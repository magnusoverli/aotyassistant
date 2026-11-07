export type AudioCodec = 'opus' | 'flac' | 'pcm';
export type DecoderMode = 'native' | 'software';
import type { AudioHealth } from '../src/browser-audio-health';
export type { AudioHealth } from '../src/browser-audio-health';

/** Match the pinned SDK's compatibility exclusions, not just MIME support. */
export function browserCodecs(userAgent: string, nativeOpus: boolean): AudioCodec[] {
  const safari = /^((?!chrome|android).)*safari/i.test(userAgent);
  const firefox = /firefox/i.test(userAgent);
  return safari ? ['opus', 'pcm'] : firefox || !nativeOpus ? ['flac', 'pcm'] : ['opus', 'flac', 'pcm'];
}

/** Only received-but-undecoded chunks trigger codec recovery. Silence, suspension,
 * network gaps and an idle/paused player cannot be mistaken for decoder failure. */
export class AudioPolicy {
  readonly health: AudioHealth = { decodedChunks: 0, decodeFailures: 0, recoveries: 0, lateChunks: 0, minBufferMs: 500 };
  private pending = new Map<number, number>();
  private failures = 0;
  private late = 0;
  private lastAdjustment = 0;
  private lastLate = 0;
  private generation = -1;
  constructor(private recover: () => void, private buffer: (ms: number) => void) {}
  reset(generation: number) { this.generation = generation; this.pending.clear(); this.failures = 0; this.late = 0; }
  received(timestamp: number, generation: number, now: number) {
    if (generation !== this.generation) this.reset(generation);
    // Bounded even if a decoder never completes. Keep oldest work for the watchdog.
    if (this.pending.size < 256) this.pending.set(timestamp, now);
  }
  decoded(timestamp: number, generation: number, now: number, late: boolean | undefined) {
    if (generation !== this.generation) return;
    this.health.decodedChunks++;
    if (!this.pending.delete(timestamp)) return;
    this.failures = 0;
    if (late === undefined) return; // Output suspended or clock not synchronized.
    if (late) { this.health.lateChunks++; this.late++; this.lastLate = now; }
    else this.late = Math.max(0, this.late - 1);
    if (this.late >= 5 && now - this.lastAdjustment >= 10_000) {
      this.adjust(Math.min(2000, this.health.minBufferMs + 250), now); this.late = 0;
    } else if (!late && now - Math.max(this.lastLate, this.lastAdjustment) >= 60_000) {
      this.adjust(Math.max(500, this.health.minBufferMs - 250), now);
    }
  }
  check(now: number) {
    for (const [timestamp, started] of this.pending) {
      if (now - started < 2500) continue;
      this.pending.delete(timestamp); this.health.decodeFailures++; this.failures++;
    }
    if (this.failures >= 3) {
      this.pending.clear(); this.failures = 0; this.recover();
    }
  }
  private adjust(ms: number, now: number) {
    this.lastAdjustment = now;
    if (ms !== this.health.minBufferMs) { this.health.minBufferMs = ms; this.buffer(ms); }
  }
}
