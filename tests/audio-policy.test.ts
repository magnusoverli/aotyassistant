import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AudioPolicy, browserCodecs, onlineAudio } from '../web/audio-policy.js';
import { probeFrame, probeCodec } from '../web/audio-probe.js';

test('codec preference preserves browser-specific exclusions and a PCM fallback', () => {
  assert.deepEqual(browserCodecs('Mozilla Chrome/130 Safari/537', true), ['opus', 'flac', 'pcm']);
  assert.deepEqual(browserCodecs('Mozilla Chrome/130 Safari/537', false), ['flac', 'pcm']);
  assert.deepEqual(browserCodecs('Mozilla Firefox/130', true), ['flac', 'pcm']);
  assert.deepEqual(browserCodecs('Mozilla iPhone Version/18 Safari/604', false), ['opus', 'pcm']);
  assert.deepEqual(browserCodecs('Mozilla iPhone CriOS/130 Mobile Safari/604', true), ['opus', 'pcm']);
  assert.deepEqual(browserCodecs('Mozilla iPad FxiOS/130 Mobile Safari/604', true), ['opus', 'pcm']);
});

test('codec recovery requires received undecodable audio, not silence or network starvation', () => {
  let recoveries = 0; const policy = new AudioPolicy(() => recoveries++, () => {});
  policy.check(100_000); assert.equal(recoveries, 0);
  for (let n = 0; n < 10; n++) { policy.received(n, 1, n); policy.decoded(n, 1, n + 1, undefined); }
  policy.check(200_000); assert.equal(recoveries, 0, 'Suspended audio output still decodes normally.');
  policy.received(11, 1, 210_000); policy.received(12, 1, 210_000); policy.received(13, 1, 210_000);
  policy.check(212_499); assert.equal(recoveries, 0);
  policy.check(212_500); assert.equal(recoveries, 1); assert.equal(policy.health.decodeFailures, 3);
  policy.check(300_000); assert.equal(recoveries, 1, 'No repeated recoveries without new incoming audio.');
});

test('seek, stop and replaced streams discard old decoder work and stale completions', () => {
  let recoveries = 0; const policy = new AudioPolicy(() => recoveries++, () => {});
  for (let n = 0; n < 5; n++) policy.received(n, 1, 0);
  policy.reset(2); policy.decoded(0, 1, 1000, false); policy.check(5000);
  assert.equal(recoveries, 0); assert.equal(policy.health.decodedChunks, 0);
  policy.received(7, 2, 5000); policy.decoded(7, 2, 5010, false);
  assert.equal(policy.health.decodedChunks, 1);
});

test('buffer changes are bounded, gradual, and require sustained late decoded audio', () => {
  const buffers: number[] = []; const policy = new AudioPolicy(() => assert.fail('Do not change codec for late audio'), ms => buffers.push(ms));
  let timestamp = 0;
  for (let time = 10_000; time <= 100_000; time += 10_000) {
    for (let n = 0; n < 5; n++) { timestamp++; policy.received(timestamp, 1, time); policy.decoded(timestamp, 1, time, true); }
  }
  assert.deepEqual(buffers, [750, 1000, 1250, 1500, 1750, 2000]);
  policy.received(++timestamp, 1, 160_000); policy.decoded(timestamp, 1, 160_000, false);
  assert.equal(policy.health.minBufferMs, 1750);
  for (let n = 0; n < 100; n++) { policy.received(++timestamp, 1, 160_100); policy.decoded(timestamp, 1, 160_100, false); }
  assert.equal(policy.health.minBufferMs, 1750, 'Recovery is not per-frame buffer oscillation.');
});

test('online buffering starts higher and may grow further, but never drops below its own floor', () => {
  const buffers: number[] = []; const policy = new AudioPolicy(() => assert.fail('Do not change codec for late audio'), ms => buffers.push(ms), onlineAudio);
  assert.equal(policy.health.minBufferMs, 1500); let timestamp = 0;
  for (let time = 10_000; time <= 200_000; time += 10_000) {
    for (let n = 0; n < 5; n++) { timestamp++; policy.received(timestamp, 1, time); policy.decoded(timestamp, 1, time, true); }
  }
  assert.equal(buffers.at(-1), 4000); assert.equal(Math.max(...buffers), 4000);
  for (let time = 300_000; time <= 2_000_000; time += 60_000) { policy.received(++timestamp, 1, time); policy.decoded(timestamp, 1, time, false); }
  assert.equal(policy.health.minBufferMs, 1500);
});

test('bundled Opus probe actually decodes using the shipping software decoder', async () => {
  assert.equal(await probeCodec('opus', 'software'), true);
});

test('generated FLAC probe carries its declared rate and bounded full frame', () => {
  for (const rate of [44100, 48000]) {
    const { format, data } = probeFrame('flac', rate);
    const header = Buffer.from(format.codec_header!, 'base64');
    assert.equal(header.subarray(0, 4).toString(), 'fLaC');
    assert.equal(Number(header.readBigUInt64BE(18) >> 44n), rate);
    assert.equal(data.byteLength, 28);
  }
});
