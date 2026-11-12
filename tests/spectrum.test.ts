import { test } from 'node:test';
import assert from 'node:assert/strict';
import { frequencyBins, SpectrumAnalyser } from '../src/spectrum-analysis.js';
import { SpectrumBuffer, spectrumBins, type SpectrumPacket } from '../src/spectrum.js';
import { SpectrumClock } from '../web/spectrum-clock.js';
import { spectrumBandHue, spectrumBandPosition, spectrumNeedleLevel } from '../web/spectrum-presentation.js';

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

// The low edge is limited by FFT resolution (about 22 Hz per bin), so only the upper cutoff is sharp.
test('spectrum includes 70 Hz bass and upper treble through 16 kHz while excluding a 17 kHz tone', () => {
  for (const rate of [44100, 48000]) {
    const sine = (hz: number) => Float32Array.from({ length: 2048 }, (_, i) => .8 * Math.sin(2 * Math.PI * hz * i / rate));
    const bass = frequencyBins([sine(75)], rate);
    assert.equal(bass.indexOf(Math.max(...bass)), 0);
    const treble = frequencyBins([sine(15500)], rate);
    assert.equal(treble.indexOf(Math.max(...treble)), spectrumBins - 1);
    assert.ok(Math.max(...bass) > 200 && Math.max(...treble) > 200);
    assert.deepEqual(frequencyBins([sine(17000)], rate), Array(spectrumBins).fill(0), `${rate} Hz: 17 kHz is excluded.`);
  }
});

test('equal-amplitude tones read equally across frequency on an unscaled 65 dB range', () => {
  // Exact FFT-bin tones avoid differences due to spectral leakage.
  const peak = (hz: number, amplitude: number) => Math.max(...frequencyBins([tone(hz, 2048, 0, amplitude)], 48000));
  const middle = peak(937.5, .03); const high = peak(12000, .03);
  assert.ok(Math.abs(high - middle) <= 1, 'No treble lift is applied.');
  // A 0.03 amplitude tone sits at about -30.5 dB, i.e. 53% of the 65 dB range. Screens apply sensitivity.
  assert.ok(Math.abs(middle - (20 * Math.log10(.03) + 65) / 65 * 255) <= 1, 'Analysis does not apply sensitivity.');
  assert.equal(peak(12000, .0001), 0, 'Input below the noise floor remains invisible.');
});

test('bass starts at the lower-left and treble meets at the upper-right on both perimeter paths', () => {
  for (const [width, height, radius] of [[144, 64, 9.5], [90, 40, 5.5], [216, 88, 9.5]]) {
    const horizontal = width! - 1 - 2 * radius!; const vertical = height! - 1 - 2 * radius!;
    const perimeter = 2 * (horizontal + vertical) + 2 * Math.PI * radius!;
    const treble = horizontal + Math.PI * radius! / 4;
    const bass = treble + perimeter / 2;
    assert.ok(Math.abs(spectrumBandPosition(bass, perimeter, treble)) < 1e-12);
    assert.equal(spectrumBandPosition(treble, perimeter, treble), 1);
    for (let step = 0; step <= 24; step++) {
      const offset = perimeter / 2 * step / 24;
      for (const direction of [-1, 1]) {
        const position = spectrumBandPosition(bass + direction * offset, perimeter, treble);
        assert.ok(Math.abs(position - step / 24) < 1e-12);
        assert.ok(Math.abs(spectrumBandHue(position) - spectrumBandHue(step / 24)) < 1e-9);
      }
    }
  }
  const silent = spectrumNeedleLevel(0, 0); const quiet = spectrumNeedleLevel(.35, 0); const loud = spectrumNeedleLevel(1, 0);
  assert.ok(silent.opacity === 0 && silent.scale < .05);
  assert.ok(silent.opacity < quiet.opacity); assert.equal(quiet.opacity, loud.opacity);
  assert.ok(silent.scale < quiet.scale && quiet.scale < loud.scale);
  assert.equal(loud.scale, 1);
});

test('frequency colours interpolate from purple through blue and cyan to green without wrapping', () => {
  for (const [position, hue] of [[0, 270], [.2, 240], [.5, 195], [.6, 180], [1, 120]]) {
    assert.equal(spectrumBandHue(position!), hue);
  }
  assert.equal(spectrumBandHue(-1), 270, 'Positions below bass clamp to purple.');
  assert.equal(spectrumBandHue(2), 120, 'Positions above treble clamp to green.');
});

test('weak treble survives the full analysis-to-needle path while bass and silence retain their response', () => {
  const bass = frequencyBins([tone(93.75, 2048, 0, .03)], 48000);
  const treble = frequencyBins([tone(12000, 2048, 0, .003)], 48000);
  const appearance = (bins: number[]) => {
    const peak = bins.indexOf(Math.max(...bins));
    return spectrumNeedleLevel(bins[peak]! / 255, peak / (spectrumBins - 1));
  };
  const highLevel = Math.max(...treble) / 255;
  const previous = spectrumNeedleLevel(highLevel, 0);
  const high = appearance(treble);
  assert.ok(high.scale > previous.scale * 1.5, 'Quiet treble should be visibly longer than in 2.0.24.');
  assert.equal(high.opacity, previous.opacity, 'Brightness depends on input amplitude, not frequency.');
  assert.ok(high.scale < appearance(bass).scale, 'A much quieter treble tone still reflects its lower energy.');
  const belowFloor = frequencyBins([tone(12000, 2048, 0, .0001)], 48000);
  for (const position of [0, .25, .5, .75, 1]) {
    assert.deepEqual(spectrumNeedleLevel(0, position), spectrumNeedleLevel(0, 0));
    assert.deepEqual(spectrumNeedleLevel(1, position), spectrumNeedleLevel(1, 0));
    assert.deepEqual(spectrumNeedleLevel(Math.max(...belowFloor) / 255, position), spectrumNeedleLevel(0, 0));
  }
  // Position .45 is just below 1 kHz in the 70 Hz to 16 kHz range.
  assert.deepEqual(spectrumNeedleLevel(.2, .45), spectrumNeedleLevel(.2, 0), 'Bass and lower mids retain their response.');
});

test('needle opacity rises from 0% to 5% by 10% input, then to 90% by 35% input across all frequencies', () => {
  for (const position of [0, .25, .5, .75, 1]) {
    for (const [input, opacity] of [[-1, 0], [0, 0], [.05, .025], [.1, .05], [.225, .475], [.35, .9], [.5, .9], [1, .9], [2, .9]]) {
      assert.ok(Math.abs(spectrumNeedleLevel(input!, position).opacity - opacity!) < 1e-12);
    }
    assert.ok(spectrumNeedleLevel(.35, position).scale < spectrumNeedleLevel(1, position).scale,
      'Length continues responding above the brightness plateau.');
  }
});

test('spectrum timestamps follow sample positions across arbitrary packet boundaries and reset on seek', () => {
  const frames: { at: number; bins: number[] }[] = [];
  const analyser = new SpectrumAnalyser((at, bins) => frames.push({ at, bins }));
  let start = 0;
  for (const length of [997, 3001, 101, 4801, 1100]) {
    analyser.push({ samples: [tone(1000, length, start)], sampleRate: 48000, serverTimeUs: 1e6 + start / 48000 * 1e6, generation: 1 }); start += length;
  }
  assert.equal(frames.length, 10);
  assert.ok(Math.abs(frames[0]!.at - (1e6 + 1023.5 / 48000 * 1e6)) < .01);
  for (let i = 1; i < frames.length; i++) assert.ok(Math.abs(frames[i]!.at - frames[i - 1]!.at - 1e6 / 60) < .01);
  analyser.clear(); frames.length = 0;
  analyser.push({ samples: [new Float32Array(2048)], sampleRate: 48000, serverTimeUs: 10e6, generation: 2 });
  assert.equal(frames.length, 1); assert.ok(frames[0]!.at > 10e6); assert.deepEqual(frames[0]!.bins, Array(spectrumBins).fill(0));
});

test('44.1 kHz audio also produces exactly 60 spectrum frames per second after the first window', () => {
  const timestamps: number[] = [];
  const analyser = new SpectrumAnalyser(at => timestamps.push(at));
  analyser.push({ samples: [new Float32Array(2048 + 44100)], sampleRate: 44100, serverTimeUs: 1e6, generation: 1 });
  assert.equal(timestamps.length, 61);
  assert.ok(Math.abs(timestamps.at(-1)! - timestamps[0]! - 1e6) < .01);
  for (let i = 1; i < timestamps.length; i++) assert.ok(Math.abs(timestamps[i]! - timestamps[i - 1]! - 1e6 / 60) < .01);
});

test('stream-ahead buffer is bounded, preserves delayed frames and discards out-of-order timestamps', () => {
  const buffer = new SpectrumBuffer(); const bins = Array(spectrumBins).fill(100);
  for (let at = 1000; at < 45000; at += 1000 / 60) buffer.push({ at, bins }, 1000);
  const visible = buffer.window(2000, 0);
  assert.ok(visible.length > 75 && visible.length < 85);
  assert.ok(visible.every(frame => frame.at >= 1850 && frame.at <= 3200));
  const clock = new SpectrumClock(); clock.synchronize(1990, 2010, 2000);
  clock.accept({ epoch: '60fps', roomId: 'room', participantId: 'person', active: true, sensitivity: 1, frames: visible }, 2000);
  assert.ok(clock.sample(2000, 'room', 'person'), 'The browser accepts the larger 60 fps frame batch.');
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
  const packet: SpectrumPacket = { epoch: 'stream-1', roomId: 'room', participantId: 'person', active: true, sensitivity: 1,
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

test('screens apply the packet sensitivity linearly on the next packet, clamp at full scale and reject invalid values', () => {
  const clock = new SpectrumClock(); clock.synchronize(100, 120, 110);
  const frame = (at: number) => ({ at, bins: Array.from({ length: spectrumBins }, (_, i) => i < 12 ? 102 : 204) });
  const packet: SpectrumPacket = { epoch: 'stream', roomId: 'room', participantId: 'person', active: true, sensitivity: .9, frames: [frame(500), frame(600)] };
  const level = (sensitivity: number) => { clock.accept({ ...packet, sensitivity }, 500); return clock.sample(500, 'room', 'person')!; };
  const reduced = level(.9);
  assert.ok(Math.abs(reduced[0]! - .4 * .9) < 1e-12 && Math.abs(reduced[23]! - .8 * .9) < 1e-12);
  const boosted = level(1.5);
  assert.ok(Math.abs(boosted[0]! - .6) < 1e-12); assert.equal(boosted[23], 1, 'Levels never exceed full scale.');
  for (const sensitivity of [.4, 1.6, NaN, undefined]) {
    clock.accept({ ...packet, sensitivity } as unknown as SpectrumPacket, 500);
    assert.equal(clock.sample(500, 'room', 'person'), undefined, `Sensitivity ${sensitivity} is rejected.`);
  }
});
