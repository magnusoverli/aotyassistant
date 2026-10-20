import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { Engine } from '../src/engine.js';
import { FileStore } from '../src/store.js';
import { IntegrationManager, IntegrationFileStore } from '../src/integrations.js';
import { ManagedPlayback } from '../src/live-playback.js';
import { DemoAdapter } from '../src/playback.js';
import { MusicAssistantClient } from '../src/music-assistant.js';
import { createApp } from '../src/http.js';
import { AppError, type View } from '../src/model.js';
import { startMusicAssistantFixture } from './fixtures/music-assistant.js';

async function fixture() {
  const remote = await startMusicAssistantFixture(); const dir = await mkdtemp('/tmp/opencode/aoty-media-');
  const manager = new IntegrationManager(new IntegrationFileStore(dir)); await manager.init();
  await manager.save(remote.origin, 'fixture-token', 0);
  // No manual check is needed, including after an application restart.
  await manager.selectDestination('sonos:room', manager.view().revision);
  const adapter = new ManagedPlayback(new DemoAdapter(), manager, 20);
  const server = createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const port = (server.address() as AddressInfo).port; const origin = `http://127.0.0.1:${port}`;
  const engine = new Engine(new FileStore(dir), adapter, origin, manager); await engine.init();
  await adapter.refresh();
  const host = () => engine.view({ kind: 'host' });
  const alex = await engine.join('Alex'); const sam = await engine.join('Sam');
  const http = createApp(engine, { port, guestUrl: origin, listenHost: '127.0.0.1', dataDir: dir, mode: 'demo', demoSeconds: 30 }, 'web', manager);
  server.on('request', http.app);
  const request = (path: string, credential?: string, role = 'participant', data?: unknown) => fetch(`${origin}${path}`, {
    method: data === undefined ? 'GET' : 'POST', headers: { ...(credential ? { Cookie: `aoty_${role}=${credential}` } : {}), ...(data === undefined ? {} : { Origin: origin, 'Content-Type': 'application/json' }) },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  });
  return { remote, manager, engine, adapter, host, alex, sam, request,
    display: () => engine.view({ kind: 'display' }),
    participant: (credential: string) => engine.view({ kind: 'participant', credential }),
    close() { http.close(); adapter.close(); remote.close(); server.closeAllConnections(); server.close(); } };
}
const status = (code: number) => (error: unknown) => error instanceof AppError && error.status === code;

test('artwork is same-origin, participant-bound, reveal-gated, and revoked when turns or membership change', async t => {
  const f = await fixture(); t.after(f.close);
  const artists = await f.engine.browse(f.alex, 'artists', 'Fixture');
  const albums = await f.engine.browse(f.alex, 'albums', artists.artists![0]!.id);
  const tracks = await f.engine.browse(f.alex, 'tracks', albums.albums![0]!.id); const track = tracks.tracks![0]!;
  for (const media of [artists.artists![0]!, albums.albums![0]!, track]) {
    assert.ok(media.artwork?.startsWith('/api/participant/artwork/'));
    const response = await f.request(`${media.artwork!}?size=160`, f.alex); assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'image/png'); assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.ok((await response.arrayBuffer()).byteLength > 20);
  }
  for (const secret of ['private.example', 'secret-search-art', 'fixture-token', 'a'.repeat(64), 'b'.repeat(64)]) assert.ok(!JSON.stringify(tracks).includes(secret));
  assert.equal((await f.request(track.artwork!)).status, 401);
  assert.equal((await f.request(track.artwork!, f.sam)).status, 409);
  await f.engine.play(f.alex, f.host().turnId!, null, track.id);
  const id = f.participant(f.alex).ownPlayback!.id;
  const publicUrl = `/api/display/artwork/${id}/artwork`;
  assert.equal((await f.request(`${publicUrl}?size=1024`)).status, 403);
  assert.ok(f.remote.imageCalls.every(path => path.includes('size=160')), 'Browsing must not fetch full-size covers.');
  assert.ok(!JSON.stringify(f.display()).includes('/artwork/'));
  await f.engine.reveal(f.alex, f.host().turnId!, id);
  const view = f.display(); assert.equal(view.nowPlaying?.revealed, true);
  if (view.nowPlaying?.revealed) {
    assert.equal(view.nowPlaying.track.artwork, publicUrl);
    assert.ok(!JSON.stringify(view).includes('/api/participant/artwork/'));
    assert.equal((await f.request(view.nowPlaying.track.artistArtwork!)).status, 200);
  }
  const revealed = await f.request(`${publicUrl}?size=1024`);
  assert.equal(revealed.status, 200); assert.equal(revealed.headers.get('content-type'), 'image/jpeg'); await revealed.arrayBuffer();
  assert.ok(f.remote.imageCalls.some(path => path.includes('size=1024&fmt=jpeg')));
  assert.ok(!JSON.stringify(f.participant(f.sam)).includes('/artwork/'));
  await f.engine.advance(f.host().turnId!);
  assert.equal((await f.request(`${publicUrl}?size=1024`)).status, 403);
  await f.engine.remove(f.participant(f.alex).me!.id, f.host().revision);
  assert.equal((await f.request(track.artwork!, f.alex)).status, 401);
});

test('artwork transport rejects arbitrary references, redirects, SVG/HTML, and oversized image responses', async t => {
  const remote = await startMusicAssistantFixture(); t.after(remote.close);
  await assert.rejects(new MusicAssistantClient(remote.origin, 'fixture-token').artwork('http://169.254.169.254/secret'), status(404));
  for (const mode of ['redirect', 'svg', 'oversized'] as const) {
    remote.imageMode(mode);
    await assert.rejects(new MusicAssistantClient(remote.origin, 'fixture-token').artwork(`image:${'a'.repeat(64)}`), status(502));
  }
  assert.equal(remote.imageCalls.length, 3);
  assert.ok(remote.imageCalls.every(path => /^\/imageproxy\/[a-f0-9]{64}\?size=512&fmt=png$/.test(path)));
});

test('MA rejects unsupported thumbnail sizes; legacy app URLs normalize to the supported cached thumbnail', async t => {
  const f = await fixture(); t.after(f.close);
  const unsupported = await fetch(`${f.remote.origin}/imageproxy/${'a'.repeat(64)}?size=128&fmt=png`, { headers: { Authorization: 'Bearer fixture-token' } });
  assert.equal(unsupported.status, 400); await unsupported.text(); f.remote.imageCalls.length = 0;
  const artist = (await f.engine.browse(f.alex, 'artists', 'Fixture')).artists![0]!;
  for (const size of [128, 160, 128]) {
    const response = await f.request(`${artist.artwork}?size=${size}`, f.alex);
    assert.equal(response.status, 200); await response.arrayBuffer();
  }
  assert.equal(f.remote.imageCalls.length, 1); assert.ok(f.remote.imageCalls[0]!.endsWith('?size=160&fmt=png'));
  assert.equal((await f.request(`${artist.artwork}?size=999`, f.alex)).status, 400);
});

test('in-flight public artwork is denied after turn changes and private references expire on credential changes', async t => {
  const f = await fixture(); t.after(f.close);
  const track = (await f.engine.search(f.alex, f.host().turnId!, 'fixture')).tracks[0]!;
  await f.engine.play(f.alex, f.host().turnId!, null, track.id); const id = f.participant(f.alex).ownPlayback!.id;
  await f.engine.reveal(f.alex, f.host().turnId!, id); f.remote.delayImages(100);
  const image = f.request(`/api/display/artwork/${id}/artwork`);
  for (let i = 0; i < 100 && !f.remote.imageCalls.length; i++) await delay(2);
  assert.ok(f.remote.imageCalls.length); await f.engine.advance(f.host().turnId!);
  assert.equal((await image).status, 403);
  await f.manager.save(f.remote.origin, 'browser-test-token', f.manager.view().revision);
  assert.equal((await f.request(track.artwork!, f.alex)).status, 409);
});

test('public progress contains no times before reveal and never advances a turn by duration guesses', async t => {
  const f = await fixture(); t.after(f.close);
  const track = (await f.engine.search(f.alex, f.host().turnId!, 'fixture')).tracks[0]!;
  await f.engine.play(f.alex, f.host().turnId!, null, track.id); const id = f.participant(f.alex).ownPlayback!.id;
  f.remote.queue.elapsed_time = 90; f.remote.queue.elapsed_time_last_updated = Date.now() / 1000; await delay(65);
  const hidden = f.display().progress!; assert.equal(hidden.status, 'playing'); assert.ok(hidden.fraction! >= .5 && hidden.fraction! < .6);
  assert.deepEqual(Object.keys(hidden).sort(), ['fraction', 'id', 'status']);
  assert.equal(f.participant(f.sam).progress, undefined);
  assert.deepEqual(Object.keys(f.host().progress!).sort(), ['fraction', 'id', 'status']);
  await f.engine.reveal(f.alex, f.host().turnId!, id); assert.equal(f.display().progress!.duration, 180); assert.ok(f.display().progress!.elapsed! >= 90);
  assert.equal(f.host().progress!.duration, 180); assert.ok(f.host().progress!.elapsed! >= 90);
  await f.engine.control(f.alex, f.host().turnId!, id, 'pause'); await delay(50);
  const elapsed = f.display().progress!.elapsed!; await delay(60); assert.ok(Math.abs(f.display().progress!.elapsed! - elapsed) < .01);
  assert.equal(f.display().progress!.status, 'paused');
  await f.engine.control(f.alex, f.host().turnId!, id, 'resume');
  f.remote.queue.elapsed_time = 181; await delay(80);
  assert.equal(f.host().current!.nickname, 'Alex', 'Elapsed time must not be used as a completion event.');
  assert.equal(f.display().progress!.fraction, 1);
  await f.engine.advance(f.host().turnId!); assert.equal(f.display().progress, undefined);
});

test('only the current playing participant and host may control destination volume, with fresh ownership/range checks', async t => {
  const f = await fixture(); t.after(f.close);
  assert.equal(f.host().volume!.available, true, 'Volume is available automatically for a configured destination.');
  assert.equal(f.remote.calls.filter(c => c.command.includes('/cmd/')).length, 0);
  const track = (await f.engine.search(f.alex, f.host().turnId!, 'fixture')).tracks[0]!;
  await f.engine.play(f.alex, f.host().turnId!, null, track.id); const id = f.participant(f.alex).ownPlayback!.id;
  const post = (credential: string, level: number, playbackId = id) => f.request('/api/participant/volume', credential, 'participant', { turnId: f.host().turnId, playbackId, level, volumeRevision: f.host().volume!.revision });
  assert.equal((await post(f.sam, 30)).status, 403);
  assert.equal((await post(f.alex, 101)).status, 400);
  assert.equal((await post(f.alex, 20, crypto.randomUUID())).status, 409);
  assert.equal((await post(f.alex, 25)).status, 200); assert.equal(f.remote.player.volume_level, 25);
  const response = await f.request('/api/host/volume', undefined, 'host', { turnId: f.host().turnId, level: 35, volumeRevision: f.host().volume!.revision });
  assert.equal(response.status, 200); assert.equal((await response.json() as View).volume!.level, 35);
  assert.equal(f.display().volume, undefined); assert.equal(f.participant(f.sam).volume, undefined);
  f.remote.queue.current_item!.queue_item_id = 'external-item';
  const before = f.remote.calls.filter(c => c.command.includes('/cmd/')).length;
  assert.ok([409, 422].includes((await post(f.alex, 90)).status));
  assert.equal(f.remote.calls.filter(c => c.command.includes('/cmd/')).length, before);
  assert.equal((await f.request('/api/host/volume', undefined, 'host', { turnId: f.host().turnId, level: 10, volumeRevision: 'old-destination' })).status, 409);
});

test('volume respects selected group semantics and unsupported destinations', async t => {
  const remote = await startMusicAssistantFixture(); t.after(remote.close);
  const api = new MusicAssistantClient(remote.origin, 'fixture-token');
  remote.player.type = 'group'; remote.player.group_members = ['one', 'two'];
  assert.equal((await api.setVolume('sonos:room', 45)).level, 45);
  assert.equal(remote.player.volume_level, 30);
  assert.equal(remote.calls.find(c => c.command.includes('/cmd/'))!.command, 'players/cmd/group_volume');
  remote.player.supported_features = []; remote.player.volume_control = 'none';
  await assert.rejects(api.setVolume('sonos:room', 25), status(422));
});

test('slow optional volume reads do not stall queue progress or overwrite a newer volume change', async t => {
  const f = await fixture(); t.after(f.close);
  const track = (await f.engine.search(f.alex, f.host().turnId!, 'fixture')).tracks[0]!;
  await f.engine.play(f.alex, f.host().turnId!, null, track.id);
  f.remote.delayNextVolumeRead(180);
  for (let i = 0; i < 100 && !f.remote.volumeReadPending; i++) await delay(2);
  assert.equal(f.remote.volumeReadPending, true);
  const before = f.remote.calls.filter(call => call.command === 'player_queues/get_active_queue').length;
  await f.engine.setVolume(25, f.host().turnId!);
  const levels: (number | null)[] = []; f.engine.on('change', () => levels.push(f.host().volume!.level));
  await delay(220);
  assert.ok(f.remote.calls.filter(call => call.command === 'player_queues/get_active_queue').length > before + 1);
  assert.ok(levels.length); assert.ok(levels.every(level => level === 25));
});

test('automatic speaker refresh ignores a delayed old-destination volume without blocking the new destination', async t => {
  const f = await fixture(); t.after(f.close);
  f.remote.delayNextVolumeRead(180); const oldRead = f.adapter.refresh();
  for (let i = 0; i < 100 && !f.remote.volumeReadPending; i++) await delay(2);
  assert.equal(f.remote.volumeReadPending, true);
  f.remote.player.volume_level = 60;
  await f.manager.selectDestination('sonos:bedroom', f.manager.view().revision); await f.adapter.refresh();
  assert.equal(f.host().volume!.level, 60);
  await oldRead;
  assert.equal(f.host().volume!.level, 60);
  assert.equal(f.remote.calls.filter(call => call.command.includes('/cmd/')).length, 0);
});

test('volume acknowledgements are immediate intents, with asynchronous correction for a mismatching speaker report', async t => {
  const f = await fixture(); t.after(f.close);
  f.remote.clampVolume(40);
  const before = f.remote.calls.length;
  await f.engine.setVolume(70, f.host().turnId!);
  assert.equal(f.host().volume!.level, 70); assert.equal(f.host().volume!.pending, true);
  assert.deepEqual(f.remote.calls.slice(before).map(call => call.command), ['players/get', 'players/cmd/volume_set'], 'A readback must not block the write acknowledgement.');
  const generation = f.host().volume!.generation!;
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() }); t.mock.timers.tick(2000);
  for (let i = 0; i < 100 && f.host().volume?.pending; i++) await delay(10);
  assert.equal(f.host().volume!.level, 40); assert.equal(f.host().volume!.pending, undefined);
  assert.ok(f.host().volume!.generation! > generation);
  assert.equal(f.remote.calls.filter(call => call.command === 'players/cmd/volume_set').length, 1, 'Confirmation must never retry a write.');
});
