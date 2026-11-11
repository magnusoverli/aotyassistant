import { test } from 'node:test';
import assert from 'node:assert/strict';
import { frequencyBins, SpectrumAnalyser } from '../src/spectrum-analysis.js';
import { SpectrumBuffer, spectrumBins, type SpectrumPacket } from '../src/spectrum.js';
import { SpectrumClock } from '../web/spectrum-clock.js';

const tone = (hz: number, length = 2048, start = 0, amplitude = .8) => Float32Array.from({ length }, (_, i) => amplitude * Math.sin(2 * Math.PI * hz * (i + start) / 48000));

test('real frequency analysis distinguishes bass and treble, silence and anti-phase stereo', () => {
  const bass = frequencyBins([tone(100)], 48000); const treble = frequencyBins([tone(6000)], 48000);
  const peak = (bins: number[]) => bins.indexOf(Math.max(...bins));
  assert.ok(peak(bass) < 6); assert.ok(peak(treble) > 16);
  assert.deepEqual(frequencyBins([new Float32Array(2048)], 48000), Array(spectrumBins).fill(0));
  const mono = tone(1000); const opposite = mono.map(sample => -sample);
  assert.deepEqual(frequencyBins([mono, opposite], 48000), frequencyBins([mono], 48000));
  assert.ok(Math.max(...frequencyBins([tone(1000, 2048, 0, .08)], 48000)) < Math.max(...frequencyBins([mono], 48000)));
});

test('spectrum timestamps follow sample positions across arbitrary packet boundaries and reset on seek', () => {
  const frames: { at: number; bins: number[] }[] = [];
  const analyser = new SpectrumAnalyser((at, bins) => frames.push({ at, bins }));
  let start = 0;
  for (const length of [997, 3001, 101, 4801, 1100]) {
    analyser.push({ samples: [tone(1000, length, start)], sampleRate: 48000, serverTimeUs: 1e6 + start / 48000 * 1e6, generation: 1 }); start += length;
  }
  assert.equal(frames.length, 5);
  assert.ok(Math.abs(frames[0]!.at - (1e6 + 1023.5 / 48000 * 1e6)) < .01);
  for (let i = 1; i < frames.length; i++) assert.ok(Math.abs(frames[i]!.at - frames[i - 1]!.at - 1e6 / 30) < .01);
  analyser.clear(); frames.length = 0;
  analyser.push({ samples: [new Float32Array(2048)], sampleRate: 48000, serverTimeUs: 10e6, generation: 2 });
  assert.equal(frames.length, 1); assert.ok(frames[0]!.at > 10e6); assert.deepEqual(frames[0]!.bins, Array(spectrumBins).fill(0));
});

test('stream-ahead buffer is bounded, preserves delayed frames and discards out-of-order timestamps', () => {
  const buffer = new SpectrumBuffer(); const bins = Array(spectrumBins).fill(100);
  for (let at = 1000; at < 45000; at += 1000 / 30) buffer.push({ at, bins }, 1000);
  const visible = buffer.window(2000, 0);
  assert.ok(visible.length > 30 && visible.length < 45);
  assert.ok(visible.every(frame => frame.at >= 1850 && frame.at <= 3200));
  const delayed = buffer.window(6000, 5000);
  assert.ok(delayed.some(frame => frame.at === 6000));
  buffer.push({ at: 2000, bins: Array(spectrumBins).fill(255) }, 2000);
  assert.ok(buffer.window(2000, 0).every(frame => frame.bins[0] === 100));
  buffer.clear(); assert.deepEqual(buffer.window(2000, 0), []);
});

test('browser schedules ahead-of-time frames using clock probes, not network arrival, and rejects stale/wrong-room data', () => {
  const clock = new SpectrumClock();
  clock.synchronize(100, 120, 1110); // Server clock is 1000ms ahead.
  clock.synchronize(120, 420, 1300); // A slower, asymmetric observation must not win.
  const packet: SpectrumPacket = { epoch: 'stream-1', roomId: 'room', participantId: 'person', active: true,
    frames: [{ at: 1500, bins: Array(spectrumBins).fill(0) }, { at: 1600, bins: Array(spectrumBins).fill(255) }] };
  clock.accept(packet, 200);
  assert.equal(clock.sample(400, 'room', 'person'), undefined, 'Never show a future frame early.');
  assert.deepEqual(clock.sample(550, 'room', 'person'), Array(spectrumBins).fill(.5));
  assert.equal(clock.sample(550, 'other-room', 'person'), undefined);
  assert.equal(clock.sample(550, 'room', 'other-person'), undefined);
  assert.equal(clock.sample(800, 'room', 'person'), undefined, 'Expired audio cannot hold a frozen spectrum.');
  clock.accept({ ...packet, epoch: 'seek', frames: [] }, 550);
  assert.equal(clock.sample(550, 'room', 'person'), undefined);
  clock.reset(); clock.accept(packet, 200);
  assert.equal(clock.sample(550, 'room', 'person'), undefined, 'Reconnections need a new clock mapping.');
});
