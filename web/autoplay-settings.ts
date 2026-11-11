import type { AutoplayMode, AutoplaySettings } from '../src/model';
import { el } from './dom';
import { requestJson } from './request';
import { panel, sectionHeading } from './ui-components';

const choices: { mode: AutoplayMode; label: string; help: string }[] = [
  { mode: 'off', label: 'Pass turn and wait', help: 'Move to the next participant. They choose when to start their song.' },
  { mode: 'next-participant', label: 'Play next participant’s song', help: 'Move to the next participant and play their first upcoming playlist track. If it cannot play, wait for them to choose.' },
  { mode: 'same-participant', label: 'Continue current participant’s playlist', help: 'Keep their turn and play their next upcoming track. If their playlist is empty or the track cannot play, keep their turn and wait.' },
];
const path = '/api/host/autoplay-settings';

/** One mutually exclusive completion policy, saved using the host's last confirmed revision. */
export class AutoplaySettingsPanel {
  readonly element = panel('settings-card settings-autoplay');
  private controls = el('fieldset', undefined, 'autoplay-options');
  private radios = new Map<AutoplayMode, HTMLInputElement>();
  private status = el('p', undefined, 'muted small');
  private retry = el('button', 'Refresh automatic play settings', 'secondary');
  private value?: AutoplaySettings;
  private busy = false;

  constructor(private signal: AbortSignal) {
    const title = sectionHeading('When a song ends', 'autoplay-title', 'h3');
    const help = el('p', 'Applies only when a song ends naturally. Stop, Finish turn, Skip turn and Pass turn never start another song. Changing this setting does not start or stop the current song.', 'muted small');
    help.id = 'autoplay-help';
    this.element.setAttribute('aria-labelledby', 'autoplay-title');
    this.controls.setAttribute('aria-labelledby', 'autoplay-title');
    this.controls.setAttribute('aria-describedby', help.id);
    for (const choice of choices) {
      const label = el('label', undefined, 'setting-toggle autoplay-option');
      const radio = el('input'); radio.type = 'radio'; radio.name = 'autoplay-mode'; radio.value = choice.mode;
      radio.id = `autoplay-${choice.mode}`;
      const text = el('span'); const name = el('span', choice.label); name.id = `${radio.id}-label`;
      const description = el('span', choice.help, 'muted small'); description.id = `${radio.id}-help`;
      radio.setAttribute('aria-labelledby', name.id); radio.setAttribute('aria-describedby', description.id);
      text.append(name, description); label.append(radio, text); this.controls.append(label);
      this.radios.set(choice.mode, radio);
      radio.onchange = () => { if (radio.checked) void this.save(choice.mode); };
    }
    this.status.setAttribute('role', 'status'); this.retry.type = 'button'; this.retry.hidden = true;
    this.retry.onclick = () => { void this.load(); };
    this.element.append(title, this.controls, help, this.status, this.retry);
    window.addEventListener('focus', () => { if (!this.busy) void this.load(); }, { signal });
    window.addEventListener('online', () => { void this.load(); }, { signal });
    window.addEventListener('offline', () => this.render(), { signal });
    this.render();
  }
  private render() {
    if (this.signal.aborted) return;
    for (const [mode, radio] of this.radios) radio.checked = mode === (this.value?.mode ?? 'off');
    this.controls.disabled = this.busy || !this.value || !navigator.onLine;
    this.retry.disabled = this.busy || !navigator.onLine;
  }
  async load() {
    if (this.busy || this.signal.aborted || !navigator.onLine) return;
    this.busy = true; this.render();
    try {
      const value = await requestJson<AutoplaySettings>(path);
      if (this.signal.aborted) return;
      this.value = value; this.status.textContent = ''; this.retry.hidden = true;
    } catch {
      if (!this.signal.aborted) { this.status.textContent = 'Automatic play settings could not be loaded.'; this.retry.hidden = false; }
    } finally { this.busy = false; this.render(); }
  }
  private async save(mode: AutoplayMode) {
    if (this.busy || !this.value || this.signal.aborted || !navigator.onLine) return;
    this.busy = true; this.status.textContent = 'Saving…'; this.render();
    try {
      const value = await requestJson<AutoplaySettings>(path, { mode, revision: this.value.revision });
      if (this.signal.aborted) return;
      this.value = value; this.status.textContent = 'Saved'; this.retry.hidden = true;
    } catch (error) {
      if (!this.signal.aborted) { this.status.textContent = error instanceof Error ? error.message : 'Setting could not be saved.'; this.retry.hidden = false; this.value = undefined; }
    } finally { this.busy = false; this.render(); }
  }
}
