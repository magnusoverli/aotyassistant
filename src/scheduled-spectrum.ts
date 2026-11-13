import { SpectrumAnalyser } from './spectrum-analysis.js';

type Chunk = Parameters<SpectrumAnalyser['push']>[0];
const maxSamples = 48_000 * 40;
const samplesPerTurn = 4096;

/** Process stream-ahead bursts in small turns, retaining sample timestamps and order. */
export class ScheduledSpectrumAnalyser {
  private analyser: SpectrumAnalyser;
  private pending: (Chunk | null)[] = [];
  private samples = 0;
  private offset = 0;
  private scheduled?: NodeJS.Immediate;
  constructor(emit: (serverTimeUs: number, bins: number[]) => void) { this.analyser = new SpectrumAnalyser(emit); }
  clear() {
    clearImmediate(this.scheduled); this.scheduled = undefined;
    this.pending = []; this.samples = this.offset = 0; this.analyser.clear();
  }
  push(chunk: Chunk) {
    const length = chunk.samples[0]?.length ?? 0;
    if (!length || ![44100, 48000].includes(chunk.sampleRate) || chunk.samples.length > 2 ||
      chunk.samples.some(channel => channel.length !== length) || !Number.isFinite(chunk.serverTimeUs)) return;
    // A stalled consumer never accumulates unlimited decoded audio. Discontinuity
    // starts a fresh FFT window, as it does on a stream reset.
    if (this.samples + length > maxSamples || this.pending.length >= 2048) this.clear();
    if (length > maxSamples) return;
    this.pending.push({ ...chunk, samples: chunk.samples.map(channel => channel.slice()) });
    this.samples += length; this.schedule();
  }
  end() { if (this.pending.at(-1) !== null) this.pending.push(null); this.schedule(); }
  private schedule() {
    this.scheduled ??= setImmediate(() => { this.scheduled = undefined; this.drain(); });
  }
  private drain() {
    let budget = samplesPerTurn;
    while (budget > 0 && this.pending.length) {
      const chunk = this.pending[0];
      if (!chunk) { this.pending.shift(); this.analyser.clear(); continue; }
      const length = Math.min(budget, chunk.samples[0]!.length - this.offset);
      this.analyser.push({ ...chunk, samples: chunk.samples.map(channel => channel.subarray(this.offset, this.offset + length)),
        serverTimeUs: chunk.serverTimeUs + this.offset / chunk.sampleRate * 1e6 });
      budget -= length; this.samples -= length; this.offset += length;
      if (this.offset === chunk.samples[0]!.length) { this.pending.shift(); this.offset = 0; }
    }
    if (this.pending.length) this.schedule();
  }
}
