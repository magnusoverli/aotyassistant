import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import sharp from 'sharp';
import { UserPictureFiles, UserPictures, prepareUserPicture, type PictureFiles } from '../src/user-pictures.js';
import { pictureVersion } from '../src/user-picture-format.js';
import { AppError, type State, type UserDirectory } from '../src/model.js';
import { Engine } from '../src/engine.js';
import { DemoAdapter } from '../src/playback.js';
import { createApp } from '../src/http.js';
import { publicRoute } from '../src/public-listener.js';
import { ingressListener } from '../src/ingress.js';

class MemoryPictures implements PictureFiles {
  data = new Map<string, Buffer>();
  failWrite = false;
  async ids() { return [...this.data.keys()]; }
  async read(id: string) { return this.data.get(id); }
  async write(id: string, bytes: Buffer) { if (this.failWrite) throw Error('Disk unavailable'); this.data.set(id, bytes); }
  async remove(id: string) { this.data.delete(id); }
}
const raster = (background = '#ee2233') => sharp({ create: { width: 800, height: 600, channels: 3, background } }).jpeg().toBuffer();
const rejects = (code: number) => (error: unknown) => error instanceof AppError && error.status === code;
async function directory(t: TestContext) {
  const path = await mkdtemp(join(tmpdir(), 'doom-room-pictures-'));
  t.after(() => rm(path, { recursive: true, force: true })); return path;
}

test('pictures become bounded full-colour WebP squares with EXIF orientation applied and metadata removed', async () => {
  // EXIF 6 rotates the horizontal red/blue bands into vertical bands before cropping.
  const input = await sharp({ create: { width: 120, height: 80, channels: 3, background: '#ff0000' } })
    .composite([{ input: await sharp({ create: { width: 120, height: 40, channels: 3, background: '#0000ff' } }).png().toBuffer(), top: 40, left: 0 }])
    .withMetadata({ orientation: 6 }).jpeg().toBuffer();
  const output = await prepareUserPicture(input); const metadata = await sharp(output).metadata();
  assert.equal(metadata.format, 'webp'); assert.equal(metadata.width, 512); assert.equal(metadata.height, 512);
  assert.equal(metadata.exif, undefined); assert.equal(metadata.orientation, undefined); assert.equal(metadata.icc, undefined);
  const { data, info } = await sharp(output).raw().toBuffer({ resolveWithObject: true });
  const at = (x: number, y: number) => [...data.subarray((y * info.width + x) * info.channels, (y * info.width + x) * info.channels + 3)];
  assert.ok(at(80, 256)[2]! > 200); assert.ok(at(430, 256)[0]! > 200);
  assert.ok(output.length < 1024 * 1024);
});

test('image validation rejects fake, vector, empty and oversized uploads', async () => {
  for (const input of [Buffer.from('not a photo'), Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>')]) {
    await assert.rejects(prepareUserPicture(input), rejects(415));
  }
  await assert.rejects(prepareUserPicture(Buffer.alloc(0)), rejects(400));
  await assert.rejects(prepareUserPicture(Buffer.alloc(10 * 1024 * 1024 + 1)), rejects(413));
});

test('photo versions prevent stale replacements, survive reload, and invalidate removed image URLs', async () => {
  const files = new MemoryPictures(); const pictures = new UserPictures(files); const id = randomUUID();
  let changes = 0; pictures.onChange = () => changes++;
  const first = await prepareUserPicture(await raster());
  const url = await pictures.set(id, first, 'none'); const version = pictureVersion(url);
  assert.deepEqual(await pictures.image(id, version), first);
  await assert.rejects(pictures.set(id, first, 'none'), rejects(409));
  const fresh = new UserPictures(files); await fresh.ready; assert.equal(fresh.url(id), url);
  const next = await pictures.set(id, await prepareUserPicture(await raster('#2233ee')), version);
  assert.notEqual(next, url); await assert.rejects(pictures.image(id, version), rejects(404));
  await assert.rejects(pictures.remove(id, version), rejects(409));
  await pictures.remove(id, pictureVersion(next));
  assert.equal(pictures.url(id), undefined); assert.equal(files.data.size, 0); assert.equal(changes, 3);
  await pictures.remove(id); // Account deletion is retryable after cleanup already succeeded.
});

test('unconfirmed writes are not published or retried blindly; existing stored bytes survive a failed replacement', async () => {
  const files = new MemoryPictures(); const pictures = new UserPictures(files); const id = randomUUID();
  const first = await prepareUserPicture(await raster()); const url = await pictures.set(id, first, 'none');
  files.failWrite = true;
  await assert.rejects(pictures.set(id, await prepareUserPicture(await raster('#2255aa')), pictureVersion(url)), rejects(503));
  assert.deepEqual(files.data.get(id), first); assert.equal(pictures.url(id), undefined);
  await assert.rejects(pictures.set(id, first, pictureVersion(url)), rejects(503));
  const fresh = new UserPictures(files); await fresh.ready; assert.equal(fresh.url(id), url);
});

test('atomic picture files survive restart and account cleanup removes them', { skip: process.platform === 'win32' ? 'Requires Linux directory fsync.' : false }, async t => {
  const path = await directory(t); const files = new UserPictureFiles(path); const pictures = new UserPictures(files); const id = randomUUID();
  const output = await prepareUserPicture(await raster()); const url = await pictures.set(id, output, 'none');
  assert.deepEqual(await readFile(join(path, 'user-pictures', `${id}.webp`)), output);
  const fresh = new UserPictures(new UserPictureFiles(path)); await fresh.ready; assert.equal(fresh.url(id), url);
  await fresh.remove(id); assert.deepEqual(await files.ids(), []);
});

async function appFixture(t: TestContext) {
  const dataDir = await directory(t);
  const people = ['First', 'Second'].map(nickname => ({ id: randomUUID(), nickname, token: randomBytes(32).toString('base64url') }));
  await writeFile(join(dataDir, 'users.json'), JSON.stringify({ schema: 1, deleted: [], users: people.map(person => ({
    id: person.id, nickname: person.nickname, pin: null, version: 1, legacyListHashes: [], failures: 0, blockedUntil: 0,
    sessions: [{ hash: createHash('sha256').update(person.token).digest('hex'), expires: Date.now() + 60_000 }],
  })) }));
  let state: State = { schema: 3, room: { id: randomUUID(), revision: 0, turnId: randomUUID(),
    participants: people.map(({ id, nickname }) => ({ id, nickname, userId: id, credentialHash: '' })),
    active: people.map(person => person.id), currentId: people[0]!.id, playback: null } };
  const server = createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const port = (server.address() as AddressInfo).port; const origin = `http://127.0.0.1:${port}`;
  const engine = new Engine({ async load() { return structuredClone(state); }, async save(next) { state = structuredClone(next); } }, new DemoAdapter(3600), origin); await engine.init();
  const files = new MemoryPictures(); const pictures = new UserPictures(files);
  const { app, close } = createApp(engine, { port, listenHost: '127.0.0.1', guestUrl: origin, dataDir, demoSeconds: 3600 }, 'web', undefined, undefined, undefined, undefined, undefined, undefined, pictures);
  server.on('request', app);
  t.after(() => { close(); engine.adapter.close(); server.closeAllConnections(); server.close(); });
  const post = (path: string, body: unknown, token = people[1]!.token) => fetch(origin + path, { method: 'POST', body: JSON.stringify(body), headers: {
    Origin: origin, 'Content-Type': 'application/json', Cookie: `doom_room_participant=${token}`,
  } });
  const upload = (body: Buffer, options: { path?: string; token?: string; version?: string; origin?: string } = {}) => fetch(origin + (options.path ?? '/api/participant/picture'), {
    method: 'POST', body: new Uint8Array(body), headers: { Origin: options.origin ?? origin, 'Content-Type': 'application/octet-stream',
      'X-Picture-Version': options.version ?? 'none', Cookie: `doom_room_participant=${options.token ?? people[1]!.token}` },
  });
  return { origin, engine, app, people, pictures, files, post, upload };
}

test('an authenticated listener uploads outside their turn, with photo projections and cache-safe removal', async t => {
  const f = await appFixture(t); const before = f.engine.view({ kind: 'host' }); const image = await raster();
  assert.equal((await f.upload(image, { token: '' })).status, 401);
  assert.equal((await f.upload(image, { origin: 'https://other.example' })).status, 403);
  assert.equal((await f.upload(Buffer.from('bad'))).status, 415);
  const response = await f.upload(image); assert.equal(response.status, 200);
  const { avatarUrl } = await response.json() as { avatarUrl: string };
  assert.match(avatarUrl, /\/api\/user-pictures\//);
  assert.equal(f.engine.view({ kind: 'display' }).rotation![1]!.avatarUrl, avatarUrl);
  assert.equal(f.engine.view({ kind: 'participant', credential: f.people[1]!.token }).me!.avatarUrl, avatarUrl);
  assert.equal(f.engine.listeningOrder().next!.avatarUrl, avatarUrl);
  assert.equal(f.engine.view({ kind: 'host' }).turnId, before.turnId);
  assert.equal(f.engine.view({ kind: 'host' }).revision, before.revision);
  const users = await (await fetch(f.origin + '/api/participant/identity')).json() as UserDirectory;
  assert.equal(users.users[1]!.avatarUrl, avatarUrl);
  const served = await fetch(f.origin + avatarUrl); assert.equal(served.status, 200); assert.match(served.headers.get('content-type')!, /image\/webp/);
  assert.equal(served.headers.get('cache-control'), 'private, no-cache');
  const etag = served.headers.get('etag')!;
  assert.equal((await fetch(f.origin + avatarUrl, { headers: { 'If-None-Match': etag } })).status, 304);
  assert.equal((await f.upload(image)).status, 409);
  assert.equal((await f.post('/api/participant/picture/remove', { version: pictureVersion(avatarUrl) }, f.people[0]!.token)).status, 409);
  assert.equal((await f.post('/api/participant/picture/remove', { version: pictureVersion(avatarUrl) })).status, 200);
  assert.equal((await fetch(f.origin + avatarUrl, { headers: { 'If-None-Match': etag } })).status, 404);
  assert.equal(f.engine.listeningOrder().next!.avatarUrl, undefined);
});

test('host picture management and trusted Ingress reads use the same stored picture', async t => {
  const f = await appFixture(t); const id = f.people[0]!.id;
  const result = await f.upload(await raster(), { path: `/api/host/users/${id}/picture`, token: '' }); assert.equal(result.status, 200);
  const { avatarUrl } = await result.json() as { avatarUrl: string };
  const ingress = createServer(ingressListener(f.app, '127.0.0.1')); ingress.listen(0, '127.0.0.1'); await once(ingress, 'listening');
  t.after(() => { ingress.closeAllConnections(); ingress.close(); });
  const response = await fetch(`http://127.0.0.1:${(ingress.address() as AddressInfo).port}${avatarUrl}`, { headers: {
    'X-Ingress-Path': '/api/hassio_ingress/test', 'X-Forwarded-Proto': 'https', 'X-Forwarded-Host': 'ha.example', 'X-Remote-User-Id': 'admin',
  } });
  assert.equal(response.status, 200);
  assert.equal((await f.post(`/api/host/users/${id}/picture/remove`, { version: pictureVersion(avatarUrl) })).status, 200);
});

test('directory and room event streams publish picture replacements without a turn change', { timeout: 10_000 }, async t => {
  const f = await appFixture(t);
  const controllers = [new AbortController(), new AbortController()]; t.after(() => controllers.forEach(controller => controller.abort()));
  const streams = await Promise.all(['/api/participant/identity/events', '/api/display/events'].map((path, i) => fetch(f.origin + path, { signal: controllers[i]!.signal })));
  const readers = streams.map(stream => stream.body!.getReader());
  await Promise.all(readers.map(reader => reader.read())); // Initial snapshots.
  const response = await f.upload(await raster()); const { avatarUrl } = await response.json() as { avatarUrl: string };
  for (const reader of readers) {
    let received = '';
    while (!received.includes(avatarUrl)) {
      const next = await reader.read(); assert.equal(next.done, false); received += new TextDecoder().decode(next.value);
    }
    assert.ok(received.includes(avatarUrl));
  }
});

test('account deletion waits for an in-flight photo commit and removes the photo before completing', { skip: process.platform === 'win32' ? 'User-account persistence requires Linux directory fsync.' : false, timeout: 10_000 }, async t => {
  const f = await appFixture(t); const id = f.people[1]!.id;
  let startedResolve!: () => void; let finishResolve!: () => void;
  const started = new Promise<void>(resolve => { startedResolve = resolve; });
  const finish = new Promise<void>(resolve => { finishResolve = resolve; });
  const write = f.files.write.bind(f.files);
  f.files.write = async (userId, bytes) => { startedResolve(); await finish; await write(userId, bytes); };
  const upload = f.upload(await raster()); await started;
  const deletion = f.post('/api/host/users/delete', { userId: id, confirm: true }); finishResolve();
  assert.equal((await upload).status, 200); assert.equal((await deletion).status, 200);
  assert.equal(f.files.data.has(id), false); assert.equal(f.pictures.url(id), undefined);
  assert.equal((await f.upload(await raster())).status, 401);
});

test('the invitation gateway exposes photo reads and own-picture changes, never host management', () => {
  const id = randomUUID(); const image = `/api/user-pictures/${id}/${'a'.repeat(32)}.webp`;
  for (const method of ['GET', 'HEAD']) assert.equal(publicRoute(method, image), true);
  assert.equal(publicRoute('GET', '/api/participant/identity/events'), true);
  for (const path of ['/api/participant/picture', '/api/participant/picture/remove']) assert.equal(publicRoute('POST', path), true);
  assert.equal(publicRoute('POST', image), false);
  assert.equal(publicRoute('POST', `/api/host/users/${id}/picture`), false);
  assert.equal(publicRoute('GET', image.replace(id, '%2e%2e')), false);
});
