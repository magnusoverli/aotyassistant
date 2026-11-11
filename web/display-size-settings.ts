import { viewingDistances, type DisplaySnapshot, type ViewingDistance } from '../src/viewing-distance';
import { el, link } from './dom';
import { requestJson } from './request';
import { panel, sectionHeading } from './ui-components';

const path = '/api/host/display-settings';

/** Settings → Appearance: how large the room display is drawn. A choice is saved at once
 * with the host's last confirmed revision, and every open room display follows it. */
export class DisplaySizePanel {
  readonly element = panel('settings-card settings-display-size');
  private controls = el('fieldset', undefined, 'display-size-options');
  private radios = new Map<ViewingDistance, HTMLInputElement>();
  private status = el('p', undefined, 'muted small');
  private retry = el('button', 'Refresh room display size', 'secondary');
  private value?: DisplaySnapshot;
  private busy = false;

  constructor(private signal: AbortSignal) {
    const title = sectionHeading('Room display size', 'display-size-title', 'h3');
    const help = el('p', 'Choose where the furthest person sits. The whole room display is drawn larger or smaller to match: names, artwork, song details and the join code. On a small screen, choose one step further. A single screen can use its own size from its menu on the room display.', 'muted small');
    help.id = 'display-size-settings-help';
    this.element.setAttribute('aria-labelledby', 'display-size-title');
    this.controls.setAttribute('aria-labelledby', 'display-size-title');
    this.controls.setAttribute('aria-describedby', help.id);
    for (const distance of viewingDistances) {
      const label = el('label', undefined, 'setting-toggle display-size-option');
      const radio = el('input'); radio.type = 'radio'; radio.name = 'display-distance'; radio.value = distance.id;
      radio.id = `display-distance-${distance.id}`;
      const text = el('span'); const name = el('span', distance.label); name.id = `${radio.id}-label`;
      const description = el('span', distance.help, 'muted small'); description.id = `${radio.id}-help`;
      radio.setAttribute('aria-labelledby', name.id); radio.setAttribute('aria-describedby', description.id);
      text.append(name, description); label.append(radio, text); this.controls.append(label);
      this.radios.set(distance.id, radio);
      radio.onchange = () => { if (radio.checked) void this.save(distance.id); };
    }
    this.status.setAttribute('role', 'status'); this.retry.type = 'button'; this.retry.hidden = true;
    this.retry.onclick = () => { void this.load(); };
    this.element.append(title, this.controls, help, this.status, this.retry, link('Open room display', '/display', 'inline-link'));
    window.addEventListener('focus', () => { if (!this.busy) void this.load(); }, { signal });
    window.addEventListener('online', () => { void this.load(); }, { signal });
    window.addEventListener('offline', () => this.render(), { signal });
    this.render();
  }
  private render() {
    if (this.signal.aborted) return;
    for (const [distance, radio] of this.radios) radio.checked = distance === this.value?.settings.distance;
    this.controls.disabled = this.busy || !this.value || !navigator.onLine;
    this.retry.disabled = this.busy || !navigator.onLine;
  }
  async load() {
    if (this.busy || this.signal.aborted || !navigator.onLine) return;
    this.busy = true; this.render();
    try {
      const value = await requestJson<DisplaySnapshot>(path, undefined, 15_000, this.signal);
      if (this.signal.aborted) return;
      this.value = value; this.status.textContent = ''; this.retry.hidden = true;
    } catch {
      if (!this.signal.aborted) { this.status.textContent = 'The room display size could not be loaded.'; this.retry.hidden = false; }
    } finally { this.busy = false; this.render(); }
  }
  private async save(distance: ViewingDistance) {
    if (this.busy || !this.value || this.signal.aborted || !navigator.onLine) return;
    this.busy = true; this.status.textContent = 'Saving…'; this.render();
    try {
      const value = await requestJson<DisplaySnapshot>(path, { revision: this.value.revision, settings: { distance } }, 15_000, this.signal);
      if (this.signal.aborted) return;
      this.value = value; this.status.textContent = 'Saved. Open room displays use this size now.'; this.retry.hidden = true;
    } catch (error) {
      if (!this.signal.aborted) {
        this.status.textContent = error instanceof Error ? error.message : 'The room display size could not be saved.';
        this.retry.hidden = false; this.value = undefined;
      }
    } finally { this.busy = false; this.render(); }
  }
}
