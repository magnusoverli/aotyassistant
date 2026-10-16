import type { AddressingView } from '../src/addressing';
import { el } from './dom';
import { requestJson } from './request';
import { inIngress, setGuestOrigin } from './paths';

/** Suggestions are not trusted until explicit guest selection or an observed MA fetch. */
export class AddressingPanel {
  view?: AddressingView;
  busy = false;
  private error = '';
  private notice = '';
  private guestDraft = '';
  private mediaDraft = '';
  private guestExpanded = false;
  private advanced = false;
  constructor(private changed: () => void, private saved: (revision: number) => void, private blocked: () => boolean) {}
  private async request(path = '', data?: unknown): Promise<AddressingView> {
    return requestJson<AddressingView>(`/api/host/addressing${path}`, data, 60_000);
  }
  private accept(view: AddressingView, drafts = false) {
    this.view = view; this.saved(view.revision);
    setGuestOrigin(view.guestOrigin);
    if (drafts) { this.guestDraft = view.guestOrigin; this.mediaDraft = view.mediaOrigin ?? ''; }
  }
  private async run(work: () => Promise<void>) {
    if (this.busy || this.blocked()) return;
    this.busy = true; this.error = ''; this.notice = ''; this.changed();
    try { await work(); }
    catch (error) {
      this.error = error instanceof Error ? error.message : 'Address setup failed. Saved addresses were kept.';
      try { this.accept(await this.request()); } catch { /* Retain last known addresses; never retry a write. */ }
    } finally { this.busy = false; this.changed(); }
  }
  async load(automatic = true) {
    await this.run(async () => {
      this.accept(await this.request(), true);
      // Startup may already be checking. Read back that result instead of duplicating its MA request.
      for (let n = 0; this.view!.mediaCheck.status === 'checking' && n < 120; n++) {
        await new Promise(resolve => setTimeout(resolve, 250)); this.accept(await this.request());
      }
      if (automatic && this.view!.configured && this.view!.mediaCheck.status !== 'checking') await this.check();
    });
  }
  private async check() {
    const view = this.view!;
    const candidates = view.mediaOrigin ? [view.mediaOrigin] : [...new Set([inIngress() ? undefined : location.origin, view.automaticMediaOrigin, view.guestOrigin].filter((value): value is string => Boolean(value)))].slice(0, 3);
    if (view.mediaCheck.status === 'verified' && view.mediaCheck.origin === candidates[0]) return;
    this.accept(await this.request('/test', { origins: candidates, revision: view.revision, automatic: !view.mediaOrigin }));
  }
  private button(text: string, work: () => Promise<void>) {
    const button = el('button', text, 'secondary'); button.type = 'button'; button.disabled = this.busy || this.blocked() || !navigator.onLine;
    button.dataset.focusKey = text; button.onclick = () => { void this.run(work); }; return button;
  }
  private field(text: string, id: string, value: string, change: (text: string) => void) {
    const group = el('div', undefined, 'field'); const label = el('label', text); label.htmlFor = id;
    const input = el('input'); input.id = id; input.type = 'url'; input.value = value; input.maxLength = 2048; input.disabled = this.busy || this.blocked();
    input.oninput = () => change(input.value); group.append(label, input); return { group, input };
  }
  render() {
    const panel = el('section', undefined, 'panel settings-card settings-addressing'); panel.setAttribute('aria-labelledby', 'settings-addressing-title');
    const title = el('h2', 'Application addresses'); title.id = 'settings-addressing-title'; panel.append(title);
    if (!this.view) panel.append(el('p', 'Loading address settings…', 'muted'));
    else {
      const view = this.view;
      panel.append(el('p', `Guest links: ${view.guestOrigin}`, 'saved-address'));
      if (view.guestOrigin !== location.origin) {
        const link = el('a', 'Open saved guest address', 'button secondary'); link.href = `${view.guestOrigin}/host/settings`; panel.append(link);
      }
      if (new URL(view.guestOrigin).hostname === 'localhost' || /^127\./.test(new URL(view.guestOrigin).hostname)) panel.append(el('p', 'Guest links work only on this device. Choose a LAN address to share the room.', 'muted small'));
      const guestSettings = el('details', undefined, 'settings-address-help'); guestSettings.open = this.guestExpanded;
      guestSettings.append(el('summary', 'Change guest address'));
      guestSettings.ontoggle = () => { if (guestSettings.isConnected) this.guestExpanded = guestSettings.open; };
      guestSettings.append(el('p', 'Changing address may require people to rejoin or recover their private lists. Keep recovery keys before switching.', 'muted small'));
      if (!inIngress()) guestSettings.append(this.button('Use the address I opened for guest links', async () => {
        this.accept(await this.request('/guest', { origin: location.origin, revision: this.view!.revision }), true);
        this.notice = 'Guest address saved.';
        if (this.view!.configured && this.view!.guestOrigin === location.origin) await this.check();
      }));
      else guestSettings.append(el('p', 'Guests need a LAN address, not the Home Assistant host interface.', 'muted small'));
      const guestForm = el('form', undefined, 'integration-form');
      const guest = this.field('Guest address', 'app-guest-origin', this.guestDraft, value => { this.guestDraft = value; }); guest.input.required = true;
      const save = el('button', 'Save guest address'); save.type = 'submit'; save.disabled = this.busy || this.blocked() || !navigator.onLine;
      guestForm.append(guest.group, save);
      guestForm.onsubmit = event => { event.preventDefault(); void this.run(async () => {
        this.accept(await this.request('/guest', { origin: this.guestDraft.trim(), revision: this.view!.revision }), true);
        this.notice = 'Guest address saved.';
        if (this.view!.configured && this.view!.guestOrigin === location.origin) await this.check();
      }); }; guestSettings.append(guestForm); panel.append(guestSettings);
      panel.append(el('p', `File access: ${view.effectiveMediaOrigin}${view.mediaOrigin ? ' (manual)' : ' (automatic)'}`, 'saved-address'));
      const status = this.busy ? 'Checking file access…' : !view.configured ? 'Connect Music Assistant to enable file access.'
        : view.mediaCheck.status === 'verified' ? 'File access verified.' : view.mediaCheck.message;
      const message = el('p', status,
        `small ${view.mediaCheck.status === 'failed' ? 'error' : view.mediaCheck.status === 'verified' ? 'success' : 'muted'}`);
      message.setAttribute('role', 'status'); panel.append(message);
      if (view.mediaCheck.status === 'verified' && view.mediaCheck.origin !== view.effectiveMediaOrigin) panel.append(el('p', 'The candidate works but has not replaced the selected address. Finish owned playback or review the manual override before changing it.', 'muted small'));
      const test = this.button('Test file connection', async () => {
        this.view = { ...this.view!, mediaCheck: { ...this.view!.mediaCheck, status: 'unchecked' } }; await this.check();
      }); test.disabled ||= !view.configured; if (view.configured) panel.append(test);
      const advanced = el('details', undefined, 'settings-address-help'); advanced.open = this.advanced;
      const summary = el('summary', 'Advanced address override'); summary.id = 'app-address-advanced'; advanced.append(summary);
      advanced.ontoggle = () => { if (advanced.isConnected) this.advanced = advanced.open; };
      if (view.mediaCheck.origin) advanced.append(el('p', `Last tested: ${view.mediaCheck.origin}`, 'muted small'));
      advanced.append(el('p', 'File checks use Music Assistant and never play audio.', 'muted small'));
      const form = el('form', undefined, 'integration-form');
      const media = this.field('Application address reachable from Music Assistant', 'upload-media-origin', this.mediaDraft, value => { this.mediaDraft = value; }); media.input.placeholder = 'Automatic';
      const saveMedia = el('button', 'Save file playback address'); saveMedia.type = 'submit'; saveMedia.disabled = this.busy || this.blocked() || !navigator.onLine || !view.configured;
      form.append(media.group, el('p', 'Only needed if Music Assistant uses a different address. Overrides must pass a file check; leave empty for automatic selection.', 'muted small'), saveMedia);
      form.onsubmit = event => { event.preventDefault(); void this.run(async () => {
        await requestJson('/api/host/integrations/media-origin', { origin: this.mediaDraft.trim() || null, revision: this.view!.revision }, 60_000);
        this.accept(await this.request(), true); this.notice = 'File playback address saved.';
        if (!this.view!.mediaOrigin) await this.check();
      }); }; advanced.append(form); panel.append(advanced);
    }
    if (this.error) { const error = el('p', this.error, 'error'); error.setAttribute('role', 'alert'); panel.append(error); }
    if (this.notice) { const notice = el('p', this.notice, 'success'); notice.setAttribute('role', 'status'); panel.append(notice); }
    return panel;
  }
}
