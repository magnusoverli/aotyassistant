import { spectrumBins, spectrumRate } from './spectrum.js';

const size = 2048;
const window = Float64Array.from({ length: size }, (_, i) => .5 - .5 * Math.cos(2 * Math.PI * i / (size - 1)));

/** Hann-windowed radix-2 FFT; channel powers are combined so anti-phase stereo survives. */
export function frequencyBins(channels: Float32Array[], sampleRate: number): number[] {
  const power = new Float64Array(size / 2);
  for (const samples of channels) {
    const re = new Float64Array(size); const im = new Float64Array(size);
    for (let i = 0, j = 0; i < size; i++) {
      re[j] = (samples[i] ?? 0) * window[i]!;
      let bit = size >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
    }
    for (let width = 2; width <= size; width <<= 1) {
      const angle = -2 * Math.PI / width; const c = Math.cos(angle); const s = Math.sin(angle);
      for (let start = 0; start < size; start += width) {
        let wr = 1; let wi = 0;
        for (let j = 0; j < width / 2; j++) {
          const a = start + j; const b = a + width / 2;
          const tr = wr * re[b]! - wi * im[b]!; const ti = wr * im[b]! + wi * re[b]!;
          re[b] = re[a]! - tr; im[b] = im[a]! - ti; re[a] = re[a]! + tr; im[a] = im[a]! + ti;
          const next = wr * c - wi * s; wi = wr * s + wi * c; wr = next;
        }
      }
    }
    for (let i = 1; i < power.length; i++) power[i] = power[i]! + (re[i]! ** 2 + im[i]! ** 2) / channels.length;
  }
  const minHz = 30; const maxHz = Math.min(13000, sampleRate / 2);
  return Array.from({ length: spectrumBins }, (_, band) => {
    const low = Math.max(1, Math.floor(minHz * (maxHz / minHz) ** (band / spectrumBins) * size / sampleRate));
    const high = Math.min(power.length, Math.max(low + 1, Math.ceil(minHz * (maxHz / minHz) ** ((band + 1) / spectrumBins) * size / sampleRate)));
    let peak = 0;
    for (let bin = low; bin < high; bin++) peak = Math.max(peak, power[bin]!);
    const db = 20 * Math.log10(Math.max(1e-9, Math.sqrt(peak) * 4 / size));
    return Math.round(Math.max(0, Math.min(1, (db + 65) / 65)) * 255);
  });
}

/** Analyse decoded samples ahead of playback; timestamps refer to the window centre. */
export class SpectrumAnalyser {
  private ring: Float32Array[] = [];
  private position = 0;
  private count = 0;
  private untilFrame = size;
  private rate = 0;
  private generation = -1;
  private expectedUs = 0;
  constructor(private emit: (serverTimeUs: number, bins: number[]) => void) {}
  clear() { this.ring = []; this.position = this.count = 0; this.untilFrame = size; this.expectedUs = 0; }
  push(chunk: { samples: Float32Array[]; sampleRate: number; serverTimeUs: number; generation: number }) {
    const { samples, sampleRate, serverTimeUs, generation } = chunk;
    const length = samples[0]?.length ?? 0;
    if (!length || ![44100, 48000].includes(sampleRate) || samples.length > 2 || samples.some(channel => channel.length !== length)) return;
    if (generation !== this.generation || sampleRate !== this.rate || samples.length !== this.ring.length || Math.abs(serverTimeUs - this.expectedUs) > 2000) {
      this.clear(); this.ring = samples.map(() => new Float32Array(size)); this.rate = sampleRate; this.generation = generation;
    }
    this.expectedUs = serverTimeUs + length / sampleRate * 1e6;
    for (let i = 0; i < length; i++) {
      for (let ch = 0; ch < samples.length; ch++) this.ring[ch]![this.position] = samples[ch]![i]!;
      this.position = (this.position + 1) % size; this.count++;
      if (--this.untilFrame > 0 || this.count < size) continue;
      this.untilFrame = Math.round(sampleRate / spectrumRate);
      const ordered = this.ring.map(ring => Float32Array.from({ length: size }, (_, j) => ring[(this.position + j) % size]!));
      this.emit(serverTimeUs + (i - (size - 1) / 2) / sampleRate * 1e6, frequencyBins(ordered, sampleRate));
    }
  }
}
