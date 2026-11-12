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
  private frames: SpectrumFrame[] = [];
  clear() { this.frames = []; }
  push(frame: SpectrumFrame, now: number) {
    if (!Number.isFinite(frame.at) || frame.at < now - 5000 || frame.at > now + 35_000 ||
      frame.at <= (this.frames.at(-1)?.at ?? -Infinity)) return;
    this.frames.push(frame);
    this.prune(now);
  }
  private prune(now: number) {
    // Retain the full delay + stream-ahead window at the analysis frame rate.
    this.frames = this.frames.filter(frame => frame.at >= now - 5500).slice(-Math.ceil(spectrumRate * 41));
  }
  window(now: number, delayMs: number) {
    this.prune(now);
    return this.frames.filter(frame => frame.at + delayMs >= now - 150 && frame.at + delayMs <= now + 1200)
      .map(frame => ({ at: frame.at + delayMs, bins: frame.bins }));
  }
}
