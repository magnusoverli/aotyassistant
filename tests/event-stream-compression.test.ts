import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer, get } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Writable } from 'node:stream';
import { createGunzip, gunzipSync } from 'node:zlib';
import express, { type Response } from 'express';
import { EventStreams } from '../src/event-streams.js';

test('gzip events and heartbeats arrive before another send or stream end, in exact order', { timeout: 5000 }, async t => {
  const streams = new EventStreams(1, 'Full'); const app = express();
  let stream!: ReturnType<EventStreams['reserve']>;
  app.get('/', (_req, res) => { stream = streams.reserve(res); stream.open(); stream.send('state', { text: 'héllo', revision: 1 }); });
  const server = createServer(app); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { streams.close(); server.closeAllConnections(); server.close(); });
  const request = get(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, { headers: { 'Accept-Encoding': 'gzip' } });
  t.after(() => request.destroy());
  const [response] = await once(request, 'response');
  assert.equal(response.headers['content-encoding'], 'gzip'); assert.match(response.headers.vary, /Accept-Encoding/);
  const decoded = response.pipe(createGunzip()); let text = ''; let wire = 0;
  response.on('data', (chunk: Buffer) => { wire += chunk.length; });
  decoded.setEncoding('utf8'); decoded.on('data', (chunk: string) => { text += chunk; });
  const received = async (suffix: string) => { while (!text.endsWith(suffix)) await once(decoded, 'data'); };
  const initial = 'event: state\ndata: {"text":"héllo","revision":1}\n\n';
  await received(initial); assert.equal(response.complete, false);
  stream.heartbeat(); await received(': heartbeat\n\n');
  const list = JSON.stringify({ entries: Array.from({ length: 1000 }, (_, id) => ({ id, title: 'A representative song', artist: 'A representative artist' })) });
  stream.sendEncoded('preparation', list); await received(`event: preparation\ndata: ${list}\n\n`);
  stream.send('revoked', {}); await once(decoded, 'end');
  assert.equal(text, initial + ': heartbeat\n\n' + `event: preparation\ndata: ${list}\n\n` + 'event: revoked\ndata: {}\n\n');
  assert.ok(wire < Buffer.byteLength(text) / 5);
});

test('SSE encoding negotiation respects identity, gzip refusal and accepted wildcards', { timeout: 5000 }, async t => {
  const streams = new EventStreams(1, 'Full'); const app = express();
  app.get('/', (_req, res) => { const stream = streams.reserve(res); stream.open(); stream.send('state', { ok: true }); stream.end(); });
  const server = createServer(app); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { streams.close(); server.closeAllConnections(); server.close(); });
  for (const [accept, compressed] of [[undefined, false], ['identity', false], ['gzip;q=0, *;q=1', false], ['br', false], ['*', true], ['gzip', true]] as const) {
    const request = get(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, { headers: accept ? { 'Accept-Encoding': accept } : {} });
    const [response] = await once(request, 'response'); const chunks: Buffer[] = [];
    for await (const chunk of response) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    assert.equal(response.headers['content-encoding'], compressed ? 'gzip' : undefined, accept ?? 'no Accept-Encoding');
    assert.equal((compressed ? gunzipSync(body) : body).toString(), 'event: state\ndata: {"ok":true}\n\n');
  }
});

class SlowResponse extends Writable {
  req = { acceptsEncodings: () => 'gzip' };
  chunks: Buffer[] = [];
  held?: () => void;
  slow = true;
  constructor() { super({ highWaterMark: 1 }); }
  set() { return this; }
  vary() { return this; }
  flushHeaders() {}
  _write(chunk: Buffer, _encoding: BufferEncoding, callback: () => void) {
    this.chunks.push(Buffer.from(chunk));
    if (this.slow) this.held = callback; else callback();
    this.emit('chunk');
  }
}

test('compressed slow readers coalesce pending events and discard revoked private updates', { timeout: 5000 }, async t => {
  const streams = new EventStreams(1, 'Full'); const response = new SlowResponse(); t.after(() => response.destroy());
  const stream = streams.reserve(response as unknown as Response); stream.open();
  const first = once(response, 'chunk'); stream.send('state', { revision: 1 }); await first;
  assert.equal(response.writableNeedDrain, true);
  stream.send('state', { revision: 2 }); stream.send('state', { revision: 3 });
  stream.send('preparation', { private: 'never-send' }); stream.send('preparation-revoked', {});
  response.slow = false; response.held!();
  // Drain the two retained event types through the real gzip pipe.
  while (!Buffer.concat(response.chunks).length || !gunzipSync(Buffer.concat(response.chunks), { finishFlush: 2 }).toString().includes('preparation-revoked')) await once(response, 'chunk');
  stream.send('revoked', {}); await once(response, 'finish');
  const text = gunzipSync(Buffer.concat(response.chunks)).toString();
  assert.ok(!text.includes('never-send')); assert.ok(!text.includes('"revision":2'));
  assert.equal(text, 'event: state\ndata: {"revision":1}\n\nevent: state\ndata: {"revision":3}\n\nevent: preparation-revoked\ndata: {}\n\nevent: revoked\ndata: {}\n\n');
  const next = streams.reserve(new SlowResponse() as unknown as Response); next.end(); streams.close();
});

test('disconnecting a compressed stream releases its reservation and subscriptions', { timeout: 5000 }, async t => {
  const streams = new EventStreams(1, 'Full'); const response = new SlowResponse(); t.after(() => streams.close());
  const stream = streams.reserve(response as unknown as Response); stream.open(); let disposed = 0; stream.onClose(() => disposed++);
  const closed = once(response, 'close'); response.destroy(); await closed;
  assert.equal(disposed, 1); assert.equal(stream.closed, true);
  const next = new SlowResponse(); streams.reserve(next as unknown as Response); next.destroy();
});
