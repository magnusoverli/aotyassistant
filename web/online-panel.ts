import type { OnlineView } from '../src/online-access';
import { el } from './dom';
import { inIngress } from './paths';
import { requestJson } from './request';
import { ViewNodes, children, prop, attr } from './view-nodes';

export function onlineConnection(network: NonNullable<OnlineView['network']>) {
  const path = network.udp === false ? ' Relayed by Tailscale: this network blocks the UDP traffic direct connections need, so online guests may be slower.'
    : network.udp ? ' Direct connections are available.' : '';
  return `Online round trip from this server: ${network.roundTripMs} ms.${path}`;
}

export class OnlinePanel {
  readonly element = el('section', undefined, 'panel stack');
  private nodes = new ViewNodes();
  private view?: OnlineView;
  private error = '';
  private notice = '';
  private busy = false;
  private generation = 0;
  private timer?: ReturnType<typeof setTimeout>;
  constructor(private signal: AbortSignal) {
    this.element.setAttribute('aria-label', 'Online invitations');
    signal.addEventListener('abort', () => clearTimeout(this.timer), { once: true });
    this.render(); if (inIngress()) void this.refresh();
  }
  private async refresh() {
    const generation = this.generation;
    try {
      const view = await requestJson<OnlineView>('/api/host/online', undefined, 12_000, this.signal);
      if (generation === this.generation && !this.busy) { this.view = view; this.error = ''; }
    }
    catch { if (!this.signal.aborted && generation === this.generation && !this.busy) this.error = 'Online status could not be refreshed. Check your connection to Home Assistant.'; }
    finally {
      if (!this.signal.aborted) { this.render(); this.timer = setTimeout(() => { void this.refresh(); }, 5000); }
    }
  }
  private async change(action: 'enable' | 'disable' | 'rotate') {
    if (this.busy || !this.view) return;
    if (action === 'rotate' && !confirm('Replace the invitation? Previous links and online access on all guest devices will stop working. Share the new QR code or link; playlists and PINs are kept.')) return;
    if (action === 'disable' && !confirm('Turn off online invitations? Online guests will be disconnected. Local access and speaker playback will continue.')) return;
    this.generation++; this.busy = true; this.error = ''; this.notice = ''; this.render();
    try { this.view = await requestJson<OnlineView>('/api/host/online', { action, revision: this.view.revision }, 15_000, this.signal); }
    catch (error) { if (!this.signal.aborted) this.error = error instanceof Error ? error.message : 'The change was not confirmed. Refresh before trying again.'; }
    finally { this.busy = false; if (!this.signal.aborted) this.render(); }
  }
  private render() {
    const v = this.nodes;
    const content: Node[] = [v.el('title', 'h2', 'Online invitations'), v.el('intro', 'p', 'Friends scan the room QR code or open your invitation on any Wi-Fi or mobile data. They do not need Tailscale or a Home Assistant account.', 'muted')];
    if (!inIngress()) { content.push(v.el('ha', 'p', 'Open Listening Room from Home Assistant to enable and manage online invitations.')); children(this.element, ...content); return; }
    if (this.error) { const error = v.el('error', 'p', this.error, 'error'); attr(error, 'role', 'alert'); content.push(error); }
    const view = this.view;
    if (!view) content.push(v.el('loading', 'p', 'Loading online settings…'));
    else {
      const status = v.el('status', 'p', view.message); attr(status, 'role', 'status'); content.push(status);
      const button = (id: string, label: string, action: 'enable' | 'disable' | 'rotate') => {
        const node = v.el(id, 'button', this.busy ? 'Saving…' : label, action === 'enable' ? '' : 'secondary'); prop(node, 'type', 'button'); prop(node, 'disabled', this.busy || !view.available || Boolean(this.error)); node.onclick = () => { void this.change(action); }; return node;
      };
      if (!view.available) content.push(v.el('unavailable', 'p', 'The connector is included in the Home Assistant app image. Update the app if this installation is missing it.', 'muted'));
      else if (!view.enabled) {
        content.push(v.el('steps', 'p', 'One-time setup: enable below, sign in to a Tailscale account, then approve HTTPS and Funnel. No separate add-on, domain, router settings, or keys to copy.'));
        content.push(button('enable', 'Enable online invitations', 'enable'));
      } else {
        if (view.approvalUrl) {
          const approval = v.el('approval', 'a', view.status === 'login' ? 'Sign in to Tailscale' : 'Approve in Tailscale', 'button');
          attr(approval, 'href', view.approvalUrl); prop(approval, 'target', '_blank'); prop(approval, 'rel', 'noopener noreferrer'); content.push(approval);
          content.push(v.el('return', 'p', 'Complete the Tailscale page, then return here. This screen updates automatically.', 'muted small'));
        }
        if (view.joinUrl && !this.error) {
          const label = v.el('link-label', 'label', 'Invitation link'); prop(label, 'htmlFor', 'online-invitation');
          const input = v.el('link-value', 'input'); prop(input, 'id', 'online-invitation'); prop(input, 'readOnly', true); prop(input, 'value', view.joinUrl); input.onclick = () => input.select();
          const copy = v.el('copy', 'button', 'Copy invitation', 'secondary'); prop(copy, 'type', 'button');
          copy.onclick = () => { void (async () => {
            try { await navigator.clipboard.writeText(view.joinUrl!); this.notice = 'Invitation copied. Share it only with people you want in the room.'; }
            catch { input.focus(); input.select(); this.notice = 'Select and copy the invitation link above.'; }
            if (!this.signal.aborted) this.render();
          })(); };
          const open = v.el('open', 'a', 'Open invitation', 'button secondary'); attr(open, 'href', view.joinUrl); prop(open, 'target', '_blank'); prop(open, 'rel', 'noopener noreferrer');
          content.push(label, input, copy, open, v.el('qr', 'p', 'Host desk and Room display now use this online invitation automatically. Test it on a phone with Wi-Fi turned off.', 'muted small'));
        }
        if (view.origin) content.push(v.el('origin', 'p', `Your stable address: ${view.origin}`, 'muted small'));
        if (view.status === 'ready' && view.network) content.push(v.el('network', 'p', onlineConnection(view.network), 'muted small'));
        if (view.keyExpiry && Number.isFinite(Date.parse(view.keyExpiry)) && Date.parse(view.keyExpiry) > 0) content.push(v.el('expiry', 'p', `Tailscale device authorization expires ${new Date(view.keyExpiry).toLocaleDateString()}. Renew it in Tailscale, or disable key expiry for this trusted device in its device settings.`, 'muted small'));
        const admin = v.el('admin', 'a', 'Tailscale device settings', 'inline-link'); attr(admin, 'href', 'https://login.tailscale.com/admin/machines'); prop(admin, 'target', '_blank'); prop(admin, 'rel', 'noopener noreferrer'); content.push(admin);
        content.push(button('rotate', 'Replace invitation', 'rotate'), button('disable', 'Turn off online invitations', 'disable'));
      }
    }
    if (this.notice) { const note = v.el('notice', 'p', this.notice); attr(note, 'role', 'status'); content.push(note); }
    content.push(v.el('privacy', 'p', 'An invitation grants access to the room; keep it private. Replace it to revoke old links and online guest sessions. Host administration stays in Home Assistant. Music Assistant and the speaker still need to reach each other locally.', 'muted small'));
    children(this.element, ...content);
  }
}
