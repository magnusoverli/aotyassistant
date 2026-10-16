import type { AddressingView } from '../src/addressing';
import { el } from './dom';
import { requestJson } from './request';

/** Suggestions are not trusted until explicit guest selection or an observed MA fetch. */
export class AddressingPanel {
  view?: AddressingView;
  busy = false;
  private error = '';
  private notice = '';
  private guestDraft = '';
  private mediaDraft = '';
  private advanced = false;
  constructor(private changed: () => void, private saved: (revision: number) => void, private blocked: () => boolean) {}
  private async request(path = '', data?: unknown): Promise<AddressingView> {
    return requestJson<AddressingView>(`/api/host/addressing${path}`, data, 60_000);
  }
  private accept(view: AddressingView, drafts = false) {
    this.view = view; this.saved(view.revision);
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
    const candidates = view.mediaOrigin ? [view.mediaOrigin] : [...new Set([location.origin, view.automaticMediaOrigin, view.guestOrigin].filter((value): value is string => Boolean(value)))].slice(0, 3);
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
      panel.append(el('p', `Guest links: ${view.guestOrigin}`, 'saved-address'), el('p', `Address opened in this browser: ${location.origin}`, 'muted small'));
      if (view.guestOrigin !== location.origin) {
        const link = el('a', 'Open saved guest address', 'button secondary'); link.href = `${view.guestOrigin}/host/settings`; panel.append(link);
      }
      panel.append(el('p', 'Changing hostname or IP changes the browser’s cookie scope. Keep private-list recovery keys; people may need to rejoin or recover their list at the new address.', 'muted small'));
      if (new URL(location.origin).hostname === 'localhost' || /^127\./.test(new URL(location.origin).hostname)) panel.append(el('p', 'Loopback addresses work only on this device. Open the app through a LAN hostname or address before sharing guest links.', 'muted small'));
      panel.append(this.button('Use the address I opened for guest links', async () => {
        this.accept(await this.request('/guest', { origin: location.origin, revision: this.view!.revision }), true);
        this.notice = 'Guest address saved. Existing participant and private-list credentials were not changed.';
        if (this.view!.configured && this.view!.guestOrigin === location.origin) await this.check();
      }));
      const guestForm = el('form', undefined, 'integration-form');
      const guest = this.field('Guest address', 'app-guest-origin', this.guestDraft, value => { this.guestDraft = value; }); guest.input.required = true;
      const save = el('button', 'Save guest address'); save.type = 'submit'; save.disabled = this.busy || this.blocked() || !navigator.onLine;
      guestForm.append(guest.group, save);
      guestForm.onsubmit = event => { event.preventDefault(); void this.run(async () => {
        this.accept(await this.request('/guest', { origin: this.guestDraft.trim(), revision: this.view!.revision }), true);
        this.notice = 'Guest address saved. Use the new address for invitations and display links.';
        if (this.view!.configured && this.view!.guestOrigin === location.origin) await this.check();
      }); }; panel.append(guestForm);
      panel.append(el('p', `File access: ${view.effectiveMediaOrigin}${view.mediaOrigin ? ' (manual)' : ' (automatic)'}`, 'saved-address'));
      const message = el('p', this.busy ? 'Checking addresses… No audio will be played.' : view.mediaCheck.message,
        `small ${view.mediaCheck.status === 'failed' ? 'error' : view.mediaCheck.status === 'verified' ? 'success' : 'muted'}`);
      message.setAttribute('role', 'status'); panel.append(message);
      if (view.mediaCheck.origin) panel.append(el('p', `Last tested: ${view.mediaCheck.origin}`, 'muted small'));
      if (view.mediaCheck.status === 'verified' && view.mediaCheck.origin !== view.effectiveMediaOrigin) panel.append(el('p', 'The candidate works but has not replaced the selected address. Finish owned playback or review the manual override before changing it.', 'muted small'));
      const test = this.button('Test file connection', async () => {
        this.view = { ...this.view!, mediaCheck: { ...this.view!.mediaCheck, status: 'unchecked' } }; await this.check();
      }); test.disabled ||= !view.configured; panel.append(test);
      if (!view.configured) panel.append(el('p', 'Save a Music Assistant connection to verify file access automatically. A speaker is not required for this check.', 'muted small'));
      panel.append(el('p', 'Suggestions are tried through Music Assistant, not just this browser. A successful check selects the automatic media address when safe; failures keep saved addresses. No playback or library import is performed.', 'muted small'));
      const advanced = el('details', undefined, 'settings-address-help'); advanced.open = this.advanced;
      const summary = el('summary', 'Advanced address override'); summary.id = 'app-address-advanced'; advanced.append(summary);
      advanced.ontoggle = () => { if (advanced.isConnected) this.advanced = advanced.open; };
      const form = el('form', undefined, 'integration-form');
      const media = this.field('Application address reachable from Music Assistant', 'upload-media-origin', this.mediaDraft, value => { this.mediaDraft = value; }); media.input.placeholder = 'Automatic';
      const saveMedia = el('button', 'Save file playback address'); saveMedia.type = 'submit'; saveMedia.disabled = this.busy || this.blocked() || !navigator.onLine || !view.configured;
      form.append(media.group, el('p', 'Use this only if Music Assistant needs a different app address (for example, behind a reverse proxy). Non-empty overrides must pass a real MA fetch before saving. Leave empty to return to automatic selection.', 'muted small'), saveMedia);
      form.onsubmit = event => { event.preventDefault(); void this.run(async () => {
        await requestJson('/api/host/integrations/media-origin', { origin: this.mediaDraft.trim() || null, revision: this.view!.revision }, 60_000);
        this.accept(await this.request(), true); this.notice = 'File playback address saved. No audio was started.';
        if (!this.view!.mediaOrigin) await this.check();
      }); }; advanced.append(form); panel.append(advanced);
    }
    if (this.error) { const error = el('p', this.error, 'error'); error.setAttribute('role', 'alert'); panel.append(error); }
    if (this.notice) { const notice = el('p', this.notice, 'success'); notice.setAttribute('role', 'status'); panel.append(notice); }
    return panel;
  }
}
