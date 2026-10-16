import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type { Response } from 'express';
import { byteRange } from '../src/http-utils.js';
import { EventStreams } from '../src/event-streams.js';

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
