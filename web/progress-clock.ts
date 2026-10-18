import type { PlaybackProgress } from '../src/model';

/** Display-only interpolation. No timers, completion callbacks, or concealed duration inference. */
export class ProgressClock {
  private sample?: PlaybackProgress;
  private at = 0;
  private correction = 0;
  private online = true;
  private signature = '';
  constructor(private now = () => performance.now()) {}

  connect(online: boolean) {
    if (online === this.online) return;
    const position = this.position();
    this.online = online;
    if (position) { this.sample = position; this.at = this.now(); this.correction = 0; }
  }
  accept(progress?: PlaybackProgress): PlaybackProgress | undefined {
    if (!progress) { this.sample = undefined; this.signature = ''; return; }
    const signature = JSON.stringify(progress);
    if (signature === this.signature) return this.position();
    this.signature = signature;
    const previous = this.sample;
    const shown = this.position();
    this.correction = 0;
    if (previous?.id === progress.id && shown?.elapsed !== undefined && progress.elapsed !== undefined) {
      const difference = shown.elapsed - progress.elapsed;
      // Pending Pause uses the last server sample; freeze where the listener saw it.
      if (progress.status !== 'playing' && previous.status === 'playing' && previous.elapsed === progress.elapsed) {
        progress = { ...progress, elapsed: shown.elapsed, fraction: shown.fraction };
      } else if (previous.status === 'playing' && progress.status === 'playing' && Math.abs(difference) < 1) this.correction = difference;
    }
    this.sample = { ...progress }; this.at = this.now(); return this.position();
  }
  position(): PlaybackProgress | undefined {
    const sample = this.sample; if (!sample) return;
    if (!this.online || sample.status !== 'playing' || sample.elapsed === undefined || !sample.duration || sample.id.startsWith('pending-')) return { ...sample };
    const seconds = Math.max(0, (this.now() - this.at) / 1000);
    // An old observation is not evidence of continued playback indefinitely.
    const elapsed = Math.max(0, Math.min(sample.duration, sample.elapsed + Math.min(5, seconds) + this.correction * Math.max(0, 1 - seconds)));
    return { ...sample, elapsed, fraction: elapsed / sample.duration };
  }
}
