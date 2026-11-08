import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { z } from 'zod';
import { readPrivateJson, writePrivateJson } from './store.js';
import { SerialQueue } from './serial.js';
import { durability } from './backup.js';
import { AppError, type GuestAccess } from './model.js';
import { tailscaleApproval, tailscaleHost, type TunnelConnector } from './tailscale.js';

const secret = () => randomBytes(32).toString('base64url');
const schema = z.object({ schema: z.literal(1), enabled: z.boolean(), key: z.string().regex(/^[\w-]{43}$/), revision: z.number().int().nonnegative() }).strict();
type State = z.infer<typeof schema>;
export type OnlineView = { available: boolean; enabled: boolean; revision: number; status: 'disabled' | 'connecting' | 'login' | 'approval' | 'checking' | 'ready' | 'offline' | 'error';
  message: string; approvalUrl?: string; origin?: string; joinUrl?: string; checkedAt?: number; keyExpiry?: string };
export const grantLifetime = 7 * 24 * 60 * 60_000;
const equal = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export class OnlineAccess extends EventEmitter {
  private saved: State = { schema: 1, enabled: false, key: secret(), revision: 0 };
  private state: OnlineView;
  private queue = new SerialQueue(8);
  private timer?: NodeJS.Timeout;
  private refreshing?: Promise<void>;
  private epoch = 0;
  private closed = false;
  private blocked = false;
  private probe = '';
  private accepting = false;
  constructor(private directory: string, private connector?: TunnelConnector, private verify = verifyPublic, private now = Date.now) {
    super(); this.state = { available: Boolean(connector), enabled: false, revision: 0, status: 'disabled', message: 'Enable online invitations to let friends join without your Wi-Fi.' };
  }
  async init() {
    try { this.saved = await readPrivateJson(join(this.directory, 'online-access.json'), schema, 4096) ?? this.saved; }
    catch { this.blocked = true; this.update('error', 'Online settings could not be read. Restore a valid backup; local access is still available.'); return; }
    if (this.saved.enabled) this.update('connecting', 'Reconnecting online invitations…');
  }
  get enabled() { return this.saved.enabled && !this.blocked && !this.closed; }
  get origin() { return this.enabled && this.accepting ? this.state.origin : undefined; }
  view(): OnlineView { return { ...this.state, enabled: this.enabled, revision: this.saved.revision, ...(this.state.status === 'ready' && this.origin ? { joinUrl: this.invitation('/join') } : {}) }; }
  private invitation(path: string) { return `${this.state.origin}${path}#online=${this.sign('invite')}`; }
  sharing(): { guestAccess: GuestAccess; joinUrl?: string; displayUrl?: string } | undefined {
    if (!this.enabled) return;
    const ready = this.state.status === 'ready' && Boolean(this.origin);
    return { guestAccess: { status: ready ? 'ready' : this.state.status === 'connecting' || this.state.status === 'checking' ? 'checking' : 'unavailable', source: 'online', message: this.state.message },
      ...(ready ? { joinUrl: this.invitation('/join'), displayUrl: this.invitation('/display') } : {}) };
  }
  private sign(value: string) { return createHmac('sha256', this.saved.key).update(value).digest('base64url'); }
  redeem(invitation: string): string | undefined {
    if (!this.origin || !/^[\w-]{43}$/.test(invitation) || !equal(invitation, this.sign('invite'))) return;
    const value = `${this.now() + grantLifetime}.${secret()}`;
    return `${value}.${this.sign(`grant:${value}`)}`;
  }
  authorized(cookie: string) {
    const match = /^(\d{13})\.([\w-]{43})\.([\w-]{43})$/.exec(cookie);
    return Boolean(this.origin && match && Number(match[1]) > this.now() && Number(match[1]) <= this.now() + grantLifetime && equal(match[3]!, this.sign(`grant:${match[1]}.${match[2]}`)));
  }
  probeResponse(value: string) { return this.enabled && this.probe && value === this.probe ? this.sign(`probe:${value}`) : undefined; }
  async change(action: 'enable' | 'disable' | 'rotate', revision: number) {
    return this.queue.run(async () => {
      if (this.closed || this.blocked || !this.connector) throw new AppError(503, 'Online invitations are unavailable. Check the app installation and saved settings.');
      if (revision !== this.saved.revision) throw new AppError(409, 'Online settings changed. Refresh and try again.');
      const next = { ...this.saved, enabled: action === 'enable' || action === 'rotate' && this.saved.enabled, key: secret(), revision: revision + 1 };
      // Close existing public streams before a revocation, including an uncertain disk outcome.
      this.epoch++; this.accepting = false; this.emit('revoke');
      try { await writePrivateJson(this.directory, 'online-access.json', next, 4096); }
      catch { this.blocked = true; this.update('error', 'Online settings could not be saved. Restart after checking storage.'); await this.connector.stop(); throw new AppError(503, this.state.message); }
      this.saved = next; this.state = { ...this.state, approvalUrl: undefined, origin: undefined, checkedAt: undefined };
      await this.connector.stop();
      if (!next.enabled) { this.update('disabled', 'Online invitations are off. Use the local guest link on your Wi-Fi.'); }
      else { this.update('connecting', 'Connecting securely…'); }
      this.start(); return this.view();
    });
  }
  start() {
    if (this.closed) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { void this.refresh().finally(() => this.start()); }, this.state.status === 'ready' ? 30_000 : 5000); this.timer.unref();
  }
  refresh() {
    if (this.refreshing) return this.refreshing;
    this.refreshing = this.inspect().finally(() => { this.refreshing = undefined; }); return this.refreshing;
  }
  private update(status: OnlineView['status'], message: string, extra: Partial<OnlineView> = {}) {
    const previous = JSON.stringify(this.view());
    this.state = { ...this.state, status, message, ...extra };
    if (JSON.stringify(this.view()) !== previous) this.emit('change');
  }
  private async inspect() {
    if (!this.enabled || !this.connector || durability.paused || this.queue.busy) return;
    const epoch = this.epoch;
    const current = () => this.enabled && epoch === this.epoch && !durability.paused && !this.queue.busy;
    const approval = (url: string) => { if (current() && tailscaleApproval(url)) this.update(url.includes('/a/') ? 'login' : 'approval', url.includes('/a/') ? 'Sign in to Tailscale to connect this installation.' : 'Approve HTTPS and Funnel in Tailscale, then return here.', { approvalUrl: url }); };
    try {
      await this.connector.start();
      const status = await this.connector.status(); if (!current()) return;
      if (status.BackendState !== 'Running') {
        this.accepting = false; this.emit('revoke');
        if (status.BackendState === 'NeedsMachineAuth') { this.update('approval', 'Approve this device in the Tailscale admin console.', { approvalUrl: 'https://login.tailscale.com/admin/machines' }); return; }
        this.update('connecting', 'Connecting to Tailscale…');
        if (status.AuthURL) approval(status.AuthURL);
        this.connector.connect(approval); return;
      }
      const host = tailscaleHost(status.Self?.DNSName);
      if (!host || status.Self?.Online !== true) throw new Error('Offline');
      const configured = await this.connector.configured(host); if (!current()) return;
      if (!configured) {
        this.accepting = false; this.emit('revoke');
        if (this.state.status !== 'approval') this.update('checking', 'Preparing the guest-only HTTPS tunnel…');
        this.connector.publish(approval); return;
      }
      this.accepting = true;
      this.state = { ...this.state, origin: `https://${host}`, approvalUrl: undefined, keyExpiry: status.Self?.KeyExpiry };
      this.probe = secret();
      const ok = await this.verify(this.state.origin!, this.probe, this.sign(`probe:${this.probe}`));
      this.probe = ''; if (!current()) return;
      this.update(ok ? 'ready' : 'offline', ok ? 'Online invitations ready. Friends can join using mobile data or any Wi-Fi.' : 'Public reachability could not be confirmed. Check internet access; reconnection is automatic.', { checkedAt: this.now() });
    } catch {
      if (current()) { this.accepting = false; this.emit('revoke'); this.update('offline', 'Waiting for the secure connection. Check internet access and Tailscale approval; retrying automatically.', { checkedAt: this.now() }); }
    }
  }
  async pause() { this.epoch++; this.accepting = false; this.emit('revoke'); if (this.enabled) this.update('connecting', 'Reconnecting online invitations…'); await this.connector?.stop(); }
  async close() { this.closed = true; clearTimeout(this.timer); await this.pause(); await this.queue.drain(); }
}

async function verifyPublic(origin: string, challenge: string, expected: string) {
  try {
    const response = await fetch(`${origin}/api/online/probe?challenge=${challenge}`, { redirect: 'error', signal: AbortSignal.timeout(8000), headers: { Accept: 'text/plain' } });
    if (response.status !== 200) { await response.body?.cancel(); return false; }
    const reader = response.body?.getReader(); if (!reader) return false;
    let text = '';
    try { for (;;) { const part = await reader.read(); if (part.done) break; text += Buffer.from(part.value).toString(); if (text.length > 128) return false; } }
    finally { await reader.cancel(); }
    return text === expected;
  } catch { return false; }
}
