import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
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
import { operation } from '../src/operation.js';
import { createApp } from '../src/http.js';
import { AppError, type View } from '../src/model.js';
import { startMusicAssistantFixture } from './fixtures/music-assistant.js';
import { unlockDisplayArtwork } from '../web/display-artwork.js';

async function fixture() {
  const remote = await startMusicAssistantFixture(); const dir = await mkdtemp('/tmp/opencode/doom-room-media-');
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
  const http = createApp(engine, { port, guestUrl: origin, listenHost: '127.0.0.1', dataDir: dir, demoSeconds: 30 }, 'web', manager);
  server.on('request', http.app);
  const request = (path: string, credential?: string, role = 'participant', data?: unknown) => fetch(`${origin}${path}`, {
    method: data === undefined ? 'GET' : 'POST', headers: { ...(credential ? { Cookie: `doom_room_${role}=${credential}` } : {}), ...(data === undefined ? {} : { Origin: origin, 'Content-Type': 'application/json' }) },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  });
  return { remote, manager, engine, adapter, host, alex, sam, request, origin,
    display: () => engine.view({ kind: 'display' }),
    participant: (credential: string) => engine.view({ kind: 'participant', credential }),
    close() { http.close(); adapter.close(); remote.close(); server.closeAllConnections(); server.close(); } };
}
const status = (code: number) => (error: unknown) => error instanceof AppError && error.status === code;

test('display downloads encrypted full-size artwork before reveal and unlocks it locally without another image read', async t => {
  const f = await fixture(); t.after(f.close);
  const selected = (await f.engine.search(f.alex, f.host().turnId!, 'fixture')).tracks[0]!;
  await f.engine.play(f.alex, f.host().turnId!, null, selected.id);
  const display = async () => (await f.request('/api/display/state')).json() as Promise<View>;
  const hidden = await display(); assert.equal(hidden.nowPlaying?.revealed, false);
  assert.ok(hidden.preparedArtwork); assert.equal(hidden.preparedArtwork.key, undefined);
  for (const secret of [selected.title, selected.artist, selected.artwork!, selected.artistArtwork!]) assert.ok(!JSON.stringify(hidden).includes(secret));
  const path = `/api/display/prepared-artwork/${hidden.preparedArtwork.id}`;
  const response = await f.request(path); assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'application/octet-stream'); assert.equal(response.headers.get('cache-control'), 'no-store');
  const bytes = new Uint8Array(await response.arrayBuffer());
  assert.ok(f.remote.imageCalls.some(path => path.endsWith('?size=1024&fmt=jpeg')));
  assert.ok(f.remote.imageCalls.some(path => path.endsWith('?size=160&fmt=jpeg')));
  const playback = f.participant(f.alex).ownPlayback!;
  assert.equal((await f.request(`/api/display/artwork/${playback.id}/artwork`)).status, 403);
  assert.equal((await display()).preparedArtwork?.key, undefined);
  const upstream = f.remote.imageCalls.length;
  const duplicate = await f.request(path); assert.deepEqual(new Uint8Array(await duplicate.arrayBuffer()), bytes);
  assert.equal(f.remote.imageCalls.length, upstream);
  const abort = new AbortController(); t.after(() => abort.abort());
  const events = await fetch(`${f.origin}/api/display/events`, { signal: AbortSignal.any([abort.signal, AbortSignal.timeout(5000)]) });
  const reader = events.body!.getReader(); const decoder = new TextDecoder(); let buffer = '';
  const nextState = async (): Promise<View> => {
    while (!buffer.includes('\n\n')) {
      const chunk = await reader.read(); if (chunk.done) throw Error('Display stream ended'); buffer += decoder.decode(chunk.value, { stream: true });
    }
    const end = buffer.indexOf('\n\n'); const frame = buffer.slice(0, end); buffer = buffer.slice(end + 2);
    return JSON.parse(frame.split('\n').find(line => line.startsWith('data: '))!.slice(6));
  };
  assert.equal((await nextState()).preparedArtwork?.key, undefined);
  await f.engine.reveal(f.alex, f.host().turnId!, playback.id);
  const revealed = await display(); assert.equal(revealed.preparedArtwork?.id, hidden.preparedArtwork.id);
  let live = await nextState(); while (!live.nowPlaying?.revealed) { assert.equal(live.preparedArtwork?.key, undefined); live = await nextState(); }
  assert.deepEqual(live.preparedArtwork, revealed.preparedArtwork, 'The reveal event carries the same unlock key as the filtered state endpoint.');
  abort.abort();
  const images = await unlockDisplayArtwork(bytes, revealed.preparedArtwork!.key!);
  assert.equal(images.artwork?.contentType, 'image/jpeg'); assert.equal(images.artistArtwork?.contentType, 'image/jpeg');
  assert.equal(f.remote.imageCalls.length, upstream, 'Reveal/decryption does not fetch the image again.');
  assert.equal(f.participant(f.alex).preparedArtwork, undefined); assert.equal(f.host().preparedArtwork, undefined);
  await f.engine.advance(f.host().turnId!);
  assert.equal((await display()).preparedArtwork, undefined); assert.equal((await f.request(path)).status, 403);
});

test('repeated artwork revalidates without transferring pixels and still rejects revoked/foreign access', async t => {
  const f = await fixture(); t.after(f.close);
  const artist = (await f.engine.browse(f.alex, 'artists', 'Fixture')).artists![0]!;
  const again = (await f.engine.browse(f.alex, 'artists', 'Fixture')).artists![0]!;
  assert.equal(again.artwork, artist.artwork, 'The same participant gets a stable artwork URL.');
  const path = `${artist.artwork}?size=160`;
  const first = await f.request(path, f.alex);
  const etag = first.headers.get('etag')!; assert.ok(etag); await first.arrayBuffer();
  assert.equal(first.headers.get('cache-control'), 'private, no-cache');
  assert.match(first.headers.get('vary')!, /Cookie/i);
  assert.match(first.headers.get('server-timing')!, /^artwork;dur=\d+\.\d$/);
  // Raw HTTP avoids fetch's automatic Cache-Control:no-cache for manual
  // conditional requests; this models the browser's ordinary revalidation.
  const conditional = (credential?: string) => new Promise<{ status: number; bytes: number }>((resolve, reject) => {
    const req = httpRequest(f.origin + path, { headers: { 'If-None-Match': etag,
      ...(credential ? { Cookie: `doom_room_participant=${credential}` } : {}) } }, res => {
      let bytes = 0; res.on('data', chunk => { bytes += chunk.length; });
      res.on('end', () => resolve({ status: res.statusCode!, bytes })); res.on('error', reject);
    }); req.on('error', reject); req.end();
  });
  assert.deepEqual(await conditional(f.alex), { status: 304, bytes: 0 });
  assert.equal(f.remote.imageCalls.length, 1, 'Revalidation uses the server cache.');
  assert.equal((await conditional()).status, 401);
  assert.equal((await conditional(f.sam)).status, 409);
  await f.manager.save(f.remote.origin, 'browser-test-token', f.manager.view().revision);
  assert.equal((await conditional(f.alex)).status, 409, 'An ETag cannot bypass a changed catalogue.');
  await f.engine.remove(f.participant(f.alex).me!.id, f.host().revision);
  assert.equal((await conditional(f.alex)).status, 401);
});

test('a full album page retains its small thumbnails and simultaneous copies share one upstream read', async t => {
  const remote = await startMusicAssistantFixture(); t.after(remote.close);
  const api = new MusicAssistantClient(remote.origin, 'fixture-token'); t.after(() => api.close());
  const ids = Array.from({ length: 80 }, (_, index) => `image:${index.toString(16).padStart(64, '0')}`);
  for (const id of ids) await api.artwork(id, 160);
  assert.equal(remote.imageCalls.length, 80);
  for (const id of ids) await api.artwork(id, 160);
  assert.equal(remote.imageCalls.length, 80, 'Browsing back does not thrash the former 64-entry cache.');
  remote.delayImages(40);
  await Promise.all(Array.from({ length: 10 }, () => api.artwork(`image:${'f'.repeat(64)}`, 160)));
  assert.equal(remote.imageCalls.length, 81);
});

function slowImages() {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0]); const calls: string[] = []; let active = 0; let peak = 0;
  const api = new MusicAssistantClient('http://127.0.0.1:1', 'fixture-token', 8000, { async read(path: string) {
    calls.push(path); active++; peak = Math.max(peak, active);
    try { await delay(15); return { body: jpeg, contentType: 'image/jpeg' }; } finally { active--; }
  } } as never);
  return { api, calls, peak: () => peak };
}
const image = (index: number) => `image:${index.toString(16).padStart(64, '0')}`;

test('a page of thumbnails requested at once (HTTP/2 over Funnel) all load, four upstream fetches at a time', async t => {
  const f = slowImages(); t.after(() => f.api.close());
  const results = await Promise.all(Array.from({ length: 30 }, (_, index) => f.api.artwork(image(index), 160)));
  assert.equal(results.length, 30); assert.ok(results.every(result => result.contentType === 'image/jpeg'));
  assert.equal(f.calls.length, 30); assert.equal(f.peak(), 4);
});

test('a thumbnail still waiting is dropped when its viewer leaves, but a viewer sharing it still gets it', async t => {
  const f = slowImages(); t.after(() => f.api.close());
  const busy = Promise.all([0, 1, 2, 3].map(index => f.api.artwork(image(index), 160)));
  const leaving = new AbortController();
  const left = operation('left', () => f.api.artwork(image(10), 160), 5000, leaving.signal);
  const shared = operation('shared', () => f.api.artwork(image(11), 160), 5000, leaving.signal);
  const staying = operation('staying', () => f.api.artwork(image(11), 160), 5000, new AbortController().signal);
  await delay(1); leaving.abort();
  await assert.rejects(left, (error: AppError) => error.status === 499); await assert.rejects(shared, (error: AppError) => error.status === 499);
  assert.equal((await staying).contentType, 'image/jpeg'); await busy;
  assert.ok(!f.calls.some(path => path.includes(image(10).slice(6))), 'The abandoned thumbnail was never fetched.');
  assert.equal(f.calls.filter(path => path.includes(image(11).slice(6))).length, 1);
});

test('artwork is same-origin, participant-bound, reveal-gated, and revoked when turns or membership change', async t => {
  const f = await fixture(); t.after(f.close);
  const artists = await f.engine.browse(f.alex, 'artists', 'Fixture');
  const albums = await f.engine.browse(f.alex, 'albums', artists.artists![0]!.id);
  const tracks = await f.engine.browse(f.alex, 'tracks', albums.albums![0]!.id); const track = tracks.tracks![0]!;
  for (const media of [artists.artists![0]!, albums.albums![0]!, track]) {
    assert.ok(media.artwork?.startsWith('/api/participant/artwork/'));
    const response = await f.request(`${media.artwork!}?size=160`, f.alex); assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'image/jpeg'); assert.equal(response.headers.get('cache-control'), 'private, no-cache');
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

test('public stream details follow the verified stream independently of reveal and clear on missing data or stop', async t => {
  const f = await fixture(); t.after(f.close);
  f.remote.track.provider_mappings.push({ item_id: 'tidal-equivalent', provider_domain: 'tidal', available: true });
  const track = (await f.engine.search(f.alex, f.host().turnId!, 'fixture')).tracks[0]!;
  await f.engine.play(f.alex, f.host().turnId!, null, track.id);
  const id = f.participant(f.alex).ownPlayback!.id;
  assert.deepEqual(f.display().streamInfo, { source: 'Spotify' });
  const expected = { source: 'Spotify', format: 'FLAC', bitRate: 1411, sampleRate: 44100 };
  f.remote.queue.current_item!.streamdetails!.audio_format = { content_type: 'flac', bit_rate: 1411, sample_rate: 44100,
    title: 'PRIVATE stream title', path: 'PRIVATE stream URL' };
  const waitForInfo = async (value: View['streamInfo']) => {
    for (let i = 0; i < 100 && JSON.stringify(f.display().streamInfo) !== JSON.stringify(value); i++) await delay(10);
    assert.deepEqual(f.display().streamInfo, value);
  };
  await waitForInfo(expected);
  assert.deepEqual(f.display().nowPlaying, { revealed: false });
  assert.ok(!JSON.stringify(f.display()).includes('PRIVATE'));
  assert.equal(f.participant(f.sam).streamInfo, undefined);
  await f.engine.reveal(f.alex, f.host().turnId!, id);
  assert.deepEqual(f.display().streamInfo, expected);
  await f.engine.control(f.alex, f.host().turnId!, id, 'pause');
  assert.deepEqual(f.display().streamInfo, expected);
  f.remote.queue.current_item!.streamdetails!.audio_format = { content_type: 'aac', bit_rate: 256 };
  await waitForInfo({ source: 'Spotify', format: 'AAC', bitRate: 256 });
  delete f.remote.queue.current_item!.streamdetails!.audio_format;
  await waitForInfo({ source: 'Spotify' });
  f.remote.queue.current_item!.streamdetails = { provider: 'tidal', item_id: 'tidal-equivalent' };
  await waitForInfo({ source: 'Tidal' });
  f.remote.queue.current_item!.streamdetails!.audio_format = { content_type: 'flac', bit_rate: 1411, sample_rate: 44100 };
  await waitForInfo({ ...expected, source: 'Tidal' });
  await f.engine.control(f.alex, f.host().turnId!, id, 'stop');
  assert.equal(f.display().streamInfo, undefined);
  await f.engine.play(f.alex, f.host().turnId!, id, track.id);
  assert.deepEqual(f.display().streamInfo, { source: 'Spotify' }, 'A replacement must use its own stream source and technical metadata.');
});

test('artwork transport rejects arbitrary references, redirects, SVG/HTML, and oversized image responses', async t => {
  const remote = await startMusicAssistantFixture(); t.after(remote.close);
  await assert.rejects(new MusicAssistantClient(remote.origin, 'fixture-token').artwork('http://169.254.169.254/secret'), status(404));
  for (const mode of ['redirect', 'svg', 'oversized'] as const) {
    remote.imageMode(mode);
    await assert.rejects(new MusicAssistantClient(remote.origin, 'fixture-token').artwork(`image:${'a'.repeat(64)}`), status(502));
  }
  assert.equal(remote.imageCalls.length, 3);
  assert.ok(remote.imageCalls.every(path => /^\/imageproxy\/[a-f0-9]{64}\?size=512&fmt=jpeg$/.test(path)));
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
  assert.equal(f.remote.imageCalls.length, 1); assert.ok(f.remote.imageCalls[0]!.endsWith('?size=160&fmt=jpeg'));
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
  assert.deepEqual(Object.keys(hidden).sort(), ['autoRevealAt', 'fraction', 'id', 'status']);
  assert.equal(hidden.autoRevealAt, .7);
  assert.equal(f.participant(f.sam).progress, undefined);
  assert.deepEqual(Object.keys(f.host().progress!).sort(), ['autoRevealAt', 'fraction', 'id', 'status']);
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
  void f.adapter.refresh(); // Explicit refresh/event, rather than polling volume on every queue sample.
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
