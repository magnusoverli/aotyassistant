import { el } from './dom';
import { prop, text } from './view-nodes';

export const clockTime = (seconds: number) => {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
};

/** What the bubble says while someone chooses a point in their song. Moving a hidden song
 * past the automatic-reveal marker reveals it, so the bubble says so before they let go. */
export function seekPreview(target: { seconds: number; duration: number; revealAt?: number; hidden: boolean }) {
  const duration = Math.max(0, target.duration);
  const seconds = Math.max(0, Math.min(duration, target.seconds));
  const reveals = Boolean(target.hidden && target.revealAt !== undefined && Number.isFinite(target.revealAt) &&
    target.revealAt > 0 && target.revealAt < 1 && duration > 0 && seconds / duration >= target.revealAt);
  return { seconds, fraction: duration > 0 ? seconds / duration : 0, time: clockTime(seconds), reveals,
    label: reveals ? `${clockTime(seconds)} · Reveals the song` : clockTime(seconds) };
}

/** Keyboard steps, in seconds. */
export const seekSteps = { arrow: 5, page: 30 } as const;

type SeekState = { enabled: boolean; duration: number; revealAt?: number; hidden: boolean };

/** A drag-to-seek layer over a progress rail. The speaker only moves when the drag ends (or
 * shortly after the last key press): one request per decision, never a stream of jumps while
 * a room is listening. Until the speaker confirms, the handle waits at the chosen point.
 * media.ts paints the rail and moves the handle with the song; while `data-seeking` is set it leaves
 * the bar, the handle and the elapsed time to this. */
export class SeekBar {
  readonly input = el('input', undefined, 'seek-input');
  private bubble = el('output', undefined, 'seek-bubble');
  private state: SeekState = { enabled: false, duration: 0, hidden: false };
  private pointer = false;
  private keyTimer?: ReturnType<typeof setTimeout>;
  private pending?: number;

  /** `seek` settles once the room has the speaker's answer, confirmed or not. */
  constructor(private frame: HTMLElement, private seek: (seconds: number) => Promise<void>, private settled: () => void) {
    const rail = frame.querySelector<HTMLElement>('.progress-rail')!;
    const input = this.input;
    input.type = 'range'; input.min = '0'; input.step = '1'; input.value = '0'; input.hidden = true;
    input.setAttribute('aria-label', 'Position in song');
    this.bubble.setAttribute('aria-hidden', 'true'); this.bubble.hidden = true;
    rail.append(input, this.bubble);
    input.addEventListener('pointerdown', () => { this.pointer = true; });
    input.addEventListener('pointercancel', () => { this.pointer = false; this.cancel(); });
    input.addEventListener('input', () => this.preview());
    input.addEventListener('change', () => {
      if (this.pointer) { this.pointer = false; this.commit(); return; }
      // Each key press changes the value; wait for a pause so one decision makes one request.
      clearTimeout(this.keyTimer); this.keyTimer = setTimeout(() => this.commit(), 700);
    });
    input.addEventListener('keydown', event => {
      if (event.key === 'Escape' && this.dragging) { event.preventDefault(); clearTimeout(this.keyTimer); this.cancel(); return; }
      const step = { ArrowRight: seekSteps.arrow, ArrowUp: seekSteps.arrow, ArrowLeft: -seekSteps.arrow, ArrowDown: -seekSteps.arrow,
        PageUp: seekSteps.page, PageDown: -seekSteps.page }[event.key];
      if (step === undefined) return;
      event.preventDefault();
      input.value = String(Math.max(0, Math.min(this.state.duration, Number(input.value) + step)));
      input.dispatchEvent(new Event('input')); input.dispatchEvent(new Event('change'));
    });
    input.addEventListener('blur', () => { if (this.keyTimer) { clearTimeout(this.keyTimer); this.commit(); } });
  }

  private get dragging() { return this.frame.dataset.seeking === 'drag'; }
  /** While dragging or waiting for the speaker, progress updates must not move the handle. */
  get active() { return this.frame.dataset.seeking !== undefined; }
  /** The status line while the speaker moves. */
  get pendingText() { return this.pending === undefined ? undefined : `Moving to ${clockTime(this.pending)}…`; }

  update(state: SeekState) {
    this.state = state;
    const usable = state.enabled && state.duration > 0;
    // A pending move keeps its handle until the speaker answers, even if controls lock meanwhile.
    prop(this.input, 'hidden', !usable && this.pending === undefined);
    prop(this.input, 'disabled', !usable || this.pending !== undefined);
    const max = String(Math.max(0, Math.floor(state.duration)));
    if (this.input.max !== max) this.input.max = max;
    this.frame.classList.toggle('is-seekable', usable);
    if (!usable && this.dragging) this.cancel();
  }

  private preview() {
    if (this.pending !== undefined) return;
    const shown = seekPreview({ seconds: Number(this.input.value), duration: this.state.duration, revealAt: this.state.revealAt, hidden: this.state.hidden });
    this.frame.dataset.seeking = 'drag';
    this.paint(shown.fraction, shown.time);
    text(this.bubble, shown.label); prop(this.bubble, 'hidden', false);
    this.bubble.classList.toggle('is-warning', shown.reveals);
    this.bubble.style.setProperty('--seek-at', String(shown.fraction));
    this.input.setAttribute('aria-valuetext', `${shown.label} of ${clockTime(this.state.duration)}`);
  }

  private commit() {
    clearTimeout(this.keyTimer); this.keyTimer = undefined;
    if (!this.dragging || this.pending !== undefined) return;
    const seconds = Math.max(0, Math.min(this.state.duration, Number(this.input.value)));
    this.pending = seconds; this.frame.dataset.seeking = 'pending';
    prop(this.bubble, 'hidden', true); prop(this.input, 'disabled', true);
    this.settled();
    void this.seek(seconds).finally(() => {
      this.pending = undefined; delete this.frame.dataset.seeking; this.settled();
    });
  }

  private cancel() {
    if (this.pending !== undefined) return;
    delete this.frame.dataset.seeking; prop(this.bubble, 'hidden', true); this.settled();
  }

  /** The bar and elapsed time show the chosen point instead of the song's position. */
  private paint(fraction: number, time: string) {
    const bar = this.frame.querySelector<HTMLProgressElement>('progress');
    if (bar) prop(bar, 'value', fraction);
    const elapsed = this.frame.querySelector<HTMLElement>('.track-times > :first-child');
    if (elapsed && elapsed.textContent !== time) elapsed.textContent = time;
  }
}
