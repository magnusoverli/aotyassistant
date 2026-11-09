import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Engine } from '../src/engine.js';
import { DemoAdapter } from '../src/playback.js';
import { stateSchema, type State, type Track } from '../src/model.js';
import type { Store } from '../src/store.js';

class MemoryStore implements Store {
  state: State = { schema: 3, room: null };
  saves = 0;
  async load() { return stateSchema.parse(structuredClone(this.state)); }
  async save(state: State) { this.state = structuredClone(state); this.saves++; }
}
class ObservedAdapter extends DemoAdapter {
  id = ''; sample: { elapsed: number; duration: number } | null = { elapsed: 0, duration: 100 };
  override async play(_track: Track, id: string) { this.id = id; }
  override progress(id: string) { return id === this.id ? this.sample : null; }
  override async control() {}
}
const secrets = ['Northern Lights', 'The Paper Satellites', 'After the Winter', '/demo-cover.svg'];
async function fixture() {
  const store = new MemoryStore(); const adapter = new ObservedAdapter(100);
  const engine = new Engine(store, adapter, 'http://localhost:3000'); await engine.init();
  const credential = await engine.join('Listener'); const other = await engine.join('Next');
  const host = () => engine.view({ kind: 'host' }); const display = () => engine.view({ kind: 'display' });
  const own = () => engine.view({ kind: 'participant', credential });
  const waiting = () => engine.view({ kind: 'participant', credential: other });
  const play = (trackId = 'demo:aurora') => engine.play(credential, own().turnId!, own().ownPlayback?.id ?? null, trackId);
  const tick = async (elapsed: number) => {
    adapter.sample = { elapsed, duration: 100 }; adapter.onProgress(); await engine.drain(); await new Promise<void>(resolve => setImmediate(resolve));
  };
  return { store, adapter, engine, host, display, own, waiting, play, tick };
}
const shown = (view: ReturnType<Engine['view']>) => view.nowPlaying?.revealed === true ? view.nowPlaying.track.title : undefined;

test('secret playback defaults on and keeps the hidden-until-revealed workflow', async () => {
  const f = await fixture();
  assert.deepEqual(f.engine.secretPlaybackSettings(), { enabled: true, revision: 0 });
  assert.equal(f.own().secretPlayback, true); assert.equal(f.waiting().secretPlayback, true);
  await f.play();
  assert.equal(f.display().nowPlaying?.revealed, false); assert.equal(f.display().progress?.autoRevealAt, .7);
  assert.equal(f.store.state.room?.secretPlayback, undefined, 'Nothing is written until the host changes it.');
  await f.tick(70); assert.equal(shown(f.display()), 'Northern Lights');
});

test('without secret playback a song starts shown on the display, with no marker and no automatic reveal', async () => {
  const f = await fixture();
  assert.deepEqual(await f.engine.setSecretPlayback(false, 0), { enabled: false, revision: 1 });
  assert.equal(f.own().secretPlayback, false); assert.equal(f.waiting().secretPlayback, false);
  await f.play();
  const display = f.display();
  assert.equal(shown(display), 'Northern Lights'); assert.equal(display.progress?.duration, 100);
  assert.equal(f.store.state.room?.playback?.revealed, true);
  for (const view of [f.host(), display, f.own()]) assert.equal(view.progress?.autoRevealAt, undefined);
  // Revealed artwork passes the reveal check; the demo cover simply has no stored artwork.
  assert.throws(() => f.engine.displayArtwork(display.progress!.id, 'artwork'), /Artwork unavailable/);
  const saves = f.store.saves; await f.tick(80); assert.equal(f.store.saves, saves, 'Automatic reveal has nothing to save.');
  for (const view of [f.host(), f.waiting()]) for (const secret of secrets) assert.ok(!JSON.stringify(view).includes(secret), 'The host desk and other participants stay unchanged.');
  assert.deepEqual(f.engine.playbackSettings(), { enabled: true, revision: 0 }, 'The automatic reveal choice is kept.');
});

test('switching off reveals the current song in the same save; switching on keeps it shown and hides the next song', async () => {
  const f = await fixture();
  await f.play(); assert.equal(f.display().nowPlaying?.revealed, false);
  const saves = f.store.saves;
  await f.engine.setSecretPlayback(false, 0);
  assert.equal(f.store.saves, saves + 1); assert.equal(f.store.state.room?.playback?.revealed, true);
  assert.equal(shown(f.display()), 'Northern Lights'); assert.equal(f.display().progress?.autoRevealAt, undefined);
  await f.engine.setSecretPlayback(true, 1);
  assert.equal(shown(f.display()), 'Northern Lights'); assert.equal(f.own().secretPlayback, true);
  await f.play('demo:summer'); await f.tick(10);
  assert.equal(f.display().nowPlaying?.revealed, false); assert.equal(f.display().progress?.autoRevealAt, .7);
  await assert.rejects(f.engine.setSecretPlayback(false, 1), /settings changed/);
  const restored = new Engine(f.store, new ObservedAdapter(), 'http://localhost:3000'); await restored.init();
  assert.deepEqual(restored.secretPlaybackSettings(), { enabled: true, revision: 2 });
});

test('a song starting while secret playback is switched off is shown whichever lands first', async () => {
  const f = await fixture();
  await Promise.all([f.play(), f.engine.setSecretPlayback(false, 0)]);
  assert.equal(shown(f.display()), 'Northern Lights'); assert.equal(f.store.state.room?.playback?.revealed, true);
});
