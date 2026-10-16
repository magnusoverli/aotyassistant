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

async function fixture() {
  const remote = await startMusicAssistantFixture(); const dir = await mkdtemp('/tmp/opencode/aoty-live-');
  const manager = new IntegrationManager(new IntegrationFileStore(dir)); await manager.init();
  await manager.save(remote.origin, 'fixture-token', 0); await manager.check(manager.view().revision);
  await manager.selectDestination('sonos:room', manager.view().revision);
  const adapter = new ManagedPlayback(new DemoAdapter(), manager, 15);
  const engine = new Engine(new FileStore(dir), adapter, 'http://localhost:3000', manager); await engine.init();
  await adapter.refresh();
  const host = () => engine.view({ kind: 'host' });
  const alex = await engine.join('Alex'); const sam = await engine.join('Sam');
  return { remote, manager, adapter, engine, host, alex, sam, dir,
    participant: (credential: string) => engine.view({ kind: 'participant', credential }),
    display: () => engine.view({ kind: 'display' }),
    close() { adapter.close(); remote.close(); } };
}
async function eventually(check: () => boolean) {
  for (let i = 0; i < 100; i++) { if (check()) return; await delay(10); }
  assert.ok(check(), 'Expected state transition did not occur.');
}
const writes = (f: Awaited<ReturnType<typeof fixture>>) => f.remote.calls.filter(c => /player_queues\/(play_media|stop|pause|resume|autoplay|repeat|shuffle)$/.test(c.command));

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
  await assert.rejects(f.engine.play(f.alex, f.host().turnId!, null, track.id), e => e instanceof AppError && e.status === 409);
});

test('unsafe continuation changes stop owned playback and never advance the turn', async t => {
  const f = await fixture(); t.after(f.close);
  const track = (await f.engine.search(f.alex, f.host().turnId!, 'fixture')).tracks[0]!;
  await f.engine.play(f.alex, f.host().turnId!, null, track.id);
  f.remote.queue.autoplay_enabled = true;
  await eventually(() => !f.engine.ready);
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

test('restart restores playback availability and membership without taking ownership or starting audio', async t => {
  const f = await fixture(); t.after(f.close);
  const track = (await f.engine.search(f.alex, f.host().turnId!, 'fixture')).tracks[0]!;
  await f.engine.play(f.alex, f.host().turnId!, null, track.id);
  f.adapter.close(); const before = writes(f).length;
  const manager = new IntegrationManager(new IntegrationFileStore(f.dir)); await manager.init();
  const adapter = new ManagedPlayback(new DemoAdapter(), manager); t.after(() => adapter.close());
  const engine = new Engine(new FileStore(f.dir), adapter, 'http://localhost:3000', manager); await engine.init();
  await adapter.refresh();
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
