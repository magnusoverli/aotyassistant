import type { PlaybackProgress } from '../src/model';

/** Display-only interpolation. No timers, completion callbacks, or concealed duration inference. */
export class ProgressClock {
  private sample?: PlaybackProgress;
  private at = 0;
  private correction = 0;
  private correctionSeconds = 1;
  private fractionTransition?: { from: number; milliseconds: number };
  private online = true;
  private signature = '';
  constructor(private now = () => performance.now()) {}

  connect(online: boolean) {
    if (online === this.online) return;
    const position = this.position();
    this.online = online;
    if (position) { this.sample = position; this.at = this.now(); this.correction = 0; this.fractionTransition = undefined; }
  }
  accept(progress?: PlaybackProgress): PlaybackProgress | undefined {
    if (!progress) { this.sample = undefined; this.signature = ''; this.fractionTransition = undefined; return; }
    const signature = JSON.stringify(progress);
    if (signature === this.signature) return this.position();
    this.signature = signature;
    const previous = this.sample;
    const shown = this.position();
    const now = this.now(); const interval = now - this.at;
    this.correction = 0; this.correctionSeconds = 1; this.fractionTransition = undefined;
    if (previous?.id === progress.id && shown && progress.elapsed !== undefined) {
      // On reveal, duration becomes public. Preserve the visible bar while
      // transitioning to the now-authoritative elapsed-time clock.
      const displayed = shown.elapsed ?? (progress.duration && shown.fraction != null ? shown.fraction * progress.duration : undefined);
      const difference = displayed === undefined ? Infinity : displayed - progress.elapsed;
      // Pending Pause uses the last server sample; freeze where the listener saw it.
      if (progress.status !== 'playing' && previous.status === 'playing' && previous.elapsed === progress.elapsed) {
        progress = { ...progress, elapsed: displayed, fraction: shown.fraction };
      } else if (previous.status === 'playing' && progress.status === 'playing' && Math.abs(difference) < 4) {
        this.correction = difference;
        // Spread larger timing jitter over several frames without moving the
        // clock backwards or freezing it while a correction is absorbed.
        this.correctionSeconds = Math.max(1, Math.min(5, Math.abs(difference) * 2));
      }
    }
    if (this.online && previous?.id === progress.id && previous.status === 'playing' && progress.status === 'playing' &&
      progress.elapsed === undefined && progress.duration === undefined && shown?.fraction != null && progress.fraction != null &&
      progress.fraction >= shown.fraction && progress.fraction - shown.fraction <= .05) {
      // Concealed progress only eases toward a received fraction. It never
      // estimates duration or advances beyond the latest reported position.
      this.fractionTransition = { from: shown.fraction, milliseconds: Math.max(100, Math.min(3500, interval)) };
    }
    this.sample = { ...progress }; this.at = now; return this.position();
  }
  get animating() {
    const sample = this.sample;
    if (!this.online || sample?.status !== 'playing' || sample.id.startsWith('pending-')) return false;
    if (this.fractionTransition) return this.now() - this.at < this.fractionTransition.milliseconds;
    return sample.elapsed !== undefined && Boolean(sample.duration) && this.now() - this.at < 5000 && this.position()!.elapsed! < sample.duration!;
  }
  position(): PlaybackProgress | undefined {
    const sample = this.sample; if (!sample) return;
    if (!this.online || sample.status !== 'playing' || sample.id.startsWith('pending-')) return { ...sample };
    const seconds = Math.max(0, (this.now() - this.at) / 1000);
    if (this.fractionTransition && sample.fraction != null) {
      const amount = Math.min(1, seconds * 1000 / this.fractionTransition.milliseconds);
      return { ...sample, fraction: this.fractionTransition.from + (sample.fraction - this.fractionTransition.from) * amount };
    }
    if (sample.elapsed === undefined || !sample.duration) return { ...sample };
    // An old observation is not evidence of continued playback indefinitely.
    const elapsed = Math.max(0, Math.min(sample.duration, sample.elapsed + Math.min(5, seconds) + this.correction * Math.max(0, 1 - seconds / this.correctionSeconds)));
    return { ...sample, elapsed, fraction: elapsed / sample.duration };
  }
}
