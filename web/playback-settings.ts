import type { PlaybackSettings } from '../src/model';
import { el } from './dom';
import { requestJson } from './request';
import { panel, sectionHeading } from './ui-components';

/** Independent of Music Assistant setup: also available in demo mode. */
export class PlaybackSettingsPanel {
  readonly element = panel('settings-card settings-playback');
  private toggle = el('input');
  private status = el('p', undefined, 'muted small');
  private retry = el('button', 'Refresh playback settings', 'secondary');
  private value?: PlaybackSettings;
  private busy = false;

  constructor(private signal: AbortSignal) {
    const label = el('label', undefined, 'auto-reveal-setting');
    this.toggle.type = 'checkbox'; this.toggle.id = 'auto-reveal'; this.toggle.disabled = true;
    label.append(this.toggle, el('span', 'Automatically reveal at 70%'));
    const help = el('p', 'Reveal track details on the room display at 70% of playback progress. Participants can still reveal earlier. Tracks with unknown duration remain manual.', 'muted small');
    help.id = 'auto-reveal-help'; this.toggle.setAttribute('aria-describedby', help.id);
    this.status.setAttribute('role', 'status'); this.retry.type = 'button'; this.retry.hidden = true;
    this.element.setAttribute('aria-labelledby', 'playback-settings-title');
    this.element.append(sectionHeading('Playback', 'playback-settings-title'), label, help, this.status, this.retry);
    this.toggle.onchange = () => { void this.save(this.toggle.checked); };
    this.retry.onclick = () => { void this.load(); };
    window.addEventListener('focus', () => { if (!this.busy) void this.load(); }, { signal });
    window.addEventListener('online', () => { void this.load(); }, { signal });
    window.addEventListener('offline', () => this.render(), { signal });
  }
  private render() {
    if (this.signal.aborted) return;
    this.toggle.checked = this.value?.enabled ?? true;
    this.toggle.disabled = this.busy || !this.value || !navigator.onLine;
    this.retry.disabled = this.busy || !navigator.onLine;
  }
  async load() {
    if (this.busy || this.signal.aborted || !navigator.onLine) return;
    this.busy = true; this.render();
    try {
      const value = await requestJson<PlaybackSettings>('/api/host/playback-settings');
      if (this.signal.aborted) return;
      this.value = value; this.status.textContent = ''; this.retry.hidden = true;
    } catch {
      if (!this.signal.aborted) { this.status.textContent = 'Playback settings could not be loaded.'; this.retry.hidden = false; }
    } finally { this.busy = false; this.render(); }
  }
  private async save(enabled: boolean) {
    if (this.busy || !this.value || this.signal.aborted) return;
    this.busy = true; this.status.textContent = 'Saving…'; this.render();
    try {
      const value = await requestJson<PlaybackSettings>('/api/host/playback-settings', { enabled, revision: this.value.revision });
      if (this.signal.aborted) return;
      this.value = value; this.status.textContent = 'Saved'; this.retry.hidden = true;
    } catch (error) {
      if (!this.signal.aborted) { this.status.textContent = error instanceof Error ? error.message : 'Setting could not be saved.'; this.retry.hidden = false; this.value = undefined; }
    } finally { this.busy = false; this.render(); }
  }
}
