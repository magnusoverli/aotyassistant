import type { VisualizerView } from '../src/spectrum';
import { el } from './dom';
import { panel, sectionHeading, actionGroup } from './ui-components';
import { requestJson } from './request';

export class VisualizerSettingsPanel {
  readonly element = panel('settings-card settings-visualizer');
  private enabled = el('input');
  private delay = el('input');
  private status = el('p', 'Loading visualizer…', 'muted small');
  private save = el('button', 'Save visualizer settings');
  private reload = el('button', 'Refresh status', 'secondary');
  private view?: VisualizerView;
  private busy = false;
  constructor(private signal: AbortSignal) {
    this.enabled.type = 'checkbox'; this.enabled.id = 'visualizer-enabled';
    this.delay.type = 'number'; this.delay.id = 'visualizer-delay'; this.delay.min = '-5000'; this.delay.max = '5000'; this.delay.step = '10';
    const toggle = el('label', 'Enable Doom Room Visualizer'); toggle.htmlFor = this.enabled.id;
    const toggleRow = el('div', undefined, 'field background-toggle'); toggleRow.append(toggle, this.enabled);
    const delayRow = el('div', undefined, 'field'); const label = el('label', 'Visual timing adjustment (ms)'); label.htmlFor = this.delay.id;
    delayRow.append(label, this.delay, el('p', 'Positive values show the spectrum later; negative values show it earlier. Start at 0 for Sendspin sync groups.', 'muted field-hint'));
    const form = el('form', undefined, 'form-stack'); const actions = actionGroup();
    this.save.type = 'submit'; this.reload.type = 'button'; actions.append(this.save, this.reload);
    form.append(toggleRow, delayRow, actions);
    form.onsubmit = event => { event.preventDefault(); void this.request(true); };
    this.reload.onclick = () => { void this.request(); };
    this.status.setAttribute('role', 'status');
    this.element.append(sectionHeading('Audio-reactive turn border', 'settings-visualizer-title', 'h3'),
      el('p', 'Enable this silent receiver, then add “Doom Room Visualizer” to a speaker group in Music Assistant. Select that group as the room’s output above. All room screens receive the same spectrum.'),
      el('p', 'Sendspin-compatible groups share a playback clock. For Sonos, AirPlay/Sendspin bridging gives synchronized grouping where supported. Universal Groups carry the same music but do not guarantee sync; an adjustment may help with a steady offset.', 'muted small'),
      form, this.status);
    this.element.setAttribute('aria-labelledby', 'settings-visualizer-title');
    void this.request();
    const timer = setInterval(() => { void this.request(false, true); }, 5000);
    signal.addEventListener('abort', () => clearInterval(timer), { once: true });
  }
  private async request(save = false, statusOnly = false) {
    if (this.busy || this.signal.aborted || save && !this.view) return;
    this.busy = true; this.lock();
    try {
      const view = await requestJson<VisualizerView>('/api/host/visualizer', save ? {
        revision: this.view!.revision, enabled: this.enabled.checked, delayMs: Number(this.delay.value),
      } : undefined, 15_000, this.signal);
      if (this.signal.aborted) return;
      // Polling status must not overwrite an unsaved draft or silently adopt another editor's revision.
      if (!statusOnly || !this.view) {
        this.view = view; this.enabled.checked = view.enabled; this.delay.value = String(view.delayMs);
      }
      this.status.textContent = view.message; this.status.className = view.state === 'error' ? 'field-error' : 'muted small';
    } catch (error) {
      if (!this.signal.aborted) { this.status.textContent = error instanceof Error ? error.message : 'Visualizer unavailable.'; this.status.className = 'field-error'; }
    } finally { this.busy = false; this.lock(); }
  }
  private lock() { this.save.disabled = this.busy || !this.view; this.reload.disabled = this.busy; this.enabled.disabled = this.delay.disabled = this.busy || !this.view; }
}
