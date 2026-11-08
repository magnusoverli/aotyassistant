import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import { createServer, request as httpRequest, type IncomingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';
import { gunzipSync } from 'node:zlib';
import express, { type NextFunction, type Request, type Response } from 'express';
import { byteRange, compressJson, sendArtwork } from '../src/http-utils.js';
import { EventStreams } from '../src/event-streams.js';
import { AppError } from '../src/model.js';

async function serve(t: TestContext, app: express.Express) {
  const server = createServer(app); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}
// Raw HTTP: fetch would add its own Accept-Encoding and conditional headers.
const get = (url: string, headers: Record<string, string> = {}) => new Promise<{ status: number; headers: IncomingHttpHeaders; body: Buffer }>((resolve, reject) => {
  httpRequest(url, { headers }, res => {
    const chunks: Buffer[] = []; res.on('data', chunk => chunks.push(chunk));
    res.on('end', () => resolve({ status: res.statusCode!, headers: res.headers, body: Buffer.concat(chunks) })); res.on('error', reject);
  }).on('error', reject).end();
});

test('artwork revalidation answers a matching tag without reading the image, after access checks', async t => {
  let reads = 0; let allowed = true; const app = express();
  app.get('/image/:key', async (req, res) => {
    await sendArtwork(req, res, req.params.key, async () => { reads++; return { body: Buffer.from([0xff, 0xd8, 0xff]), contentType: 'image/jpeg' }; },
      () => { if (!allowed) throw new AppError(403, 'Artwork access expired.'); });
  });
  app.use((error: AppError, _req: Request, res: Response, _next: NextFunction) => { res.status(error.status).end(); });
  const origin = await serve(t, app);
  const first = await get(`${origin}/image/a`); const tag = first.headers.etag!;
  assert.equal(first.status, 200); assert.equal(reads, 1); assert.match(tag, /^W\/"[\w-]{27}"$/);
  assert.equal(first.headers['cache-control'], 'private, no-cache'); assert.match(first.headers.vary!, /Cookie/);
  assert.equal((await get(`${origin}/image/a`, { 'If-None-Match': tag })).status, 304);
  assert.equal(reads, 1, 'A matching browser copy needs no image read.');
  assert.equal((await get(`${origin}/image/b`, { 'If-None-Match': tag })).status, 200, 'Other pixels have another tag.');
  allowed = false; assert.equal((await get(`${origin}/image/a`, { 'If-None-Match': tag })).status, 403);
});

test('large JSON is gzipped for clients that accept it; small JSON and other clients get plain JSON', async t => {
  const app = express(); app.use(compressJson);
  const large = { items: Array.from({ length: 200 }, (_, index) => ({ id: index, name: `Album ${index}` })) };
  app.get('/large', (_req, res) => { res.json(large); }); app.get('/small', (_req, res) => { res.json({ ok: true }); });
  const origin = await serve(t, app);
  const zipped = await get(`${origin}/large`, { 'Accept-Encoding': 'gzip, deflate, br' });
  assert.equal(zipped.headers['content-encoding'], 'gzip'); assert.match(zipped.headers.vary!, /Accept-Encoding/);
  assert.match(zipped.headers['content-type']!, /^application\/json/); assert.ok(zipped.body.length < JSON.stringify(large).length / 3);
  assert.deepEqual(JSON.parse(gunzipSync(zipped.body).toString()), large);
  const plain = await get(`${origin}/large`); assert.equal(plain.headers['content-encoding'], undefined);
  assert.deepEqual(JSON.parse(plain.body.toString()), large);
  assert.equal((await get(`${origin}/large`, { 'Accept-Encoding': 'identity' })).headers['content-encoding'], undefined);
  assert.equal((await get(`${origin}/small`, { 'Accept-Encoding': 'gzip' })).headers['content-encoding'], undefined);
});

test('single byte ranges reject overflowing numbers before suffix clamping and retain exact bounds', () => {
  assert.deepEqual(byteRange(undefined, 10), { start: 0, end: 9, status: 200 });
  assert.deepEqual(byteRange('bytes=3-', 10), { start: 3, end: 9, status: 206 });
  assert.deepEqual(byteRange('bytes=-3', 10), { start: 7, end: 9, status: 206 });
  assert.deepEqual(byteRange('bytes=-20', 10), { start: 0, end: 9, status: 206 });
  assert.deepEqual(byteRange('bytes=0-20', 10), { start: 0, end: 9, status: 206 });
  for (const value of ['bytes=-9007199254740992', `bytes=-${'9'.repeat(400)}`, 'bytes=0-9007199254740992', 'bytes=-0', 'bytes=10-', 'bytes=3-2', 'bytes=0-1,3-4', 'bytes=-', '']) {
    assert.equal(byteRange(value, 10), null, value);
  }
});

class SocketResponse extends EventEmitter {
  destroyed = false;
  writableEnded = false;
  frames: string[] = [];
  writable = true;
  set() { return this; }
  flushHeaders() {}
  write(frame: string) { this.frames.push(frame); return this.writable; }
  end() { this.writableEnded = true; this.emit('close'); }
  destroy() { this.destroyed = true; this.emit('close'); }
  get response() { return this as unknown as Response; }
}

test('stream reservations bound pending authorization and dispose subscriptions even when attached after disconnect', () => {
  const streams = new EventStreams(1, 'Full'); const response = new SocketResponse();
  const stream = streams.reserve(response.response);
  assert.throws(() => streams.reserve(new SocketResponse().response), /Full/);
  assert.deepEqual(response.frames, [], 'Reserving is not authorization to send private data.');
  response.destroy(); let disposed = 0; stream.onClose(() => disposed++);
  assert.equal(disposed, 1); assert.equal(stream.open(), false);
  const next = streams.reserve(new SocketResponse().response); streams.close(); assert.equal(next.closed, true);
  assert.throws(() => streams.reserve(new SocketResponse().response), /Full/);
});

test('large snapshots wait for drain, coalesce updates and revoke without sending queued private data', () => {
  const streams = new EventStreams(1, 'Full'); const response = new SocketResponse(); const stream = streams.reserve(response.response);
  stream.open(); response.writable = false;
  stream.send('state', { revision: 1 }); stream.send('state', { revision: 2 }); stream.send('state', { revision: 3 });
  assert.equal(response.writableEnded, false); assert.equal(response.frames.length, 1);
  response.writable = true; response.emit('drain');
  assert.equal(response.frames.length, 2); assert.match(response.frames[1]!, /"revision":3/);
  response.writable = false; stream.send('state', { revision: 4 }); stream.send('state', { private: 'unsent' });
  stream.send('revoked', {}); response.emit('drain');
  assert.equal(response.writableEnded, true); assert.equal(response.frames.length, 4);
  assert.ok(!response.frames.join('').includes('unsent')); assert.match(response.frames.at(-1)!, /event: revoked/);
  streams.close();
});

test('multiplexed feeds coalesce independently and private revocation removes queued list content', () => {
  const streams = new EventStreams(1, 'Full'); const response = new SocketResponse(); const stream = streams.reserve(response.response);
  stream.open(); response.writable = false;
  stream.send('state', { revision: 0 }); stream.send('preparation', { revision: 1 }); stream.send('state', { revision: 2 });
  response.writable = true; response.emit('drain');
  assert.equal(response.frames.length, 3); assert.match(response.frames[1]!, /event: preparation/); assert.match(response.frames[2]!, /"revision":2/);
  response.writable = false;
  stream.send('state', { revision: 3 }); stream.send('preparation', { private: 'never-send' }); stream.send('preparation-revoked', {});
  response.writable = true; response.emit('drain'); stream.heartbeat();
  assert.ok(!response.frames.join('').includes('never-send')); assert.equal(response.writableEnded, false);
  assert.match(response.frames.at(-2)!, /preparation-revoked/); assert.equal(response.frames.at(-1), ': heartbeat\n\n'); streams.close();
});
