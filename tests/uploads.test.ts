import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir, stat, writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { createServer, request as httpRequest } from 'node:http';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { UploadAssets, analyzeUpload, type UploadPreview } from '../src/uploads.js';
import { AppError, type View } from '../src/model.js';
import { Engine } from '../src/engine.js';
import { FileStore, writePrivateJson } from '../src/store.js';
import { DemoAdapter } from '../src/playback.js';
import { ManagedPlayback } from '../src/live-playback.js';
import { IntegrationFileStore, IntegrationManager } from '../src/integrations.js';
import { PreparationFileStore, type PreparationResult, type PreparationView } from '../src/preparations.js';
import { createApp } from '../src/http.js';
import { startMusicAssistantFixture } from './fixtures/music-assistant.js';
import { fixtureUploadAnalysis, uploadBytes } from './fixtures/uploads.js';

const prefix = '/api/participant/preparations';
const op = (revision: number) => ({ id: randomUUID(), revision, issuedAt: Date.now() });
const status = (expected: number) => (error: unknown) => error instanceof AppError && error.status === expected;
const cookie = (response: Response) => response.headers.get('set-cookie')!.split(';')[0]!;

async function fixture(t: TestContext, analyze = fixtureUploadAnalysis) {
  const remote = await startMusicAssistantFixture(); const directory = await mkdtemp('/tmp/opencode/aoty-uploads-');
  const server = createServer(); server.listen(0, '0.0.0.0'); await once(server, 'listening');
  const port = (server.address() as AddressInfo).port; const origin = `http://127.0.0.1:${port}`;
  const config = { port, listenHost: '127.0.0.1', guestUrl: origin, dataDir: directory, mode: 'demo' as const, demoSeconds: 3600 };
  const integrations = new IntegrationManager(new IntegrationFileStore(directory)); await integrations.init();
  const adapter = new ManagedPlayback(new DemoAdapter(3600), integrations, 20);
  const engine = new Engine(new FileStore(directory), adapter, origin, integrations); await engine.init();
  const uploads = new UploadAssets(directory, analyze);
  const http = createApp(engine, config, 'dist/web', integrations, undefined, uploads); server.on('request', http.app);
  t.after(() => { http.close(); adapter.close(); server.closeAllConnections(); server.close(); remote.close(); });
  const request = (path: string, data?: unknown, credentials = '') => fetch(origin + path, { method: data === undefined ? 'GET' : 'POST',
    headers: { Cookie: credentials, ...(data === undefined ? {} : { Origin: origin, 'Content-Type': 'application/json' }) },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }), signal: AbortSignal.timeout(5000) });
  async function json<T = View>(path: string, data?: unknown, credentials = ''): Promise<T> {
    const response = await request(path, data, credentials); assert.equal(response.status, 200, await response.clone().text()); return response.json() as Promise<T>;
  }
  const displayCookie = ''; // Public display needs no credential.
  async function member(name: string) {
    const joined = await request('/api/participant/join', { nickname: name, pin: '1234' }); assert.equal(joined.status, 200);
    const membership = cookie(joined);
    const initialized = await request(prefix + '/init', {}, membership); const library = cookie(initialized);
    return { membership, library, credentials: `${membership}; ${library}`, ownerId: (await initialized.json() as PreparationView).ownerId };
  }
  const first = await member('First'); const second = await member('Second');
  const upload = (credentials = first.credentials, uploadId = randomUUID(), bytes = uploadBytes, filename = 'my-song.mp3', extra: Record<string, string> = {}) => fetch(`${origin}${prefix}/uploads/${uploadId}`, {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/octet-stream', 'X-Upload-Filename': encodeURIComponent(filename), Cookie: credentials, ...extra }, body: new Uint8Array(bytes), signal: AbortSignal.timeout(5000),
  });
  async function add(member = first, uploadId?: string) {
    if (!uploadId) { const response = await upload(member.credentials); assert.equal(response.status, 200, await response.clone().text()); uploadId = (await response.json() as UploadPreview).id; }
    const list = await json<PreparationView>(prefix + '/state', undefined, member.library);
    const body = { operation: op(list.revision), uploadId, text: { title: 'My exact recording', artist: 'My artist', album: 'My album' } };
    return { ...(await json<PreparationResult>(prefix + '/add-upload', body, member.credentials)), body };
  }
  async function connect() { await integrations.save(remote.origin, 'fixture-token', integrations.view().revision); await integrations.selectDestination('sonos:room', integrations.view().revision); await adapter.refresh(); }
  async function play(added: PreparationResult) {
    const current = await json('/api/participant/state', undefined, first.membership);
    return json<{ view: View; preparation: PreparationView }>(prefix + '/play', { entryId: added.entryId, revision: added.view.revision, turnId: current.turnId, previousPlaybackId: current.ownPlayback?.id ?? null }, first.credentials);
  }
  return { directory, origin, first, second, displayCookie, integrations, adapter, engine, remote, uploads, request, json, upload, add, connect, play, config };
}

test('uploads stream privately, retry identically, reject changed/foreign IDs and unsupported AAC, and persist original bytes/artwork', async t => {
  const f = await fixture(t); const uploadId = randomUUID();
  assert.equal((await f.upload('', uploadId)).status, 401);
  assert.equal((await f.upload(f.first.credentials, uploadId, uploadBytes, 'my.aac')).status, 422);
  assert.equal((await f.upload(f.first.credentials, uploadId, uploadBytes, 'my.mp3', { Origin: 'https://evil.invalid' })).status, 403);
  let response = await f.upload(f.first.credentials, uploadId); assert.equal(response.status, 200, await response.clone().text());
  const preview = await response.json() as UploadPreview;
  assert.equal(preview.title, 'Uploaded song'); assert.equal(preview.artist, 'Local artist');
  assert.equal((await f.upload(f.first.credentials, uploadId)).status, 200);
  assert.equal((await f.upload(f.first.credentials, uploadId, Buffer.from('different recording'))).status, 409);
  assert.equal((await f.upload(f.second.credentials, uploadId)).status, 409);
  assert.equal((await f.request(prefix + `/uploads/${uploadId}`, undefined, f.second.credentials)).status, 404);
  assert.equal((await f.request(preview.artwork!, undefined, f.second.credentials)).status, 404);
  assert.equal((await f.request(preview.artwork!)).status, 401);
  assert.equal((await f.request(preview.artwork!, undefined, f.first.library)).status, 200);
  const files = join(f.directory, 'uploads', uploadId);
  assert.deepEqual(await readFile(join(files, 'audio')), uploadBytes);
  assert.equal((await stat(files)).mode & 0o777, 0o700); assert.equal((await stat(join(files, 'audio'))).mode & 0o777, 0o600);
  assert.equal(f.remote.calls.filter(call => /play_media|add_track/.test(call.command)).length, 0);
});

test('host user deletion stops their playback and deletes saved and draft uploads, but keeps other users and their files', async t => {
  const f = await fixture(t); await f.connect(); const added = await f.add(); await f.play(added);
  const draftId = randomUUID(); const keptId = randomUUID();
  assert.equal((await f.upload(f.first.credentials, draftId)).status, 200);
  assert.equal((await f.upload(f.second.credentials, keptId)).status, 200);
  const stagedId = randomUUID(); const keptStageId = randomUUID();
  for (const [assetId, ownerId] of [[stagedId, f.first.ownerId], [keptStageId, f.second.ownerId]]) {
    const directory = join(f.directory, 'upload-staging', assetId!);
    await writePrivateJson(directory, 'receiving.json', { id: assetId, ownerId, createdAt: Date.now() });
    await writeFile(join(directory, 'audio'), uploadBytes);
  }
  const user = (await f.json('/api/participant/state', undefined, f.first.membership)).user!;
  assert.equal((await f.request('/api/host/users/delete', { userId: user.id })).status, 400);
  const response = await f.request('/api/host/users/delete', { userId: user.id, confirm: true });
  assert.equal(response.status, 200, await response.clone().text());
  for (const assetId of [added.body.uploadId, draftId]) await assert.rejects(stat(join(f.directory, 'uploads', assetId)), { code: 'ENOENT' });
  await assert.rejects(stat(join(f.directory, 'preparations', `${f.first.ownerId}.json`)), { code: 'ENOENT' });
  assert.deepEqual(await readFile(join(f.directory, 'uploads', keptId, 'audio')), uploadBytes);
  await assert.rejects(stat(join(f.directory, 'upload-staging', stagedId)), { code: 'ENOENT' });
  assert.deepEqual(await readFile(join(f.directory, 'upload-staging', keptStageId, 'audio')), uploadBytes);
  assert.equal((await f.request(prefix + '/state', undefined, f.first.library)).status, 401);
  assert.equal((await f.request(prefix + '/init', {}, f.first.credentials)).status, 401);
  assert.equal((await f.request(prefix + '/state', undefined, f.second.library)).status, 200);
  const host = await f.json('/api/host/state'); assert.equal(host.active!.length, 1); assert.equal(host.hostPlayback, null);
  assert.equal((await f.request('/api/host/users/delete', { userId: user.id, confirm: true })).status, 200);
  const registered = await f.request(prefix + '/join', { nickname: user.nickname, pin: '0042', operation: randomUUID() }, f.first.credentials);
  assert.equal(registered.status, 200, await registered.clone().text());
  const newUser = await registered.json() as View; assert.notEqual(newUser.user!.id, user.id);
  const newList = await f.json<PreparationView>(prefix + '/init', {}, cookie(registered));
  assert.notEqual(newList.ownerId, f.first.ownerId); assert.deepEqual(newList.upcoming, []);
});

test('deleting a user already removed from the listening order leaves the current listener and playback untouched', async t => {
  const f = await fixture(t); await f.connect(); const added = await f.add(); await f.play(added);
  const user = (await f.json('/api/participant/state', undefined, f.second.membership)).user!;
  const room = await f.json('/api/host/state');
  await f.json('/api/host/remove', { id: user.id, revision: room.revision });
  const before = await f.json('/api/host/state');
  const response = await f.request('/api/host/users/delete', { userId: user.id, confirm: true });
  assert.equal(response.status, 200, await response.clone().text());
  const after = await f.json('/api/host/state');
  assert.deepEqual(after.hostPlayback, before.hostPlayback); assert.equal(after.turnId, before.turnId);
  assert.deepEqual(after.active, before.active);
  assert.deepEqual(await readFile(join(f.directory, 'uploads', added.body.uploadId, 'audio')), uploadBytes);
  await assert.rejects(stat(join(f.directory, 'preparations', `${f.second.ownerId}.json`)), { code: 'ENOENT' });
});

test('deletion during an upload revokes access immediately and keeps cleanup retryable until the transfer finishes', async t => {
  let entered!: () => void; let release!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; }); const gate = new Promise<void>(resolve => { release = resolve; });
  t.after(() => release());
  const f = await fixture(t, async (directory, filename) => { entered(); await gate; return fixtureUploadAnalysis(directory, filename); });
  const user = (await f.json('/api/participant/state', undefined, f.first.membership)).user!;
  const uploadId = randomUUID(); const upload = f.upload(f.first.credentials, uploadId); await started;
  const deletion = { userId: user.id, confirm: true };
  assert.equal((await f.request('/api/host/users/delete', deletion)).status, 409);
  assert.equal((await f.request('/api/participant/state', undefined, f.first.membership)).status, 401);
  assert.equal((await f.upload(f.first.credentials, randomUUID())).status, 401);
  release(); assert.equal((await upload).status, 401);
  assert.equal((await f.request('/api/host/users/delete', deletion)).status, 200);
  await assert.rejects(stat(join(f.directory, 'uploads', uploadId)), { code: 'ENOENT' });
});

test('uploaded entries preserve privacy, metadata, automatic list persistence and idempotent saves without catalogue bindings', async t => {
  const f = await fixture(t); const added = await f.add();
  assert.equal(added.view.upcoming[0]!.title, 'My exact recording'); assert.equal(added.view.upcoming[0]!.source, 'upload');
  assert.equal(added.view.upcoming[0]!.sourceAvailable, false);
  for (const secret of ['sha256', 'assetId', 'sourceBindingId', '/audio', 'fixture-token']) assert.ok(!JSON.stringify(added.view).includes(secret));
  const retried = await f.json<PreparationResult>(prefix + '/add-upload', added.body, f.first.library); assert.equal(retried.replayed, true); assert.equal(retried.view.upcoming.length, 1);
  const discard = await f.json<{ discarded: boolean; saved: boolean }>(prefix + `/uploads/${added.body.uploadId}/discard`, {}, f.first.library);
  assert.deepEqual(discard, { discarded: false, saved: true }); await stat(join(f.directory, 'uploads', added.body.uploadId, 'audio'));
  assert.equal((await f.request(prefix + '/add-upload', { ...added.body, operation: op(0) }, f.second.credentials)).status, 404);
  const duplicate = await f.add(); assert.equal(duplicate.entryId, added.entryId); assert.equal(duplicate.view.upcoming.length, 1);
  assert.equal((await readdir(join(f.directory, 'uploads'))).length, 1, 'Unreferenced duplicate bytes are discarded only after durable list commit.');
  const initialized = await f.request(prefix + '/init', {}, f.first.membership); const newCookie = cookie(initialized);
  assert.equal((await f.json<PreparationView>(prefix + '/state', undefined, newCookie)).upcoming[0]!.title, 'My exact recording');
  await f.connect(); assert.equal((await f.json<PreparationView>(prefix + '/state', undefined, newCookie)).upcoming[0]!.sourceAvailable, true);
  await f.integrations.clear(f.integrations.view().revision); await f.connect();
  assert.equal((await f.json<PreparationView>(prefix + '/state', undefined, newCookie)).upcoming[0]!.sourceAvailable, true);
  assert.equal((await f.request(added.view.upcoming[0]!.artwork!, undefined, newCookie)).status, 200);
  const host = await f.json('/api/host/state'); await f.json('/api/host/remove', { id: host.current!.id, revision: host.revision });
  assert.equal((await f.request(prefix + '/state', undefined, newCookie)).status, 200);
  assert.equal((await f.request(added.view.upcoming[0]!.artwork!, undefined, newCookie)).status, 200);
  for (const view of [await f.json('/api/host/state'), await f.json<PreparationView>(prefix + '/state', undefined, f.second.library)]) assert.ok(!JSON.stringify(view).includes('My exact recording'));
});

test('uploaded playback verifies a typed exact source before queue writes, supports ranged reads and reveal, and revokes on stop', async t => {
  const f = await fixture(t); await f.connect(); const added = await f.add(); const played = await f.play(added);
  const playback = played.view.ownPlayback!;
  assert.equal(playback.track.title, 'My exact recording'); assert.equal(played.preparation.played[0]!.id, added.entryId);
  const read = f.remote.calls.find(call => call.command === 'music/item_by_uri' && String(call.args.uri).startsWith('builtin://track/'))!;
  const mediaURL = String(read.args.uri).slice('builtin://track/'.length);
  assert.equal(f.remote.calls.filter(call => call.command === 'player_queues/play_media').length, 1);
  assert.deepEqual(f.remote.calls.find(call => call.command === 'player_queues/play_media')!.args.media, [read.args.uri]);
  for (const view of [played.view, await f.json('/api/host/state'), await f.json('/api/display/state', undefined, f.displayCookie), await f.json('/api/participant/state', undefined, f.second.membership)]) {
    assert.ok(!JSON.stringify(view).includes(mediaURL)); assert.ok(!JSON.stringify(view).includes('UPSTREAM SECRET'));
  }
  const head = await fetch(mediaURL, { method: 'HEAD' }); assert.equal(head.status, 200); assert.equal(head.headers.get('content-length'), String(uploadBytes.length));
  const range = await fetch(mediaURL, { headers: { Range: 'bytes=3-8' } }); assert.equal(range.status, 206); assert.deepEqual(Buffer.from(await range.arrayBuffer()), uploadBytes.subarray(3, 9));
  const suffix = await fetch(mediaURL, { headers: { Range: 'bytes=-4' } }); assert.equal(suffix.status, 206); assert.deepEqual(Buffer.from(await suffix.arrayBuffer()), uploadBytes.subarray(-4));
  for (const value of ['bytes=999999-', 'bytes=0-1,4-5', 'bytes=-0', 'bytes=10-2', 'bytes=-9007199254740992']) assert.equal((await fetch(mediaURL, { headers: { Range: value } })).status, 416);
  assert.equal((await fetch(mediaURL.replace(/\/[A-Za-z0-9_-]{43}\//, `/${'a'.repeat(43)}/`))).status, 404);
  assert.equal((await fetch(mediaURL.replace(/track\.[a-z0-9]+$/, 'track.wav'))).status, 404);
  const art = playback.track.artwork!;
  assert.equal((await f.request(art, undefined, f.second.membership)).status, 409);
  assert.equal((await f.request(`/api/display/artwork/${playback.id}/artwork`, undefined, f.displayCookie)).status, 403);
  await f.json('/api/participant/reveal', { turnId: played.view.turnId, playbackId: playback.id }, f.first.membership);
  const publicView = await f.json('/api/display/state', undefined, f.displayCookie);
  assert.equal(publicView.nowPlaying?.revealed, true);
  assert.equal((await f.request(`/api/display/artwork/${playback.id}/artwork`, undefined, f.displayCookie)).status, 200);
  await f.json('/api/participant/control', { turnId: played.view.turnId, playbackId: playback.id, action: 'stop' }, f.first.membership);
  assert.equal((await fetch(mediaURL)).status, 404); assert.equal(f.uploads.busy(added.body.uploadId), false);
});

test('parked uploads remain readable across an indefinite pause and revoke on natural completion without autoplay', async t => {
  const f = await fixture(t); await f.connect(); const added = await f.add(); const played = await f.play(added); const playback = played.view.ownPlayback!;
  const mediaURL = String(f.remote.calls.find(call => call.command === 'player_queues/play_media')!.args.media instanceof Array ? (f.remote.calls.find(call => call.command === 'player_queues/play_media')!.args.media as string[])[0] : '').slice('builtin://track/'.length);
  await f.json('/api/participant/control', { turnId: played.view.turnId, playbackId: playback.id, action: 'pause' }, f.first.membership); f.remote.parkPaused();
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() }); t.mock.timers.tick(24 * 60 * 60_000); await delay(60);
  assert.equal((await fetch(mediaURL)).status, 200); assert.equal(f.engine.view({ kind: 'host' }).turnId, played.view.turnId);
  await f.json('/api/participant/control', { turnId: played.view.turnId, playbackId: playback.id, action: 'resume' }, f.first.membership);
  f.remote.finish();
  for (let i = 0; i < 100 && f.engine.view({ kind: 'host' }).turnId === played.view.turnId; i++) await delay(10);
  assert.notEqual(f.engine.view({ kind: 'host' }).turnId, played.view.turnId); assert.equal((await fetch(mediaURL)).status, 404);
  assert.equal(f.remote.calls.filter(call => call.command === 'player_queues/play_media').length, 1);
});

test('unreachable or substituted uploads retain the head for review and send no queue mutation or private URL error', async t => {
  const f = await fixture(t); await f.connect(); let added = await f.add();
  for (const mode of ['unreachable', 'wrong-identity'] as const) {
    f.remote.uploadedMode(mode);
    const current = await f.json('/api/participant/state', undefined, f.first.membership);
    const response = await f.request(prefix + '/play', { entryId: added.entryId, revision: added.view.revision, turnId: current.turnId, previousPlaybackId: null }, f.first.credentials);
    assert.equal(response.status, 422); const error = await response.text(); assert.match(error, /Your file/); assert.ok(!error.includes('/api/media/')); assert.ok(!error.includes('fixture-token'));
    const list = await f.json<PreparationView>(prefix + '/state', undefined, f.first.library); assert.equal(list.upcoming[0]!.id, added.entryId); assert.equal(list.reviewEntryId, added.entryId);
    added = { ...added, ...(await f.json<PreparationResult>(prefix + '/review', { entryId: added.entryId, operation: op(list.revision) }, f.first.library)) };
  }
  assert.equal(f.remote.calls.filter(call => /play_media|\/autoplay|\/repeat|\/shuffle/.test(call.command)).length, 0);
  assert.equal(f.uploads.busy(added.body.uploadId), false);
});

test('an inconsistent restored upload manifest cannot substitute different bytes for a saved recording', async t => {
  const f = await fixture(t); await f.connect(); const added = await f.add();
  const directory = join(f.directory, 'uploads', added.body.uploadId);
  const manifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'));
  const substituted = Buffer.alloc(uploadBytes.length, 42);
  await writeFile(join(directory, 'audio'), substituted);
  await writeFile(join(directory, 'manifest.json'), JSON.stringify({ ...manifest, sha256: createHash('sha256').update(substituted).digest('hex') }));
  const current = await f.json('/api/participant/state', undefined, f.first.membership);
  const response = await f.request(prefix + '/play', { entryId: added.entryId, revision: added.view.revision, turnId: current.turnId, previousPlaybackId: null }, f.first.credentials);
  assert.equal(response.status, 422);
  assert.equal(f.remote.calls.filter(call => call.command === 'player_queues/play_media').length, 0);
  const list = await f.json<PreparationView>(prefix + '/state', undefined, f.first.library);
  assert.equal(list.upcoming[0]!.id, added.entryId); assert.equal(list.reviewEntryId, added.entryId);
});

test('removal/restore retains audio; permanent deletion is explicit, active-safe, durable, and idempotent', async t => {
  const f = await fixture(t); await f.connect(); const added = await f.add(); await f.play(added);
  let list = await f.json<PreparationView>(prefix + '/state', undefined, f.first.library);
  list = (await f.json<PreparationResult>(prefix + '/remove', { entryId: added.entryId, operation: op(list.revision) }, f.first.library)).view;
  assert.equal((await f.request(prefix + '/purge-upload', { entryId: added.entryId, operation: op(list.revision) }, f.first.library)).status, 409);
  const view = await f.json('/api/participant/state', undefined, f.first.membership);
  await f.json('/api/participant/control', { turnId: view.turnId, playbackId: view.ownPlayback!.id, action: 'stop' }, f.first.membership);
  list = (await f.json<PreparationResult>(prefix + '/restore', { entryId: added.entryId, operation: op(list.revision) }, f.first.library)).view;
  assert.deepEqual(await readFile(join(f.directory, 'uploads', added.body.uploadId, 'audio')), uploadBytes);
  list = (await f.json<PreparationResult>(prefix + '/remove', { entryId: added.entryId, operation: op(list.revision) }, f.first.library)).view;
  const body = { entryId: added.entryId, operation: op(list.revision) };
  const deleted = await f.json<PreparationResult>(prefix + '/purge-upload', body, f.first.library); assert.equal(deleted.view.removed.length, 0);
  assert.equal((await f.json<PreparationResult>(prefix + '/purge-upload', body, f.first.library)).replayed, true);
  assert.equal((await new PreparationFileStore(f.directory).load(f.first.ownerId))!.deletedUploads![0], added.body.uploadId);
  await assert.rejects(stat(join(f.directory, 'uploads', added.body.uploadId)));
  assert.equal((await f.request(prefix + '/restore', { entryId: added.entryId, operation: op(deleted.view.revision) }, f.first.library)).status, 404);
});

test('the media origin is host-configurable, preserves files, and permits only capability reads on its alternate Host', async t => {
  const f = await fixture(t); const added = await f.add();
  await f.connect();
  const alternate = f.origin.replace('127.0.0.1', '127.0.0.2'); const alternateHost = new URL(alternate).host;
  const saved = await f.json<{ mediaOrigin: string }>('/api/host/integrations/media-origin', { origin: alternate, revision: f.integrations.view().revision });
  assert.equal(saved.mediaOrigin, alternate);
  const lease = await f.uploads.lease(added.body.uploadId, alternate);
  const withHost = (path: string) => new Promise<number>(resolve => {
    const request = httpRequest(f.origin + path, { headers: { Host: alternateHost } }, response => { response.resume(); resolve(response.statusCode!); }); request.end();
  });
  assert.equal(await withHost(new URL(lease.url).pathname), 200);
  assert.equal(await withHost('/api/host/state'), 403);
  assert.equal((await fetch(f.origin + new URL(lease.url).pathname)).status, 404);
  lease.revoke();
  const restored = new IntegrationManager(new IntegrationFileStore(f.directory)); await restored.init(); assert.equal(restored.view().mediaOrigin, alternate);
  assert.equal((await f.json<PreparationView>(prefix + '/state', undefined, f.first.library)).upcoming[0]!.id, added.entryId);
});

test('failed analysis, cancelled transfers and cleanup do not discard retained audio or change the player lane', async t => {
  let clock = Date.now(); const dir = await mkdtemp('/tmp/opencode/aoty-upload-cleanup-');
  const assets = new UploadAssets(dir, fixtureUploadAnalysis, () => clock); t.after(() => assets.close());
  const owner = randomUUID(); const retained = randomUUID(); const draft = randomUUID();
  await assets.receive(owner, retained, 'retained.mp3', Readable.from(uploadBytes));
  await assets.capture(owner, retained, { title: 'Saved', artist: '', album: '' });
  await assets.receive(owner, draft, 'draft.mp3', Readable.from(uploadBytes));
  const invalid = randomUUID(); await assert.rejects(assets.receive(owner, invalid, 'invalid.mp3', Readable.from(Buffer.from('invalid data'))), status(422));
  await assert.rejects(stat(join(dir, 'uploads', invalid)));
  const aborted = new AbortController(); aborted.abort();
  await assert.rejects(assets.receive(owner, randomUUID(), 'aborted.mp3', Readable.from(uploadBytes), aborted.signal));
  clock += 8 * 24 * 60 * 60_000; await assets.cleanup();
  await assert.rejects(assets.inspect(owner, draft), status(404)); assert.equal((await assets.inspect(owner, retained)).title, 'Uploaded song');
  await writeFile(join(dir, 'uploads', retained, 'audio'), Buffer.alloc(uploadBytes.length));
  await assert.rejects(assets.lease(retained, 'http://localhost:3000'), status(422));
});

test('the real analysis child fails clearly when FFprobe is missing rather than accepting filename metadata as audio', async () => {
  const dir = await mkdtemp('/tmp/opencode/aoty-upload-worker-'); await writeFile(join(dir, 'audio'), uploadBytes);
  await assert.rejects(analyzeUpload(dir, 'test.mp3'), error => error instanceof AppError && [422, 503].includes(error.status));
});

test('large streamed files have no storage quota, and slow processing/authorization changes stay outside the player lane', async t => {
  let enter!: () => void; let release!: () => void;
  const entered = new Promise<void>(resolve => { enter = resolve; }); const gate = new Promise<void>(resolve => { release = resolve; });
  t.after(() => release());
  const f = await fixture(t, async (directory, filename) => { if (filename === 'slow.mp3') { enter(); await gate; } return fixtureUploadAnalysis(directory, filename); });
  await f.connect(); const added = await f.add(); const played = await f.play(added);
  const large = await f.upload(f.second.credentials, randomUUID(), Buffer.alloc(5 * 1024 * 1024, 1), 'large.mp3'); assert.equal(large.status, 200);
  const uploadId = randomUUID(); const uploading = f.upload(f.second.credentials, uploadId, uploadBytes, 'slow.mp3'); await entered;
  const paused = await f.json('/api/participant/control', { turnId: played.view.turnId, playbackId: played.view.ownPlayback!.id, action: 'pause' }, f.first.membership);
  assert.equal(paused.ownPlayback!.status, 'paused');
  const user = (await f.json('/api/participant/state', undefined, f.second.membership)).user!;
  const login = await f.request('/api/participant/join', { userId: user.id, pin: '1234' });
  const initialized = await f.request(prefix + '/init', {}, cookie(login));
  const replacementCookie = cookie(initialized); const replacement = replacementCookie.slice('aoty_preparation='.length);
  const store = new PreparationFileStore(f.directory); const state = (await store.load(f.second.ownerId))!;
  state.credentials = [{ hash: createHash('sha256').update(replacement).digest('hex'), createdAt: Date.now() }]; await store.save(state);
  release(); const finished = await uploading; assert.equal(finished.status, 401);
  assert.equal((await f.request(prefix + `/uploads/${uploadId}`, undefined, f.second.library)).status, 401);
  assert.equal((await f.request(prefix + `/uploads/${uploadId}`, undefined, replacementCookie)).status, 200);
  assert.equal(f.remote.calls.filter(call => call.command === 'player_queues/stop').length, 0);
});

test('an unconfirmed permanent-delete cleanup is durable and safely resumes after the next authorized read', async t => {
  const f = await fixture(t); const added = await f.add();
  const removed = await f.json<PreparationResult>(prefix + '/remove', { entryId: added.entryId, operation: op(added.view.revision) }, f.first.library);
  const remove = f.uploads.remove.bind(f.uploads); f.uploads.remove = async () => { throw new Error('Synthetic storage failure'); };
  const deleted = await f.json<PreparationResult>(prefix + '/purge-upload', { entryId: added.entryId, operation: op(removed.view.revision) }, f.first.library);
  assert.equal(deleted.view.removed.length, 0); assert.ok(deleted.warning); await stat(join(f.directory, 'uploads', added.body.uploadId, 'audio'));
  f.uploads.remove = remove;
  assert.equal((await f.request(prefix + '/state', undefined, f.first.library)).status, 200);
  for (let i = 0; i < 100 && await stat(join(f.directory, 'uploads', added.body.uploadId)).then(() => true, () => false); i++) await delay(5);
  await assert.rejects(stat(join(f.directory, 'uploads', added.body.uploadId)));
});

test('cleanup never treats missing manifests or inconsistent backup retention markers as permission to delete saved audio', async t => {
  const f = await fixture(t); const added = await f.add(); const directory = join(f.directory, 'uploads', added.body.uploadId);
  await unlink(join(directory, 'manifest.json'));
  await writePrivateJson(directory, 'receiving.json', { id: added.body.uploadId, ownerId: f.first.ownerId, createdAt: Date.now() - 9 * 24 * 60 * 60_000 });
  await f.uploads.cleanup(); assert.deepEqual(await readFile(join(directory, 'audio')), uploadBytes);
  const view = await f.json<PreparationView>(prefix + '/state', undefined, f.first.library); assert.equal(view.upcoming[0]!.id, added.entryId);
});

test('external takeover revokes uploaded audio and public artwork; uncertain ownership keeps deletion pinned until recovery', async t => {
  const f = await fixture(t); await f.connect(); const added = await f.add(); const played = await f.play(added);
  const playback = played.view.ownPlayback!;
  const mediaURL = (f.remote.calls.find(call => call.command === 'player_queues/play_media')!.args.media as string[])[0]!.slice('builtin://track/'.length);
  await f.json('/api/participant/reveal', { turnId: played.view.turnId, playbackId: playback.id }, f.first.membership);
  f.remote.fail(true);
  for (let i = 0; i < 100 && f.engine.ready; i++) await delay(10);
  assert.equal(f.engine.ready, false); assert.equal((await fetch(mediaURL)).status, 404); assert.equal(f.uploads.busy(added.body.uploadId), true);
  assert.equal((await f.request(`/api/display/artwork/${playback.id}/artwork`, undefined, f.displayCookie)).status, 403);
  f.remote.fail(false); await f.integrations.recoverPlayback(f.integrations.view().revision);
  assert.equal(f.uploads.busy(added.body.uploadId), false);
  const fresh = await f.json<PreparationView>(prefix + '/state', undefined, f.first.library);
  const restored = await f.json<PreparationResult>(prefix + '/restore', { entryId: added.entryId, operation: op(fresh.revision) }, f.first.library);
  await f.play(restored);
  const nextURL = (f.remote.calls.filter(call => call.command === 'player_queues/play_media').at(-1)!.args.media as string[])[0]!.slice('builtin://track/'.length);
  const stops = f.remote.calls.filter(call => call.command === 'player_queues/stop').length;
  f.remote.queue.current_item!.queue_item_id = 'external-source-same-recording';
  for (let i = 0; i < 100 && f.adapter.ownsPlayback; i++) await delay(10);
  assert.equal((await fetch(nextURL)).status, 404); assert.equal(f.remote.calls.filter(call => call.command === 'player_queues/stop').length, stops);
});
