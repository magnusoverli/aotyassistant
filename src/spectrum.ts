/** Small, metadata-free frames shared by the server and every room screen. */
export const spectrumBins = 24;
export const spectrumRate = 60;
/** Analysed frequency range; bands are log-spaced between these limits. */
export const spectrumMinHz = 70;
export const spectrumMaxHz = 16_000;
/** Linear multiplier screens apply to every band level when drawing (1 = unscaled analysis). */
export const visualizerSensitivity = { min: .5, max: 1.5, default: .9 } as const;
export type SpectrumFrame = { at: number; bins: number[] };
export type SpectrumPacket = { epoch: string; roomId: string | null; participantId: string | null; active: boolean; sensitivity: number; frames: SpectrumFrame[] };
export type VisualizerSettings = { revision: number; enabled: boolean; delayMs: number; sensitivity: number };
export type VisualizerView = VisualizerSettings & {
  name: string; state: 'disabled' | 'connecting' | 'ready' | 'receiving' | 'error'; message: string;
};

/** Bounded stream-ahead storage, in the Doom Room server's monotonic clock domain. */
export class SpectrumBuffer {
  private readonly capacity = Math.ceil(spectrumRate * 41);
  private frames: (SpectrumFrame | undefined)[] = new Array(this.capacity);
  private head = 0;
  private length = 0;
  clear() { this.frames.fill(undefined); this.head = this.length = 0; }
  private at(index: number) { return this.frames[(this.head + index) % this.capacity]!; }
  private shift() { this.frames[this.head] = undefined; this.head = (this.head + 1) % this.capacity; this.length--; }
  push(frame: SpectrumFrame, now: number) {
    if (!Number.isFinite(frame.at) || frame.at < now - 5000 || frame.at > now + 35_000 ||
      frame.at <= (this.length ? this.at(this.length - 1).at : -Infinity)) return;
    if (this.length === this.capacity) this.shift();
    this.frames[(this.head + this.length++) % this.capacity] = frame;
    this.prune(now);
  }
  private prune(now: number) {
    // Retain the full delay + stream-ahead window at the analysis frame rate.
    while (this.length && this.at(0).at < now - 5500) this.shift();
  }
  window(now: number, delayMs: number) {
    this.prune(now);
    const visible: SpectrumFrame[] = [];
    for (let i = 0; i < this.length; i++) {
      const frame = this.at(i); const at = frame.at + delayMs;
      if (at > now + 1200) break;
      if (at >= now - 150) visible.push({ at, bins: frame.bins });
    }
    return visible;
  }
}
