import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { createServer, type RequestListener, type IncomingMessage } from 'node:http';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import WebSocket, { WebSocketServer } from 'ws';
import express from 'express';
import { BrowserSpeakers, openSpeakerSocket, pairingClientId, type SpeakerConnection, type SpeakerContext } from '../src/browser-speakers.js';
import { speakerContext, mountBrowserSpeakers } from '../src/browser-speaker-http.js';
import { validateIngress } from '../src/ingress.js';
import { publicRoute } from '../src/public-listener.js';
import type { OnlineAccess } from '../src/online-access.js';

const owner = randomBytes(32).toString('base64url');
const clientId = randomBytes(32).toString('base64url');
const lan: SpeakerContext = { kind: 'lan', origin: 'http://room.local:3000', base: '', valid: () => true };
const connection: SpeakerConnection = { origin: 'http://127.0.0.1:8095', token: 'fixture-only', epoch: 'epoch-1', scope: 'installation', version: '2.10.9', serverId: 'ma-fixture' };
const registration = () => ({ id: randomUUID(), clientId, name: 'Room browser' });
function tokenFor(id: string) {
  let bits = 0; let value = 0; let encoded = '';
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  for (const byte of Buffer.concat([Buffer.from(id, 'base64url'), Buffer.alloc(32, 1)])) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { bits -= 5; encoded += alphabet[(value >>> bits) & 31]; }
    value &= (1 << bits) - 1;
  }
  if (bits) encoded += alphabet[(value << (5 - bits)) & 31];
  return 'SP:0' + encoded.replaceAll('2', '9');
}
async function listen(t: TestContext, handler?: RequestListener) {
  const server = createServer(handler); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const port = (server.address() as AddressInfo).port;
  return { server, port, url: `http://127.0.0.1:${port}` };
}
async function fixture(t: TestContext) {
  const auth: unknown[] = []; const commands: unknown[] = [];
  const app = express(); app.use(express.json());
  app.get('/info', (_req, res) => res.json({ server_id: connection.serverId, server_version: connection.version, schema_version: 65 }));
  app.post('/api', (req, res) => { assert.equal(req.headers.authorization, 'Bearer fixture-only'); commands.push(req.body); res.json(null); });
  const upstream = await listen(t, app);
  const ws = new WebSocketServer({ server: upstream.server });
  t.after(() => { for (const client of ws.clients) client.terminate(); ws.close(); });
  ws.on('connection', socket => {
    socket.once('message', data => {
      auth.push(JSON.parse(data.toString())); socket.send('{"type":"auth_ok"}');
      socket.on('message', (data, binary) => socket.send(data, { binary }));
    });
  });
  let epoch = 'epoch-1';
  const speakers = new BrowserSpeakers(() => ({ ...connection, origin: upstream.url, epoch })); t.after(() => speakers.close());
  const local = await listen(t);
  const context = { ...lan, origin: local.url };
  speakers.attach(local.server, req => speakerContext(req, 'lan', local.url, local.port));
  const input = registration(); speakers.register(input, owner, context);
  const connect = (extra: Record<string, string> = {}, path = `/api/browser-speaker/socket?id=${input.id}`) => {
    const socket = new WebSocket(local.url.replace('http:', 'ws:') + path, { headers: { Origin: local.url, Cookie: `aoty_browser_speaker=${owner}`, ...extra } });
    t.after(() => socket.terminate()); return socket;
  };
  return { speakers, context, input, connect, auth, commands, local, upstreamSockets: ws.clients, epoch: () => { epoch = 'epoch-2'; } };
}

test('automatic sessions enforce owner/context and abandoned sessions expire', t => {
  let now = 0; const speakers = new BrowserSpeakers(() => connection, undefined, undefined, undefined, () => now); t.after(() => speakers.close());
  const input = registration(); const view = speakers.register(input, owner, lan);
  assert.equal(view.active, true); assert.equal(JSON.stringify(view).includes(owner), false);
  assert.throws(() => speakers.status(input.id, 'wrong', lan), /expired/);
  assert.throws(() => speakers.status(input.id, owner, { ...lan, kind: 'public' }), /expired/);
  assert.throws(() => speakers.status(input.id, owner, { ...lan, origin: 'http://evil.test' }), /expired/);
  now = 20_000; assert.equal(speakers.status(input.id, owner, lan).active, true);
  now = 80_000; assert.throws(() => speakers.status(input.id, owner, lan), /expired/);
  speakers.sweep(); assert.deepEqual(speakers.list(), []);
});

test('another tab waits for the identity lease and takes over automatically after the first leaves', t => {
  const speakers = new BrowserSpeakers(() => connection); t.after(() => speakers.close());
  const ingress: SpeakerContext = { ...lan, kind: 'ingress', base: '/api/hassio_ingress/test' };
  const first = speakers.register(registration(), owner, ingress); assert.equal(first.active, true);
  const second = speakers.register(registration(), owner, ingress); assert.equal(second.active, false);
  speakers.remove(first.id); assert.equal(speakers.status(second.id, owner, ingress).active, true);
  const remote = speakers.register({ ...registration(), clientId: randomBytes(32).toString('base64url') }, owner, { ...lan, kind: 'public' });
  speakers.revokePublic(); assert.equal(speakers.list().some(s => s.id === remote.id), false); assert.equal(speakers.list().length, 1);
  speakers.revokeOwner(owner); assert.deepEqual(speakers.list(), []);
});

test('pairing tokens bind exactly to their public identity and reject malformed/noncanonical tokens', () => {
  assert.equal(pairingClientId(tokenFor(clientId)), clientId);
  for (const token of ['', 'SP:1' + 'A'.repeat(103), tokenFor(clientId).slice(0, -1), 'SP:0' + 'A'.repeat(102) + 'B']) assert.equal(pairingClientId(token), undefined);
});

test('an abandoned connection attempt cannot indefinitely reserve the browser identity', t => {
  let now = 0; const speakers = new BrowserSpeakers(() => connection, undefined, undefined, undefined, () => now); t.after(() => speakers.close());
  const first = speakers.register(registration(), owner, lan); const second = speakers.register(registration(), owner, lan);
  assert.equal(first.active, true); assert.equal(second.active, false);
  now = 31_000;
  assert.equal(speakers.status(second.id, owner, lan).active, true);
  assert.equal(speakers.status(first.id, owner, lan).active, false);
});

test('unregistered, wrong-origin, wrong-owner and off-route websocket upgrades never authenticate upstream', async t => {
  const f = await fixture(t);
  await assert.rejects(once(f.connect({}, '/api/browser-speaker/socket?id=' + randomUUID()), 'open'), /403/);
  await assert.rejects(once(f.connect({ Origin: 'https://evil.test' }), 'open'), /403/);
  await assert.rejects(once(f.connect({ Cookie: '' }), 'open'), /403/);
  await assert.rejects(once(f.connect({}, '/api/host/state?id=' + f.input.id), 'open'), /403/);
  assert.equal(f.auth.length, 0);
});

test('relay authenticates server-side, preserves binary/text framing, binds pairing and closes on revocation', async t => {
  const f = await fixture(t);
  const socket = f.connect(); await once(socket, 'open');
  assert.deepEqual(f.auth, [{ type: 'auth', token: 'fixture-only', client_id: clientId }]);
  const binary = Buffer.from([0, 255, 32, 127]); const echoed = once(socket, 'message'); socket.send(binary);
  const [bytes, isBinary] = await echoed; assert.deepEqual(bytes, binary); assert.equal(isBinary, true);
  const text = once(socket, 'message'); socket.send('{"fixture":"hello"}'); const [message, textBinary] = await text;
  assert.equal(message.toString(), '{"fixture":"hello"}'); assert.equal(textBinary, false);
  await assert.rejects(f.speakers.pair(f.input.id, owner, f.context, tokenFor(randomBytes(32).toString('base64url'))), /cannot be paired/);
  assert.equal(f.commands.length, 0);
  const result = await f.speakers.pair(f.input.id, owner, f.context, tokenFor(clientId)); assert.equal(result.paired, true);
  assert.equal((f.commands[0] as { command: string }).command, 'sendspin/pair_web_player');
  await assert.rejects(once(f.connect(), 'open'), /403/); assert.equal(f.auth.length, 1);
  const closed = once(socket, 'close'); f.speakers.remove(f.input.id); await closed;
  assert.deepEqual(f.speakers.list(), []);
});

test('server/account replacement revokes a connected relay without issuing queue commands', async t => {
  const f = await fixture(t); const socket = f.connect(); await once(socket, 'open');
  const closed = once(socket, 'close'); f.epoch(); f.speakers.sweep(); await closed;
  assert.equal(f.commands.length, 0); assert.deepEqual(f.speakers.list(), []);
});

test('two real websocket clients cannot play the same identity simultaneously and hand over after disconnect', async t => {
  const f = await fixture(t); const first = f.connect(); await once(first, 'open');
  const next = registration(); assert.equal(f.speakers.register(next, owner, f.context).active, false);
  const path = '/api/browser-speaker/socket?id=' + next.id;
  await assert.rejects(once(f.connect({}, path), 'open'), /403/); assert.equal(f.auth.length, 1);
  const closed = once(first, 'close'); f.speakers.remove(f.input.id); await closed;
  assert.equal(f.speakers.status(next.id, owner, f.context).active, true);
  const second = f.connect({}, path); await once(second, 'open');
  assert.equal(f.auth.length, 2); assert.equal(f.commands.length, 0);
});

test('a dropped stream releases its lease for reconnection without taking over the queue', async t => {
  const f = await fixture(t); const socket = f.connect(); await once(socket, 'open');
  const closed = once(socket, 'close'); for (const remote of f.upstreamSockets) remote.terminate(); await closed;
  const status = f.speakers.status(f.input.id, owner, f.context); assert.equal(status.active, true); assert.equal(status.connected, false);
  const reconnect = f.connect(); await once(reconnect, 'open');
  assert.equal(f.auth.length, 2); assert.equal(f.commands.length, 0); assert.equal(f.speakers.status(f.input.id, owner, f.context).connected, true);
});

test('public websocket upgrades require both invitation and device grants; losing the invitation closes audio', async t => {
  const f = await fixture(t); const gateway = await listen(t);
  let valid = true; const online = { origin: 'https://room.ts.net', authorized: (grant: string) => valid && grant === 'fixture-grant' } as OnlineAccess;
  const context: SpeakerContext = { kind: 'public', origin: online.origin!, base: '', valid: () => valid };
  const input = { ...registration(), clientId: randomBytes(32).toString('base64url') }; assert.equal(f.speakers.register(input, owner, context).active, true);
  f.speakers.attach(gateway.server, req => speakerContext(req, 'public', f.local.url, f.local.port, online));
  const connect = (cookie: string) => {
    const ws = new WebSocket(gateway.url.replace('http:', 'ws:') + '/api/browser-speaker/socket?id=' + input.id,
      { headers: { Host: 'room.ts.net', Origin: online.origin!, Cookie: cookie } });
    t.after(() => ws.terminate()); return ws;
  };
  await assert.rejects(once(connect(`aoty_browser_speaker=${owner}`), 'open'), /403/);
  await assert.rejects(once(connect('__Host-aoty_online=fixture-grant'), 'open'), /403/);
  const socket = connect(`__Host-aoty_online=fixture-grant; aoty_browser_speaker=${owner}`); await once(socket, 'open');
  const closed = once(socket, 'close'); valid = false; f.speakers.sweep(); await closed;
  await assert.rejects(once(connect(`__Host-aoty_online=fixture-grant; aoty_browser_speaker=${owner}`), 'open'), /403/);
});

test('upstream authentication failure is sanitized and cannot establish a relay', async t => {
  const server = await listen(t, (_req, res) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ server_id: connection.serverId, server_version: '2.10.8', schema_version: 65 })); }); const ws = new WebSocketServer({ server: server.server });
  t.after(() => { for (const c of ws.clients) c.terminate(); ws.close(); });
  ws.on('connection', socket => socket.once('message', () => socket.send('{"type":"auth_error","detail":"sensitive upstream data"}')));
  await assert.rejects(openSpeakerSocket({ ...connection, origin: server.url }, clientId), error => error instanceof Error && /could not be established/.test(error.message) && !error.message.includes('sensitive'));
});

test('a reused MA address or unsupported API schema is rejected before websocket authentication', async t => {
  let info = { server_id: 'different-server', server_version: '2.10.8', schema_version: 65 }; let upgrades = 0;
  const server = await listen(t, (_req, res) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(info)); });
  server.server.on('upgrade', (_req, socket) => { upgrades++; socket.destroy(); });
  for (const next of [info, { ...info, server_id: connection.serverId, schema_version: 66 }]) {
    info = next;
    await assert.rejects(openSpeakerSocket({ ...connection, origin: server.url }, clientId), /identity or browser-audio compatibility/);
  }
  assert.equal(upgrades, 0);
});

test('listener contexts require real Ingress provenance or a valid Funnel grant, not forwarded headers on LAN', () => {
  const req = (headers: Record<string, string>, peer = '127.0.0.1') => ({ headers, socket: { remoteAddress: peer } }) as IncomingMessage;
  const ingressHeaders = { host: 'internal:8099', 'x-ingress-path': '/api/hassio_ingress/test', 'x-forwarded-proto': 'https', 'x-forwarded-host': 'ha.example', 'x-remote-user-id': 'user' };
  assert.equal(validateIngress(req(ingressHeaders)), undefined);
  assert.equal(speakerContext(req(ingressHeaders), 'lan', lan.origin, 3000), undefined);
  const trusted = speakerContext(req(ingressHeaders, '172.30.32.2'), 'ingress', lan.origin, 3000)!;
  assert.equal(trusted.origin, 'https://ha.example'); assert.equal(trusted.kind, 'ingress');
  let valid = true; const online = { origin: 'https://room.ts.net', authorized: (grant: string) => valid && grant === 'fixture-grant' } as OnlineAccess;
  const remote = req({ host: 'room.ts.net', cookie: '__Host-aoty_online=fixture-grant' });
  const context = speakerContext(remote, 'public', lan.origin, 3000, online)!; assert.equal(context.kind, 'public'); assert.equal(context.valid(), true);
  valid = false; assert.equal(context.valid(), false); assert.equal(speakerContext(remote, 'public', lan.origin, 3000, online), undefined);
  for (const action of ['register', 'pair', 'stop']) assert.equal(publicRoute('POST', '/api/browser-speaker/' + action), true);
  assert.equal(publicRoute('POST', '/api/host/browser-speakers'), false);
});

test('HTTP speaker setup uses an HttpOnly cookie and read-only sanitized info', async t => {
  const app = express(); app.use(express.json()); const local = await listen(t, app);
  const speakers = new BrowserSpeakers(() => connection); t.after(() => speakers.close());
  mountBrowserSpeakers(app, speakers, () => local.url, local.port);
  const info = await fetch(local.url + '/api/browser-speaker/info'); const cookie = info.headers.get('set-cookie')!;
  assert.match(cookie, /HttpOnly/); assert.match(cookie, /SameSite=Strict/); assert.match(cookie, /Path=\/api/);
  assert.deepEqual(await info.json(), { scope: 'installation', version: '2.10.9' });
  const registered = await fetch(local.url + '/api/browser-speaker/register', { method: 'POST', headers: { Cookie: cookie.split(';')[0]!, 'Content-Type': 'application/json' }, body: JSON.stringify(registration()) });
  assert.equal(registered.status, 200); assert.equal((await registered.json() as { active: boolean }).active, true);
});
