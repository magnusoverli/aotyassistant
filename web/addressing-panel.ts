import type { AddressingView } from '../src/addressing';
import { fieldControl, panel as createPanel, sectionHeading } from './ui-components';
import { requestJson } from './request';
import { inIngress, setGuestOrigin } from './paths';
import { ViewNodes, children, prop, attr } from './view-nodes';

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
  private loading?: Promise<void>;
  private nodes = new ViewNodes();
  constructor(private changed: () => void, private saved: (revision: number) => void, private blocked: () => boolean, private playbackBlocked = () => false) {}
  private async request(path = '', data?: unknown): Promise<AddressingView> {
    return requestJson<AddressingView>(`/api/host/addressing${path}`, data, 60_000);
  }
  private accept(view: AddressingView, drafts = false) {
    const previous = this.view;
    if (previous && previous.instanceId === view.instanceId && (view.revision < previous.revision ||
      view.sequence !== undefined && previous.sequence !== undefined && view.sequence < previous.sequence)) return;
    this.view = view; this.saved(view.revision);
    setGuestOrigin(view.guestOrigin);
    if (drafts || !previous) {
      if (!previous || this.guestDraft === previous.guestOrigin) this.guestDraft = view.guestOrigin;
      if (!previous || this.mediaDraft === (previous.mediaOrigin ?? '')) this.mediaDraft = view.mediaOrigin ?? '';
    }
  }
  observe(view: AddressingView) { this.accept(view, true); }
  private async run(work: () => Promise<void>) {
    if (this.busy || this.blocked()) return;
    this.busy = true; this.error = ''; this.notice = ''; this.changed();
    try { await work(); }
    catch (error) {
      this.error = error instanceof Error ? error.message : 'Address setup failed. Saved addresses were kept.';
      try { this.accept(await this.request()); } catch { /* Retain last known addresses; never retry a write. */ }
    } finally { this.busy = false; this.changed(); }
  }
  load(automatic = true): Promise<void> {
    if (this.loading) return this.loading;
    const pending = this.run(async () => {
      this.accept(await this.request(), true);
      // Startup may already be checking. Read back that result instead of duplicating its MA request.
      for (let n = 0; this.view!.mediaCheck.status === 'checking' && n < 120; n++) {
        await new Promise(resolve => setTimeout(resolve, 250)); this.accept(await this.request());
      }
      if (automatic && this.view!.configured && this.view!.mediaCheck.status !== 'checking') await this.check();
    }).finally(() => { if (this.loading === pending) this.loading = undefined; });
    this.loading = pending; return pending;
  }
  private async check() {
    const view = this.view!;
    const candidates = view.mediaOrigin ? [view.mediaOrigin] : [...new Set([inIngress() ? undefined : location.origin, view.automaticMediaOrigin, view.guestOrigin].filter((value): value is string => Boolean(value)))].slice(0, 3);
    if (view.mediaCheck.status === 'verified' && view.mediaCheck.origin === candidates[0]) return;
    this.accept(await this.request('/test', { origins: candidates, revision: view.revision, automatic: !view.mediaOrigin }));
  }
  private button(text: string, work: () => Promise<void>, mutation = false) {
    const button = this.nodes.el(`button-${text}`, 'button', text, 'secondary'); prop(button, 'type', 'button');
    prop(button, 'disabled', this.busy || this.blocked() || !navigator.onLine || mutation && this.playbackBlocked());
    attr(button, 'data-focus-key', text); button.onclick = () => { void this.run(work); }; return button;
  }
  private field(text: string, id: string, value: string, change: (text: string) => void) {
    const { group, input } = this.nodes.get(`field-${id}`, () => fieldControl(text, id, 'url')); prop(input, 'value', value); prop(input, 'maxLength', 2048); prop(input, 'disabled', this.busy || this.blocked() || this.playbackBlocked());
    input.oninput = () => change(input.value); return { group, input };
  }
  render() {
    const v = this.nodes;
    const panel = v.get('panel', () => { const node = createPanel('settings-card settings-addressing'); node.setAttribute('aria-labelledby', 'settings-addressing-title'); return node; });
    const content: Node[] = [v.get('heading', () => sectionHeading('Guest access', 'settings-addressing-title', 'h3'))];
    if (!this.view) content.push(v.el('loading', 'p', 'Loading address settings…', 'muted'));
    else {
      const view = this.view;
      if (this.playbackBlocked()) content.push(v.el('blocked', 'p', 'Finish the current song before changing addresses.', 'muted small'));
      content.push(v.el('guest-address', 'p', `Guest links: ${view.guestOrigin}`, 'saved-address'));
      if (view.guestOrigin !== location.origin) {
        const link = v.el('guest-link', 'a', 'Open saved guest address', 'button secondary'); attr(link, 'href', `${view.guestOrigin}/host/settings`); content.push(link);
      }
      if (new URL(view.guestOrigin).hostname === 'localhost' || /^127\./.test(new URL(view.guestOrigin).hostname)) content.push(v.el('local-guest', 'p', 'Guest links work only on this device. Choose a LAN address to share the room.', 'muted small'));
      const guestSettings = v.el('guest-settings', 'details', undefined, 'settings-address-help'); prop(guestSettings, 'open', this.guestExpanded);
      const guestNodes: Node[] = [v.el('guest-summary', 'summary', 'Change guest address')];
      guestSettings.ontoggle = () => { if (guestSettings.isConnected) this.guestExpanded = guestSettings.open; };
      guestNodes.push(v.el('guest-warning', 'p', 'At a new address, people select their name and enter their PIN again. Their playlists are kept. Keep the guest address stable for automatic recognition.', 'muted small'));
      if (!inIngress()) guestNodes.push(this.button('Use this browser address for guest links', async () => {
        if (!this.confirmGuestChange(location.origin)) return;
        this.accept(await this.request('/guest', { origin: location.origin, revision: this.view!.revision }), true);
        this.notice = 'Guest address saved.';
        if (this.view!.configured && this.view!.guestOrigin === location.origin) await this.check();
      }, true));
      else guestNodes.push(v.el('ingress', 'p', 'Guests need a LAN address, not the Home Assistant host interface.', 'muted small'));
      const guestForm = v.el('guest-form', 'form', undefined, 'form-stack integration-form');
      const guest = this.field('Guest address', 'app-guest-origin', this.guestDraft, value => { this.guestDraft = value; }); prop(guest.input, 'required', true);
      const save = v.el('save-guest', 'button', 'Save guest address'); prop(save, 'type', 'submit'); prop(save, 'disabled', this.busy || this.blocked() || !navigator.onLine || this.playbackBlocked());
      children(guestForm, guest.group, save);
      guestForm.onsubmit = event => { event.preventDefault(); void this.run(async () => {
        if (!this.confirmGuestChange(this.guestDraft.trim())) return;
        this.accept(await this.request('/guest', { origin: this.guestDraft.trim(), revision: this.view!.revision }), true);
        this.notice = 'Guest address saved.';
        if (this.view!.configured && this.view!.guestOrigin === location.origin) await this.check();
      }); }; guestNodes.push(guestForm); children(guestSettings, ...guestNodes); content.push(guestSettings, v.el('file-title', 'h3', 'Uploaded-file playback'));
      const status = this.busy ? 'Checking file access…' : !view.configured ? 'Connect Music Assistant to enable file access.'
        : view.mediaCheck.status === 'verified' ? 'File access verified.' : view.mediaCheck.message;
      const message = v.el('file-status', 'p', status,
        `small ${view.mediaCheck.status === 'failed' ? 'error' : view.mediaCheck.status === 'verified' ? 'success' : 'muted'}`);
      attr(message, 'role', 'status'); content.push(message);
      if (view.mediaCheck.status === 'verified' && view.mediaCheck.origin !== view.effectiveMediaOrigin) content.push(v.el('candidate', 'p', 'This address passed the file check but is not selected. Finish the current song or review the manual override before changing it.', 'muted small'));
      const test = this.button('Test file connection', async () => {
        this.view = { ...this.view!, mediaCheck: { ...this.view!.mediaCheck, status: 'unchecked' } }; await this.check();
      }); prop(test, 'disabled', test.disabled || !view.configured); if (view.configured) content.push(test);
      const advanced = v.el('advanced', 'details', undefined, 'settings-address-help'); prop(advanced, 'open', this.advanced);
      const summary = v.el('advanced-summary', 'summary', 'Advanced address override'); prop(summary, 'id', 'app-address-advanced');
      advanced.ontoggle = () => { if (advanced.isConnected) this.advanced = advanced.open; };
      const form = v.el('media-form', 'form', undefined, 'form-stack integration-form');
      const media = this.field('Application address reachable from Music Assistant', 'upload-media-origin', this.mediaDraft, value => { this.mediaDraft = value; }); prop(media.input, 'placeholder', 'Automatic');
      const saveMedia = v.el('save-media', 'button', 'Save file playback address'); prop(saveMedia, 'type', 'submit'); prop(saveMedia, 'disabled', this.busy || this.blocked() || !navigator.onLine || !view.configured || this.playbackBlocked());
      children(form, media.group, v.el('override-help', 'p', 'Only needed if Music Assistant uses a different address. Overrides must pass a file check; leave empty for automatic selection.', 'muted small'), saveMedia);
      form.onsubmit = event => { event.preventDefault(); void this.run(async () => {
        await requestJson('/api/host/integrations/media-origin', { origin: this.mediaDraft.trim() || null, revision: this.view!.revision }, 60_000);
        this.accept(await this.request(), true); this.notice = 'File playback address saved.';
        if (!this.view!.mediaOrigin) await this.check();
      }); }; children(advanced, summary, v.el('file-address', 'p', `File access: ${view.effectiveMediaOrigin}${view.mediaOrigin ? ' (manual)' : ' (automatic)'}`, 'saved-address'),
        view.mediaCheck.origin ? v.el('last-tested', 'p', `Last tested: ${view.mediaCheck.origin}`, 'muted small') : undefined,
        v.el('check-help', 'p', 'File checks use Music Assistant and never play audio.', 'muted small'), form); content.push(advanced);
    }
    if (this.error) { const error = v.el('error', 'p', this.error, 'error'); attr(error, 'role', 'alert'); content.push(error); }
    if (this.notice) { const notice = v.el('notice', 'p', this.notice, 'success'); attr(notice, 'role', 'status'); content.push(notice); }
    children(panel, ...content);
    return panel;
  }
  private confirmGuestChange(origin: string) {
    return origin === this.view?.guestOrigin || confirm(`Change the guest link from ${this.view?.guestOrigin}/join to ${origin}/join? People will need to select their name and enter their PIN at the new address. Their playlists are kept.`);
  }
}
