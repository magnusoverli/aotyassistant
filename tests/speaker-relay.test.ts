import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SpeakerRelay, type RelaySocket } from '../src/speaker-relay.js';

function fixture() {
  let now = 0; let valid = true; let failures = 0;
  const writes: { data: unknown; binary: boolean; complete: (error?: Error) => void }[] = [];
  const source = { pauses: 0, resumes: 0, pause() { this.pauses++; }, resume() { this.resumes++; } };
  const target = { readyState: 1, bufferedAmount: 0,
    send(data: unknown, options: { binary: boolean }, complete: (error?: Error) => void) { writes.push({ data, binary: options.binary, complete }); } };
  const relay = new SpeakerRelay(source as unknown as RelaySocket, target as unknown as RelaySocket,
    () => { failures++; relay.close(); }, () => valid, () => now);
  return { source, target, writes, relay, failures: () => failures, time: (value: number) => { now = value; }, revoke: () => { valid = false; } };
}

test('relay absorbs stream-ahead bursts above the old 4MiB limit and preserves exact frame order', () => {
  const f = fixture(); const frames = Array.from({ length: 6 }, (_, index) => Buffer.alloc(1024 * 1024, index));
  for (const frame of frames) f.relay.forward(frame, true);
  f.relay.forward(Buffer.from('control'), false);
  assert.equal(f.source.pauses, 1); assert.equal(f.failures(), 0); assert.equal(f.writes.length, 1);
  for (let index = 0; index < frames.length; index++) {
    assert.equal(f.writes[index]!.data, frames[index]); assert.equal(f.writes[index]!.binary, true); f.writes[index]!.complete();
  }
  assert.equal(f.writes[6]!.binary, false); f.writes[6]!.complete();
  assert.equal(f.source.resumes, 1); assert.equal(f.relay.bytes, 6 * 1024 * 1024 + 7);
  assert.equal(f.relay.heartbeatDeferred, true); f.time(20_001); assert.equal(f.relay.heartbeatDeferred, false);
});

test('stalled relay closes on deadline, even when the source cannot read pongs', () => {
  const f = fixture(); f.relay.forward(Buffer.alloc(1024 * 1024), true);
  f.time(14_999); f.relay.check(); assert.equal(f.failures(), 0);
  f.time(15_000); f.relay.check(); assert.equal(f.failures(), 1);
  f.writes[0]!.complete(); assert.equal(f.source.resumes, 0); assert.equal(f.relay.bytes, 0);
});

test('queue remains bounded and revocation prevents queued data from draining', () => {
  const f = fixture();
  for (let n = 0; n < 9; n++) f.relay.forward(Buffer.alloc(1024 * 1024), true);
  assert.equal(f.failures(), 1); assert.equal(f.writes.length, 1);
  const revoked = fixture(); revoked.relay.forward(Buffer.from('first'), true); revoked.relay.forward(Buffer.from('second'), true);
  revoked.revoke(); revoked.writes[0]!.complete();
  assert.equal(revoked.failures(), 1); assert.equal(revoked.writes.length, 1);
});

test('send errors and closed targets stop both relay directions through their owner', () => {
  const f = fixture(); f.relay.forward(Buffer.from('one'), true); f.writes[0]!.complete(new Error('network'));
  assert.equal(f.failures(), 1);
  const closed = fixture(); closed.target.readyState = 3; closed.relay.forward(Buffer.from('two'), true);
  assert.equal(closed.failures(), 1); assert.equal(closed.writes.length, 0);
});

test('transfer rates exclude startup from steady windows, age idle traffic out, and ignore failed writes', () => {
  const f = fixture();
  assert.equal(f.relay.rates().steadyKbps, null);
  const send = (bytes: number) => { f.relay.forward(Buffer.alloc(bytes), true); f.writes.at(-1)!.complete(); };
  send(1_000_000);
  for (let second = 1; second <= 90; second++) {
    f.time(second * 1000); send(16_000);
    if (second === 29) assert.equal(f.relay.rates().phase, 'startup');
    if (second === 30) { assert.equal(f.relay.rates().phase, 'settling'); assert.equal(f.relay.rates().steadyKbps, null); }
    if (second === 60) { assert.equal(f.relay.rates().phase, 'steady'); assert.equal(f.relay.rates().steadyKbps, 128); }
  }
  const rates = f.relay.rates();
  assert.equal(rates.startupBytes, 1_000_000 + 29 * 16_000); assert.equal(rates.steadyKbps, 128);
  for (let second = 91; second <= 121; second++) { f.time(second * 1000); f.relay.check(); }
  assert.equal(f.relay.rates().recentKbps, 0);
  f.relay.forward(Buffer.alloc(1000), true); f.writes.at(-1)!.complete(new Error('failed'));
  const closed = f.relay.rates(); assert.equal(closed.phase, 'closed'); assert.equal(closed.steadyKbps, null);
  f.time(1_000_000); assert.deepEqual(f.relay.rates(), closed);
});
