import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Engine } from '../src/engine.js';
import { DemoAdapter } from '../src/playback.js';
import { stateSchema, type State, type Track } from '../src/model.js';
import type { Store } from '../src/store.js';

class MemoryStore implements Store {
  state: State = { schema: 3, room: null };
  saves = 0; fail = false; gate?: Promise<void>;
  async load() { return stateSchema.parse(structuredClone(this.state)); }
  async save(state: State) { await this.gate; if (this.fail) throw new Error('disk failure'); this.state = structuredClone(state); this.saves++; }
}
class ObservedAdapter extends DemoAdapter {
  id = ''; sample: { elapsed: number; duration: number } | null = { elapsed: 0, duration: 100 };
  controls: string[] = [];
  override async play(_track: Track, id: string) { this.id = id; }
  override progress(id: string) { return id === this.id ? this.sample : null; }
  override async control(action: 'pause' | 'resume' | 'stop') { this.controls.push(action); }
}
async function fixture() {
  const store = new MemoryStore(); const adapter = new ObservedAdapter(100);
  const engine = new Engine(store, adapter, 'http://localhost:3000'); await engine.init();
  const credential = await engine.join('Listener'); const other = await engine.join('Next');
  const host = () => engine.view({ kind: 'host' }); const display = () => engine.view({ kind: 'display' });
  const own = () => engine.view({ kind: 'participant', credential });
  await engine.play(credential, host().turnId!, null, 'demo:aurora');
  const tick = async (elapsed: number, duration = 100) => {
    adapter.sample = { elapsed, duration }; adapter.onProgress(); await engine.drain(); await new Promise<void>(resolve => setImmediate(resolve));
  };
  return { store, adapter, engine, credential, other, host, display, own, tick };
}

test('auto reveal defaults on, triggers at exactly 70% once, and preserves role privacy and the turn', async () => {
  const f = await fixture();
  assert.deepEqual(f.engine.playbackSettings(), { enabled: true, revision: 0 });
  const turn = f.host().turnId; const id = f.host().hostPlayback!.id;
  for (const view of [f.host(), f.display(), f.own()]) assert.equal(view.progress?.autoRevealAt, .7);
  await f.tick(69.999); assert.equal(f.display().nowPlaying?.revealed, false);
  const saves = f.store.saves;
  await f.tick(70); assert.equal(f.display().nowPlaying?.revealed, true);
  assert.equal(f.store.saves, saves + 1);
  for (const view of [f.host(), f.display(), f.own()]) assert.equal(view.progress?.autoRevealAt, undefined);
  for (const view of [f.host(), f.engine.view({ kind: 'participant', credential: f.other })]) {
    for (const secret of ['Northern Lights', 'The Paper Satellites', 'After the Winter', '/demo-cover.svg']) assert.ok(!JSON.stringify(view).includes(secret));
  }
  await f.tick(90); assert.equal(f.store.saves, saves + 1);
  assert.equal(f.host().turnId, turn); assert.equal(f.host().hostPlayback!.id, id); assert.deepEqual(f.adapter.controls, []);
});

test('manual reveal removes the marker and automatic progress cannot reveal twice or affect a replacement', async () => {
  const f = await fixture();
  await f.engine.reveal(f.credential, f.own().turnId!, f.own().ownPlayback!.id);
  assert.equal(f.display().progress?.autoRevealAt, undefined);
  const saves = f.store.saves; await f.tick(80); assert.equal(f.store.saves, saves);
  await f.engine.play(f.credential, f.own().turnId!, f.own().ownPlayback!.id, 'demo:summer');
  await f.tick(10); assert.equal(f.display().nowPlaying?.revealed, false); assert.equal(f.display().progress?.autoRevealAt, .7);
  f.adapter.id = 'stale-playback'; await f.tick(90); assert.equal(f.display().nowPlaying?.revealed, false);
});

test('settings persist through restart, reject stale writes, and enabling evaluates current progress', async () => {
  const f = await fixture();
  await f.engine.setAutoReveal(false, 0); await f.tick(90);
  assert.equal(f.display().nowPlaying?.revealed, false); assert.equal(f.display().progress?.autoRevealAt, undefined);
  await assert.rejects(f.engine.setAutoReveal(true, 0), /settings changed/);
  const restored = new Engine(f.store, new ObservedAdapter(), 'http://localhost:3000'); await restored.init();
  assert.deepEqual(restored.playbackSettings(), { enabled: false, revision: 1 });
  await f.engine.setAutoReveal(true, 1); await f.engine.drain();
  assert.equal(f.display().nowPlaying?.revealed, true);
  await f.engine.setAutoReveal(false, 2); assert.equal(f.display().nowPlaying?.revealed, true);
});

test('unknown duration, missing samples, stopped playback, disconnection and shutdown never auto reveal', async () => {
  const f = await fixture();
  f.adapter.sample = null; f.adapter.onProgress(); await f.engine.drain(); assert.equal(f.display().progress?.autoRevealAt, undefined);
  f.adapter.connected = false; await f.tick(95); f.adapter.connected = true;
  assert.equal(f.display().nowPlaying?.revealed, false);
  await f.engine.stopForHost(f.host().turnId!, f.host().hostPlayback!.id); await f.tick(95);
  assert.equal(f.own().ownPlayback?.revealed, false); assert.equal(f.own().progress?.autoRevealAt, undefined);
  f.adapter.catalogue[0]!.duration = 0;
  await f.engine.play(f.credential, f.host().turnId!, f.host().hostPlayback!.id, 'demo:aurora'); await f.tick(500, 0);
  assert.equal(f.display().nowPlaying?.revealed, false); assert.equal(f.display().progress?.autoRevealAt, undefined);
  f.engine.beginShutdown(); await f.tick(90); assert.equal(f.display().nowPlaying?.revealed, false);
});

test('a queued reveal rechecks a disabling setting and failed persistence never publishes revealed metadata', async () => {
  const f = await fixture(); let release!: () => void;
  f.store.gate = new Promise<void>(resolve => { release = resolve; });
  const disabling = f.engine.setAutoReveal(false, 0);
  f.adapter.sample = { elapsed: 80, duration: 100 }; f.adapter.onProgress();
  release(); await disabling; await f.engine.drain();
  assert.equal(f.display().nowPlaying?.revealed, false);
  f.adapter.sample = { elapsed: 0, duration: 100 }; await f.engine.setAutoReveal(true, 1);
  f.store.fail = true; await f.tick(80);
  assert.equal(f.engine.storageAvailable, false); assert.equal(f.display().nowPlaying?.revealed, false);
  assert.equal(f.store.state.room?.playback?.revealed, false);
  assert.deepEqual(f.adapter.controls, []);
});

test('pause and seek use observed position, rather than wall-clock time, to reveal', async () => {
  const f = await fixture(); const id = f.host().hostPlayback!.id;
  await f.engine.control(f.credential, f.host().turnId!, id, 'pause');
  await f.tick(40); await f.tick(40); assert.equal(f.display().nowPlaying?.revealed, false);
  await f.tick(69); assert.equal(f.display().nowPlaying?.revealed, false);
  await f.tick(72); assert.equal(f.display().nowPlaying?.revealed, true);
  await f.tick(20); assert.equal(f.display().nowPlaying?.revealed, true);
});
