import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Agent, createServer, request as httpRequest, type RequestListener } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { Readable } from 'node:stream';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { OnlineAccess, firstReachMs, grantLifetime, invitationGraceMs } from '../src/online-access.js';
import { exactFunnel, funnelTarget, socketReady, tailscaleApproval, tailscaleHost, type TailStatus, type TunnelConnector } from '../src/tailscale.js';
import { refuseLoopbackPeers } from '../src/http-guards.js';
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
import type { State } from '../src/model.js';

const host = 'doom-room.tail123.ts.net';
class Connector implements TunnelConnector {
  busy = false; starts = 0; stops = 0; connects = 0; publishes = 0; valid = true;
  state: TailStatus = { BackendState: 'Running', Self: { DNSName: host + '.', Online: true } };
  async start() { this.starts++; }
  async stop() { this.stops++; }
  async status() { return this.state; }
  async configured() { return this.valid; }
  /** Ends the last sign-in or tunnel command, as the real one does when its step is complete. */
  settled?: () => void;
  connect(url: (value: string) => void, settled?: () => void) { this.connects++; this.settled = settled; url('https://login.tailscale.com/a/test'); }
  publish(url: (value: string) => void, settled?: () => void) { this.publishes++; this.settled = settled; url('https://login.tailscale.com/f/funnel?node=test'); }
}
async function directory(t: TestContext) {
  const dir = await mkdtemp(join(tmpdir(), 'doom-room-online-')); t.after(() => rm(dir, { recursive: true, force: true })); return dir;
}
async function fixture(t: TestContext, previouslyEnabled = false) {
  const dir = await directory(t); const connector = new Connector();
  // A pre-existing record lets read-only health tests run on platforms without directory fsync.
  if (previouslyEnabled) await writeFile(join(dir, 'online-access.json'), JSON.stringify({ schema: 1, enabled: true, key: 'f'.repeat(43), revision: 1 }));
  let now = Date.now(); let reachable = true; let probes = 0;
  const online: OnlineAccess = new OnlineAccess(dir, connector, async (_origin, probe, expected): Promise<boolean> => {
    probes++; return reachable && online.probeResponse(probe) === expected;
  }, () => now);
  await online.init(); t.after(() => online.close());
  return { dir, online, connector, clock: (value: number) => { now += value; }, reachable: (value: boolean) => { reachable = value; }, probes: () => probes };
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
  // A new address is still being set up until it first answers; only later is it reported as unreachable.
  f.connector.valid = true; f.reachable(false); await f.online.refresh(); assert.equal(f.online.view().status, 'checking'); assert.equal(f.online.view().joinUrl, undefined);
  assert.match(f.online.view().message, /HTTPS certificate/); assert.equal(f.online.view().approvalUrl, undefined);
  f.clock(firstReachMs); await f.online.refresh(); assert.equal(f.online.view().status, 'offline'); assert.equal(f.online.view().joinUrl, undefined);
  f.reachable(true); await f.online.refresh(); const url = f.online.view().joinUrl;
  assert.equal(f.online.view().status, 'ready'); assert.ok(url?.startsWith(`https://${host}/join#online=`));
  f.connector.state.Self!.Online = false; await f.online.refresh(); assert.equal(f.online.view().joinUrl, url); assert.equal(f.online.origin, undefined);
  f.clock(invitationGraceMs); await f.online.refresh(); assert.equal(f.online.view().joinUrl, undefined);
  f.connector.state.Self!.Online = true; await f.online.refresh(); assert.equal(f.online.view().joinUrl, url);
  await durability.freeze();
  try { await f.online.pause(); const starts = f.connector.starts; await f.online.refresh(); assert.equal(f.connector.starts, starts); assert.equal(f.online.origin, undefined); }
  finally { durability.thaw(); }
  await f.online.refresh(); assert.equal(f.online.view().joinUrl, url);
});

test('online health uses one verified request for both reachability and round-trip measurement', async t => {
  const f = await fixture(t, true); await f.online.refresh();
  assert.equal(f.online.view().status, 'ready'); assert.equal(f.probes(), 1);
  assert.ok(Number.isInteger(f.online.view().network?.roundTripMs));
  await f.online.refresh(); assert.equal(f.probes(), 2);
});

test('online invitation grace retains the same QR for 30 seconds without hiding the outage status or extending on repeated failures', async t => {
  const f = await fixture(t, true); await f.online.refresh();
  const url = f.online.view().joinUrl; const displayUrl = f.online.sharing()?.displayUrl;
  assert.ok(url); assert.ok(displayUrl);
  f.clock(60_000); f.reachable(false); await f.online.refresh();
  assert.equal(f.online.view().status, 'offline');
  assert.equal(f.online.sharing()?.guestAccess.status, 'unavailable');
  assert.equal(f.online.sharing()?.joinUrl, url);
  f.clock(invitationGraceMs - 1); await f.online.refresh();
  assert.equal(f.online.view().joinUrl, url); assert.equal(f.online.sharing()?.displayUrl, displayUrl);
  f.clock(1); await f.online.refresh();
  assert.equal(f.online.view().joinUrl, undefined); assert.equal(f.online.sharing()?.joinUrl, undefined);
  f.reachable(true); await f.online.refresh(); assert.equal(f.online.view().joinUrl, url);
  f.reachable(false); await f.online.refresh(); f.clock(invitationGraceMs - 1);
  assert.equal(f.online.sharing()?.joinUrl, url, 'Recovery grants a fresh grace period for a later outage.');
});

test('online invitation grace never advertises an unverified or changed public origin', async t => {
  const f = await fixture(t, true); f.reachable(false); await f.online.refresh();
  assert.equal(f.online.view().joinUrl, undefined);
  f.reachable(true); await f.online.refresh(); assert.ok(f.online.view().joinUrl);
  f.connector.state.Self!.DNSName = 'different.tail123.ts.net'; f.reachable(false); await f.online.refresh();
  assert.equal(f.online.view().joinUrl, undefined); assert.equal(f.online.sharing()?.joinUrl, undefined);
});

test('online invitation grace tolerates a temporary connector outage but ends for approval, unsafe configuration and maintenance', async t => {
  const f = await fixture(t, true); await f.online.refresh(); const url = f.online.view().joinUrl;
  f.connector.state.Self!.Online = false; await f.online.refresh();
  assert.equal(f.online.origin, undefined, 'Retaining the QR never restores listener authorization.');
  assert.equal(f.online.view().joinUrl, url);
  f.connector.state.Self!.Online = true; await f.online.refresh();
  f.connector.valid = false; await f.online.refresh(); assert.equal(f.online.view().joinUrl, undefined);
  f.connector.valid = true; await f.online.refresh();
  f.connector.state.BackendState = 'NeedsMachineAuth'; await f.online.refresh(); assert.equal(f.online.view().joinUrl, undefined);
  f.connector.state.BackendState = 'Running'; await f.online.refresh(); assert.equal(f.online.view().joinUrl, url);
  await f.online.pause(); assert.equal(f.online.view().joinUrl, undefined);
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
  const stops = f.connector.stops;
  await f.online.change('rotate', f.online.view().revision);
  assert.equal(f.connector.stops, stops, 'Replacing the invitation keeps the tunnel running.');
  assert.equal(f.online.origin, undefined); assert.equal(f.online.authorized(grant), false);
  await f.online.refresh();
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

test('online guests may read the room logo, but never change it', () => {
  for (const path of ['/api/logo', '/api/logo/0123456789abcdef']) assert.equal(publicRoute('GET', path), true, path);
  for (const path of ['/api/logo/../host/state', '/api/logo/0123456789ABCDEF', '/api/logo/0123', '/api/logo/0123456789abcdef/extra']) assert.equal(publicRoute('GET', path), false, path);
  for (const path of ['/api/host/logo', '/api/host/logo/remove', '/api/logo']) assert.equal(publicRoute('POST', path), false, path);
});

test('user settings opens through Tailscale while identity and host controls keep their access gates', async t => {
  const f = await fixture(t, true); await f.online.refresh();
  const local = await listen(t); const adapter = new DemoAdapter();
  let state: State = { schema: 3, room: null };
  const engine = new Engine({ async load() { return structuredClone(state); }, async save(next) { state = structuredClone(next); } }, adapter, local.url);
  await engine.init();
  const http = createApp(engine, { port: local.port, listenHost: '127.0.0.1', guestUrl: local.url, dataDir: f.dir, demoSeconds: 30 }, 'web');
  const gateway = publicListener(http.app, f.online); const remote = await listen(t, gateway.listener);
  t.after(() => { gateway.close(); http.close(); adapter.close(); });
  const request = (path: string, cookie = '', method = 'GET') => new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = httpRequest(remote.url + path, { method, headers: { Host: host, Cookie: cookie } }, res => {
      let body = ''; res.setEncoding('utf8'); res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode!, body })); res.on('error', reject);
    });
    req.on('error', reject); req.end();
  });
  const shell = await request('/user/settings'); assert.equal(shell.status, 200);
  assert.match(shell.body, /name="doom-room-public" content="1"/); assert.doesNotMatch(shell.body, /doom-room-online-session/);
  assert.equal((await request('/api/participant/identity')).status, 401);
  const access = `__Host-doom_room_online=${f.online.redeem(invitation(f.online))!}`;
  const invited = await request('/user/settings', access); assert.equal(invited.status, 200);
  assert.match(invited.body, /name="doom-room-online-session" content="1"/);
  assert.equal((await request('/user/settings', access, 'HEAD')).status, 200);
  const identity = await request('/api/participant/identity', access); assert.equal(identity.status, 200);
  assert.equal(JSON.parse(identity.body).current, null, 'An invitation does not sign in as a user.');
  for (const path of ['/host/settings', '/api/host/users', '/user/settings/extra', '/user/settings%2fextra']) assert.equal((await request(path, access)).status, 404);
  assert.equal(publicRoute('POST', '/user/settings'), false);
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

test('checks begin at once, and a finished sign-in is noticed without waiting for the next poll', { timeout: 15_000 }, async t => {
  const f = await fixture(t, true); f.connector.state = { BackendState: 'NeedsLogin' };
  const reached = (status: string) => new Promise<void>(resolve => {
    const check = () => { if (f.online.view().status !== status) return; f.online.off('change', check); resolve(); };
    f.online.on('change', check); check();
  });
  let began = performance.now(); f.online.start(); await reached('login');
  assert.ok(performance.now() - began < 1000, 'The first check does not wait for a poll interval.');
  // Long after setup began, polls are five seconds apart. Let the last one-second poll pass.
  f.clock(10 * 60_000); await delay(1300);
  const polled = f.connector.connects;
  f.connector.state = { BackendState: 'Running', Self: { DNSName: host + '.', Online: true } };
  began = performance.now(); f.connector.settled!(); await reached('ready');
  assert.ok(performance.now() - began < 2500, 'The result of a finished step is read at once.');
  assert.equal(f.connector.connects, polled, 'No further sign-in was started.');
});

test('tunnel attempts that keep failing are spaced out, and an approval wait is not counted as a failure', async t => {
  const f = await fixture(t, true); f.connector.valid = false;
  for (let attempt = 1; attempt <= 3; attempt++) { await f.online.refresh(); assert.equal(f.connector.publishes, attempt); f.connector.settled!(); }
  await f.online.refresh(); assert.equal(f.connector.publishes, 3, 'The tunnel is not reset on every check.');
  for (const [wait, attempt] of [[5000, 4], [10_000, 5], [20_000, 6]] as const) {
    f.clock(wait - 1); await f.online.refresh(); assert.equal(f.connector.publishes, attempt - 1);
    f.clock(1); await f.online.refresh(); assert.equal(f.connector.publishes, attempt); f.connector.settled!();
  }
  await f.online.refresh();
  assert.equal(f.online.view().status, 'error'); assert.match(f.online.view().message, /could not be set up/);
  assert.equal(f.online.view().joinUrl, undefined); assert.equal(f.online.origin, undefined);
  f.connector.valid = true; await f.online.refresh(); assert.equal(f.online.view().status, 'ready');
  // The host takes several minutes to approve Funnel: the command ends late, and the next attempt follows at once.
  f.connector.valid = false;
  for (let attempt = 7; attempt <= 11; attempt++) { await f.online.refresh(); assert.equal(f.connector.publishes, attempt); f.clock(5 * 60_000); f.connector.settled!(); }
  assert.equal(f.online.view().status, 'approval');
});

test('the tunnel contract accepts the pinned release’s own output and nothing wider', () => {
  // `tailscale funnel status --json` prints its ServeConfig. This is that structure for our one
  // mapping, written out from the definition in the pinned release (ipn/serve.go); empty fields are omitted.
  const printed = `{
  "TCP": {
    "443": {
      "HTTPS": true
    }
  },
  "Web": {
    "${host}:443": {
      "Handlers": {
        "/": {
          "Proxy": "${funnelTarget}"
        }
      }
    }
  },
  "AllowFunnel": {
    "${host}:443": true
  }
}`;
  assert.ok(exactFunnel(JSON.parse(printed), host));
  assert.equal(exactFunnel(JSON.parse(printed), 'other.tail123.ts.net'), false);
  assert.equal(exactFunnel({}, host), false, 'Nothing published yet.');
  const widened = (change: (config: any) => void) => { const config = JSON.parse(printed); change(config); return exactFunnel(config, host); };
  assert.equal(widened(config => { config.TCP['443'].TCPForward = '127.0.0.1:3000'; }), false);
  assert.equal(widened(config => { config.Web[`${host}:443`].Handlers['/host'] = { Proxy: 'http://127.0.0.1:3000' }; }), false);
  assert.equal(widened(config => { config.Web[`${host}:443`].Handlers['/'].Path = '/data'; }), false);
  assert.equal(widened(config => { config.Web[`${host}:8443`] = config.Web[`${host}:443`]; }), false);
  assert.equal(widened(config => { config.AllowFunnel[`${host}:8443`] = true; }), false);
  assert.equal(widened(config => { config.Services = { 'svc:other': {} }; }), false);
  assert.equal(widened(config => { config.Unrecognised = {}; }), false, 'A field this app does not know may expose something.');
});

test('the wait for the bundled daemon ends when its socket accepts connections', { timeout: 15_000 }, async t => {
  const dir = await directory(t);
  const path = process.platform === 'win32' ? `\\\\.\\pipe\\doom-room-${randomUUID()}` : join(dir, 'daemon.sock');
  assert.equal(await socketReady(path, 150), false, 'Nothing is listening yet.');
  assert.equal(await socketReady(path, 10_000, () => false), false, 'A daemon that has exited is not waited for.');
  const waiting = socketReady(path, 10_000);
  await delay(120);
  const daemon = createNetServer(socket => socket.destroy()); t.after(() => daemon.close());
  daemon.listen(path); await once(daemon, 'listening');
  assert.equal(await waiting, true);
});

test('a listener that refuses this machine’s own connections cannot be reached through the tailnet', async t => {
  // The bundled daemon passes a tailnet device's connection on from loopback, on the same port.
  const answer: RequestListener = (_req, res) => { res.end('host controls'); };
  const open = await listen(t, answer); const closed = await listen(t, answer); refuseLoopbackPeers(closed.server);
  assert.equal(await (await fetch(open.url)).text(), 'host controls');
  await assert.rejects(fetch(closed.url));
  await assert.rejects(fetch(closed.url.replace('127.0.0.1', 'localhost')));
});

test('people without an invitation cannot use up the limits that invited guests depend on', { timeout: 30_000 }, async t => {
  const f = await fixture(t, true); await f.online.refresh(); assert.equal(f.online.view().status, 'ready');
  let handled = 0;
  const gateway = publicListener((_req, res) => { handled++; res.end('{}'); }, f.online); const remote = await listen(t, gateway.listener);
  const agent = new Agent({ keepAlive: true, maxSockets: 16 }); t.after(() => { agent.destroy(); gateway.close(); });
  const send = (path: string, body: unknown, cookie = '') => new Promise<{ status: number; cookie: string }>((resolve, reject) => {
    const req = httpRequest(remote.url + path, { method: 'POST', agent, headers: { Host: host, Origin: `https://${host}`, 'Content-Type': 'application/json', Cookie: cookie } },
      res => { res.resume(); res.once('end', () => resolve({ status: res.statusCode!, cookie: String(res.headers['set-cookie']?.[0]).split(';')[0]! })); });
    req.on('error', reject); req.end(JSON.stringify(body));
  });
  const flood = async (count: number, path: string, body: unknown, cookie = '') => {
    const seen: Record<number, number> = {};
    for (let sent = 0; sent < count; sent += 16) {
      for (const { status } of await Promise.all(Array.from({ length: Math.min(16, count - sent) }, () => send(path, body, cookie)))) seen[status] = (seen[status] ?? 0) + 1;
    }
    return seen;
  };
  // More than a minute's whole budget of actions and of invitation attempts, from someone who only knows the address.
  assert.deepEqual(await flood(700, '/api/participant/control', { action: 'pause' }), { 401: 700 });
  assert.deepEqual(await flood(100, '/api/online/redeem', { invitation: 'x'.repeat(43) }), { 403: 60, 429: 40 });
  assert.equal(handled, 0);
  const redeemed = await send('/api/online/redeem', { invitation: invitation(f.online) });
  assert.equal(redeemed.status, 200, 'A real invitation is still accepted.');
  assert.equal((await send('/api/participant/control', { action: 'pause' }, redeemed.cookie)).status, 200, 'An invited guest can still act.');
  assert.equal(handled, 1);
  // Invited guests stay limited, each within their own allowance.
  assert.deepEqual(await flood(260, '/api/participant/control', { action: 'pause' }, redeemed.cookie), { 200: 239, 429: 21 });
});
