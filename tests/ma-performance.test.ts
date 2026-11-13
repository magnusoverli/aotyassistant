import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { MusicAssistantTransport } from '../src/music-assistant-transport.js';
import { MusicAssistantClient } from '../src/music-assistant.js';
import { operation, operationSignal } from '../src/operation.js';
import { AppError } from '../src/model.js';
import { startMusicAssistantFixture } from './fixtures/music-assistant.js';
import { MusicAssistantEvents } from '../src/music-assistant-events.js';

test('search has headroom beyond MA eight-second partial-result cutoff while normal reads keep their deadline', async t => {
  const server = createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const search = raw && JSON.parse(raw).command === 'music/search';
    await delay(search ? 8100 : 100);
    if (!res.destroyed) res.end(search ? '{"tracks":[]}' : '{}');
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const transport = new MusicAssistantTransport(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, 'SECRET', 50);
  t.after(() => transport.close());
  await assert.rejects(transport.read('/info'), /respond in time/);
  assert.deepEqual(await transport.read('/api', 'music/search', { search_query: 'fixture' }), { tracks: [] });
});

test('HTTP connections are reused per lane, with independent capacity for controls and explicit disposal', async t => {
  const remote = await startMusicAssistantFixture(); t.after(remote.close);
  const transport = new MusicAssistantTransport(remote.origin, 'fixture-token'); t.after(() => transport.close());
  await transport.read('/info'); await transport.read('/api', 'players/all'); await transport.read('/info');
  assert.equal(remote.connections, 1);
  await transport.read('/api', 'music/search', { search_query: 'fixture', media_types: ['track'] });
  assert.equal(remote.connections, 2, 'Catalogue requests have their own pool.');
  remote.delayImages(300);
  const artwork = Promise.all(Array.from({ length: 8 }, () => transport.read(`/imageproxy/${'a'.repeat(64)}`, undefined, {}, true)));
  await operation('control-capacity', () => transport.read('/api', 'players/all'), 200);
  await artwork;
  transport.close(); await assert.rejects(transport.read('/info'), /closed/);
});

test('pool identity follows the checked DNS addresses and never reuses a socket after a prohibited DNS answer', async t => {
  const ports: number[] = [];
  const server = createServer((req, res) => { ports.push(req.socket.remotePort!); res.end('{}'); });
  server.listen(0, '0.0.0.0'); await once(server, 'listening'); t.after(() => { server.closeAllConnections(); server.close(); });
  let address = '127.0.0.1';
  const transport = new MusicAssistantTransport(`http://fixture.internal:${(server.address() as AddressInfo).port}`, 'SECRET', 1000,
    async () => [{ address, family: 4 }]); t.after(() => transport.close());
  await transport.read('/info'); await transport.read('/info'); assert.equal(ports[0], ports[1]);
  address = '127.0.0.2'; await transport.read('/info'); assert.notEqual(ports[1], ports[2]);
  address = '169.254.169.254'; await assert.rejects(transport.read('/info'), /private LAN/); assert.equal(ports.length, 3);
});

test('DNS and the response body share one deadline, and timed-out writes are sent only once', async t => {
  let commands = 0; let dnsFinished = false;
  const server = createServer(async (req, res) => {
    for await (const _chunk of req) { /* drain */ }
    commands++;
    assert.equal(dnsFinished, true);
    res.write('{'); await delay(100); if (!res.destroyed) res.end('}');
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); t.after(() => { server.closeAllConnections(); server.close(); });
  const transport = new MusicAssistantTransport(`http://fixture.internal:${(server.address() as AddressInfo).port}`, 'SECRET', 120,
    async () => { await delay(70); dnsFinished = true; return [{ address: '127.0.0.1', family: 4 }]; }); t.after(() => transport.close());
  await assert.rejects(transport.read('/api', 'player_queues/pause'), /respond in time/);
  assert.equal(commands, 1);
});

test('interactive discovery skips the documentation endpoint while explicit diagnostics retain it', async t => {
  const remote = await startMusicAssistantFixture(); t.after(remote.close);
  const client = new MusicAssistantClient(remote.origin, 'fixture-token'); t.after(() => client.close());
  await client.inspect({ documentation: false });
  assert.equal(remote.requests.some(r => r.path === '/api-docs'), false);
  assert.equal((await client.inspect()).docsAvailable, true);
});

test('cancelling a catalogue read aborts its upstream request without retrying it', async t => {
  let entered!: () => void; let disconnected!: () => void;
  const waiting = new Promise<void>(resolve => { entered = resolve; });
  const closed = new Promise<void>(resolve => { disconnected = resolve; });
  let requests = 0;
  const server = createServer((req, res) => { requests++; req.resume(); res.on('close', disconnected); entered(); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); t.after(() => { server.closeAllConnections(); server.close(); });
  const transport = new MusicAssistantTransport(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, 'SECRET'); t.after(() => transport.close());
  const controller = new AbortController();
  const reading = operation('browse', () => transport.read('/api', 'music/search', {}), 12_000, controller.signal);
  const rejected = assert.rejects(reading); await waiting; controller.abort(); await rejected; await closed;
  assert.equal(requests, 1);
});

function pendingListings(t: TestContext) {
  const reads: { signal: AbortSignal; finish(value?: unknown): void }[] = [];
  const client = new MusicAssistantClient('http://127.0.0.1:1', 'fixture-token', 8000, {
    read: () => new Promise(resolve => {
      reads.push({ signal: operationSignal()!, finish: (value = { tracks: [] }) => resolve(value) });
    }),
  });
  t.after(() => { client.close(); for (const read of reads) read.finish(); });
  return { client, reads };
}

test('shared catalogue callers have independent cancellation and deadlines', { timeout: 3000 }, async t => {
  for (const cancel of [true, false]) {
    const { client, reads } = pendingListings(t); const leaving = new AbortController();
    const first = operation('first', () => client.search('shared'), cancel ? 2000 : 30, leaving.signal);
    const staying = operation('staying', () => client.search('shared'), 2000);
    const rejected = assert.rejects(first, (error: AppError) => error.status === (cancel ? 499 : 504));
    if (cancel) leaving.abort();
    await rejected;
    assert.equal(reads.length, 1); assert.equal(reads[0]!.signal.aborted, false, 'Another caller still needs this upstream read.');
    reads[0]!.finish(); assert.deepEqual(await staying, []);
    assert.deepEqual(await client.search('shared'), []); assert.equal(reads.length, 1, 'Successful shared results still populate the cache.');
  }
});

test('the last catalogue caller leaving cancels upstream work and an immediate retry gets fresh work', async t => {
  const { client, reads } = pendingListings(t); const leaving = new AbortController();
  const old = operation('old', () => client.search('same'), 2000, leaving.signal);
  const rejected = assert.rejects(old, (error: AppError) => error.status === 499);
  leaving.abort(); await rejected;
  assert.equal(reads[0]!.signal.aborted, true);
  const next = client.search('same'); assert.equal(reads.length, 2);
  reads[0]!.finish(); await delay(0);
  const shared = client.search('same'); assert.equal(reads.length, 2, 'A late abandoned response cannot evict or populate the new read.');
  reads[1]!.finish(); assert.deepEqual(await next, []); assert.deepEqual(await shared, []);
});

test('catalogue admission is bounded and cancelled callers release their places', async t => {
  const { client, reads } = pendingListings(t); const leaving = new AbortController();
  const pending = Array.from({ length: 64 }, (_, index) => operation('browse', () => client.search(`query-${index}`), 2000, leaving.signal));
  const settled = Promise.allSettled(pending);
  await assert.rejects(client.search('overflow'), (error: AppError) => error.status === 429);
  assert.equal(reads.length, 64);
  leaving.abort(); assert.ok((await settled).every(result => result.status === 'rejected'));
  assert.ok(reads.every(read => read.signal.aborted));
  const next = client.search('admitted'); assert.equal(reads.length, 65);
  reads.at(-1)!.finish(); await next;
});

test('cached listings cannot turn a cancelled caller into a successful request', async t => {
  const { client, reads } = pendingListings(t);
  const initial = client.search('cached'); reads[0]!.finish(); await initial;
  const controller = new AbortController(); controller.abort();
  await assert.rejects(operation('cancelled', () => client.search('cached'), 1000, controller.signal), (error: AppError) => error.status === 499);
  assert.equal(reads.length, 1);
});

test('cancelling through the shared client closes the real upstream connection', { timeout: 3000 }, async t => {
  let enter!: () => void; let disconnect!: () => void;
  const entered = new Promise<void>(resolve => { enter = resolve; }); const disconnected = new Promise<void>(resolve => { disconnect = resolve; });
  const server = createServer((req, res) => { req.resume(); res.on('close', disconnect); enter(); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const client = new MusicAssistantClient(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, 'fixture-token');
  t.after(() => client.close());
  const controller = new AbortController();
  const reading = operation('browse', () => client.search('leave'), 2000, controller.signal);
  const rejected = assert.rejects(reading, (error: AppError) => error.status === 499);
  await entered; controller.abort(); await rejected; await disconnected;
});

test('opt-in timings correlate commands and include no token, URI, arguments or response data', async t => {
  const remote = await startMusicAssistantFixture(); t.after(remote.close);
  const transport = new MusicAssistantTransport(remote.origin, 'fixture-token'); t.after(() => transport.close());
  const logs: string[] = []; t.mock.method(console, 'info', (value: string) => logs.push(value));
  const previous = process.env.DOOM_ROOM_MA_TIMINGS; process.env.DOOM_ROOM_MA_TIMINGS = '1';
  t.after(() => { if (previous === undefined) delete process.env.DOOM_ROOM_MA_TIMINGS; else process.env.DOOM_ROOM_MA_TIMINGS = previous; });
  await operation('play', () => transport.read('/api', 'music/item_by_uri', { uri: remote.track.uri }));
  assert.equal(logs.length, 1);
  const report = JSON.parse(logs[0]!); assert.equal(report.action, 'play'); assert.equal(report.ok, true);
  assert.ok(report.stages.some((s: { stage: string }) => s.stage === 'music/item_by_uri'));
  for (const secret of [remote.origin, remote.track.uri, remote.track.name, 'fixture-token']) assert.ok(!logs[0]!.includes(secret));
});

test('WebSocket reconnection authenticates again, forwards only event identifiers and never sends audio commands', async t => {
  const remote = await startMusicAssistantFixture(); t.after(remote.close);
  const events = new MusicAssistantEvents(remote.origin, 'fixture-token'); t.after(() => events.close());
  const hints: { connected: boolean; objectId?: string }[] = [];
  const unsubscribe = events.subscribe(event => hints.push(event));
  const wait = async (check: () => boolean) => { for (let i = 0; i < 300 && !check(); i++) await delay(10); assert.ok(check()); };
  await wait(() => hints.some(h => h.connected));
  remote.notify(); await wait(() => hints.some(h => h.objectId === remote.queue.queue_id));
  assert.ok(!JSON.stringify(hints).includes('data'));
  remote.disconnectEvents(); await wait(() => remote.websocketCommands.length === 2);
  assert.deepEqual(remote.websocketCommands, ['auth', 'auth']); assert.equal(remote.calls.length, 0);
  unsubscribe(); await wait(() => remote.eventClients === 0);
});
