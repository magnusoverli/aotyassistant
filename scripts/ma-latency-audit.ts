import { mkdtemp, rm } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { performance } from 'node:perf_hooks';
import assert from 'node:assert/strict';
import { startMusicAssistantFixture } from '../tests/fixtures/music-assistant.js';
import { MusicAssistantClient } from '../src/music-assistant.js';
import { MusicAssistantTransport } from '../src/music-assistant-transport.js';
import { IntegrationManager, IntegrationFileStore } from '../src/integrations.js';
import { ManagedPlayback } from '../src/live-playback.js';
import { DemoAdapter } from '../src/playback.js';
import { Engine } from '../src/engine.js';
import { FileStore } from '../src/store.js';

// Synthetic fixture only: no deployed credentials, provider or speaker access.
// Add deterministic per-request latency around the real HTTP transport and client.
type Call = { command: string; startMs: number; durationMs: number };
type Gate = { entered(): void; released: Promise<void> };
const round = (value: number) => Math.round(value * 10) / 10;

async function fixture() {
  const remote = await startMusicAssistantFixture();
  const directory = await mkdtemp('/tmp/opencode/aoty-latency-');
  const calls: Call[] = [];
  let latency = 0; let start = performance.now(); let measuring = false;
  let gate: Gate | undefined;
  let persistenceMs = 0;
  const manager = new IntegrationManager(new IntegrationFileStore(directory), (url, token) => {
    const transport = new MusicAssistantTransport(url, token);
    return new MusicAssistantClient(url, token, 8000, {
      close() { transport.close(); },
      async read(path, command, args, binary) {
        const began = performance.now();
        const call = { command: command ?? path, startMs: round(began - start), durationMs: 0 };
        if (measuring) calls.push(call);
        if (command === 'player_queues/get_active_queue' && gate) {
          const waiting = gate; gate = undefined; waiting.entered(); await waiting.released;
        }
        if (latency) await delay(latency);
        try { return await transport.read(path, command, args, binary); }
        finally { call.durationMs = round(performance.now() - began); }
      },
    });
  });
  await manager.init();
  await manager.save(remote.origin, 'fixture-token', 0);
  await manager.selectDestination('sonos:room', manager.view().revision);
  const adapter = new ManagedPlayback(new DemoAdapter(), manager, 60_000);
  const store = new FileStore(directory); const save = store.save.bind(store);
  store.save = async state => {
    const began = performance.now(); await save(state);
    if (measuring) persistenceMs += performance.now() - began;
  };
  const engine = new Engine(store, adapter, 'http://localhost:3000', manager);
  await engine.init(); await adapter.refresh();
  const member = await engine.join('Latency fixture');
  const state = () => engine.view({ kind: 'participant', credential: member });
  const track = (await engine.search(member, state().turnId!, 'fixture')).tracks[0]!;
  const play = () => engine.play(member, state().turnId!, state().ownPlayback?.id ?? null, track.id);
  const control = (action: 'pause' | 'resume' | 'stop') => engine.control(member, state().turnId!, state().ownPlayback!.id, action);
  return {
    remote, adapter, manager, engine, member, state, play, control,
    blockQueue() {
      let entered!: () => void; let release!: () => void;
      const pending = new Promise<void>(resolve => { entered = resolve; });
      const released = new Promise<void>(resolve => { release = resolve; });
      gate = { entered, released }; return { pending, release };
    },
    async measure(action: string, requestLatencyMs: number, work: () => Promise<unknown>) {
      latency = requestLatencyMs; calls.length = 0; persistenceMs = 0; measuring = true; start = performance.now();
      try {
        await work();
        return { action, requestLatencyMs, elapsedMs: round(performance.now() - start), persistenceMs: round(persistenceMs),
          requests: calls.length, playDispatchMs: calls.find(call => call.command === 'player_queues/play_media')?.startMs, calls: [...calls] };
      } finally { measuring = false; latency = 0; }
    },
    async close() { adapter.close(); manager.close(); remote.close(); await rm(directory, { recursive: true, force: true }); },
  };
}

const results = [];
for (const latency of [0, 50, 200]) {
  for (const action of ['play', 'play-configured', 'pause', 'resume', 'parked-resume', 'participant-volume', 'host-volume', 'finish', 'reveal', 'settings-discovery']) {
    const f = await fixture();
    try {
      if (!['play', 'play-configured', 'host-volume', 'settings-discovery'].includes(action)) await f.play();
      if (action === 'play-configured') Object.assign(f.remote.queue, { autoplay_enabled: false, repeat_mode: 'off', shuffle_enabled: false });
      if (action === 'resume' || action === 'parked-resume') await f.control('pause');
      if (action === 'parked-resume') f.remote.parkPaused();
      results.push(await f.measure(action, latency, async () => {
        if (action === 'play' || action === 'play-configured') return f.play();
        if (action === 'pause') return f.control('pause');
        if (action === 'resume' || action === 'parked-resume') return f.control('resume');
        if (action === 'participant-volume') return f.engine.setVolume(40, f.state().turnId, f.member, f.state().ownPlayback!.id, f.adapter.volume.revision);
        if (action === 'host-volume') return f.engine.setVolume(40, f.state().turnId, undefined, undefined, f.adapter.volume.revision);
        if (action === 'finish') return f.engine.advance(f.state().turnId!, f.member);
        if (action === 'reveal') return f.engine.reveal(f.member, f.state().turnId!, f.state().ownPlayback!.id);
        return f.manager.check(f.manager.view().revision);
      }));
    } finally { await f.close(); }
  }
}

// Trigger the real ownership poll explicitly rather than waiting on its timer.
// Hold its queue read to measure head-of-line blocking of a user control.
{
  const f = await fixture();
  try {
    await f.play(); const blocked = f.blockQueue();
    const polling = (f.adapter as unknown as { poll(): Promise<void> }).poll();
    await blocked.pending;
    const release = delay(300).then(blocked.release);
    results.push(await f.measure('pause-behind-300ms-poll', 0, () => f.control('pause')));
    await release; await polling;
  } finally { await f.close(); }
}

// Joins must remain responsive while the separate playback lane starts a track.
{
  const f = await fixture();
  try {
    const blocked = f.blockQueue(); const playing = f.play(); await blocked.pending;
    const release = delay(300).then(blocked.release);
    results.push(await f.measure('join-behind-starting-play', 0, () => f.engine.join('Arriving listener')));
    await release; await playing;
  } finally { await f.close(); }
}

// An accepted command with no state change consumes the confirmation budget.
{
  const f = await fixture();
  try {
    await f.play(); f.remote.ignoreControl('pause');
    results.push(await f.measure('pause-never-confirmed', 0, () =>
      assert.rejects(f.control('pause'), /Playback connectivity or queue state is uncertain/)));
  } finally { await f.close(); }
}

console.log(JSON.stringify({ synthetic: true, note: 'Request latency is injected, not measured LAN latency. No audible speaker timing. Background timers are excluded except the explicit blocked-poll case.', results }, null, 2));
