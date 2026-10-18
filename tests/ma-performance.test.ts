import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { MusicAssistantTransport } from '../src/music-assistant-transport.js';
import { MusicAssistantClient } from '../src/music-assistant.js';
import { maOperation } from '../src/ma-operation.js';
import { startMusicAssistantFixture } from './fixtures/music-assistant.js';
import { MusicAssistantEvents } from '../src/music-assistant-events.js';

test('HTTP connections are reused per lane, with independent capacity for controls and explicit disposal', async t => {
  const remote = await startMusicAssistantFixture(); t.after(remote.close);
  const transport = new MusicAssistantTransport(remote.origin, 'fixture-token'); t.after(() => transport.close());
  await transport.read('/info'); await transport.read('/api', 'players/all'); await transport.read('/info');
  assert.equal(remote.connections, 1);
  await transport.read('/api', 'music/search', { search_query: 'fixture', media_types: ['track'] });
  assert.equal(remote.connections, 2, 'Catalogue requests have their own pool.');
  remote.delayImages(300);
  const artwork = Promise.all(Array.from({ length: 8 }, () => transport.read(`/imageproxy/${'a'.repeat(64)}`, undefined, {}, true)));
  await maOperation('control-capacity', () => transport.read('/api', 'players/all'), 200);
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
  const reading = maOperation('browse', () => transport.read('/api', 'music/search', {}), 12_000, controller.signal);
  const rejected = assert.rejects(reading); await waiting; controller.abort(); await rejected; await closed;
  assert.equal(requests, 1);
});

test('opt-in timings correlate commands and include no token, URI, arguments or response data', async t => {
  const remote = await startMusicAssistantFixture(); t.after(remote.close);
  const transport = new MusicAssistantTransport(remote.origin, 'fixture-token'); t.after(() => transport.close());
  const logs: string[] = []; t.mock.method(console, 'info', (value: string) => logs.push(value));
  const previous = process.env.AOTY_MA_TIMINGS; process.env.AOTY_MA_TIMINGS = '1';
  t.after(() => { if (previous === undefined) delete process.env.AOTY_MA_TIMINGS; else process.env.AOTY_MA_TIMINGS = previous; });
  await maOperation('play', () => transport.read('/api', 'music/item_by_uri', { uri: remote.track.uri }));
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
