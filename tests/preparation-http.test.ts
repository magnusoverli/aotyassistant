import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer, request as httpRequest } from 'node:http';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { Engine } from '../src/engine.js';
import { FileStore } from '../src/store.js';
import { ManagedPlayback } from '../src/live-playback.js';
import { IntegrationManager, IntegrationFileStore } from '../src/integrations.js';
import { PreparationFileStore, PreparationManager } from '../src/preparations.js';
import type { PreparationView, PreparationResult } from '../src/preparations.js';
import type { CatalogueBrowse, CatalogueTrack, View, UserDirectory } from '../src/model.js';
import type { SharedSong } from '../src/shared-list.js';
import { ListImports } from '../src/list-import-jobs.js';
import { createApp } from '../src/http.js';
import { startMusicAssistantFixture } from './fixtures/music-assistant.js';

const prefix = '/api/participant/preparations';
const operation = (revision: number) => ({ id: randomUUID(), revision, issuedAt: Date.now() });
const cookie = (response: Response) => response.headers.get('set-cookie')!.split(';')[0]!;
async function fixture(t: TestContext) {
  const remote = await startMusicAssistantFixture(); const dir = await mkdtemp('/tmp/opencode/doom-room-preparation-http-');
  const server = createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const port = (server.address() as AddressInfo).port; const origin = `http://127.0.0.1:${port}`;
  const config = { port, listenHost: '127.0.0.1', guestUrl: origin, dataDir: dir };
  async function boot() {
    const integrations = new IntegrationManager(new IntegrationFileStore(dir)); await integrations.init();
    const adapter = new ManagedPlayback(integrations, 30);
    const engine = new Engine(new FileStore(dir), adapter, origin, integrations); await engine.init();
    await adapter.refresh();
    const preparationStore = new PreparationFileStore(dir);
    const preparations = new PreparationManager(preparationStore, Date.now, selection => selection.source === 'demo' ? !integrations.configured : selection.source === 'music-assistant' && selection.sourceBindingId === integrations.sourceBindingId);
    const http = createApp(engine, config, 'dist/web', integrations, preparations); server.on('request', http.app);
    return { integrations, adapter, engine, http, preparationStore, preparations };
  }
  let running = await boot();
  const aborts: AbortController[] = [];
  t.after(() => { for (const abort of aborts) abort.abort(); running.http.close(); running.adapter.close(); server.closeAllConnections(); server.close(); remote.close(); });
  const request = (path: string, data?: unknown, credential = '', headers: Record<string, string> = {}) => fetch(origin + path, {
    method: data === undefined ? 'GET' : 'POST', headers: { ...(data === undefined ? {} : { Origin: origin, 'Content-Type': 'application/json' }), Cookie: credential, ...headers },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }), signal: AbortSignal.timeout(5000),
  });
  async function json<T = View>(path: string, data?: unknown, credential = ''): Promise<T> {
    const response = await request(path, data, credential); assert.equal(response.status, 200, await response.clone().text()); return response.json() as Promise<T>;
  }
  async function openStream(path: string, credential: string) {
    const abort = new AbortController(); aborts.push(abort);
    const response = await fetch(origin + path, { headers: { Cookie: credential }, signal: AbortSignal.any([abort.signal, AbortSignal.timeout(10_000)]) }); assert.equal(response.status, 200);
    const reader = response.body!.getReader(); let buffer = ''; const decoder = new TextDecoder();
    return async () => {
      while (!buffer.includes('\n\n')) { const part = await reader.read(); if (part.done) throw new Error('Stream ended'); buffer += decoder.decode(part.value, { stream: true }); }
      const index = buffer.indexOf('\n\n'); const frame = buffer.slice(0, index); buffer = buffer.slice(index + 2); return frame;
    };
  }
  async function joinMember() {
    const joined = await request('/api/participant/join', { nickname: 'Same nickname', pin: '1234' }); assert.equal(joined.status, 200);
    const membership = cookie(joined);
    const initialized = await request(prefix + '/init', {}, membership); assert.equal(initialized.status, 200);
    const privateCookie = cookie(initialized); const preparation = await initialized.json() as PreparationView;
    return { membership, privateCookie, credentials: `${membership}; ${privateCookie}`, preparation, cookieHeader: initialized.headers.get('set-cookie')! };
  }
  const first = await joinMember(); const second = await joinMember();
  await running.integrations.save(remote.origin, 'fixture-token', 0); await running.integrations.selectDestination('sonos:room', running.integrations.view().revision);
  await running.adapter.refresh();
  async function add(member = first) {
    // As in the app: search for an artist, open one of their albums, then pick a song.
    const browse = (kind: 'artists' | 'albums' | 'tracks', value: string) => json<CatalogueBrowse>('/api/participant/browse', { kind, value }, member.membership);
    const artist = (await browse('artists', 'fixture')).artists![0]!; const album = (await browse('albums', artist.id)).albums![0]!;
    const search = { tracks: (await browse('tracks', album.id)).tracks! };
    const list = await json<PreparationView>(prefix + '/state', undefined, member.privateCookie);
    const body = { operation: operation(list.revision), trackId: search.tracks[0]!.id };
    return { ...(await json<PreparationResult>(prefix + '/add', body, member.credentials)), body, search };
  }
  return { remote, dir, origin, first, second, request, json, add, openStream, get running() { return running; },
    async restart() { running.http.close(); running.adapter.close(); server.removeListener('request', running.http.app); running = await boot(); } };
}

test('saved catalogue entries/artwork survive expired references, fresh readers, and restart without exposing recording internals', async t => {
  const f = await fixture(t); const added = await f.add(); const binding = f.running.integrations.sourceBindingId;
  assert.match(f.first.cookieHeader, /HttpOnly/); assert.match(f.first.cookieHeader, /SameSite=Strict/); assert.match(f.first.cookieHeader, /Path=\/api\/participant\/preparations/);
  const descriptor = (await new PreparationFileStore(f.dir).load(added.view.ownerId))!.entries[0]!.selection;
  const text = JSON.stringify(added.view);
  for (const secret of [binding!, 'private-fixture-uri', 'recording:', 'sourceBindingId', 'image:', 'fixture-token']) assert.ok(!text.includes(secret), secret);
  // Expire both reference layers, then restore the clock before unrelated HTTP deadlines.
  const now = Date.now; Date.now = () => now() + 13 * 60 * 60_000;
  try {
    await assert.rejects(f.running.integrations.resolve(added.body.trackId, f.running.engine.catalogueContext(f.first.membership.split('=')[1]!)));
    const resolved = await f.running.integrations.resolveSaved(descriptor, 'authorized-context', `prepared:${added.entryId}`);
    assert.equal(resolved.uri, f.remote.track.uri);
  } finally { Date.now = now; }
  const writes = () => f.remote.calls.filter(call => /^(players\/cmd\/|player_queues\/(play_media|stop|pause|resume|autoplay|repeat|shuffle)$)/.test(call.command));
  const writesBefore = writes().length; await f.restart(); assert.equal(writes().length, writesBefore);
  await f.running.integrations.check(f.running.integrations.view().revision);
  assert.equal(f.running.integrations.sourceBindingId, binding); assert.equal(f.running.integrations.playbackAvailable, true);
  assert.deepEqual(await f.json(prefix + '/state', undefined, f.first.privateCookie), added.view);
  const retry = await f.json<PreparationResult>(prefix + '/add', added.body, f.first.credentials); assert.equal(retry.replayed, true);
  assert.equal((await f.request(added.view.upcoming[0]!.artwork!, undefined, f.first.privateCookie)).status, 200);
  assert.equal((await f.request(added.view.upcoming[0]!.artwork!, undefined, f.second.privateCookie)).status, 404);
  assert.equal((await f.request(added.view.upcoming[0]!.artwork!)).status, 401);
  const current = await f.json('/api/participant/state', undefined, f.first.membership);
  const played = await f.json<{ view: View; preparation: PreparationView }>(prefix + '/play', { turnId: current.turnId, previousPlaybackId: null, entryId: added.entryId, revision: added.view.revision }, f.first.credentials);
  assert.equal(played.preparation.played[0]!.id, added.entryId); assert.equal(played.view.ownPlayback!.track.id, `prepared:${added.entryId}`);
  const preview = added.view.upcoming[0]!; const confirmed = played.view.ownPlayback!;
  assert.notEqual(confirmed.track.artwork, preview.artwork, 'Playback keeps its own authorized download URL.');
  assert.equal(confirmed.track.artworkIdentity, preview.artwork, 'The already displayed cover can be retained.');
  assert.equal(confirmed.track.artistArtworkIdentity, preview.artistArtwork);
  await f.json('/api/participant/reveal', { turnId: played.view.turnId, playbackId: confirmed.id }, f.first.membership);
  const display = await f.json('/api/display/state'); assert.equal(display.nowPlaying?.revealed, true);
  for (const audience of [display, await f.json('/api/host/state'), await f.json('/api/participant/state', undefined, f.second.membership)]) {
    assert.ok(!JSON.stringify(audience).includes('artworkIdentity'));
    assert.ok(!JSON.stringify(audience).includes('artistArtworkIdentity'));
    assert.ok(!JSON.stringify(audience).includes('/api/participant/preparations/artwork/'));
  }
  assert.equal((await f.request(confirmed.track.artwork!, undefined, f.second.membership)).status, 409);
  const plays = f.remote.calls.filter(call => call.command === 'player_queues/play_media');
  assert.equal(plays.length, 1); assert.deepEqual(plays[0]!.args.media, [f.remote.track.uri]);
});

test('saved artwork reuse requires exact image identity independently for cover and portrait', async t => {
  const f = await fixture(t); const added = await f.add();
  const saved = (await f.running.preparationStore.load(added.view.ownerId))!.entries[0]!.selection;
  const resolve = () => f.running.integrations.resolveSaved(saved, 'authorized-context', `prepared:${added.entryId}`);
  f.remote.track.metadata.images[0]!.proxy_id = 'c'.repeat(64);
  const changedCover = (await resolve()).track;
  assert.equal(changedCover.artworkIdentity, undefined);
  assert.equal(changedCover.artistArtworkIdentity, added.view.upcoming[0]!.artistArtwork);
  f.remote.track.artists[0]!.image.proxy_id = 'd'.repeat(64);
  const changedBoth = (await resolve()).track;
  assert.equal(changedBoth.artworkIdentity, undefined); assert.equal(changedBoth.artistArtworkIdentity, undefined);
  f.remote.track.metadata.images[0]!.proxy_id = 'a'.repeat(64);
  const originalCover = (await resolve()).track;
  assert.equal(originalCover.artworkIdentity, added.view.upcoming[0]!.artwork);
  assert.equal(originalCover.artistArtworkIdentity, undefined);
});

test('search, saved lists, history and playback share one authorized thumbnail tag, one request per cover', async t => {
  const f = await fixture(t); const added = await f.add();
  const selected = added.search.tracks[0]!; const entry = added.view.upcoming[0]!;
  const cached = new Map<string, string>();
  for (const kind of ['artwork', 'artistArtwork'] as const) {
    const canonical = `${selected[kind]}?size=160`;
    const first = await f.request(canonical, undefined, f.first.membership);
    assert.equal(first.status, 200); cached.set(kind, first.headers.get('etag')!); await first.arrayBuffer();
    // Served directly rather than redirected to the catalogue URL, with the same pixel tag.
    const saved = await fetch(`${f.origin}${entry[kind]}?size=160`, { headers: { Cookie: f.first.credentials }, redirect: 'manual' });
    assert.equal(saved.status, 200); assert.equal(saved.headers.get('etag'), cached.get(kind));
    assert.equal(saved.headers.get('cache-control'), 'private, no-cache'); await saved.arrayBuffer();
  }
  const conditional = (path: string, credential: string, etag: string) => new Promise<{ status: number; bytes: number }>((resolve, reject) => {
    const req = httpRequest(f.origin + path, { headers: { Cookie: credential, 'If-None-Match': etag } }, res => {
      let bytes = 0; res.on('data', part => { bytes += part.length; });
      res.on('end', () => resolve({ status: res.statusCode!, bytes })); res.on('error', reject);
    }); req.on('error', reject); req.end();
  });
  const current = await f.json('/api/participant/state', undefined, f.first.membership);
  const played = await f.json<{ view: View; preparation: PreparationView }>(prefix + '/play',
    { turnId: current.turnId, previousPlaybackId: null, entryId: entry.id, revision: added.view.revision }, f.first.credentials);
  for (const kind of ['artwork', 'artistArtwork'] as const) {
    const canonical = `${selected[kind]}?size=160`;
    assert.equal(played.view.ownPlayback!.track[kind], selected[kind]);
    assert.deepEqual(await conditional(canonical, f.first.membership, cached.get(kind)!), { status: 304, bytes: 0 });
    assert.deepEqual(await conditional(`${played.preparation.played[0]![kind]}?size=160`, f.first.credentials, cached.get(kind)!), { status: 304, bytes: 0 },
      'History revalidates against the catalogue tag without sending pixels.');
    assert.equal((await conditional(canonical, f.second.membership, cached.get(kind)!)).status, 409);
    assert.equal((await f.request(`${entry[kind]}?size=160`, undefined, f.second.credentials)).status, 404);
    // Private-list-only clients still get safe conditional caching.
    const fallback = await f.request(`${entry[kind]}?size=160`, undefined, f.first.privateCookie);
    assert.equal(fallback.headers.get('cache-control'), 'private, no-cache');
    await fallback.arrayBuffer();
    assert.deepEqual(await conditional(`${entry[kind]}?size=160`, f.first.privateCookie, cached.get(kind)!), { status: 304, bytes: 0 });
  }
  assert.equal(f.remote.imageCalls.length, 2, 'Only the cover and portrait are fetched from Music Assistant.');
  assert.ok(f.remote.imageCalls.every(path => path.endsWith('?size=160&fmt=jpeg')));
});

test('one participant stream separates room and owner events and revokes removed membership', async t => {
  const f = await fixture(t); const added = await f.add();
  assert.equal((await f.request(prefix + '/live', undefined, f.first.privateCookie)).status, 401);
  const events = await f.openStream(prefix + '/live', f.first.credentials);
  const room = await events(); const list = await events();
  assert.match(room, /event: state/); assert.ok(!room.includes(added.entryId)); assert.ok(!room.includes('upcoming'));
  assert.match(list, /event: preparation\n/); assert.ok(list.includes(added.entryId)); assert.ok(!list.includes(f.second.preparation.ownerId));
  // Read-only output monitoring can publish room state between owner events.
  // Inspect every intervening frame rather than relying on scheduler timing.
  const expectEvent = async (name: string, contains = '') => {
    for (;;) {
      const frame = await events();
      assert.ok(!frame.includes(f.second.preparation.ownerId));
      if (frame.startsWith('event: state\n')) {
        assert.ok(!frame.includes(added.entryId)); assert.ok(!frame.includes('upcoming'));
        if (name === 'state' && frame.includes(contains)) return;
        continue;
      }
      assert.ok(frame.startsWith(`event: ${name}\n`), `Expected ${name}, received ${frame}`);
      return;
    }
  };
  await f.running.engine.join('Late'); await expectEvent('state', 'Late');
  const host = f.running.engine.view({ kind: 'host' }); await f.running.engine.remove(host.current!.id, host.revision);
  await expectEvent('revoked');
});

test('PIN HTTP boundaries share one playlist and revoke both cookies and open streams after host reset', async t => {
  const f = await fixture(t); const added = await f.add();
  const turn = await f.json('/api/participant/state', undefined, f.first.membership);
  await f.json(prefix + '/play', { turnId: turn.turnId, previousPlaybackId: null, entryId: added.entryId, revision: added.view.revision }, f.first.credentials);
  const before = await f.json('/api/participant/state', undefined, f.first.membership); const userId = before.user!.id;
  assert.equal((await f.request('/api/participant/join', { nickname: 'No PIN' })).status, 400);
  assert.equal((await f.request(prefix + '/join', { userId, pin: 1234 })).status, 400);
  assert.equal((await f.request(prefix + '/join', { userId, pin: '4321' })).status, 401);
  const login = await f.request(prefix + '/join', { userId, pin: '1234' }); assert.equal(login.status, 200);
  assert.match(login.headers.get('set-cookie')!, /HttpOnly/); assert.match(login.headers.get('set-cookie')!, /SameSite=Strict/);
  const member = cookie(login); const initialized = await f.request(prefix + '/init', {}, member);
  assert.equal(initialized.status, 200); const privateCookie = cookie(initialized);
  const shared = await initialized.json() as PreparationView;
  assert.equal(shared.ownerId, added.view.ownerId); assert.equal(shared.played[0]!.id, added.entryId);
  assert.equal((await f.json('/api/host/state')).active!.length, 2);
  const directory = await f.json<UserDirectory>('/api/participant/identity');
  assert.deepEqual(Object.keys(directory.users[0]!).sort(), ['id', 'nickname', 'pinRequired']);
  assert.ok(!JSON.stringify(directory).includes(added.view.ownerId));
  const events = await f.openStream(prefix + '/live', `${member}; ${privateCookie}`); await events(); await events();
  const reset = await f.request('/api/host/users/pin', { userId, pin: '0042' }); assert.equal(reset.status, 200);
  let revoked = ''; for (let i = 0; i < 40 && !revoked.includes('event: revoked'); i++) revoked = await events();
  assert.match(revoked, /event: revoked/); // Drain playback samples buffered before the reset committed.
  for (const credential of [f.first.credentials, `${member}; ${privateCookie}`]) {
    assert.equal((await f.request('/api/participant/state', undefined, credential)).status, 401);
    assert.equal((await f.request(prefix + '/state', undefined, credential)).status, 401);
    assert.equal((await f.request(prefix + '/init', {}, credential)).status, 401);
    assert.equal((await f.request(prefix + '/join', {}, credential)).status, 400);
    assert.equal((await f.request(prefix + '/join', { nickname: 'Old cookie', pin: '9999' }, credential)).status, 401);
  }
  const host = await f.json('/api/host/state'); assert.equal(host.turnId, before.turnId); assert.deepEqual(host.rotation, before.rotation);
  assert.equal(host.hostPlayback!.id, before.ownPlayback!.id); assert.equal(host.hostPlayback!.status, 'playing');
  const restored = await f.request(prefix + '/join', { userId, pin: '0042' }); assert.equal(restored.status, 200);
  const recovered = await f.json<PreparationView>(prefix + '/init', {}, cookie(restored));
  assert.equal(recovered.played[0]!.id, added.entryId);
});

test('selecting another user signs the old browser session out without removing either listening-order seat', async t => {
  const f = await fixture(t);
  const second = await f.json('/api/participant/state', undefined, f.second.membership);
  const switched = await f.request(prefix + '/join', { userId: second.user!.id, pin: '1234' }, f.first.credentials);
  assert.equal(switched.status, 200);
  assert.equal((await f.request('/api/participant/state', undefined, f.first.membership)).status, 401);
  assert.equal((await f.request(prefix + '/state', undefined, f.first.privateCookie)).status, 401);
  const list = await f.json<PreparationView>(prefix + '/init', {}, cookie(switched));
  assert.equal(list.ownerId, f.second.preparation.ownerId);
  assert.equal((await f.request('/api/participant/state', undefined, f.second.membership)).status, 200);
  assert.equal((await f.json('/api/host/state')).active!.length, 2);
});

test('bounded thumbnail variants remain owner-authorized and independently cached', async t => {
  const f = await fixture(t); const added = await f.add(); const url = added.view.upcoming[0]!.artwork!;
  for (const size of [160, 512, 1024, 128, 160]) {
    const response = await f.request(`${url}?size=${size}`, undefined, f.first.privateCookie);
    assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'private, no-cache'); await response.arrayBuffer();
  }
  assert.equal(f.remote.imageCalls.filter(path => path.includes('size=128')).length, 0);
  assert.equal(f.remote.imageCalls.filter(path => path.includes('size=160')).length, 1);
  assert.equal(f.remote.imageCalls.filter(path => path.includes('size=512')).length, 1);
  assert.equal(f.remote.imageCalls.filter(path => path.includes('size=1024&fmt=jpeg')).length, 1);
  assert.equal((await f.request(`${url}?size=999`, undefined, f.first.privateCookie)).status, 400);
  assert.equal((await f.request(`${url}?size=128`, undefined, f.second.privateCookie)).status, 404);
});

test('owner APIs and streams stay private across matching nicknames and room removal; obsolete identity endpoints are absent', async t => {
  const f = await fixture(t);
  assert.notEqual(f.first.preparation.ownerId, f.second.preparation.ownerId);
  assert.equal((await f.request(prefix + '/state')).status, 401);
  assert.equal((await f.request(prefix + '/init', {})).status, 401);
  assert.equal((await f.request(prefix + '/move', {}, f.first.credentials, { Origin: 'https://evil.invalid' })).status, 403);
  const firstEvent = await f.openStream(prefix + '/events', f.first.privateCookie); await firstEvent();
  const otherEvent = await f.openStream(prefix + '/events', f.second.privateCookie); await otherEvent();
  const hostEvent = await f.openStream('/api/host/events', ''); await hostEvent();
  const memberEvent = await f.openStream('/api/participant/events', f.second.membership); await memberEvent();
  let events = 0; f.running.engine.on('change', () => events++);
  const added = await f.add(); assert.equal(events, 0);
  const ownFrame = await firstEvent(); assert.ok(ownFrame.includes(f.remote.track.name));
  const other = await f.add(f.second); const otherFrame = await otherEvent(); assert.ok(!otherFrame.includes(added.entryId)); assert.ok(otherFrame.includes(other.entryId));
  assert.equal(events, 0);
  f.running.engine.emit('change');
  for (const frame of [await hostEvent(), await memberEvent(), JSON.stringify(await f.json('/api/host/state'))]) {
    for (const secret of [f.remote.track.name, added.entryId, added.view.ownerId, 'upcoming', 'playCount']) assert.ok(!frame.includes(secret), secret);
  }
  assert.equal((await f.request(prefix + '/remove', { operation: operation(other.view.revision), entryId: added.entryId }, f.second.privateCookie)).status, 404);
  const current = await f.json('/api/participant/state', undefined, f.first.membership);
  assert.equal((await f.request(prefix + '/play', { entryId: other.entryId, revision: other.view.revision, turnId: current.turnId, previousPlaybackId: null }, f.second.credentials)).status, 403);
  for (const removed of ['/recovery-key', '/recover', '/revoke-devices']) assert.equal((await f.request(prefix + removed, {}, f.first.credentials)).status, 404);
  const host = await f.json('/api/host/state'); await f.json('/api/host/remove', { id: host.current!.id, revision: host.revision });
  assert.equal((await f.request('/api/participant/state', undefined, f.first.membership)).status, 401);
  assert.equal((await f.json<PreparationView>(prefix + '/state', undefined, f.first.privateCookie)).upcoming[0]!.id, added.entryId);
  const raw = await readFile(join(f.dir, 'preparations', `${added.view.ownerId}.json`), 'utf8'); assert.ok(!raw.includes('recoveryHash')); assert.ok(!raw.includes(f.first.privateCookie.split('=')[1]!));
});

test('exact/source failures retain entries for review and never substitute or send an audio command', async t => {
  const f = await fixture(t); const added = await f.add(); const binding = f.running.integrations.sourceBindingId;
  await f.running.integrations.save(f.remote.origin, 'browser-test-token', f.running.integrations.view().revision);
  await f.running.integrations.check(f.running.integrations.view().revision);
  assert.equal(f.running.integrations.sourceBindingId, binding);
  f.remote.track.version = 'Different remaster';
  let view = await f.json('/api/participant/state', undefined, f.first.membership);
  assert.equal((await f.request(prefix + '/play', { entryId: added.entryId, revision: added.view.revision, turnId: view.turnId, previousPlaybackId: null }, f.first.credentials)).status, 422);
  let list = await f.json<PreparationView>(prefix + '/state', undefined, f.first.privateCookie);
  assert.equal(list.upcoming[0]!.id, added.entryId); assert.equal(list.reviewEntryId, added.entryId);
  f.remote.track.version = 'Original recording';
  list = (await f.json<PreparationResult>(prefix + '/review', { entryId: added.entryId, operation: operation(list.revision) }, f.first.privateCookie)).view;
  await f.running.integrations.clear(f.running.integrations.view().revision);
  list = await f.json<PreparationView>(prefix + '/state', undefined, f.first.privateCookie); assert.equal(list.upcoming[0]!.sourceAvailable, false);
  await f.running.integrations.save(f.remote.origin, 'fixture-token', f.running.integrations.view().revision);
  assert.notEqual(f.running.integrations.sourceBindingId, binding);
  await f.running.integrations.selectDestination('sonos:room', f.running.integrations.view().revision);
  assert.equal((await f.request(prefix + '/play', { entryId: added.entryId, revision: list.revision, turnId: view.turnId, previousPlaybackId: null }, f.first.credentials)).status, 409);
  assert.equal(f.remote.calls.filter(call => call.command === 'player_queues/play_media').length, 0);
  assert.equal((await f.json<PreparationView>(prefix + '/state', undefined, f.first.privateCookie)).upcoming.length, 1);
});

test('saved playback keeps single-track/turn/reveal guards and natural completion never autoplays another choice', async t => {
  const f = await fixture(t); const added = await f.add();
  const current = await f.json('/api/participant/state', undefined, f.first.membership);
  const command = { entryId: added.entryId, revision: added.view.revision, turnId: current.turnId, previousPlaybackId: null };
  const responses = await Promise.all([f.request(prefix + '/play', command, f.first.credentials), f.request(prefix + '/play', command, f.first.credentials)]);
  assert.deepEqual(responses.map(response => response.status).sort(), [200, 409]);
  const playing = await f.json('/api/participant/state', undefined, f.first.membership); const playbackId = playing.ownPlayback!.id;
  for (const action of ['pause', 'resume'] as const) await f.json('/api/participant/control', { turnId: current.turnId, playbackId, action }, f.first.membership);
  await f.json('/api/participant/reveal', { turnId: current.turnId, playbackId }, f.first.membership);
  assert.equal((await f.json<PreparationView>(prefix + '/state', undefined, f.first.privateCookie)).played[0]!.playCount, 1);
  f.remote.finish();
  for (let i = 0; i < 100 && f.running.engine.view({ kind: 'host' }).turnId === current.turnId; i++) await delay(10);
  assert.notEqual(f.running.engine.view({ kind: 'host' }).turnId, current.turnId);
  assert.equal(f.remote.calls.filter(call => call.command === 'player_queues/play_media').length, 1);
  assert.equal(f.running.engine.view({ kind: 'participant', credential: f.first.membership.split('=')[1]! }).ownPlayback, undefined);
});

test('a slow or failed private save cannot hold up another participant’s player or consume its command budget', async t => {
  const f = await fixture(t); const first = await f.add();
  const initial = await f.json('/api/participant/state', undefined, f.first.membership);
  const played = await f.json<{ view: View }>(prefix + '/play', { entryId: first.entryId, revision: first.view.revision, turnId: initial.turnId, previousPlaybackId: null }, f.first.credentials);
  const playbackId = played.view.ownPlayback!.id;
  await f.json('/api/participant/reveal', { turnId: initial.turnId, playbackId }, f.first.membership);
  const store = f.running.preparationStore; const save = store.save.bind(store);
  let entered!: () => void; let release!: () => void;
  const saving = new Promise<void>(resolve => { entered = resolve; }); const gate = new Promise<void>(resolve => { release = resolve; });
  store.save = async state => { if (state.ownerId === f.second.preparation.ownerId) { entered(); await gate; throw new Error('Synthetic storage failure'); } await save(state); };
  t.after(() => release());
  const pending = f.add(f.second).catch(error => error); await saving;
  const paused = await f.json('/api/participant/control', { turnId: initial.turnId, playbackId, action: 'pause' }, f.first.membership);
  assert.equal(paused.ownPlayback!.status, 'paused'); assert.equal(paused.ownPlayback!.revealed, true); assert.equal(paused.turnId, initial.turnId);
  release(); assert.ok(await pending instanceof Error);
  assert.equal(f.remote.calls.filter(call => call.command === 'player_queues/stop').length, 0);
  // Invalid saves still count against this owner's edit lane, not any transport lane.
  for (let i = 0; i < 180; i++) await f.request(prefix + '/remove', {}, f.second.privateCookie);
  assert.equal((await f.request(prefix + '/remove', {}, f.second.privateCookie)).status, 429);
  const resumed = await f.json('/api/participant/control', { turnId: initial.turnId, playbackId, action: 'resume' }, f.first.membership);
  assert.equal(resumed.ownPlayback!.status, 'playing'); assert.equal(resumed.ownPlayback!.revealed, true);
});

test('saved artwork revalidates authorization and source after downloads; stale access returns no private image', async t => {
  const f = await fixture(t); const first = await f.add();
  const user = (await f.json('/api/participant/state', undefined, f.first.membership)).user!;
  const login = await f.request('/api/participant/join', { userId: user.id, pin: '1234' });
  const membership = login.headers.get('set-cookie')!.split(';')[0]!;
  const initialized = await f.request(prefix + '/init', {}, membership);
  const newCookie = initialized.headers.get('set-cookie')!.split(';')[0]!; f.remote.delayImages(150);
  let pending = f.request(first.view.upcoming[0]!.artwork!, undefined, f.first.privateCookie);
  for (let i = 0; i < 100 && !f.remote.imageCalls.length; i++) await delay(2);
  const state = (await f.running.preparationStore.load(first.view.ownerId))!; state.credentials.shift(); await f.running.preparationStore.save(state);
  assert.equal((await pending).status, 401);
  pending = f.request(first.view.upcoming[0]!.artistArtwork!, undefined, newCookie);
  for (let i = 0; i < 100 && f.remote.imageCalls.length < 2; i++) await delay(2);
  await f.running.integrations.save(f.remote.origin, 'browser-test-token', f.running.integrations.view().revision);
  assert.equal((await pending).status, 409);
});

test('legacy connection files gain a durable source binding once without changing routing/revisions or making network requests', async t => {
  const remote = await startMusicAssistantFixture(); t.after(remote.close);
  const dir = await mkdtemp('/tmp/opencode/doom-room-preparation-migrate-');
  const legacy = { schema: 1, revision: 7, musicAssistant: { url: remote.origin, accessToken: 'fixture-token', destination: { id: 'sonos:room', name: 'Living room' } } };
  await writeFile(join(dir, 'integrations.json'), JSON.stringify(legacy), { mode: 0o600 });
  const first = new IntegrationManager(new IntegrationFileStore(dir)); await first.init(); assert.ok(first.sourceBindingId);
  const second = new IntegrationManager(new IntegrationFileStore(dir)); await second.init(); assert.equal(second.sourceBindingId, first.sourceBindingId);
  assert.equal(second.view().revision, 7); assert.deepEqual(second.view().destination, legacy.musicAssistant.destination); assert.equal(remote.calls.length, 0);
});

test('a shared list is imported on the server: found songs are saved in order without asking Music Assistant again', async t => {
  const f = await fixture(t);
  const token = (member: typeof f.first) => member.privateCookie.split('=')[1]!;
  const song = (rank: number, fields: Partial<SharedSong> = {}): SharedSong => ({ rank, artist: 'Fixture artist', title: 'Real catalogue fixture', album: 'Fixture album',
    trackNumber: 1, duration: 180, albumLinks: [{ service: 'spotify', url: 'https://open.spotify.com/album/4aawyAB9vmqN3uQ7FjRGTy' }], ...fields });
  const shared = { list: { name: 'Best of 2025', year: 2025 }, leftOut: { noPick: 0, disqualified: 0 }, skipped: 0,
    songs: [song(1), song(2, { artist: 'Someone else', albumLinks: [] }), song(3)] };
  const imports = new ListImports(f.running.preparations, item => f.running.integrations.importSong(item));
  const finished = async (credential: string) => { for (let i = 0; i < 200; i++) { const view = await imports.current(credential); if (view?.finished) return view; await delay(10); } throw new Error('Import did not finish'); };
  const lookups = () => f.remote.calls.filter(call => ['music/search', 'music/albums/album_tracks', 'music/item_by_uri', 'providers'].includes(call.command)).length;
  const exact = () => f.remote.calls.filter(call => call.command === 'music/item_by_uri').length;
  const exactBefore = exact();
  await imports.start(token(f.first), shared);
  const first = await finished(token(f.first));
  // The same song twice is added once; a different artist is not a match.
  assert.deepEqual([first.added, first.already, first.missing.map(item => item.rank)], [1, 1, [2]]);
  assert.equal(exact(), exactBefore, 'the match is saved from the listing, without a second lookup');
  const searches = f.remote.calls.filter(call => call.command === 'music/search');
  assert.ok(searches.length && searches.every(call => call.args.limit === 10), 'imports ask for one page of results per service');
  assert.ok(searches.some(call => JSON.stringify(call.args.providers) === '["library"]'), 'the library is searched before slow services');
  const list = await f.json<PreparationView>(prefix + '/state', undefined, f.first.privateCookie);
  assert.deepEqual(list.upcoming.map(entry => entry.title), ['Real catalogue fixture']);
  // Another person importing the same songs needs no Music Assistant lookups at all.
  const before = lookups();
  await imports.start(token(f.second), shared); const second = await finished(token(f.second));
  assert.equal(second.added, 1); assert.equal(lookups(), before);
  await assert.rejects(imports.current('not-a-playlist-credential'), 'a progress view needs the playlist’s own credential');
  // Links are checked before anything is contacted, and there is no demo version.
  for (const link of ['not a link', 'https://127.0.0.1/lr/AbCdEfGhIjKlMnOpQrStUv']) assert.equal((await f.request(prefix + '/import', { link }, f.first.credentials)).status, 422, link);
  assert.equal((await f.request(prefix + '/import', { link: 'https://sushe.example/lr/AbCdEfGhIjKlMnOpQrStUv' }, f.first.privateCookie)).status, 401, 'members only');
  assert.deepEqual(await (await f.request(prefix + '/import', undefined, f.first.privateCookie)).json(), { import: null });
  await f.running.integrations.clear(f.running.integrations.view().revision);
  assert.equal((await f.request(prefix + '/import', { link: 'https://sushe.example/lr/AbCdEfGhIjKlMnOpQrStUv' }, f.first.credentials)).status, 422);
  imports.close();
});

test('a song is replaced with another from its album, in the same place, for its owner only', async t => {
  const f = await fixture(t); const added = await f.add();
  type Album = { album: { name: string; artist: string }; tracks: CatalogueTrack[]; current: number };
  const album = await f.json<Album>(prefix + '/album', { entryId: added.entryId }, f.first.credentials);
  assert.deepEqual(album.album, { name: 'Fixture album', artist: 'Fixture artist' });
  assert.deepEqual(album.tracks.map(track => track.title), ['Real catalogue fixture', 'Second fixture song']); assert.equal(album.current, 0);
  assert.equal((await f.request(prefix + '/album', { entryId: added.entryId }, f.first.privateCookie)).status, 401, 'members only');
  assert.equal((await f.request(prefix + '/album', { entryId: added.entryId }, f.second.credentials)).status, 404, 'another person’s song');
  // The album's songs are sealed to the person who listed them, like search results.
  const other = await f.json<PreparationView>(prefix + '/state', undefined, f.second.privateCookie);
  assert.equal((await f.request(prefix + '/replace', { operation: operation(other.revision), entryId: added.entryId, trackId: album.tracks[1]!.id }, f.second.credentials)).status, 409);
  const replaced = await f.json<PreparationResult>(prefix + '/replace', { operation: operation(added.view.revision), entryId: added.entryId, trackId: album.tracks[1]!.id }, f.first.credentials);
  assert.deepEqual(replaced.view.upcoming.map(entry => entry.title), ['Second fixture song']);
  assert.deepEqual(replaced.view.removed, [], 'the replaced song leaves the list');
  const again = await f.json<Album>(prefix + '/album', { entryId: replaced.entryId }, f.first.credentials);
  assert.equal(again.current, 1);
});
