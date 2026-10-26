import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { startMusicAssistantFixture } from './fixtures/music-assistant.js';
import { IntegrationManager, IntegrationFileStore } from '../src/integrations.js';
import { ManagedPlayback } from '../src/live-playback.js';
import { DemoAdapter } from '../src/playback.js';
import { Engine } from '../src/engine.js';
import { FileStore } from '../src/store.js';
import { AppError } from '../src/model.js';
import { maOperation } from '../src/ma-operation.js';

async function fixture(pollMs = 15) {
  const remote = await startMusicAssistantFixture(); const dir = await mkdtemp('/tmp/opencode/aoty-live-');
  const manager = new IntegrationManager(new IntegrationFileStore(dir)); await manager.init();
  await manager.save(remote.origin, 'fixture-token', 0); await manager.check(manager.view().revision);
  await manager.selectDestination('sonos:room', manager.view().revision);
  const adapter = new ManagedPlayback(new DemoAdapter(), manager, pollMs);
  const engine = new Engine(new FileStore(dir), adapter, 'http://localhost:3000', manager); await engine.init();
  await adapter.refresh();
  const host = () => engine.view({ kind: 'host' });
  const alex = await engine.join('Alex'); const sam = await engine.join('Sam');
  return { remote, manager, adapter, engine, host, alex, sam, dir,
    participant: (credential: string) => engine.view({ kind: 'participant', credential }),
    display: () => engine.view({ kind: 'display' }),
    close() { adapter.close(); manager.close(); remote.close(); } };
}
async function eventually(check: () => boolean) {
  for (let i = 0; i < 100; i++) { if (check()) return; await delay(10); }
  assert.ok(check(), 'Expected state transition did not occur.');
}
const writes = (f: Awaited<ReturnType<typeof fixture>>) => f.remote.calls.filter(c => /player_queues\/(play_media|stop|pause|resume|autoplay|repeat|shuffle)$/.test(c.command));

test('configured Play uses six requests and still freshly validates schema, exact recording and queue contents', async t => {
  const f = await fixture(60_000); t.after(f.close);
  Object.assign(f.remote.queue, { autoplay_enabled: false, repeat_mode: 'off', shuffle_enabled: false });
  const track = (await f.engine.search(f.alex, f.host().turnId!, 'fixture')).tracks[0]!;
  f.remote.calls.length = 0; f.remote.requests.length = 0;
  await f.engine.play(f.alex, f.host().turnId!, null, track.id);
  assert.equal(f.remote.requests.length, 6);
  assert.deepEqual(f.remote.calls.map(c => c.command), ['music/item_by_uri', 'player_queues/get_active_queue', 'player_queues/play_media', 'player_queues/get_active_queue', 'player_queues/items']);
  assert.equal(f.remote.requests.filter(r => r.path === '/info').length, 1);
  f.remote.info.schema_version = 66;
  await assert.rejects(f.engine.play(f.alex, f.host().turnId!, f.participant(f.alex).ownPlayback!.id, track.id), /schema 65/);
  assert.equal(writes(f).filter(c => c.command === 'player_queues/play_media').length, 1);
});

test('host stop confirms the owned song without advancing and rejects externally replaced audio', async t => {
  const f = await fixture(60_000); t.after(f.close);
  const turn = f.host().turnId!; const track = (await f.engine.search(f.alex, turn, 'fixture')).tracks[0]!;
  await f.engine.play(f.alex, turn, null, track.id); const id = f.host().hostPlayback!.id;
  await f.engine.stopForHost(turn, id);
  assert.equal(f.remote.queue.state, 'idle'); assert.equal(f.host().turnId, turn);
  assert.equal(f.host().hostPlayback?.status, 'stopped');
  await f.engine.play(f.alex, turn, id, track.id); const next = f.host().hostPlayback!.id;
  f.remote.calls.length = 0; f.remote.queue.current_item!.queue_item_id = 'external-item';
  await assert.rejects(f.engine.stopForHost(turn, next), error => error instanceof AppError && error.status === 409);
  assert.equal(f.remote.queue.state, 'playing'); assert.equal(f.host().turnId, turn);
  assert.equal(writes(f).length, 0);
});

test('a transient background read failure retains playback, reveal, turn and ownership without any write or recovery', async t => {
  const f = await fixture(60_000); t.after(f.close);
  const track = (await f.engine.search(f.alex, f.host().turnId!, 'fixture')).tracks[0]!;
  await f.engine.play(f.alex, f.host().turnId!, null, track.id);
  const playback = f.participant(f.alex).ownPlayback!; const turn = f.host().turnId!;
  await f.engine.reveal(f.alex, turn, playback.id);
  const before = writes(f).length;
  f.remote.failReads('player_queues/get_active_queue', 2);
  await (f.adapter as unknown as { poll(): Promise<void> }).poll();
  assert.equal(f.adapter.problem, undefined); assert.equal(f.adapter.requiresRecovery, false);
  assert.equal(f.adapter.ownsPlayback, true); assert.equal(f.engine.ready, true);
  assert.equal(f.participant(f.alex).ownPlayback?.id, playback.id); assert.equal(f.display().nowPlaying?.revealed, true);
  assert.equal(f.host().turnId, turn); assert.equal(writes(f).length, before);
});

test('exhausted read-only control preflight keeps confirmed ownership and sends no mutation', async t => {
  const f = await fixture(60_000); t.after(f.close);
  const track = (await f.engine.search(f.alex, f.host().turnId!, 'fixture')).tracks[0]!;
  await f.engine.play(f.alex, f.host().turnId!, null, track.id);
  const playback = f.participant(f.alex).ownPlayback!; const turn = f.host().turnId!; const before = writes(f).length;
  f.remote.failReads('player_queues/get_active_queue', 3);
  await assert.rejects(f.engine.control(f.alex, turn, playback.id, 'pause'));
  assert.equal(f.adapter.requiresRecovery, false); assert.equal(f.engine.ready, true);
  assert.equal(f.participant(f.alex).ownPlayback?.id, playback.id); assert.equal(f.host().turnId, turn);
  assert.equal(f.remote.queue.state, 'playing'); assert.equal(writes(f).length, before);
  await f.engine.control(f.alex, turn, playback.id, 'pause');
  assert.equal(f.remote.queue.state, 'paused'); assert.equal(f.host().turnId, turn);
});

test('persistent read failures fail closed after bounded retries with a distinct safe problem and no public diagnostics', async t => {
  const f = await fixture(60_000); t.after(f.close);
  const track = (await f.engine.search(f.alex, f.host().turnId!, 'fixture')).tracks[0]!;
  await f.engine.play(f.alex, f.host().turnId!, null, track.id);
  const turn = f.host().turnId!; const before = writes(f).length;
  f.remote.failReads('player_queues/get_active_queue', 3);
  await (f.adapter as unknown as { poll(): Promise<void> }).poll();
  assert.equal(f.adapter.problem?.code, 'connection-lost'); assert.equal(f.adapter.problem?.recoveryRequired, true);
  assert.equal(f.engine.ready, false); assert.equal(f.adapter.ownsPlayback, true);
  assert.equal(f.host().playbackProblem?.code, 'connection-lost');
  assert.equal(f.participant(f.sam).playbackProblem?.code, 'connection-lost');
  assert.equal(f.display().playbackProblem, undefined); assert.equal(f.display().playbackIssue, undefined);
  assert.equal(f.manager.view().playbackProblem?.code, 'connection-lost');
  assert.ok(!JSON.stringify(f.host().playbackProblem).includes('PRIVATE'));
  assert.equal(f.host().turnId, turn); assert.equal(writes(f).length, before);
});

test('successful recovery refreshes failed speaker readiness before acknowledging the next Play', async t => {
  const f = await fixture(60_000); t.after(f.close);
  const turn = f.host().turnId!; const track = (await f.engine.search(f.alex, turn, 'fixture')).tracks[0]!;
  await f.engine.play(f.alex, turn, null, track.id);
  f.remote.fail(true);
  await (f.adapter as unknown as { poll(): Promise<void> }).poll();
  await f.manager.check(f.manager.view().revision);
  assert.equal(f.manager.playbackAvailable, false);
  f.remote.fail(false);
  const recovered = await f.manager.recoverPlayback(f.manager.view().revision);
  assert.equal(recovered.output.state, 'ready'); assert.equal(recovered.playbackAvailable, true);
  assert.equal(recovered.playbackProblem, undefined); assert.equal(recovered.playbackIssue, '');
  assert.equal(f.remote.queue.state, 'idle'); assert.equal(f.host().turnId, turn);
  assert.equal(f.host().playbackStatus, 'idle');
  await f.engine.play(f.alex, turn, null, track.id);
  assert.equal(f.remote.queue.state, 'playing'); assert.equal(f.host().turnId, turn);
});

test('a late failed inventory inspection cannot overwrite freshly recovered readiness or block the next song', async t => {
  const f = await fixture(60_000); t.after(f.close);
  const turn = f.host().turnId!; const track = (await f.engine.search(f.alex, turn, 'fixture')).tracks[0]!;
  await f.engine.play(f.alex, turn, null, track.id);
  f.remote.failReads('player_queues/get_active_queue', 1, 200);
  await (f.adapter as unknown as { poll(): Promise<void> }).poll();
  const gate = f.remote.holdNextQueueRead(); t.after(() => gate.release());
  const oldInspection = f.manager.check(f.manager.view().revision); await gate.entered;
  const recovered = await f.manager.recoverPlayback(f.manager.view().revision);
  assert.equal(recovered.output.state, 'ready');
  gate.release(true); await oldInspection;
  assert.equal(f.manager.output.state, 'ready');
  await f.engine.play(f.alex, turn, null, track.id);
  assert.equal(f.remote.queue.state, 'playing'); assert.equal(f.host().turnId, turn);
});

test('an authorization failure is not retried or mislabeled as a connectivity problem', async t => {
  const f = await fixture(60_000); t.after(f.close);
  const track = (await f.engine.search(f.alex, f.host().turnId!, 'fixture')).tracks[0]!;
  await f.engine.play(f.alex, f.host().turnId!, null, track.id);
  const before = f.remote.calls.filter(call => call.command === 'player_queues/get_active_queue').length;
  f.remote.failReads('player_queues/get_active_queue', 1, 401);
  await (f.adapter as unknown as { poll(): Promise<void> }).poll();
  assert.equal(f.adapter.problem?.code, 'authorization');
  assert.equal(f.remote.calls.filter(call => call.command === 'player_queues/get_active_queue').length, before + 1);
});

test('unsupported queue responses are not retried, while speaker unavailability gets its own bounded failure', async t => {
  const f = await fixture(60_000); t.after(f.close);
  const track = (await f.engine.search(f.alex, f.host().turnId!, 'fixture')).tracks[0]!;
  await f.engine.play(f.alex, f.host().turnId!, null, track.id);
  const poll = () => (f.adapter as unknown as { poll(): Promise<void> }).poll();
  const before = f.remote.calls.filter(call => call.command === 'player_queues/get_active_queue').length;
  f.remote.failReads('player_queues/get_active_queue', 1, 200); await poll();
  assert.equal(f.adapter.problem?.code, 'unsupported-response');
  assert.equal(f.remote.calls.filter(call => call.command === 'player_queues/get_active_queue').length, before + 1);
  await f.manager.recoverPlayback(f.manager.view().revision);
  await f.engine.play(f.alex, f.host().turnId!, null, track.id);
  f.remote.queue.available = false; await poll();
  assert.equal(f.adapter.problem?.code, 'speaker-unavailable'); assert.equal(f.adapter.requiresRecovery, true);
});

test('an unknown playback state is rechecked and never mislabeled as stopped or completed', async t => {
  const f = await fixture(60_000); t.after(f.close);
  const turn = f.host().turnId!; const track = (await f.engine.search(f.alex, turn, 'fixture')).tracks[0]!;
  await f.engine.play(f.alex, turn, null, track.id);
  const before = writes(f).length; f.remote.queue.state = 'unknown';
  await (f.adapter as unknown as { poll(): Promise<void> }).poll();
  assert.equal(f.adapter.problem?.code, 'state-unconfirmed'); assert.equal(f.adapter.requiresRecovery, true);
  assert.equal(f.adapter.ownsPlayback, true); assert.equal(f.host().turnId, turn); assert.equal(writes(f).length, before);
  assert.ok(!f.adapter.issue.includes('Playback stopped'));
});

for (const action of ['play_media', 'pause', 'resume', 'stop'] as const) test(`a lost ${action} acknowledgement is reconciled without dispatching the mutation twice`, async t => {
  const f = await fixture(60_000); t.after(f.close);
  const turn = f.host().turnId!; const track = (await f.engine.search(f.alex, turn, 'fixture')).tracks[0]!;
  if (action === 'play_media') f.remote.loseAcknowledgement('player_queues/play_media');
  await f.engine.play(f.alex, turn, null, track.id);
  const id = f.participant(f.alex).ownPlayback!.id;
  if (action !== 'play_media') {
    if (action === 'resume') await f.engine.control(f.alex, turn, id, 'pause');
    f.remote.loseAcknowledgement(`player_queues/${action}`);
    await f.engine.control(f.alex, turn, id, action);
  }
  assert.equal(f.adapter.requiresRecovery, false); assert.equal(f.adapter.problem, undefined);
  assert.equal(f.host().turnId, turn); assert.equal(f.engine.ready, true);
  assert.equal(writes(f).filter(call => call.command === `player_queues/${action}`).length, 1);
  assert.equal(f.remote.queue.state, action === 'pause' ? 'paused' : action === 'stop' ? 'idle' : 'playing');
});

test('an unreceived replacement Play cannot mistake the old identical recording for a newly started queue item', async t => {
  const f = await fixture(60_000); t.after(f.close);
  const turn = f.host().turnId!; const track = (await f.engine.search(f.alex, turn, 'fixture')).tracks[0]!;
  await f.engine.play(f.alex, turn, null, track.id);
  const previous = f.participant(f.alex).ownPlayback!.id;
  f.remote.loseAcknowledgement('player_queues/play_media', false);
  await assert.rejects(maOperation('lost-replacement', () => f.engine.play(f.alex, turn, previous, track.id), 300));
  assert.equal(f.adapter.problem?.code, 'play-unconfirmed'); assert.equal(f.engine.ready, false);
  assert.equal(f.host().turnId, turn); assert.equal(f.display().nowPlaying?.revealed, false);
  assert.equal(writes(f).filter(call => call.command === 'player_queues/play_media').length, 2);
});

test('a lost unreceived Play cannot claim or stop a pre-existing external item with identical recording metadata', async t => {
  const f = await fixture(60_000); t.after(f.close);
  const turn = f.host().turnId!; const track = (await f.engine.search(f.alex, turn, 'fixture')).tracks[0]!;
  Object.assign(f.remote.queue, { items: 1, state: 'playing', autoplay_enabled: false, repeat_mode: 'off', shuffle_enabled: false,
    current_item: { queue_item_id: 'external-before-play', media_item: { ...f.remote.track } } });
  f.remote.loseAcknowledgement('player_queues/play_media', false);
  await assert.rejects(maOperation('lost-initial-play', () => f.engine.play(f.alex, turn, null, track.id), 300));
  assert.equal(f.adapter.problem?.code, 'play-unconfirmed');
  assert.equal(writes(f).filter(call => call.command === 'player_queues/stop').length, 0);
  await f.manager.recoverPlayback(f.manager.view().revision);
  assert.equal(writes(f).filter(call => call.command === 'player_queues/stop').length, 0);
  assert.equal(f.remote.queue.state, 'playing'); assert.equal(f.host().turnId, turn);
});

test('host pause/resume confirms the owned MA transport and leaves an externally replaced item untouched', async t => {
  const f = await fixture(60_000); t.after(f.close);
  const turn = f.host().turnId!; const track = (await f.engine.search(f.alex, turn, 'fixture')).tracks[0]!;
  await f.engine.play(f.alex, turn, null, track.id); const id = f.host().hostPlayback!.id;
  await f.engine.controlForHost(turn, id, 'pause');
  assert.equal(f.remote.queue.state, 'paused'); assert.equal(f.host().hostPlayback!.status, 'paused'); assert.equal(f.host().turnId, turn);
  await f.engine.controlForHost(turn, id, 'resume'); assert.equal(f.remote.queue.state, 'playing');
  f.remote.queue.current_item!.queue_item_id = 'external-item'; const before = writes(f).length;
  await assert.rejects(f.engine.controlForHost(turn, id, 'pause'), error => error instanceof AppError && error.status === 409);
  assert.equal(f.remote.queue.state, 'playing'); assert.equal(writes(f).length, before); assert.equal(f.host().turnId, turn);
});

test('Play changes only incorrect queue policies and verifies them before starting audio', async t => {
  const f = await fixture(60_000); t.after(f.close);
  Object.assign(f.remote.queue, { autoplay_enabled: false, repeat_mode: 'all', shuffle_enabled: false });
  const track = (await f.engine.search(f.alex, f.host().turnId!, 'fixture')).tracks[0]!;
  f.remote.ignorePolicy('repeat');
  await assert.rejects(f.engine.play(f.alex, f.host().turnId!, null, track.id), /could not be verified/);
  assert.deepEqual(writes(f).map(c => c.command), ['player_queues/repeat']);
  assert.equal(f.adapter.ownsPlayback, true, 'Uncertain policy writes retain the recovery guard.');
  f.remote.ignorePolicy(undefined); await f.manager.recoverPlayback(f.manager.view().revision);
  await f.engine.play(f.alex, f.host().turnId!, null, track.id);
  assert.deepEqual(writes(f).map(c => c.command), ['player_queues/repeat', 'player_queues/repeat', 'player_queues/play_media']);
});

for (const outcome of ['old-playing', 'old-failure', 'old-ended', 'old-unsafe'] as const) {
  test(`a held background poll cannot delay Pause or apply ${outcome} after it`, async t => {
    const f = await fixture(60_000); t.after(f.close);
    const track = (await f.engine.search(f.alex, f.host().turnId!, 'fixture')).tracks[0]!;
    await f.engine.play(f.alex, f.host().turnId!, null, track.id);
    const id = f.participant(f.alex).ownPlayback!.id; const turn = f.host().turnId!;
    if (outcome === 'old-ended') f.remote.finish();
    if (outcome === 'old-unsafe') f.remote.queue.autoplay_enabled = true;
    const gate = f.remote.holdNextQueueRead(); t.after(() => gate.release());
    const polling = (f.adapter as unknown as { poll(): Promise<void> }).poll(); await gate.entered;
    Object.assign(f.remote.queue, { state: 'playing', ended: false, autoplay_enabled: false });
    // A real deadline makes the old blocking implementation fail instead of hanging.
    await maOperation('test-pause', () => f.engine.control(f.alex, turn, id, 'pause'), 1000);
    assert.equal(f.participant(f.alex).ownPlayback!.status, 'paused');
    gate.release(outcome === 'old-failure'); await polling;
    assert.equal(f.engine.ready, true); assert.equal(f.host().turnId, turn);
    assert.equal(f.participant(f.alex).ownPlayback!.status, 'paused');
    assert.equal(writes(f).filter(c => c.command === 'player_queues/stop').length, 0);
  });
}

test('an elapsed confirmation budget retains uncertain playback and never retries the mutation', async t => {
  const f = await fixture(60_000); t.after(f.close);
  const track = (await f.engine.search(f.alex, f.host().turnId!, 'fixture')).tracks[0]!;
  await f.engine.play(f.alex, f.host().turnId!, null, track.id);
  const id = f.participant(f.alex).ownPlayback!.id;
  f.remote.ignoreControl('pause');
  await assert.rejects(maOperation('test-pause', () => f.engine.control(f.alex, f.host().turnId!, id, 'pause'), 150), /Pause could not be confirmed/);
  assert.equal(f.adapter.problem?.code, 'pause-unconfirmed');
  assert.equal(f.engine.ready, false); assert.equal(f.adapter.ownsPlayback, true);
  assert.equal(writes(f).filter(c => c.command === 'player_queues/pause').length, 1);
  assert.ok(f.remote.calls.filter(c => c.command === 'player_queues/get_active_queue').length < 10);
});

test('an expired queued Play is rejected before resolving or writing to Music Assistant', async t => {
  const f = await fixture(60_000); t.after(f.close);
  const track = (await f.engine.search(f.alex, f.host().turnId!, 'fixture')).tracks[0]!;
  let release!: () => void; let enter!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; }); t.after(() => release());
  const entered = new Promise<void>(resolve => { enter = resolve; });
  const blocked = (f.engine as unknown as { serial(work: () => Promise<void>): Promise<void> }).serial(async () => { enter(); await gate; });
  await entered; f.remote.calls.length = 0;
  const rejected = assert.rejects(maOperation('queued-play', () => f.engine.play(f.alex, f.host().turnId!, null, track.id), 30), /timed out/);
  await delay(50); release(); await blocked; await rejected;
  assert.equal(f.remote.calls.some(c => c.command === 'music/item_by_uri'), false);
  assert.equal(writes(f).length, 0); assert.equal(f.adapter.ownsPlayback, false);
});

test('authenticated queue events reconcile natural completion without waiting for the polling interval', async t => {
  const f = await fixture(60_000); t.after(f.close);
  await eventually(() => f.remote.eventClients === 1);
  const track = (await f.engine.search(f.alex, f.host().turnId!, 'fixture')).tracks[0]!;
  await f.engine.play(f.alex, f.host().turnId!, null, track.id);
  f.remote.finish();
  await eventually(() => f.host().current?.nickname === 'Sam');
  assert.ok(f.remote.websocketCommands.every(command => command === 'auth'));
  assert.equal(writes(f).filter(c => c.command === 'player_queues/play_media').length, 1);
});

test('queue events wake confirmation early but only an HTTP ownership read confirms Pause', async t => {
  const f = await fixture(60_000); t.after(f.close);
  await eventually(() => f.remote.eventClients === 1);
  const track = (await f.engine.search(f.alex, f.host().turnId!, 'fixture')).tracks[0]!;
  await f.engine.play(f.alex, f.host().turnId!, null, track.id);
  const id = f.participant(f.alex).ownPlayback!.id;
  f.remote.ignoreControl('pause');
  const paused = maOperation('event-pause', () => f.engine.control(f.alex, f.host().turnId!, id, 'pause'), 220);
  await eventually(() => (f.adapter as unknown as { eventWaiters: Set<unknown> }).eventWaiters.size > 0);
  f.remote.queue.state = 'paused'; f.remote.notify(); await paused;
  assert.equal(f.participant(f.alex).ownPlayback!.status, 'paused');
  assert.equal(writes(f).filter(c => c.command === 'player_queues/pause').length, 1);
});

for (const active of [true, false]) test(`natural completion advances after MA's delayed ended flag with active=${active}`, async t => {
  const f = await fixture(60_000); t.after(f.close);
  const poll = () => (f.adapter as unknown as { poll(): Promise<void> }).poll();
  const track = (await f.engine.search(f.alex, f.host().turnId!, 'fixture')).tracks[0]!;
  await f.engine.play(f.alex, f.host().turnId!, null, track.id);
  const turn = f.host().turnId; const playbackId = f.participant(f.alex).ownPlayback!.id; const before = writes(f).length;
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  Object.assign(f.remote.queue, { state: 'idle', active, ended: false });
  await poll(); t.mock.timers.tick(5000); await poll();
  assert.equal(f.host().turnId, turn); assert.equal(f.adapter.ownsPlayback, true);
  assert.equal(writes(f).length, before, 'Waiting for completion must not send audio commands.');
  f.remote.finish(); await poll();
  await eventually(() => f.host().current?.nickname === 'Sam');
  const nextTurn = f.host().turnId;
  await poll(); await f.engine.complete(playbackId);
  assert.equal(f.host().turnId, nextTurn); assert.equal(f.participant(f.sam).ownPlayback, null);
  assert.equal(f.display().nowPlaying?.revealed, false); assert.equal(f.adapter.ownsPlayback, false);
  assert.equal(writes(f).length, before, 'Completion must not start the next participant’s song.');
});

test('idle without a confirmed natural end expires without advancing, even at the track duration', async t => {
  const f = await fixture(60_000); t.after(f.close);
  const poll = () => (f.adapter as unknown as { poll(): Promise<void> }).poll();
  const track = (await f.engine.search(f.alex, f.host().turnId!, 'fixture')).tracks[0]!;
  await f.engine.play(f.alex, f.host().turnId!, null, track.id);
  const turn = f.host().turnId; const before = writes(f).length;
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  Object.assign(f.remote.queue, { state: 'idle', ended: false, elapsed_time: track.duration });
  await poll(); t.mock.timers.tick(10_000); await poll();
  await eventually(() => f.participant(f.alex).ownPlayback === null);
  f.remote.finish(); await poll();
  assert.equal(f.host().turnId, turn); assert.equal(f.adapter.ownsPlayback, false); assert.equal(writes(f).length, before);
});

for (const change of ['stop', 'replacement', 'connection-loss'] as const) test(`${change} during completion confirmation never advances the turn`, async t => {
  const f = await fixture(60_000); t.after(f.close);
  const poll = () => (f.adapter as unknown as { poll(): Promise<void> }).poll();
  const track = (await f.engine.search(f.alex, f.host().turnId!, 'fixture')).tracks[0]!;
  await f.engine.play(f.alex, f.host().turnId!, null, track.id);
  const turn = f.host().turnId!; const playbackId = f.participant(f.alex).ownPlayback!.id; const before = writes(f).length;
  f.remote.queue.state = 'idle'; await poll();
  if (change === 'stop') await f.engine.control(f.alex, turn, playbackId, 'stop');
  else if (change === 'replacement') f.remote.queue.current_item!.queue_item_id = 'external-item';
  else f.remote.fail(true);
  f.remote.finish(); await poll();
  assert.equal(f.host().turnId, turn); assert.equal(writes(f).length, before);
  assert.equal(f.engine.ready, change !== 'connection-loss');
});

test('playback follows configured connection/destination automatically without setup or volume writes', async t => {
  const remote = await startMusicAssistantFixture(); t.after(remote.close);
  const manager = new IntegrationManager(new IntegrationFileStore(await mkdtemp('/tmp/opencode/aoty-auto-'))); await manager.init();
  const adapter = new ManagedPlayback(new DemoAdapter(), manager); t.after(() => adapter.close());
  assert.equal(adapter.mode, 'demo'); assert.equal(manager.playbackAvailable, false);
  await manager.save(remote.origin, 'fixture-token', manager.view().revision);
  assert.equal(adapter.mode, 'music-assistant'); assert.equal(manager.playbackAvailable, false);
  const track = (await manager.search('fixture', 'private-context'))[0]!;
  await assert.rejects(adapter.resolve(track.id, 'private-context'), error => error instanceof AppError && error.status === 409);
  await manager.selectDestination('sonos:room', manager.view().revision); await adapter.refresh();
  assert.equal(manager.playbackAvailable, true); assert.equal(adapter.volume.available, true);
  await manager.selectDestination('sonos:bedroom', manager.view().revision); await adapter.refresh();
  assert.equal(manager.playbackAvailable, true); assert.equal(adapter.volume.available, true);
  await manager.clear(manager.view().revision);
  assert.equal(adapter.mode, 'demo'); assert.equal(manager.playbackAvailable, false);
  assert.equal(remote.calls.filter(call => /^(players\/cmd\/|player_queues\/(play_media|stop|pause|resume|autoplay|repeat|shuffle)$)/.test(call.command)).length, 0);
});

test('automatic availability never bypasses schema or destination checks before audio commands', async t => {
  const f = await fixture(); t.after(f.close);
  const track = (await f.engine.search(f.alex, f.host().turnId!, 'fixture')).tracks[0]!;
  f.remote.info.schema_version = 66;
  await f.manager.save(f.remote.origin, undefined, f.manager.view().revision); await f.adapter.refresh();
  assert.equal(f.adapter.volume.available, false);
  await assert.rejects(f.engine.play(f.alex, f.host().turnId!, null, track.id), error => error instanceof AppError && error.status === 422);
  assert.equal(f.engine.ready, true, 'Unsupported playback must not prevent private browsing.');
  assert.ok((await f.engine.search(f.sam, f.host().turnId!, 'fixture')).tracks.length);
  f.remote.info.schema_version = 65; f.remote.queue.available = false;
  await assert.rejects(f.engine.play(f.alex, f.host().turnId!, null, track.id), error => error instanceof AppError && error.status === 502);
  assert.equal(f.adapter.ownsPlayback, false); assert.equal(writes(f).length, 0);
  f.remote.queue.available = true;
  await f.engine.play(f.alex, f.host().turnId!, null, track.id);
  assert.equal(f.remote.queue.state, 'playing');
});

test('a resolved live recording never falls back to the demo timer after disconnect', async t => {
  const f = await fixture(); t.after(f.close);
  const context = f.engine.catalogueContext(f.alex);
  const reference = (await f.manager.search('fixture', context))[0]!;
  const resolved = await f.adapter.resolve(reference.id, context);
  await f.manager.clear(f.manager.view().revision);
  await assert.rejects(f.adapter.play(resolved, crypto.randomUUID()), error => error instanceof AppError && error.status === 409);
  assert.equal(f.adapter.ownsPlayback, false); assert.equal(writes(f).length, 0);
});

test('a connection save racing demo Play cannot change source underneath newly owned playback', async t => {
  const dir = await mkdtemp('/tmp/opencode/aoty-demo-config-race-'); const store = new IntegrationFileStore(dir);
  const manager = new IntegrationManager(store); await manager.init();
  const demo = new DemoAdapter(3600); const adapter = new ManagedPlayback(demo, manager); t.after(() => adapter.close());
  const track = await adapter.resolve('demo:aurora');
  const save = store.save.bind(store); let entered!: () => void; let release!: () => void;
  const waiting = new Promise<void>(resolve => { entered = resolve; }); const gate = new Promise<void>(resolve => { release = resolve; });
  store.save = async state => { entered(); await gate; await save(state); };
  const saving = manager.save('http://localhost:8095', 'fixture-token', 0); await waiting;
  const playing = adapter.play(track, crypto.randomUUID()); const result = Promise.allSettled([saving, playing]);
  release(); const outcomes = await result;
  assert.equal(outcomes[0]!.status, 'fulfilled'); assert.equal(outcomes[1]!.status, 'rejected');
  assert.equal(adapter.ownsPlayback, false); assert.equal(manager.configured, true);
});

test('a non-current participant privately browses artist/albums/tracks, prepares across turns, and only plays when current', async t => {
  const f = await fixture(); t.after(f.close);
  const artists = await f.engine.browse(f.sam, 'artists', 'Fixture');
  const albums = await f.engine.browse(f.sam, 'albums', artists.artists![0]!.id);
  const tracks = await f.engine.browse(f.sam, 'tracks', albums.albums![0]!.id);
  const prepared = tracks.tracks![0]!;
  assert.ok(prepared.id.startsWith('ref:')); assert.equal(writes(f).length, 0);
  for (const state of [f.host(), f.display(), f.participant(f.alex), f.participant(f.sam)]) assert.ok(!JSON.stringify(state).includes('Fixture album'));
  await assert.rejects(f.engine.browse(f.alex, 'albums', artists.artists![0]!.id), e => e instanceof AppError && e.status === 409);
  await assert.rejects(f.engine.browse(f.sam, 'tracks', `${albums.albums![0]!.id}x`), e => e instanceof AppError && e.status === 409);
  assert.equal(f.manager.playbackAvailable, true);
  assert.equal(writes(f).length, 0, 'Setup and browsing must be read-only.');
  await assert.rejects(f.engine.play(f.sam, f.host().turnId!, null, prepared.id), e => e instanceof AppError && e.status === 403);
  await assert.rejects(f.engine.play(f.alex, f.host().turnId!, null, prepared.id), e => e instanceof AppError && e.status === 409);
  await f.engine.advance(f.host().turnId!);
  await f.engine.play(f.sam, f.host().turnId!, null, prepared.id);
  assert.equal(f.remote.queue.state, 'playing'); assert.equal(f.remote.queue.items, 1);
  assert.equal(f.remote.queue.autoplay_enabled, false); assert.equal(f.remote.queue.repeat_mode, 'off'); assert.equal(f.remote.queue.shuffle_enabled, false);
  assert.deepEqual(writes(f).find(c => c.command === 'player_queues/play_media')!.args.media, [f.remote.track.uri]);
  assert.equal(f.display().nowPlaying!.revealed, false);
  const playback = f.participant(f.sam).ownPlayback!;
  await f.engine.reveal(f.sam, f.host().turnId!, playback.id);
  assert.ok(JSON.stringify(f.display()).includes('Real catalogue fixture'));
  assert.ok(!JSON.stringify(f.participant(f.alex)).includes('Real catalogue fixture'));
  await assert.rejects(f.manager.clear(f.manager.view().revision), e => e instanceof AppError && e.status === 409);
  await f.engine.advance(f.host().turnId!, f.sam);
  assert.equal(f.remote.queue.state, 'idle'); assert.equal(f.host().current!.nickname, 'Alex');
});

test('authoritative ended flag advances exactly once; pause and explicit stop do not advance', async t => {
  const f = await fixture(); t.after(f.close);
  let track = (await f.engine.search(f.alex, f.host().turnId!, 'fixture')).tracks[0]!;
  await f.engine.play(f.alex, f.host().turnId!, null, track.id);
  const first = f.participant(f.alex).ownPlayback!.id;
  await f.engine.control(f.alex, f.host().turnId!, first, 'pause'); await delay(40);
  assert.equal(f.host().current!.nickname, 'Alex');
  await f.engine.control(f.alex, f.host().turnId!, first, 'resume');
  await f.engine.control(f.alex, f.host().turnId!, first, 'stop'); f.remote.finish(); await delay(40);
  assert.equal(f.host().current!.nickname, 'Alex');
  track = (await f.engine.search(f.alex, f.host().turnId!, 'fixture')).tracks[0]!;
  await f.engine.play(f.alex, f.host().turnId!, first, track.id);
  const last = f.participant(f.alex).ownPlayback!.id;
  f.remote.finish(); await eventually(() => f.host().current?.nickname === 'Sam');
  await f.engine.complete(last); assert.equal(f.host().current!.nickname, 'Sam');
  assert.equal(f.display().nowPlaying!.revealed, false);
});

test('connection loss conceals metadata and fails closed; explicit recovery stops only the still-owned item', async t => {
  const f = await fixture(); t.after(f.close);
  const track = (await f.engine.search(f.alex, f.host().turnId!, 'fixture')).tracks[0]!;
  await f.engine.play(f.alex, f.host().turnId!, null, track.id);
  await f.engine.reveal(f.alex, f.host().turnId!, f.participant(f.alex).ownPlayback!.id);
  f.remote.fail(true); await eventually(() => !f.engine.ready);
  assert.equal(f.display().nowPlaying!.revealed, false);
  await assert.rejects(f.engine.advance(f.host().turnId!), e => e instanceof AppError && e.status === 503);
  f.remote.fail(false); await f.manager.recoverPlayback(f.manager.view().revision);
  await eventually(() => f.engine.ready && f.participant(f.alex).ownPlayback === null);
  assert.equal(f.remote.queue.state, 'idle'); assert.equal(f.host().current!.nickname, 'Alex');
  assert.equal(writes(f).filter(c => c.command === 'player_queues/play_media').length, 1);
});

test('externally replaced queue items invalidate reveal without stopping somebody else’s audio', async t => {
  const f = await fixture(); t.after(f.close);
  const track = (await f.engine.search(f.alex, f.host().turnId!, 'fixture')).tracks[0]!;
  await f.engine.play(f.alex, f.host().turnId!, null, track.id);
  await f.engine.reveal(f.alex, f.host().turnId!, f.participant(f.alex).ownPlayback!.id);
  f.remote.queue.current_item!.queue_item_id = 'someone-else-same-recording';
  await eventually(() => f.participant(f.alex).ownPlayback === null);
  assert.equal(f.display().nowPlaying!.revealed, false); assert.equal(f.engine.ready, true);
  assert.equal(f.adapter.problem?.code, 'external-playback'); assert.equal(f.adapter.problem?.recoveryRequired, false);
  await f.engine.advance(f.host().turnId!);
  assert.equal(f.remote.queue.state, 'playing'); assert.equal(writes(f).filter(c => c.command === 'player_queues/stop').length, 0);
});

test('a changed version on the same queue item invalidates ownership without stopping substituted audio', async t => {
  const f = await fixture(); t.after(f.close);
  const track = (await f.engine.search(f.alex, f.host().turnId!, 'fixture')).tracks[0]!;
  await f.engine.play(f.alex, f.host().turnId!, null, track.id);
  await f.engine.reveal(f.alex, f.host().turnId!, f.participant(f.alex).ownPlayback!.id);
  f.remote.queue.current_item!.media_item.version = 'Different recording version';
  await eventually(() => f.participant(f.alex).ownPlayback === null);
  assert.equal(f.display().nowPlaying?.revealed, false);
  assert.equal(writes(f).filter(call => call.command === 'player_queues/stop').length, 0);
  assert.equal(f.host().current?.nickname, 'Alex');
});

test('changed recording versions fail before playback and prepared references cannot survive connection changes', async t => {
  const f = await fixture(); t.after(f.close);
  const track = (await f.engine.search(f.alex, f.host().turnId!, 'fixture')).tracks[0]!;
  f.remote.track.version = 'Different remaster';
  await assert.rejects(f.engine.play(f.alex, f.host().turnId!, null, track.id), e => e instanceof AppError && e.status === 422);
  assert.equal(writes(f).length, 0);
  await f.manager.save(f.remote.origin, 'browser-test-token', f.manager.view().revision);
  await f.manager.check(f.manager.view().revision);
  await assert.rejects(f.engine.play(f.alex, f.host().turnId!, null, track.id), e => e instanceof AppError && e.status === 409);
});

test('unsafe continuation changes stop owned playback and never advance the turn', async t => {
  const f = await fixture(); t.after(f.close);
  const track = (await f.engine.search(f.alex, f.host().turnId!, 'fixture')).tracks[0]!;
  await f.engine.play(f.alex, f.host().turnId!, null, track.id);
  f.remote.queue.autoplay_enabled = true;
  await eventually(() => f.adapter.problem?.code === 'queue-policy-stopped');
  assert.equal(f.engine.ready, true); assert.equal(f.adapter.ownsPlayback, false);
  assert.equal(f.adapter.problem?.recoveryRequired, false);
  await eventually(() => f.participant(f.alex).ownPlayback === null);
  assert.equal(f.host().playbackStatus, 'idle');
  assert.equal(f.remote.queue.state, 'idle'); assert.equal(f.host().current!.nickname, 'Alex');
});

test('an acknowledged but ignored stop keeps ownership uncertain and never advances the turn', async t => {
  const f = await fixture(); t.after(f.close);
  const track = (await f.engine.search(f.alex, f.host().turnId!, 'fixture')).tracks[0]!;
  await f.engine.play(f.alex, f.host().turnId!, null, track.id);
  const turnId = f.host().turnId;
  f.remote.ignoreControl('stop');
  await assert.rejects(f.engine.advance(turnId!), error => error instanceof AppError && error.status === 503);
  assert.equal(f.host().turnId, turnId); assert.equal(f.remote.queue.state, 'playing');
  assert.equal(f.adapter.ownsPlayback, true); assert.equal(f.engine.ready, false);
  f.remote.ignoreControl(undefined);
  await f.manager.recoverPlayback(f.manager.view().revision);
  assert.equal(f.remote.queue.state, 'idle'); assert.equal(f.adapter.ownsPlayback, false);
});

test('restart revalidates the output before restoring readiness without taking ownership or starting audio', async t => {
  const f = await fixture(); t.after(f.close);
  const track = (await f.engine.search(f.alex, f.host().turnId!, 'fixture')).tracks[0]!;
  await f.engine.play(f.alex, f.host().turnId!, null, track.id);
  f.adapter.close(); const before = writes(f).length;
  const manager = new IntegrationManager(new IntegrationFileStore(f.dir)); await manager.init();
  const adapter = new ManagedPlayback(new DemoAdapter(), manager); t.after(() => adapter.close());
  const engine = new Engine(new FileStore(f.dir), adapter, 'http://localhost:3000', manager); await engine.init();
  await adapter.refresh();
  assert.equal(manager.playbackAvailable, false); assert.equal(manager.output.state, 'checking');
  await manager.check(manager.view().revision);
  assert.equal(manager.playbackAvailable, true); assert.equal(writes(f).length, before);
  assert.equal(adapter.ownsPlayback, false); assert.equal(f.remote.queue.state, 'playing');
  assert.equal(engine.view({ kind: 'participant', credential: f.alex }).ownPlayback, null);
  await assert.rejects(engine.play(f.alex, engine.view({ kind: 'host' }).turnId!, null, track.id), e => e instanceof AppError && e.status === 409);
  assert.equal(writes(f).length, before);
  const fresh = (await engine.search(f.alex, engine.view({ kind: 'host' }).turnId!, 'fixture')).tracks[0]!;
  await engine.play(f.alex, engine.view({ kind: 'host' }).turnId!, null, fresh.id);
  assert.equal(writes(f).filter(call => call.command === 'player_queues/play_media').length, 2);
});

test('inactive cached queues are not treated as ownership of an external source', async t => {
  const f = await fixture(); t.after(f.close);
  const track = (await f.engine.search(f.alex, f.host().turnId!, 'fixture')).tracks[0]!;
  await f.engine.play(f.alex, f.host().turnId!, null, track.id);
  f.remote.queue.active = false;
  await eventually(() => f.participant(f.alex).ownPlayback === null);
  await f.engine.advance(f.host().turnId!);
  assert.equal(writes(f).filter(c => c.command === 'player_queues/stop').length, 0);
});

test('a failed replacement invalidates the previous revealed playback as well as the unverified new item', async t => {
  const f = await fixture(); t.after(f.close);
  const track = (await f.engine.search(f.alex, f.host().turnId!, 'fixture')).tracks[0]!;
  await f.engine.play(f.alex, f.host().turnId!, null, track.id);
  const previous = f.participant(f.alex).ownPlayback!.id;
  await f.engine.reveal(f.alex, f.host().turnId!, previous);
  f.remote.failNextPlaybackVerification();
  await assert.rejects(f.engine.play(f.alex, f.host().turnId!, previous, track.id), e => e instanceof AppError && e.status === 502);
  await eventually(() => f.participant(f.alex).ownPlayback === null);
  assert.equal(f.display().nowPlaying!.revealed, false);
  f.remote.fail(false); await f.manager.recoverPlayback(f.manager.view().revision);
  assert.equal(f.engine.ready, true); assert.equal(f.participant(f.alex).ownPlayback, null);
});

test('Music Assistant pause-to-idle parking has no expiry and resumes the same item/position only on request', async t => {
  const f = await fixture(); t.after(f.close);
  const track = (await f.engine.search(f.alex, f.host().turnId!, 'fixture')).tracks[0]!;
  await f.engine.play(f.alex, f.host().turnId!, null, track.id);
  f.remote.queue.elapsed_time = 45; f.remote.queue.elapsed_time_last_updated = Date.now() / 1000;
  const id = f.participant(f.alex).ownPlayback!.id; const turnId = f.host().turnId!;
  await f.engine.control(f.alex, turnId, id, 'pause'); await f.engine.reveal(f.alex, turnId, id);
  const paused = f.display().progress!.elapsed!; const before = writes(f).length;
  f.remote.parkPaused();
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() }); t.mock.timers.tick(24 * 60 * 60_000);
  await delay(90);
  assert.equal(f.host().turnId, turnId); assert.equal(f.participant(f.alex).ownPlayback!.id, id);
  assert.equal(f.participant(f.alex).ownPlayback!.status, 'paused'); assert.equal(f.display().nowPlaying!.revealed, true);
  assert.equal(f.display().progress!.elapsed, paused); assert.equal(writes(f).length, before);
  // This controller-only fixture has no HTTP-owned inventory monitor; revalidate after the clock jump.
  await f.manager.check(f.manager.view().revision);
  await f.engine.setVolume(25, turnId, f.alex, id);
  await f.engine.control(f.alex, turnId, id, 'resume');
  assert.equal(f.remote.queue.state, 'playing'); assert.equal(f.participant(f.alex).ownPlayback!.id, id);
  assert.ok(f.remote.queue.elapsed_time >= 45); assert.equal(f.host().turnId, turnId);
  assert.equal(writes(f).filter(call => call.command === 'player_queues/play_media').length, 1);
});

test('finishing a parked pause issues no resume/stop, while another active source still revokes resume ownership', async t => {
  const f = await fixture(); t.after(f.close);
  const track = (await f.engine.search(f.alex, f.host().turnId!, 'fixture')).tracks[0]!;
  await f.engine.play(f.alex, f.host().turnId!, null, track.id); const id = f.participant(f.alex).ownPlayback!.id;
  await f.engine.control(f.alex, f.host().turnId!, id, 'pause'); f.remote.parkPaused(); await delay(45);
  const before = writes(f).length; await f.engine.advance(f.host().turnId!);
  assert.equal(writes(f).length, before); assert.equal(f.host().current!.nickname, 'Sam');
  const next = (await f.engine.search(f.sam, f.host().turnId!, 'fixture')).tracks[0]!;
  await f.engine.play(f.sam, f.host().turnId!, null, next.id); const second = f.participant(f.sam).ownPlayback!.id;
  await f.engine.control(f.sam, f.host().turnId!, second, 'pause'); f.remote.parkPaused();
  f.remote.player.active_source = 'external-spotify-connect'; f.remote.player.playback_state = 'paused';
  const count = writes(f).length;
  await assert.rejects(f.engine.control(f.sam, f.host().turnId!, second, 'resume'), e => e instanceof AppError && e.status === 409);
  assert.equal(writes(f).length, count); assert.equal(f.host().current!.nickname, 'Sam');
});
