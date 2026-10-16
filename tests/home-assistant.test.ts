import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request, type RequestListener } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, cp } from 'node:fs/promises';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { supervisorHints, SupervisorClient } from '../src/supervisor.js';
import { discoverServers, type ServerInfo } from '../src/ma-discovery.js';
import { SetupManager } from '../src/setup.js';
import { IntegrationFileStore, IntegrationManager } from '../src/integrations.js';
import { FileStore, writePrivateJson } from '../src/store.js';
import { Engine } from '../src/engine.js';
import { DemoAdapter } from '../src/playback.js';
import { createApp } from '../src/http.js';
import { ingressListener } from '../src/ingress.js';
import { DurabilityBarrier, durability } from '../src/backup.js';

async function listen(t: TestContext, handler?: RequestListener) {
  const server = createServer(handler); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  return { server, port: (server.address() as AddressInfo).port, origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
}
async function directory(t: TestContext) {
  const dir = await mkdtemp('/tmp/opencode/aoty-ha-'); t.after(() => rm(dir, { recursive: true, force: true })); return dir;
}
const serverInfo: ServerInfo = { server_id: 'ma-instance-one', server_version: '2.10.6', schema_version: 65, min_supported_schema_version: 28, onboard_done: true };

test('Supervisor hints use default-role reads, effective ports, private interfaces and verified MA metadata', async () => {
  const calls: string[] = [];
  const data: Record<string, unknown> = {
    '/info': { homeassistant: '2026.10.0', supervisor: '2026.10.2' },
    '/addons/self/info': { hostname: 'local-aoty', ip_address: '172.30.33.5', network: { '3000/tcp': 4567 } },
    '/network/info': { interfaces: [
      { interface: 'tailscale0', primary: true, ipv4: { address: ['100.64.1.3/32'] } },
      { interface: 'eth0', primary: true, enabled: true, ipv4: { address: ['192.168.5.20/24'] } },
      { interface: 'wlan0', primary: false, ipv4: { address: ['192.168.6.20/24'] } },
    ] },
    '/supervisor/info': { addons: [{ slug: 'abc_music_assistant', name: 'Music Assistant' }, { slug: 'local_music_assistant_fake', name: 'Music Assistant' }] },
    '/addons/abc_music_assistant/info': { state: 'started', discovery: ['music_assistant'], host_network: true, ip_address: '172.30.32.1', ingress_port: 8094 },
    '/addons/local_music_assistant_fake/info': { state: 'started', url: 'https://example.com', ip_address: '192.168.1.99' },
  };
  const reader = { read: async (path: string) => { calls.push(path); if (!(path in data)) throw new Error(); return data[path]; } };
  const hints = await supervisorHints(reader, 3000);
  assert.deepEqual(hints.guestOrigins, ['http://192.168.5.20:4567']);
  assert.deepEqual(hints.mediaOrigins, ['http://local-aoty:3000', 'http://172.30.33.5:3000', 'http://192.168.5.20:4567']);
  assert.deepEqual(hints.maOrigins, ['http://192.168.5.20:8095', 'http://172.30.32.1:8094']);
  assert.ok(!calls.includes('/addons') && !calls.some(path => path.startsWith('/discovery')));
  assert.throws(() => new SupervisorClient('never-send').read('http://192.168.1.1/info'));
  data['/addons/self/info'] = { network: { '3000/tcp': null } }; data['/supervisor/info'] = {};
  const disabled = await supervisorHints(reader, 3000); assert.equal(disabled.guestPort, null); assert.deepEqual(disabled.guestOrigins, []);
  assert.match(disabled.message, /published port/); assert.deepEqual(disabled.maOrigins, []);
});

test('discovery deduplicates server identities and rejects an advertised browser URL for another instance', async () => {
  const read = async (url: string) => url === 'http://192.168.1.2:8095' ? { ...serverInfo, server_id: 'imposter' }
    : url === 'http://192.168.1.1:8095' ? serverInfo : { ...serverInfo, base_url: 'http://192.168.1.2:8095' };
  const found = await discoverServers(['http://172.30.32.1:8094', 'http://192.168.1.1:8095', 'http://192.168.1.1:8095'], read);
  assert.equal(found.length, 1); assert.equal(found[0]!.browserUrl, 'http://192.168.1.1:8095');
  assert.equal(found[0]!.playbackCompatible, true);
});

test('first-run addresses persist once; subsequent Supervisor IP changes and explicit overrides preserve browser identity', async t => {
  const dir = await directory(t); const manager = new IntegrationManager(new IntegrationFileStore(dir)); await manager.init();
  manager.attachUploads({} as never, 'http://localhost:3000');
  const client = { read: async (path: string) => path === '/addons/self/info' ? { network: { '3000/tcp': 4000 } }
    : path === '/network/info' ? { interfaces: [{ primary: true, ipv4: { address: ['192.168.1.8/24'] } }] } : {} };
  const config = { port: 3000, listenHost: '0.0.0.0', guestUrl: 'http://localhost:3000', dataDir: dir, mode: 'demo' as const, demoSeconds: 30, addon: true };
  let guest = ''; const setup = new SetupManager(config, manager, value => { guest = value; }, client, async () => [], async () => []);
  t.after(() => setup.close()); await setup.refresh(); assert.equal(guest, 'http://192.168.1.8:4000');
  await manager.initializeGuestOrigin('http://192.168.1.9:4000'); assert.equal(manager.guestOrigin, guest);
  const restored = new IntegrationManager(new IntegrationFileStore(dir)); await restored.init(); assert.equal(restored.guestOrigin, guest);
  const explicit = new SetupManager({ ...config, guestOverride: true }, restored, () => assert.fail('Explicit address replaced'), client, async () => [], async () => []);
  t.after(() => explicit.close()); await explicit.refresh();
  assert.equal(explicit.allowsGuestHost('192.168.1.8:4000'), true);
  assert.equal(explicit.allowsGuestHost('192.168.1.8:3000'), false);
  assert.equal(explicit.allowsGuestHost('other.local:4000'), false);
  const savedHostname = 'http://homeassistant.local:4000';
  await restored.saveGuestOrigin(savedHostname, restored.view().revision);
  const local = await listen(t); const adapter = new DemoAdapter();
  const engine = new Engine(new FileStore(dir), adapter, guest, restored); await engine.init();
  const http = createApp(engine, { ...config, port: local.port }, 'web', restored, undefined, undefined, explicit);
  local.server.on('request', http.app); t.after(() => { http.close(); adapter.close(); });
  const status = (path: string, headers: Record<string, string>, data?: unknown) => new Promise<number>((resolve, reject) => {
    const req = request(local.origin + path, { method: data ? 'POST' : 'GET', headers }, res => {
      res.resume(); res.on('end', () => resolve(res.statusCode!)); res.on('error', reject);
    });
    req.on('error', reject); req.end(data ? JSON.stringify(data) : undefined);
  });
  for (const path of ['/display', '/join', '/participant', '/api/display/state']) {
    assert.equal(await status(path, { Host: '192.168.1.8:4000' }), 200);
  }
  assert.equal(await status('/api/display/state', { Host: '192.168.1.8:3000' }), 403);
  assert.equal(await status('/api/display/state', { Host: 'other.local:4000', 'X-Forwarded-Host': '192.168.1.8:4000' }), 403);
  assert.equal(await status('/api/participant/join', { Host: '192.168.1.8:4000', Origin: 'http://192.168.1.8:4000', 'Content-Type': 'application/json' }, { nickname: 'LAN guest' }), 200);
  assert.equal(restored.guestOrigin, savedHostname);
  assert.equal(await status('/api/participant/join', { Host: '192.168.1.8:4000', Origin: 'https://evil.example', 'Content-Type': 'application/json' }, { nickname: 'Rejected' }), 403);
});

async function authorizationFixture(t: TestContext) {
  const calls: string[] = []; let identity = serverInfo.server_id;
  const token = `header.${Buffer.from(JSON.stringify({ jti: 'app-token-id', exp: Math.floor(Date.now() / 1000) + 365 * 86400 })).toString('base64url')}.signature`;
  const remote = await listen(t, async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/info') { res.end(JSON.stringify({ ...serverInfo, server_id: identity })); return; }
    if (req.url === '/api-docs') { res.end('docs'); return; }
    let raw = ''; for await (const chunk of req) raw += chunk;
    const input = JSON.parse(raw); calls.push(input.command);
    if (!['Bearer login-code', `Bearer ${token}`, 'Bearer old-token'].includes(req.headers.authorization ?? '')) { res.statusCode = 401; res.end('private upstream error'); return; }
    if (input.command === 'players/all') res.end(JSON.stringify([{ player_id: 'speaker', name: 'Room', available: true }]));
    else if (input.command === 'auth/token/create') res.end(JSON.stringify(token));
    else if (input.command === 'auth/token/revoke') res.end('null');
    else if (input.command === 'player_queues/get_active_queue') res.end(JSON.stringify({ queue_id: 'speaker' }));
    else { res.statusCode = 400; res.end('unsupported'); }
  });
  const dir = await directory(t); const manager = new IntegrationManager(new IntegrationFileStore(dir)); await manager.init();
  const local = await listen(t); const adapter = new DemoAdapter();
  const engine = new Engine(new FileStore(dir), adapter, local.origin, manager); await engine.init();
  const http = createApp(engine, { port: local.port, listenHost: '127.0.0.1', guestUrl: local.origin, dataDir: dir, mode: 'demo', demoSeconds: 30 }, 'web', manager);
  local.server.on('request', http.app); t.after(() => { http.close(); adapter.close(); });
  const post = (path: string, data: unknown) => fetch(`${local.origin}${path}`, { method: 'POST', headers: { Origin: local.origin, 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  const start = async () => {
    const response = await post('/api/host/auth/start', { url: remote.origin, revision: manager.view().revision }); assert.equal(response.status, 200);
    const login = new URL((await response.json() as { loginUrl: string }).loginUrl);
    return { callback: new URL(login.searchParams.get('return_url')!), cookie: response.headers.get('set-cookie')!.split(';')[0]!, response };
  };
  return { manager, local, remote, token, calls, dir, engine, app: http.app, post, start, setIdentity(value: string) { identity = value; } };
}

test('browser authorization binds state to cookie, consumes callbacks once, and persists only an app token', async t => {
  const f = await authorizationFixture(t); const login = await f.start();
  assert.match(login.response.headers.get('set-cookie')!, /HttpOnly/); assert.match(login.response.headers.get('set-cookie')!, /SameSite=Lax/);
  login.callback.searchParams.set('code', 'login-code');
  const forged = await fetch(login.callback, { redirect: 'manual' }); assert.match(forged.headers.get('location')!, /failed$/);
  assert.deepEqual(f.calls, []); assert.equal(f.manager.configured, false);
  const connected = await fetch(login.callback, { headers: { Cookie: login.cookie }, redirect: 'manual' });
  assert.equal(connected.status, 303); assert.equal(connected.headers.get('location'), '/host/settings?ma_auth=connected');
  assert.equal(connected.headers.get('referrer-policy'), 'no-referrer'); assert.equal(f.manager.serverId, serverInfo.server_id);
  assert.equal(f.manager.configured, true); assert.ok(f.manager.view().tokenExpiresAt! > Date.now());
  assert.ok(!(JSON.stringify(f.manager.view())).includes(f.token)); assert.ok(!(await readFile(join(f.dir, 'integrations.json'), 'utf8')).includes('login-code'));
  await fetch(login.callback, { headers: { Cookie: login.cookie }, redirect: 'manual' });
  assert.equal(f.calls.filter(c => c === 'auth/token/create').length, 1);
  assert.ok(!f.calls.some(c => /play|volume|stop/.test(c) && c !== 'players/all'));
});

test('stale, cancelled and identity-replaced authorization cannot mint credentials or replace saved setup', async t => {
  const f = await authorizationFixture(t);
  const stale = await f.start(); stale.callback.searchParams.set('code', 'login-code');
  await f.manager.saveGuestOrigin(f.local.origin, 0);
  await fetch(stale.callback, { headers: { Cookie: stale.cookie }, redirect: 'manual' });
  assert.equal(f.manager.configured, false); assert.equal(f.calls.length, 0);
  const cancelled = await f.start(); cancelled.callback.searchParams.set('error', 'access_denied');
  const response = await fetch(cancelled.callback, { headers: { Cookie: cancelled.cookie }, redirect: 'manual' }); assert.match(response.headers.get('location')!, /cancelled$/);
  const replaced = await f.start(); replaced.callback.searchParams.set('code', 'login-code'); f.setIdentity('new-server');
  await fetch(replaced.callback, { headers: { Cookie: replaced.cookie }, redirect: 'manual' }); assert.equal(f.calls.length, 0);
});

test('reauthorization and same-server relocation preserve source binding and destination; another server is rejected', async t => {
  const f = await authorizationFixture(t);
  await f.manager.save(f.remote.origin, 'old-token', 0); await f.manager.check(1); await f.manager.selectDestination('speaker', 1);
  const binding = f.manager.sourceBindingId; const destination = f.manager.view().destination;
  const login = await f.start(); login.callback.searchParams.set('code', 'login-code');
  await fetch(login.callback, { headers: { Cookie: login.cookie }, redirect: 'manual' });
  assert.equal(f.manager.sourceBindingId, binding); assert.deepEqual(f.manager.view().destination, destination);
  await f.manager.relocate(f.remote.origin.replace('127.0.0.1', 'localhost'), serverInfo.server_id, f.manager.view().revision);
  assert.equal(f.manager.sourceBindingId, binding); assert.deepEqual(f.manager.view().destination, destination);
  await assert.rejects(f.manager.saveAuthorized(f.remote.origin, 'token', 'other-server', f.remote.origin, f.manager.view().revision), /different Music Assistant/);
  assert.equal(f.manager.sourceBindingId, binding);
});

test('Ingress requires its dedicated trusted listener; prefixes assets/auth and preserves canonical guest links', async t => {
  const f = await authorizationFixture(t); const ingress = await listen(t, ingressListener(f.app, '127.0.0.1'));
  const guestOrigin = 'http://192.168.9.22:3000'; await f.manager.saveGuestOrigin(guestOrigin, 0);
  const headers = { 'X-Ingress-Path': '/api/hassio_ingress/fixture', 'X-Forwarded-Host': 'ha.example.test', 'X-Forwarded-Proto': 'https', 'X-Remote-User-Id': 'owner' };
  assert.equal((await fetch(`${ingress.origin}/host`)).status, 403);
  const response = await fetch(`${ingress.origin}/host`, { headers }); const html = await response.text();
  assert.equal(response.status, 200); assert.equal(response.headers.get('x-frame-options'), 'SAMEORIGIN');
  assert.match(html, /src="\/api\/hassio_ingress\/fixture\/main.ts"/); assert.ok(html.includes(`content="${guestOrigin}"`));
  const direct = await fetch(`${f.local.origin}/host`, { headers }); assert.equal(direct.headers.get('x-frame-options'), 'DENY');
  assert.ok(!(await direct.text()).includes('src="/api/hassio_ingress'));
  const guest = await fetch(`${ingress.origin}/participant`, { headers, redirect: 'manual' }); assert.equal(guest.headers.get('location'), `${guestOrigin}/participant`);
  assert.equal((await fetch(`${ingress.origin}/api/participant/state`, { headers })).status, 404);
  const postHeaders = { ...headers, Origin: 'https://ha.example.test', 'Content-Type': 'application/json' };
  const login = await fetch(`${ingress.origin}/api/host/auth/start`, { method: 'POST', headers: postHeaders, body: JSON.stringify({ url: f.remote.origin, revision: f.manager.view().revision }) });
  assert.equal(login.status, 200); assert.match(login.headers.get('set-cookie')!, /Path=\/api\/hassio_ingress\/fixture\/api\/host\/auth/); assert.match(login.headers.get('set-cookie')!, /Secure/);
  const payload = await login.json() as { loginUrl: string }; const callback = new URL(new URL(payload.loginUrl).searchParams.get('return_url')!);
  assert.equal(callback.origin, 'https://ha.example.test'); assert.equal(callback.pathname, '/api/hassio_ingress/fixture/api/host/auth/callback');
  callback.searchParams.set('code', 'login-code'); const cookie = login.headers.get('set-cookie')!.split(';')[0]!;
  const wrongUser = await fetch(`${ingress.origin}/api/host/auth/callback${callback.search}`, { headers: { ...headers, 'X-Remote-User-Id': 'different', Cookie: cookie }, redirect: 'manual' });
  assert.match(wrongUser.headers.get('location')!, /failed$/); assert.equal(f.calls.length, 0);
  const valid = await fetch(`${ingress.origin}/api/host/auth/callback${callback.search}`, { headers: { ...headers, Cookie: cookie }, redirect: 'manual' });
  assert.match(valid.headers.get('location')!, /^\/api\/hassio_ingress\/fixture\/host\/settings\?ma_auth=connected$/);
  const csrf = await fetch(`${ingress.origin}/api/host/integrations/clear`, { method: 'POST', headers: { ...postHeaders, Origin: f.local.origin }, body: JSON.stringify({ revision: f.manager.view().revision }) }); assert.equal(csrf.status, 403);
  const health = await fetch(`${f.local.origin}/api/health`, { headers: { Host: '172.30.33.99:3000' } }); assert.equal(health.status, 200);
});

test('backup barrier drains nested writes, freezes consistent snapshots, and resumes queued commits', async t => {
  const dir = await directory(t); const restored = await directory(t);
  let release!: () => void; const wait = new Promise<void>(resolve => { release = resolve; });
  let entered!: () => void; const enteredWork = new Promise<void>(resolve => { entered = resolve; });
  const active = durability.run(async () => { entered(); await wait; await writePrivateJson(dir, 'integrations.json', { schema: 1, revision: 0, musicAssistant: null }); });
  await enteredWork; const freezing = durability.freeze(); assert.equal(durability.paused, true);
  let written = false; const later = writePrivateJson(dir, 'state.json', { schema: 3, room: null }).then(() => { written = true; });
  release(); await active; await freezing;
  try {
    assert.equal(written, false); await cp(dir, restored, { recursive: true });
    assert.equal((await new IntegrationFileStore(restored).load()).revision, 0);
    await assert.rejects(readFile(join(restored, 'state.json')), { code: 'ENOENT' });
  } finally { durability.thaw(); }
  await later; assert.equal(written, true); assert.equal((await new FileStore(dir).load()).schema, 3);
  const barrier = new DurabilityBarrier(); let finish!: () => void;
  const longWrite = barrier.run(() => new Promise<void>(resolve => { finish = resolve; }));
  await assert.rejects(barrier.freeze(10), /still running/); assert.equal(barrier.paused, false); finish(); await longWrite;
});
