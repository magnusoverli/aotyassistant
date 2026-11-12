import { visualizerSensitivity, type VisualizerView } from '../src/spectrum';
import { el } from './dom';
import { panel, sectionHeading, actionGroup } from './ui-components';
import { requestJson } from './request';

/** Minimum spacing between automatic sensitivity saves while the slider is dragged. */
const liveInterval = 100;

export class VisualizerSettingsPanel {
  readonly element = panel('settings-card settings-visualizer');
  private enabled = el('input');
  private delay = el('input');
  private sensitivity = el('input');
  private sensitivityValue = el('output');
  private status = el('p', 'Loading visualizer…', 'muted small');
  private save = el('button', 'Save visualizer settings');
  private reload = el('button', 'Refresh status', 'secondary');
  private view?: VisualizerView;
  /** Every request runs in order, so each one carries the revision returned by the previous one. */
  private lane: Promise<void> = Promise.resolve();
  private pending = 0;
  private formBusy = false;
  /** Latest slider value not yet sent; sends coalesce to the newest value. */
  private live?: number;
  private liveQueued = false;
  private liveTimer?: ReturnType<typeof setTimeout>;
  private lastSent = -Infinity;
  constructor(private signal: AbortSignal) {
    this.enabled.type = 'checkbox'; this.enabled.id = 'visualizer-enabled';
    this.delay.type = 'number'; this.delay.id = 'visualizer-delay'; this.delay.min = '-5000'; this.delay.max = '5000'; this.delay.step = '10';
    this.sensitivity.type = 'range'; this.sensitivity.id = 'visualizer-sensitivity';
    this.sensitivity.min = String(visualizerSensitivity.min * 100); this.sensitivity.max = String(visualizerSensitivity.max * 100); this.sensitivity.step = '5';
    this.sensitivity.value = String(visualizerSensitivity.default * 100); this.sensitivityValue.htmlFor = this.sensitivity.id; this.showSensitivity();
    const toggle = el('label', 'Enable Doom Room Visualizer'); toggle.htmlFor = this.enabled.id;
    const toggleRow = el('div', undefined, 'field background-toggle'); toggleRow.append(toggle, this.enabled);
    const delayRow = el('div', undefined, 'field'); const label = el('label', 'Visual timing adjustment (ms)'); label.htmlFor = this.delay.id;
    delayRow.append(label, this.delay, el('p', 'Positive values show the spectrum later; negative values show it earlier. Start at 0 for Sendspin sync groups.', 'muted field-hint'));
    const sensitivityRow = el('div', undefined, 'field background-field visualizer-sensitivity');
    const sensitivityLabel = el('label', 'Sensitivity'); sensitivityLabel.htmlFor = this.sensitivity.id;
    sensitivityRow.append(sensitivityLabel, this.sensitivityValue, this.sensitivity,
      el('p', `Scales how strongly needles react. Changes apply immediately on every room screen and save automatically. Default ${visualizerSensitivity.default * 100}%.`, 'muted field-hint'));
    this.sensitivity.oninput = () => { this.showSensitivity(); this.live = Number(this.sensitivity.value) / 100; this.flushLive(); };
    const form = el('form', undefined, 'form-stack'); const actions = actionGroup();
    this.save.type = 'submit'; this.reload.type = 'button'; actions.append(this.save, this.reload);
    form.append(toggleRow, delayRow, sensitivityRow, actions);
    form.onsubmit = event => { event.preventDefault(); void this.request(true); };
    this.reload.onclick = () => { void this.request(); };
    this.status.setAttribute('role', 'status');
    this.element.append(sectionHeading('Audio-reactive turn border', 'settings-visualizer-title', 'h3'),
      el('p', 'Enable this silent receiver, then add “Doom Room Visualizer” to a speaker group in Music Assistant. Select that group as the room’s output above. All room screens receive the same spectrum.'),
      el('p', 'Sendspin-compatible groups share a playback clock. For Sonos, AirPlay/Sendspin bridging gives synchronized grouping where supported. Universal Groups carry the same music but do not guarantee sync; an adjustment may help with a steady offset.', 'muted small'),
      form, this.status);
    this.element.setAttribute('aria-labelledby', 'settings-visualizer-title');
    this.lock(); void this.request();
    const timer = setInterval(() => { void this.request(false, true); }, 5000);
    signal.addEventListener('abort', () => { clearInterval(timer); clearTimeout(this.liveTimer); }, { once: true });
  }
  private enqueue(task: () => Promise<void>) {
    this.pending++;
    const run = this.lane.then(task).finally(() => { this.pending--; });
    this.lane = run.catch(() => {});
    return run;
  }
  private request(save = false, statusOnly = false) {
    if (this.signal.aborted || save && !this.view || statusOnly && this.pending) return Promise.resolve();
    return this.enqueue(async () => {
      if (this.signal.aborted || save && !this.view) return;
      if (!statusOnly) { this.formBusy = true; this.lock(); }
      try {
        // The slider's value is always included, so a form save never reverts a live sensitivity change.
        const view = await requestJson<VisualizerView>('/api/host/visualizer', save ? {
          revision: this.view!.revision, enabled: this.enabled.checked, delayMs: Number(this.delay.value), sensitivity: Number(this.sensitivity.value) / 100,
        } : undefined, 15_000, this.signal);
        if (this.signal.aborted) return;
        // Polling status must not overwrite an unsaved draft or silently adopt another editor's revision.
        if (!statusOnly || !this.view) {
          this.view = view; this.enabled.checked = view.enabled; this.delay.value = String(view.delayMs);
          if (this.live === undefined) { this.sensitivity.value = String(Math.round(view.sensitivity * 100)); this.showSensitivity(); }
        }
        this.report(view);
      } catch (error) {
        if (!this.signal.aborted) this.fail(error);
      } finally { if (!statusOnly) { this.formBusy = false; this.lock(); } }
    });
  }
  /** Sends the newest slider value, at most every 100 ms, keeping any unsaved timing or enable drafts. */
  private flushLive = () => {
    clearTimeout(this.liveTimer); this.liveTimer = undefined;
    if (this.live === undefined || this.liveQueued || !this.view || this.signal.aborted) return;
    const wait = this.lastSent + liveInterval - performance.now();
    if (wait > 0) { this.liveTimer = setTimeout(this.flushLive, wait); return; }
    this.liveQueued = true;
    void this.enqueue(async () => {
      this.liveQueued = false;
      const value = this.live; const saved = this.view;
      this.live = undefined; this.lastSent = performance.now();
      if (value === undefined || !saved || this.signal.aborted || value === saved.sensitivity) return;
      try {
        const view = await requestJson<VisualizerView>('/api/host/visualizer', {
          revision: saved.revision, enabled: saved.enabled, delayMs: saved.delayMs, sensitivity: value,
        }, 15_000, this.signal);
        if (this.signal.aborted) return;
        this.view = view; this.report(view);
      } catch (error) {
        if (this.signal.aborted) return;
        this.live = undefined; this.fail(error);
      }
    });
  };
  private showSensitivity() { this.sensitivityValue.value = `${this.sensitivity.value}%`; }
  private report(view: VisualizerView) { this.status.textContent = view.message; this.status.className = view.state === 'error' ? 'field-error' : 'muted small'; }
  private fail(error: unknown) { this.status.textContent = error instanceof Error ? error.message : 'Visualizer unavailable.'; this.status.className = 'field-error'; }
  // The slider stays enabled during requests so a drag is never interrupted.
  private lock() {
    this.save.disabled = this.formBusy || !this.view; this.reload.disabled = this.formBusy;
    this.enabled.disabled = this.delay.disabled = this.formBusy || !this.view; this.sensitivity.disabled = !this.view;
  }
}
