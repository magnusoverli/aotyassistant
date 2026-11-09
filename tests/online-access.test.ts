import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, request as httpRequest, type RequestListener } from 'node:http';
import { Readable } from 'node:stream';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { OnlineAccess, grantLifetime } from '../src/online-access.js';
import { exactFunnel, funnelTarget, tailscaleApproval, tailscaleHost, type TailStatus, type TunnelConnector } from '../src/tailscale.js';
import { publicListener, publicRoute } from '../src/public-listener.js';
import { createApp } from '../src/http.js';
import { ingressListener } from '../src/ingress.js';
import { Engine } from '../src/engine.js';
import { FileStore } from '../src/store.js';
import { DemoAdapter } from '../src/playback.js';
import { durability } from '../src/backup.js';
import { UploadAssets } from '../src/uploads.js';
import { fixtureUploadAnalysis, uploadBytes } from './fixtures/uploads.js';
import { randomUUID } from 'node:crypto';
import { IntegrationManager, IntegrationFileStore } from '../src/integrations.js';
import { startMusicAssistantFixture } from './fixtures/music-assistant.js';
import { onlineConnection } from '../web/online-panel.js';

const host = 'doom-room.tail123.ts.net';
class Connector implements TunnelConnector {
  busy = false; starts = 0; stops = 0; connects = 0; publishes = 0; valid = true;
  state: TailStatus = { BackendState: 'Running', Self: { DNSName: host + '.', Online: true } };
  async start() { this.starts++; }
  async stop() { this.stops++; }
  async status() { return this.state; }
  async configured() { return this.valid; }
  connect(url: (value: string) => void) { this.connects++; url('https://login.tailscale.com/a/test'); }
  publish(url: (value: string) => void) { this.publishes++; url('https://login.tailscale.com/f/funnel?node=test'); }
}
async function directory(t: TestContext) {
  const dir = await mkdtemp(join(tmpdir(), 'doom-room-online-')); t.after(() => rm(dir, { recursive: true, force: true })); return dir;
}
async function fixture(t: TestContext) {
  const dir = await directory(t); const connector = new Connector();
  let now = Date.now(); let reachable = true;
  const online: OnlineAccess = new OnlineAccess(dir, connector, async (_origin, probe, expected): Promise<boolean> => reachable && online.probeResponse(probe) === expected, () => now);
  await online.init(); t.after(() => online.close());
  return { dir, online, connector, clock: (value: number) => { now += value; }, reachable: (value: boolean) => { reachable = value; } };
}
async function enable(online: OnlineAccess) { await online.change('enable', online.view().revision); await online.refresh(); assert.equal(online.view().status, 'ready'); }
const invitation = (online: OnlineAccess) => new URLSearchParams(new URL(online.view().joinUrl!).hash.slice(1)).get('online')!;

test('online setup requires account and Funnel approval, verified reachability, and reconnects without changing invitations', async t => {
  const f = await fixture(t);
  assert.equal(f.online.sharing(), undefined);
  f.connector.state = { BackendState: 'NeedsLogin' };
  await f.online.change('enable', 0); await f.online.refresh();
  assert.equal(f.online.view().status, 'login'); assert.equal(f.connector.connects, 1); assert.equal(f.online.view().joinUrl, undefined);
  f.connector.state = { BackendState: 'NeedsMachineAuth' }; await f.online.refresh(); assert.equal(f.online.view().status, 'approval');
  f.connector.state = { BackendState: 'Running', Self: { DNSName: host + '.', Online: true } }; f.connector.valid = false;
  await f.online.refresh(); assert.equal(f.connector.publishes, 1); assert.match(f.online.view().approvalUrl!, /\/f\/funnel/); assert.equal(f.online.origin, undefined);
  f.connector.valid = true; f.reachable(false); await f.online.refresh(); assert.equal(f.online.view().status, 'offline'); assert.equal(f.online.view().joinUrl, undefined);
  f.reachable(true); await f.online.refresh(); const url = f.online.view().joinUrl;
  assert.equal(f.online.view().status, 'ready'); assert.ok(url?.startsWith(`https://${host}/join#online=`));
  f.connector.state.Self!.Online = false; await f.online.refresh(); assert.equal(f.online.view().joinUrl, undefined); assert.equal(f.online.origin, undefined);
  f.connector.state.Self!.Online = true; await f.online.refresh(); assert.equal(f.online.view().joinUrl, url);
  await durability.freeze();
  try { await f.online.pause(); const starts = f.connector.starts; await f.online.refresh(); assert.equal(f.connector.starts, starts); assert.equal(f.online.origin, undefined); }
  finally { durability.thaw(); }
  await f.online.refresh(); assert.equal(f.online.view().joinUrl, url);
});

test('ready online access reports its Funnel round trip and rechecks UDP on a new connection', async t => {
  const f = await fixture(t); let netchecks = 0; let udp = true;
  (f.connector as TunnelConnector).netcheck = async () => { netchecks++; return { udp }; };
  const changes: unknown[] = []; f.online.on('change', () => changes.push(f.online.view()));
  await enable(f.online);
  const network = f.online.view().network!;
  assert.ok(Number.isInteger(network.roundTripMs) && network.roundTripMs >= 0); assert.equal(network.udp, true); assert.equal(netchecks, 1);
  const before = changes.length; await f.online.refresh(); f.clock(60_000); await f.online.refresh();
  assert.equal(netchecks, 1, 'UDP is checked at most every 30 minutes on one connection.');
  assert.ok(changes.length - before <= 2, 'Measurements do not add room change events.');
  udp = false; f.reachable(false); await f.online.refresh(); assert.equal(f.online.view().network, undefined);
  f.reachable(true); await f.online.refresh(); assert.equal(netchecks, 2); assert.equal(f.online.view().network?.udp, false);
  assert.match(onlineConnection(f.online.view().network!), /Relayed by Tailscale/);
  assert.match(onlineConnection({ roundTripMs: 140, udp: true }), /^Online round trip from this server: 140 ms\. Direct connections are available\.$/);
});

test('invitations survive restart; signed grants expire and rotate/disable revokes all previous online access', async t => {
  const f = await fixture(t); await enable(f.online);
  const code = invitation(f.online); const grant = f.online.redeem(code)!;
  assert.ok(f.online.authorized(grant)); assert.equal(f.online.authorized(grant + 'x'), false); assert.equal(f.online.redeem('x'.repeat(43)), undefined);
  const restored = new OnlineAccess(f.dir, new Connector(), async () => true); await restored.init(); t.after(() => restored.close());
  assert.equal(restored.origin, undefined); await restored.refresh(); assert.equal(invitation(restored), code); assert.ok(restored.authorized(grant));
  f.clock(grantLifetime + 1); assert.equal(f.online.authorized(grant), false);
  await assert.rejects(f.online.change('rotate', 0), /changed/);
  await f.online.change('rotate', f.online.view().revision); await f.online.refresh();
  assert.equal(f.online.redeem(code), undefined); assert.notEqual(invitation(f.online), code);
  const next = f.online.redeem(invitation(f.online))!; assert.ok(f.online.authorized(next));
  await f.online.change('disable', f.online.view().revision); assert.equal(f.online.origin, undefined); assert.equal(f.online.authorized(next), false); assert.equal(f.online.sharing(), undefined);
});

test('corrupt settings fail closed and a late reachability result cannot re-enable disabled access', async t => {
  const dir = await directory(t); await writeFile(join(dir, 'online-access.json'), '{bad');
  const corrupt = new OnlineAccess(dir, new Connector()); await corrupt.init(); t.after(() => corrupt.close());
  assert.equal(corrupt.view().status, 'error'); await assert.rejects(corrupt.change('enable', 0), /unavailable/);
  const nextDir = await directory(t); let resolve!: (value: boolean) => void; let entered!: () => void;
  const started = new Promise<void>(r => { entered = r; });
  const online = new OnlineAccess(nextDir, new Connector(), () => { entered(); return new Promise<boolean>(r => { resolve = r; }); });
  await online.init(); t.after(() => online.close()); await online.change('enable', 0);
  const checking = online.refresh(); await started; await online.change('disable', 1); resolve(true); await checking;
  assert.equal(online.view().status, 'disabled'); assert.equal(online.origin, undefined); assert.equal(online.view().joinUrl, undefined);
});

test('connector contracts reject unsafe proxy configurations, non-Tailscale hosts and untrusted approval links', () => {
  const config = { TCP: { '443': { HTTPS: true } }, Web: { [`${host}:443`]: { Handlers: { '/': { Proxy: funnelTarget } } } }, AllowFunnel: { [`${host}:443`]: true } };
  assert.ok(exactFunnel(config, host));
  assert.equal(exactFunnel({ ...config, TCP: { '443': { HTTPS: true }, '80': { HTTP: true } } }, host), false);
  config.Web[`${host}:443`]!.Handlers['/'].Proxy = 'http://127.0.0.1:3000'; assert.equal(exactFunnel(config, host), false);
  assert.equal(tailscaleHost(host + '.'), host); assert.equal(tailscaleHost('evil.ts.net.evil.test'), undefined); assert.equal(tailscaleHost('127.0.0.1'), undefined);
  assert.equal(tailscaleApproval('https://login.tailscale.com/f/funnel?node=123'), 'https://login.tailscale.com/f/funnel?node=123');
  assert.equal(tailscaleApproval('https://login.tailscale.com.evil.test/a/test'), undefined); assert.equal(tailscaleApproval('https://evil@login.tailscale.com/a/test'), undefined);
  for (const path of ['/host', '/api/host/state', '/api/media/uploads/id/key/track.mp3', '/api/participant/../host/state', '/api/participant/%2e%2e/host/state', '/API/host/state', '/assets/app.js.map', '/api/health']) assert.equal(publicRoute('GET', path), false, path);
});

test('every participant action is reachable through an online invitation', () => {
  // A new participant route that is missing here works at home but answers "Page not found" online.
  const source = (file: string) => readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8');
  const paths = [...source('http.ts').matchAll(/app\.post\('(\/api\/participant\/[^':]+)'/g)].map(match => match[1]!);
  // Playlist actions: `${prefix}/name` routes and the shared `for (const action of [...])` routes.
  const playlist = source('preparation-http.ts');
  const actions = [...playlist.matchAll(/app\.post\(`\$\{prefix\}\/([a-z/-]+)`/g)].map(match => match[1]!);
  for (const list of playlist.matchAll(/for \(const action of \[([^\]]+)\]/g)) actions.push(...[...list[1]!.matchAll(/'([a-z-]+)'/g)].map(match => match[1]!));
  paths.push(...actions.map(action => `/api/participant/preparations/${action}`));
  for (const expected of ['/api/participant/search', '/api/participant/preparations/import', '/api/participant/preparations/import/stop',
    '/api/participant/preparations/clear', '/api/participant/preparations/move', '/api/participant/preparations/replace-upload']) assert.ok(paths.includes(expected), expected);
  for (const path of paths) assert.equal(publicRoute('POST', path), true, path);
  // Reads too, such as following an import's progress.
  const reads = [...playlist.matchAll(/app\.get\(`\$\{prefix\}\/([a-z/-]+)`/g)].map(match => `/api/participant/preparations/${match[1]!}`);
  assert.ok(reads.includes('/api/participant/preparations/import'), 'read routes were found');
  for (const path of reads) assert.equal(publicRoute('GET', path), true, path);
});

async function listen(t: TestContext, handler?: RequestListener) {
  const server = createServer(handler); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const port = (server.address() as AddressInfo).port; return { server, port, url: `http://127.0.0.1:${port}` };
}

test('public artwork routes accept encoded reference separators but reject other path encodings', () => {
  for (const reference of ['ref%3Aabc_-123', 'ref%3aabc_-123', 'ref:abc_-123', 'upload:ref:abc_-123', 'upload%3Aref%3Aabc_-123']) {
    for (const method of ['GET', 'HEAD']) assert.equal(publicRoute(method, `/api/participant/artwork/${reference}`), true);
    assert.equal(publicRoute('POST', `/api/participant/artwork/${reference}`), false);
  }
  for (const reference of ['ref%253Aabc', 'ref%3Aabc%2fhost', 'ref%3Aabc%5chost', 'ref%3Aabc%00', 'ref%3Aabc%3f',
    'ref%3Aabc%23', 'ref%3A..', 'ref%3Aabc/extra', 'ref%3Aabc\\extra', 'ref%3A', `ref%3A${'x'.repeat(1001)}`]) {
    assert.equal(publicRoute('GET', `/api/participant/artwork/${reference}`), false);
  }
  for (const path of ['/api/%70articipant/artwork/ref%3Aabc', '/api/host%3Astate', '/api/participant/artwork%2fref%3Aabc']) {
    assert.equal(publicRoute('GET', path), false);
  }
});

test('online artist, album and track artwork reaches MA with participant and invitation checks intact', async t => {
  const f = await fixture(t); await enable(f.online);
  const ma = await startMusicAssistantFixture(); t.after(ma.close);
  const integrations = new IntegrationManager(new IntegrationFileStore(f.dir)); await integrations.init();
  await integrations.save(ma.origin, 'fixture-token', 0);
  const local = await listen(t); const adapter = new DemoAdapter();
  const engine = new Engine(new FileStore(f.dir), adapter, local.url, integrations); await engine.init();
  const http = createApp(engine, { port: local.port, listenHost: '127.0.0.1', guestUrl: local.url, dataDir: f.dir, demoSeconds: 30 }, 'web', integrations);
  local.server.on('request', http.app);
  const gateway = publicListener(http.app, f.online); const remote = await listen(t, gateway.listener);
  t.after(() => { gateway.close(); http.close(); adapter.close(); });
  const access = `__Host-doom_room_online=${f.online.redeem(invitation(f.online))!}`;
  const request = (path: string, cookies = access, data?: unknown, etag?: string) => new Promise<Response>((resolve, reject) => {
    const req = httpRequest(remote.url + path, { method: data === undefined ? 'GET' : 'POST',
      headers: { Host: host, Cookie: cookies, ...(etag ? { 'If-None-Match': etag } : {}), ...(data === undefined ? {} : { Origin: `https://${host}`, 'Content-Type': 'application/json' }) } }, res => {
      const headers = new Headers(); for (let i = 0; i < res.rawHeaders.length; i += 2) headers.append(res.rawHeaders[i]!, res.rawHeaders[i + 1]!);
      if (res.statusCode === 304) res.resume();
      resolve(new Response(res.statusCode === 304 ? null : Readable.toWeb(res) as ReadableStream<Uint8Array>, { status: res.statusCode!, headers }));
    });
    req.on('error', reject); req.end(data === undefined ? undefined : JSON.stringify(data));
  });
  const joined = await request('/api/participant/join', access, { nickname: 'Artwork listener', pin: '1234' });
  assert.equal(joined.status, 200);
  const participant = joined.headers.get('set-cookie')!.split(';')[0]!;
  const cookies = `${access}; ${participant}`;
  let value = 'Fixture'; let lastArtwork = ''; let etag = '';
  for (const kind of ['artists', 'albums', 'tracks']) {
    const response = await request('/api/participant/browse', cookies, { kind, value });
    assert.equal(response.status, 200);
    const item = (await response.json())[kind][0]; value = item.id;
    assert.match(item.artwork, /\/ref%3A/);
    lastArtwork = `${item.artwork}?size=160`;
    const image = await request(lastArtwork, cookies);
    assert.equal(image.status, 200, `${kind} artwork must pass the public gateway`);
    assert.equal(image.headers.get('content-type'), 'image/jpeg');
    etag = image.headers.get('etag')!;
    assert.ok((await image.arrayBuffer()).byteLength > 20);
  }
  const cached = await request(lastArtwork, cookies, undefined, etag);
  assert.equal(cached.status, 304); assert.equal((await cached.arrayBuffer()).byteLength, 0);
  assert.equal((await request(lastArtwork, participant, undefined, etag)).status, 401, 'An invitation is still required, even with a cached image.');
  assert.equal((await request(lastArtwork, access)).status, 401, 'A participant session is still required.');
  const other = await engine.join('Other listener');
  assert.equal((await request(lastArtwork, `${access}; doom_room_participant=${other}`)).status, 409);
  const prepared = '/api/display/prepared-artwork/11111111-1111-4111-8111-111111111111';
  assert.equal((await request(prepared)).status, 403, 'Invited displays reach the current-playback preparation guard.');
  assert.equal((await request(prepared, participant)).status, 401, 'Encrypted prefetch still requires an online invitation.');
  await f.online.change('rotate', f.online.view().revision); await f.online.refresh();
  assert.equal((await request(prepared)).status, 401);
  assert.equal((await request(lastArtwork, cookies, undefined, etag)).status, 401, 'Revoked invitations cannot revalidate artwork.');
});

test('public listener gates profiles, supports PIN join/private library, rejects host and media routes, and revokes live streams', async t => {
  const f = await fixture(t); await enable(f.online);
  const local = await listen(t); const adapter = new DemoAdapter(); const engine = new Engine(new FileStore(f.dir), adapter, local.url); await engine.init();
  engine.setOnlineSharing(() => f.online.sharing());
  const uploads = new UploadAssets(f.dir, fixtureUploadAnalysis);
  const http = createApp(engine, { port: local.port, listenHost: '127.0.0.1', guestUrl: local.url, dataDir: f.dir, demoSeconds: 30 }, 'web', undefined, undefined, uploads, undefined, f.online);
  local.server.on('request', http.app);
  const gateway = publicListener(http.app, f.online); const remote = await listen(t, gateway.listener);
  const ingress = await listen(t, ingressListener(http.app, '127.0.0.1'));
  t.after(() => { gateway.close(); http.close(); adapter.close(); });
  const request = (path: string, data?: unknown, cookies = '', extra: Record<string, string> = {}) => new Promise<Response>((resolve, reject) => {
    const req = httpRequest(remote.url + path, {
      method: data === undefined ? 'GET' : 'POST', headers: { Host: host, Cookie: cookies, ...(data === undefined ? {} : { Origin: `https://${host}`, 'Content-Type': 'application/json' }), ...extra },
    }, res => {
      const headers = new Headers(); for (let i = 0; i < res.rawHeaders.length; i += 2) headers.append(res.rawHeaders[i]!, res.rawHeaders[i + 1]!);
      resolve(new Response(Readable.toWeb(res) as ReadableStream<Uint8Array>, { status: res.statusCode!, headers }));
    });
    req.on('error', reject); req.end(data === undefined ? undefined : Buffer.isBuffer(data) ? data : JSON.stringify(data));
  });
  const shell = await request('/join'); assert.equal(shell.status, 200); assert.match(await shell.text(), /name="doom-room-public" content="1"/);
  assert.equal((await request('/api/participant/identity')).status, 401);
  assert.equal((await request('/api/display/state')).status, 401);
  assert.equal((await request('/api/online/redeem', { invitation: invitation(f.online) }, '', { Origin: 'https://evil.test' })).status, 403);
  const redeemed = await request('/api/online/redeem', { invitation: invitation(f.online) }); assert.equal(redeemed.status, 200);
  const set = redeemed.headers.get('set-cookie')!; assert.match(set, /^__Host-doom_room_online=/); assert.match(set, /Secure/); assert.match(set, /HttpOnly/); assert.match(set, /SameSite=Strict/);
  const access = set.split(';')[0]!;
  // The shell tells a returning guest their invitation cookie is valid: no session round trip.
  assert.doesNotMatch(await (await request('/join')).text(), /doom-room-online-session/);
  assert.match(await (await request('/participant', undefined, access)).text(), /<meta name="doom-room-online-session" content="1">/);
  assert.doesNotMatch(await (await request('/participant', undefined, '__Host-doom_room_online=1.forged.cookie')).text(), /doom-room-online-session/);
  for (const path of ['/host', '/host/settings', '/api/host/state', '/api/host/events', '/api/host/online', '/api/health', '/api/media/check/not-a-key/track.wav', '/api/host%2fstate']) {
    assert.equal((await request(path, undefined, access, { 'X-Ingress-Path': '/fake', 'X-Remote-User-Id': 'owner', 'X-Forwarded-Host': 'localhost', 'X-Forwarded-Proto': 'https' })).status, 404, path);
  }
  assert.equal((await request('/api/host/online', { action: 'disable', revision: 1 }, access)).status, 404);
  assert.equal((await fetch(local.url + '/api/host/online', { headers: { 'X-Ingress-Path': '/fake', 'X-Remote-User-Id': 'owner' } })).status, 403);
  const ingressHeaders = { 'X-Ingress-Path': '/api/hassio_ingress/test', 'X-Forwarded-Host': 'ha.test', 'X-Forwarded-Proto': 'https', 'X-Remote-User-Id': 'owner' };
  assert.equal((await fetch(ingress.url + '/api/host/online', { headers: ingressHeaders })).status, 200);
  const joined = await request('/api/participant/join', { nickname: 'Remote friend', pin: '1234' }, access); assert.equal(joined.status, 200);
  assert.match(joined.headers.get('set-cookie')!, /Secure/); const participant = joined.headers.get('set-cookie')!.split(';')[0]!;
  const cookies = `${access}; ${participant}`;
  const library = await request('/api/participant/preparations/init', {}, cookies); assert.equal(library.status, 200); assert.match(library.headers.get('set-cookie')!, /Secure/);
  const listCookie = library.headers.get('set-cookie')!.split(';')[0]!;
  assert.equal((await request('/api/participant/preparations/state', undefined, `${cookies}; ${listCookie}`)).status, 200);
  const uploadId = randomUUID(); const privateCookies = `${cookies}; ${listCookie}`;
  const uploaded = await request(`/api/participant/preparations/uploads/${uploadId}`, uploadBytes, privateCookies, {
    'Content-Type': 'application/octet-stream', 'X-Upload-Filename': 'remote-song.mp3', 'Content-Length': String(uploadBytes.length),
  });
  assert.equal(uploaded.status, 200); const preview = await uploaded.json();
  assert.equal((await request(preview.artwork, undefined, privateCookies)).status, 200);
  assert.equal((await request(preview.artwork, undefined, access)).status, 401);
  const list = await library.json();
  const added = await request('/api/participant/preparations/add-upload', { operation: { id: randomUUID(), revision: list.revision, issuedAt: Date.now() }, uploadId,
    text: { title: 'Private remote upload', artist: 'Friend', album: '' } }, privateCookies);
  assert.equal(added.status, 200);
  const saved = await added.json(); assert.equal(saved.view.upcoming[0].title, 'Private remote upload');
  assert.equal((await request(saved.view.upcoming[0].artwork, undefined, privateCookies)).status, 200);
  assert.equal((await request('/api/participant/state', undefined, participant)).status, 401);
  const stream = await request('/api/display/events', undefined, access); assert.equal(stream.status, 200); const reader = stream.body!.getReader(); await reader.read();
  await f.online.change('rotate', 1); await f.online.refresh();
  await assert.rejects(async () => { while (!(await reader.read()).done) {} });
  assert.equal((await request('/api/participant/state', undefined, cookies)).status, 401);
  const localView = await fetch(local.url + '/api/host/state').then(r => r.json()); assert.equal(localView.joinUrl, f.online.view().joinUrl);
  await f.online.change('disable', 2);
  assert.equal((await request('/join')).status, 503);
  assert.equal((await fetch(local.url + '/api/host/state')).status, 200);
});
