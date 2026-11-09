import type { PlaybackSettings } from '../src/model';
import { el } from './dom';
import { requestJson } from './request';
import { panel, sectionHeading } from './ui-components';

/** One on/off room setting, saved with a revision so a stale page cannot overwrite a newer choice.
 * `inactiveHelp` explains why the toggle is greyed out while another setting makes it meaningless. */
type ToggleSetting = { path: string; className: string; id: string; title: string; label: string; help: string; fallback: boolean; inactiveHelp?: string };

export const secretPlaybackSetting: ToggleSetting = {
  path: '/api/host/secret-playback-settings', className: 'settings-secret-playback', id: 'secret-playback', fallback: true,
  title: 'Secret playback', label: 'Hide track details until revealed',
  help: 'The room display shows Track details hidden. until the participant reveals their song, or automatic reveal does. Switch off to show the title, artist and artwork on the room display as soon as each song starts.',
};
export const autoRevealSetting: ToggleSetting = {
  path: '/api/host/playback-settings', className: 'settings-playback', id: 'auto-reveal', fallback: true,
  title: 'Automatic reveal', label: 'Automatically reveal at 70%',
  help: 'Reveal track details on the room display at 70% of playback progress. Participants can still reveal earlier. Tracks with unknown duration remain manual.',
  inactiveHelp: 'Only applies while Secret playback is on.',
};
export const autoplaySetting: ToggleSetting = {
  path: '/api/host/autoplay-settings', className: 'settings-autoplay', id: 'autoplay', fallback: false,
  title: 'Automatic play', label: 'Play the next song automatically',
  help: 'When a song ends, the turn passes and the next participant’s first song in Your playlist starts by itself. If their playlist is empty or the song can’t play, they choose as usual. Finish turn, Skip turn and Pass turn never start the next song.',
};

/** Independent of Music Assistant setup: also available in demo mode. */
export class PlaybackSettingsPanel {
  readonly element: HTMLElement;
  private toggle = el('input');
  private status = el('p', undefined, 'muted small');
  private retry = el('button', 'Refresh playback settings', 'secondary');
  private inactive = el('p', undefined, 'muted small setting-inactive');
  private value?: PlaybackSettings;
  private busy = false;
  private active = true;
  /** Receives each value the server confirms. */
  onValue?: (enabled: boolean) => void;

  constructor(private signal: AbortSignal, private setting: ToggleSetting = autoRevealSetting) {
    this.element = panel(`settings-card ${setting.className}`);
    const label = el('label', undefined, 'setting-toggle');
    this.toggle.type = 'checkbox'; this.toggle.id = setting.id; this.toggle.disabled = true;
    label.append(this.toggle, el('span', setting.label));
    const help = el('p', setting.help, 'muted small');
    help.id = `${setting.id}-help`; this.toggle.setAttribute('aria-describedby', help.id);
    this.inactive.id = `${setting.id}-inactive`; this.inactive.textContent = setting.inactiveHelp ?? ''; this.inactive.hidden = true;
    this.status.setAttribute('role', 'status'); this.retry.type = 'button'; this.retry.hidden = true;
    this.element.setAttribute('aria-labelledby', `${setting.id}-title`);
    this.element.append(sectionHeading(setting.title, `${setting.id}-title`, 'h3'), label, help, this.inactive, this.status, this.retry);
    this.toggle.onchange = () => { void this.save(this.toggle.checked); };
    this.retry.onclick = () => { void this.load(); };
    window.addEventListener('focus', () => { if (!this.busy) void this.load(); }, { signal });
    window.addEventListener('online', () => { void this.load(); }, { signal });
    window.addEventListener('offline', () => this.render(), { signal });
  }
  /** Greys out the toggle, keeping its saved value, while another setting makes it meaningless. */
  setActive(active: boolean) { this.active = active; this.render(); }
  private render() {
    if (this.signal.aborted) return;
    this.toggle.checked = this.value?.enabled ?? this.setting.fallback;
    this.toggle.disabled = this.busy || !this.value || !navigator.onLine || !this.active;
    this.retry.disabled = this.busy || !navigator.onLine;
    const inactive = !this.active && Boolean(this.setting.inactiveHelp);
    this.inactive.hidden = !inactive;
    this.toggle.setAttribute('aria-describedby', inactive ? `${this.setting.id}-help ${this.inactive.id}` : `${this.setting.id}-help`);
  }
  async load() {
    if (this.busy || this.signal.aborted || !navigator.onLine) return;
    this.busy = true; this.render();
    try {
      const value = await requestJson<PlaybackSettings>(this.setting.path);
      if (this.signal.aborted) return;
      this.value = value; this.status.textContent = ''; this.retry.hidden = true; this.onValue?.(value.enabled);
    } catch {
      if (!this.signal.aborted) { this.status.textContent = 'Playback settings could not be loaded.'; this.retry.hidden = false; }
    } finally { this.busy = false; this.render(); }
  }
  private async save(enabled: boolean) {
    if (this.busy || !this.value || this.signal.aborted) return;
    this.busy = true; this.status.textContent = 'Saving…'; this.render();
    try {
      const value = await requestJson<PlaybackSettings>(this.setting.path, { enabled, revision: this.value.revision });
      if (this.signal.aborted) return;
      this.value = value; this.status.textContent = 'Saved'; this.retry.hidden = true; this.onValue?.(value.enabled);
    } catch (error) {
      if (!this.signal.aborted) { this.status.textContent = error instanceof Error ? error.message : 'Setting could not be saved.'; this.retry.hidden = false; this.value = undefined; }
    } finally { this.busy = false; this.render(); }
  }
}
