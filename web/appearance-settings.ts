import type { RoomLogoView } from '../src/model';
import { el } from './dom';
import { actionGroup, panel, sectionHeading } from './ui-components';
import { ViewNodes, attr, children, prop } from './view-nodes';
import { appPath } from './paths';
import { requestJson } from './request';
import { onRoomLogo, roomLogo, roomLogoMark, setRoomLogo } from './room-logo';

const maxBytes = 10 * 1024 * 1024;
const accepted = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'];

/** Settings → Appearance: upload, preview, replace or remove the room's logo. */
export class AppearancePanel {
  readonly element = panel('settings-card settings-logo');
  private nodes = new ViewNodes();
  private busy: '' | 'upload' | 'remove' = '';
  private message = '';
  private failed = false;

  constructor(private signal: AbortSignal) {
    this.element.setAttribute('aria-labelledby', 'settings-logo-title');
    onRoomLogo(() => this.render(), signal);
    this.render();
    void requestJson<{ logo: RoomLogoView | null }>('/api/logo', undefined, 15_000, signal)
      .then(result => setRoomLogo(result.logo)).catch(() => {});
  }

  render() {
    if (this.signal.aborted) return;
    const v = this.nodes; const logo = roomLogo();
    const heading = v.get('heading', () => sectionHeading('Room logo', 'settings-logo-title', 'h3'));
    const badge = v.el('badge', 'span', this.busy === 'upload' ? 'Uploading…' : this.busy === 'remove' ? 'Removing…' : logo ? 'Shown' : 'Not set', 'badge settings-state');
    attr(badge, 'role', 'status');
    children(heading, heading.firstElementChild!, badge);
    const intro = v.el('intro', 'p', 'Shown at the top right of the room display, whatever is playing, and above the join form on guests’ phones. It is drawn in the room’s gold, so any logo sits naturally on the display.');
    const previews = v.get('previews', () => {
      const wrap = el('div', undefined, 'logo-previews'); wrap.setAttribute('aria-hidden', 'true');
      const display = el('div', undefined, 'logo-preview-display');
      display.append(el('span', undefined, 'logo-preview-line'), el('span', undefined, 'logo-preview-line is-short'), roomLogoMark('logo-preview-mark'), el('span', undefined, 'logo-preview-code'));
      const phone = el('div', undefined, 'logo-preview-phone');
      phone.append(roomLogoMark('logo-preview-mark'), el('span', undefined, 'logo-preview-card'));
      const figure = (screen: HTMLElement, caption: string) => { const node = el('figure', undefined, 'logo-preview'); node.append(screen, el('figcaption', caption)); return node; };
      wrap.append(figure(display, 'Room display, in every state'), figure(phone, 'Join page'));
      return wrap;
    });
    const empty = v.el('empty', 'p', 'No logo yet. The room display and the join page look as they do today until you upload one.', 'muted logo-empty-note');
    prop(empty, 'hidden', Boolean(logo));
    const file = v.get('file', () => {
      const input = el('input'); input.type = 'file'; input.id = 'room-logo-file'; input.className = 'sr-only';
      input.accept = accepted.join(','); input.tabIndex = -1; input.setAttribute('aria-hidden', 'true');
      input.onchange = () => { const chosen = input.files?.[0]; input.value = ''; if (chosen) void this.upload(chosen); };
      return input;
    });
    const choose = v.el('choose', 'button', logo ? 'Replace logo' : 'Upload logo');
    prop(choose, 'type', 'button'); prop(choose, 'disabled', Boolean(this.busy)); choose.onclick = () => file.click();
    const remove = v.el('remove', 'button', 'Remove logo', 'secondary');
    prop(remove, 'type', 'button'); prop(remove, 'hidden', !logo); prop(remove, 'disabled', Boolean(this.busy));
    remove.onclick = () => { void this.remove(); };
    const actions = v.get('actions', () => actionGroup('inline'));
    children(actions, choose, remove, file);
    const status = v.el('status', 'p', this.message, this.failed ? 'field-error' : 'muted small');
    attr(status, 'role', this.failed ? 'alert' : 'status');
    prop(status, 'hidden', !this.message);
    const hint = v.el('hint', 'p', 'PNG, JPEG, WebP or SVG, up to 10 MB. A transparent PNG or an SVG works best. Light-on-dark and dark-on-light images are converted automatically.', 'muted field-hint');
    children(this.element, heading, intro, previews, empty, actions, status, hint);
  }

  private async upload(file: File) {
    if (this.busy) return;
    if (file.size > maxBytes) { this.report('The logo file is larger than 10 MB. Export a smaller PNG or SVG.', true); return; }
    if (file.type && !accepted.includes(file.type)) { this.report('Use a PNG, JPEG, WebP or SVG image.', true); return; }
    this.busy = 'upload'; this.message = ''; this.render();
    try {
      const response = await fetch(appPath('/api/host/logo'), { method: 'POST', cache: 'no-store', body: file,
        headers: { 'Content-Type': 'application/octet-stream' }, signal: AbortSignal.any([this.signal, AbortSignal.timeout(60_000)]) });
      const payload = await response.json().catch(() => undefined) as { logo?: RoomLogoView | null; error?: string } | undefined;
      if (!response.ok || !payload?.logo) throw new Error(payload?.error ?? 'The logo could not be uploaded. Try again.');
      setRoomLogo(payload.logo);
      this.busy = ''; this.report('Logo saved. The room display and join page show it now.', false);
    } catch (error) {
      this.busy = '';
      if (this.signal.aborted) return;
      this.report(error instanceof Error && error.name === 'TimeoutError' ? 'The upload took too long. Check the connection and try again.'
        : error instanceof Error ? error.message : 'The logo could not be uploaded. Try again.', true);
    }
  }

  private async remove() {
    if (this.busy) return;
    this.busy = 'remove'; this.message = ''; this.render();
    try {
      await requestJson('/api/host/logo/remove', {}, 15_000, this.signal);
      setRoomLogo(null);
      this.busy = ''; this.report('Logo removed. The room display and join page look as they did before.', false);
    } catch (error) {
      this.busy = '';
      if (this.signal.aborted) return;
      this.report(error instanceof Error ? error.message : 'The logo could not be removed. Try again.', true);
    }
  }

  private report(message: string, failed: boolean) { this.message = message; this.failed = failed; this.render(); }
}
