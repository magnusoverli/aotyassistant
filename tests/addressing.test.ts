import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import express from 'express';
import { type AddressingView, MediaChecks, applicationOrigin, setupHostAllowed } from '../src/addressing.js';
import { IntegrationManager, IntegrationFileStore } from '../src/integrations.js';
import { Engine } from '../src/engine.js';
import { FileStore } from '../src/store.js';
import { DemoAdapter } from '../src/playback.js';
import { createApp } from '../src/http.js';
import { startMusicAssistantFixture } from './fixtures/music-assistant.js';

async function fixture(t: TestContext) {
  const remote = await startMusicAssistantFixture(); const directory = await mkdtemp('/tmp/opencode/aoty-addressing-');
  const server = createServer(); server.listen(0, '0.0.0.0'); await once(server, 'listening');
  const port = (server.address() as AddressInfo).port; const origin = `http://127.0.0.1:${port}`; const alternate = `http://127.0.0.2:${port}`;
  const store = new IntegrationFileStore(directory); const manager = new IntegrationManager(store); await manager.init();
  const adapter = new DemoAdapter(3600); const engine = new Engine(new FileStore(directory), adapter, 'http://obsolete.local:3000', manager); await engine.init();
  const http = createApp(engine, { port, guestUrl: 'http://obsolete.local:3000', listenHost: '0.0.0.0', dataDir: directory, mode: 'demo', demoSeconds: 3600 }, 'dist/web', manager);
  server.on('request', http.app); t.after(() => { http.close(); adapter.close(); remote.close(); server.closeAllConnections(); server.close(); });
  const request = (path: string, data?: unknown, base = origin, headers: Record<string, string> = {}) => fetch(base + path, { method: data === undefined ? 'GET' : 'POST',
    headers: { ...(data === undefined ? {} : { Origin: base, 'Content-Type': 'application/json' }), ...headers }, ...(data === undefined ? {} : { body: JSON.stringify(data) }), signal: AbortSignal.timeout(5000) });
  async function json(path: string, data?: unknown, base = origin): Promise<AddressingView> {
    const response = await request(path, data, base); assert.equal(response.status, 200, await response.clone().text()); return response.json() as Promise<AddressingView>;
  }
  const connect = () => manager.save(remote.origin, 'fixture-token', manager.view().revision);
  return { remote, directory, manager, store, engine, origin, alternate, request, json, connect, close: http.close };
}

test('application origins and LAN setup candidates reject unsafe/ambiguous addresses, arbitrary DNS hosts and public peers', () => {
  for (const value of ['http://192.168.1.2:3000', 'https://app.example.org', 'http://homeassistant.local:3000', 'http://[fd12::4]:3000', 'http://100.80.2.3:3000']) assert.ok(applicationOrigin.safeParse(value).success, value);
  for (const value of ['ftp://localhost', 'http://a:b@localhost', 'http://localhost/path', 'http://localhost/?secret=x', 'http://localhost/#x', 'http://0.0.0.0:3000', 'http://[::]:3000', 'http://169.254.169.254', 'http://supervisor', 'http://224.0.0.1']) assert.equal(applicationOrigin.safeParse(value).success, false, value);
  for (const host of ['192.168.1.2:3000', 'homeassistant.local:3000', '[fd12::2]:3000']) assert.equal(setupHostAllowed(host, '::ffff:192.168.1.5'), true);
  for (const host of ['evil.example:3000', '0.0.0.0:3000', '169.254.169.254', 'user@homeassistant.local:3000', 'homeassistant.local:3000/path']) assert.equal(setupHostAllowed(host, '192.168.1.5'), false, host);
  assert.equal(setupHostAllowed('192.168.1.2:3000', '8.8.8.8'), false);
});

test('unknown LAN hosts get scoped setup only; explicit guest selection updates links durably without session or credential changes', async t => {
  const f = await fixture(t); const before = f.engine.view({ kind: 'host' });
  await f.engine.join('Listener');
  const joined = f.engine.view({ kind: 'host' });
  assert.equal((await f.request('/api/host/state', undefined, f.alternate)).status, 403);
  assert.equal((await f.request('/host', undefined, f.alternate)).url, f.alternate + '/host/settings');
  for (const path of ['/display', '/join', '/participant']) {
    const help = await f.request(path, undefined, f.alternate);
    assert.equal(help.status, 403); assert.match(help.headers.get('content-type')!, /text\/html/);
    const html = await help.text(); assert.ok(html.includes(`href="http://obsolete.local:3000${path}"`));
    assert.ok(html.includes('href="/host/settings"')); assert.ok(html.includes('Use this browser address for guest links'));
  }
  assert.equal((await f.request('/api/host/addressing', undefined, f.alternate)).status, 200);
  assert.equal((await f.request('/api/host/create', {}, f.alternate)).status, 403);
  assert.equal((await f.request('/api/host/addressing/guest', { origin: f.alternate, revision: 0 }, f.alternate, { Origin: 'https://evil.example' })).status, 403);
  assert.equal((await f.request('/api/host/addressing/guest', { origin: f.alternate, revision: 0 }, f.alternate, { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  const saved = await f.json('/api/host/addressing/guest', { origin: f.alternate, revision: 0 }, f.alternate); assert.equal(saved.guestOrigin, f.alternate);
  const after = f.engine.view({ kind: 'host' }); assert.equal(after.roomId, before.roomId); assert.equal(after.turnId, joined.turnId);
  assert.equal(after.joinUrl, `${f.alternate}/join`); assert.equal(after.displayUrl, `${f.alternate}/display`);
  assert.equal((await f.request('/api/host/state', undefined, f.alternate)).status, 200);
  const restored = new IntegrationManager(new IntegrationFileStore(f.directory)); await restored.init(); assert.equal(restored.guestOrigin, f.alternate);
  assert.equal((await stat(join(f.directory, 'integrations.json'))).mode & 0o777, 0o600);
  assert.equal((await f.request('/api/host/addressing/guest', { origin: f.origin, revision: 0 })).status, 409);
  assert.equal(f.manager.guestOrigin, f.alternate);
});

test('MA must fetch the synthetic exact file before automatic selection; no speaker, library or queue command is sent', async t => {
  const f = await fixture(t); await f.connect();
  const signature = () => JSON.stringify({ ...f.remote.queue, elapsed_time_last_updated: 0 }); const before = signature();
  const checked = await f.json('/api/host/addressing/test', { origins: [f.alternate], revision: f.manager.view().revision, automatic: true });
  assert.equal(checked.mediaCheck.status, 'verified'); assert.equal(checked.effectiveMediaOrigin, f.alternate); assert.equal(checked.automaticMediaOrigin, f.alternate);
  assert.equal(checked.guestOrigin, 'http://obsolete.local:3000');
  assert.ok(!JSON.stringify(checked).includes('/api/media/check/')); assert.ok(!JSON.stringify(checked).includes('fixture-token'));
  assert.deepEqual(f.remote.calls.map(call => call.command), ['music/item_by_uri']); assert.equal(signature(), before);
  const uri = String(f.remote.calls[0]!.args.uri); const url = uri.slice('builtin://track/'.length);
  assert.match(uri, /^builtin:\/\/track\/http:/); assert.equal((await fetch(url)).status, 404, 'Diagnostic access is revoked immediately, not persisted as a playable URL.');
  const record = JSON.parse(await readFile(join(f.directory, 'integrations.json'), 'utf8')); assert.equal(record.automaticMediaOrigin, f.alternate); assert.ok(!JSON.stringify(record).includes('/api/media/check/'));
  const restored = new IntegrationManager(new IntegrationFileStore(f.directory)); await restored.init(); assert.equal(restored.addressing().automaticMediaOrigin, f.alternate); assert.equal(restored.addressing().mediaCheck.status, 'unchecked');
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() }); t.mock.timers.tick(6 * 60_000); assert.equal(f.manager.addressing().mediaCheck.status, 'expired');
});

test('failed, unobserved and substituted sources never become automatic/manual addresses; fallback candidates are independently verified', async t => {
  const f = await fixture(t); await f.connect(); const revision = f.manager.view().revision;
  for (const mode of ['unreachable', 'no-callback', 'wrong-identity'] as const) {
    f.remote.uploadedMode(mode);
    const result = await f.json('/api/host/addressing/test', { origins: [f.alternate], revision, automatic: true });
    assert.equal(result.mediaCheck.status, 'failed'); assert.equal(result.automaticMediaOrigin, null); assert.equal(result.revision, revision);
    assert.ok(!JSON.stringify(result).includes('/api/media/check/')); assert.ok(!JSON.stringify(result).includes('UPSTREAM SECRET'));
    assert.equal((await f.request('/api/host/integrations/media-origin', { origin: f.alternate, revision })).status, 422);
    assert.equal(f.manager.addressing().mediaOrigin, null);
  }
  f.remote.uploadedMode('normal');
  const result = await f.json('/api/host/addressing/test', { origins: ['http://127.0.0.1:9', f.alternate], revision, automatic: true });
  assert.equal(result.mediaCheck.status, 'verified'); assert.equal(result.effectiveMediaOrigin, f.alternate);
});

test('verified manual override survives destination changes and automatic suggestions never overwrite it', async t => {
  const f = await fixture(t); await f.connect();
  assert.equal((await f.request('/api/host/integrations/media-origin', { origin: f.alternate, revision: f.manager.view().revision })).status, 200);
  await f.manager.selectDestination('sonos:room', f.manager.view().revision);
  assert.equal(f.manager.addressing().mediaOrigin, f.alternate);
  const checked = await f.json('/api/host/addressing/test', { origins: [f.origin], revision: f.manager.view().revision, automatic: true });
  assert.equal(checked.mediaOrigin, f.alternate); assert.equal(checked.effectiveMediaOrigin, f.alternate);
  await f.json('/api/host/addressing/guest', { origin: f.origin, revision: checked.revision });
  await f.manager.selectDestination('sonos:bedroom', f.manager.view().revision); assert.equal(f.manager.guestOrigin, f.origin);
});

test('slow diagnostics do not hold playback serialization; concurrent checks and settings races fail safely', async t => {
  const f = await fixture(t); await f.connect(); f.remote.delayUploads(120);
  const checking = f.manager.checkMediaOrigins([f.alternate], f.manager.view().revision, true);
  for (let n = 0; n < 50 && !f.remote.calls.length; n++) await delay(2);
  await assert.rejects(f.manager.checkMediaOrigins([f.origin], f.manager.view().revision), error => (error as { status: number }).status === 429);
  await f.manager.selectDestination('sonos:room', f.manager.view().revision);
  assert.equal(await f.manager.withPlayback(async () => 'player lane is free'), 'player lane is free');
  await assert.rejects(checking, error => (error as { status: number }).status === 409);
  assert.equal(f.manager.addressing().automaticMediaOrigin, null); assert.equal(f.manager.addressing().mediaCheck.status, 'unchecked');
});

test('an owned pause is not reconfigured by diagnostics and explicit address changes require finishing it first', async t => {
  const f = await fixture(t); await f.connect();
  f.manager.attachPlayback({ ownsPlayback: true, issue: '', configurationChanged() { throw new Error('Must not reconfigure playback'); }, async recover() {} });
  const checked = await f.manager.checkMediaOrigins([f.alternate], f.manager.view().revision, true);
  assert.equal(checked.mediaCheck.status, 'verified'); assert.equal(checked.automaticMediaOrigin, null);
  await assert.rejects(f.manager.saveGuestOrigin(f.origin, f.manager.view().revision), error => (error as { status: number }).status === 409);
  await assert.rejects(f.manager.saveMediaOrigin(f.alternate, f.manager.view().revision), error => (error as { status: number }).status === 409);
  assert.deepEqual(f.remote.calls.map(call => call.command), ['music/item_by_uri']);
});

test('diagnostic capabilities serve only finite synthetic ranges and expire/revoke independently of uploads', async t => {
  let now = Date.now(); const checks = new MediaChecks(() => now); const app = express();
  app.get('/api/media/check/:key/track.wav', (req, res) => { if (!checks.allows(req)) { res.status(404).end(); return; } checks.serve(req, res); });
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { checks.close(); server.closeAllConnections(); server.close(); });
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`; const lease = checks.create(origin);
  const head = await fetch(lease.url, { method: 'HEAD' }); assert.equal(head.status, 200); assert.equal(lease.observed, false);
  const range = await fetch(lease.url, { headers: { Range: 'bytes=0-3' } }); assert.equal(range.status, 206); assert.equal(await range.text(), 'RIFF'); assert.equal(lease.observed, true);
  for (const bad of ['bytes=-0', 'bytes=999999-', 'bytes=3-2', 'bytes=0-2,5-8']) assert.equal((await fetch(lease.url, { headers: { Range: bad } })).status, 416);
  now += 31_000; assert.equal((await fetch(lease.url)).status, 404); assert.equal(lease.observed, false); lease.revoke();
  const next = checks.create(origin); checks.close(); assert.equal((await fetch(next.url)).status, 404);
});

test('Host and forwarded-header manipulation never promotes arbitrary sites into trusted application origins', async t => {
  const f = await fixture(t);
  const spoof = (host: string) => new Promise<number>(resolve => { const request = httpRequest(f.origin + '/api/host/addressing', { headers: { Host: host, 'X-Forwarded-Host': new URL(f.alternate).host } }, res => { res.resume(); resolve(res.statusCode!); }); request.end(); });
  assert.equal(await spoof('evil.example:3000'), 403); assert.equal(await spoof('169.254.169.254'), 403);
  const read = await f.request('/api/host/addressing', undefined, f.origin, { 'X-Forwarded-Host': 'evil.example', 'X-Forwarded-Proto': 'https' });
  assert.equal((await read.json() as AddressingView).guestOrigin, 'http://obsolete.local:3000');
});

test('failed persistence keeps the previous addresses and a successful fetch is not misrepresented as a saved selection', async t => {
  const f = await fixture(t); await f.connect(); const before = f.manager.addressing(); const save = f.store.save.bind(f.store);
  f.store.save = async () => { throw new Error('Synthetic disk failure'); };
  assert.equal((await f.request('/api/host/addressing/test', { origins: [f.alternate], automatic: true, revision: before.revision })).status, 503);
  assert.equal(f.manager.addressing().effectiveMediaOrigin, before.effectiveMediaOrigin); assert.equal(f.manager.addressing().revision, before.revision);
  assert.equal(f.manager.addressing().mediaCheck.status, 'unchecked');
  assert.equal((await f.request('/api/host/addressing/guest', { origin: f.alternate, revision: before.revision })).status, 503);
  assert.equal(f.manager.guestOrigin, before.guestOrigin);
  f.store.save = save;
});
