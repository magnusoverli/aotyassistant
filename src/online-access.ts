import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { z } from 'zod';
import { readPrivateJson, writePrivateJson } from './store.js';
import { SerialQueue } from './serial.js';
import { durability } from './backup.js';
import { AppError, type GuestAccess } from './model.js';
import { tailscaleApproval, tailscaleHost, type TunnelConnector } from './tailscale.js';
import { diagnostics } from './diagnostics.js';

const secret = () => randomBytes(32).toString('base64url');
const schema = z.object({ schema: z.literal(1), enabled: z.boolean(), key: z.string().regex(/^[\w-]{43}$/), revision: z.number().int().nonnegative() }).strict();
type State = z.infer<typeof schema>;
export type OnlineView = { available: boolean; enabled: boolean; revision: number; status: 'disabled' | 'connecting' | 'login' | 'approval' | 'checking' | 'ready' | 'offline' | 'error';
  message: string; approvalUrl?: string; origin?: string; joinUrl?: string; checkedAt?: number; keyExpiry?: string;
  /** This server's own request out through Funnel and back, and whether direct (UDP) connections are possible. */
  network?: { roundTripMs: number; udp?: boolean } };
const netcheckInterval = 30 * 60_000;
/** After a setup step, a restart or an outage, check every second for this long; then every five. */
const promptChecksMs = 3 * 60_000;
/** A new address needs public DNS and an HTTPS certificate before it answers. */
export const firstReachMs = 10 * 60_000;
/** A tunnel command that ends this quickly without a valid result counts as a failed attempt. */
const quickPublishMs = 60_000;
export const invitationGraceMs = 30_000;
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
  private netcheckedAt = -Infinity;
  private udp?: boolean;
  private verifiedOrigin?: string;
  private unavailableSince?: number;
  private polling = false;
  private promptUntil = 0;
  private inspectedAt = -Infinity;
  private recheck = false;
  private awaited?: { origin: string; since: number };
  private failedPublishes = 0;
  private publishAfter = -Infinity;
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
  private get shareable() {
    return this.enabled && this.state.origin === this.verifiedOrigin && Boolean(this.verifiedOrigin) &&
      (this.state.status === 'ready' && Boolean(this.origin) ||
        this.unavailableSince !== undefined && this.now() - this.unavailableSince < invitationGraceMs);
  }
  private forgetVerification() { this.verifiedOrigin = undefined; this.unavailableSince = undefined; }
  private connectionInterrupted() {
    // Repeated failed checks must not restart the grace period.
    if (this.verifiedOrigin && this.unavailableSince === undefined) this.unavailableSince = this.now();
  }
  view(): OnlineView { return { ...this.state, enabled: this.enabled, revision: this.saved.revision, ...(this.shareable ? { joinUrl: this.invitation('/join') } : {}) }; }
  private invitation(path: string) { return `${this.state.origin}${path}#online=${this.sign('invite')}`; }
  sharing(): { guestAccess: GuestAccess; joinUrl?: string; displayUrl?: string } | undefined {
    if (!this.enabled) return;
    const ready = this.state.status === 'ready' && Boolean(this.origin);
    return { guestAccess: { status: ready ? 'ready' : this.state.status === 'connecting' || this.state.status === 'checking' ? 'checking' : 'unavailable', source: 'online', message: this.state.message },
      ...(this.shareable ? { joinUrl: this.invitation('/join'), displayUrl: this.invitation('/display') } : {}) };
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
      this.epoch++; this.accepting = false; this.forgetVerification(); this.emit('revoke');
      try { await writePrivateJson(this.directory, 'online-access.json', next, 4096); }
      catch { this.blocked = true; this.update('error', 'Online settings could not be saved. Restart after checking storage.'); await this.connector.stop(); throw new AppError(503, this.state.message); }
      this.saved = next; this.state = { ...this.state, approvalUrl: undefined, origin: undefined, checkedAt: undefined, network: undefined };
      this.awaited = undefined; this.failedPublishes = 0; this.publishAfter = -Infinity;
      // The new signing key already ends every earlier invitation and grant. A replacement
      // keeps the running tunnel, unless a setup step bound to the old state is still waiting.
      if (action !== 'rotate' || this.connector.busy) await this.connector.stop();
      if (!next.enabled) { this.update('disabled', 'Online invitations are off. Use the local guest link on your Wi-Fi.'); }
      else { this.update('connecting', 'Connecting securely…'); }
      this.checkSoon(); return this.view();
    });
  }
  /** Begin health checks, starting with one right away. */
  start() { this.polling = true; this.checkSoon(); }
  private expectProgress() { this.promptUntil = this.now() + promptChecksMs; }
  /** A step just finished: check again now, yet never within a second of the previous check. */
  private checkSoon() { this.expectProgress(); this.recheck = true; this.schedule(this.gap()); }
  private gap() { return Math.max(0, this.inspectedAt + 1000 - performance.now()); }
  private schedule(delay: number) {
    if (this.closed || !this.polling) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.recheck = false;
      // A check already under way may predate the event that asked for this one.
      const fresh = () => this.refresh(); const running = this.refreshing;
      void (running ? running.then(fresh, fresh) : fresh()).finally(() => this.schedule(this.recheck ? this.gap()
        : this.state.status === 'ready' ? 30_000 : this.now() < this.promptUntil ? 1000 : 5000));
    }, delay); this.timer.unref();
  }
  refresh() {
    if (this.refreshing) return this.refreshing;
    this.refreshing = this.inspect().finally(() => { this.refreshing = undefined; }); return this.refreshing;
  }
  private update(status: OnlineView['status'], message: string, extra: Partial<OnlineView> = {}) {
    // Room pages show only the shared status and links. Check times and measurements are read
    // by Settings on its own schedule, so they must not resend the room to every open page.
    const shown = () => JSON.stringify([this.state.status, this.sharing()]);
    const previous = shown();
    if (this.state.status === 'ready' && status !== 'ready') this.expectProgress(); // Notice recovery promptly.
    this.state = { ...this.state, status, message, ...extra };
    if (shown() !== previous) this.emit('change');
  }
  private async inspect() {
    if (durability.paused) this.expectProgress(); // Reconnect promptly when the backup finishes.
    if (!this.enabled || !this.connector || durability.paused || this.queue.busy) return;
    this.inspectedAt = performance.now();
    const epoch = this.epoch;
    const current = () => this.enabled && epoch === this.epoch && !durability.paused && !this.queue.busy;
    const approval = (url: string) => { if (current() && tailscaleApproval(url)) this.update(url.includes('/a/') ? 'login' : 'approval', url.includes('/a/') ? 'Sign in to Tailscale to connect this installation.' : 'Approve HTTPS and Funnel in Tailscale, then return here.', { approvalUrl: url }); };
    // Sign-in or approval was just completed (or the command gave up): look at the result now.
    const settled = () => { if (epoch === this.epoch) this.checkSoon(); };
    try {
      await this.connector.start();
      const status = await this.connector.status(); if (!current()) return;
      if (status.BackendState !== 'Running') {
        this.connectionInterrupted();
        this.accepting = false; this.emit('revoke');
        if (status.BackendState === 'NeedsMachineAuth' || status.BackendState === 'NeedsLogin') this.forgetVerification();
        if (status.BackendState === 'NeedsMachineAuth') { this.update('approval', 'Approve this device in the Tailscale admin console.', { approvalUrl: 'https://login.tailscale.com/admin/machines', checkedAt: this.now() }); return; }
        // A sign-in link stays on screen while its command waits; each check must not withdraw and restore it.
        const link = status.AuthURL && tailscaleApproval(status.AuthURL);
        if (link) approval(link);
        else if (!(this.connector.busy && this.state.status === 'login' && this.state.approvalUrl)) this.update('connecting', 'Connecting to Tailscale…', { approvalUrl: undefined, checkedAt: this.now() });
        this.connector.connect(approval, settled); return;
      }
      const host = tailscaleHost(status.Self?.DNSName);
      if (!host || status.Self?.Online !== true) throw new Error('Offline');
      const configured = await this.connector.configured(host); if (!current()) return;
      if (!configured) {
        this.forgetVerification();
        this.accepting = false; this.emit('revoke');
        // Attempts that keep ending quickly without a valid tunnel wait longer each time, up to five
        // minutes, so the tunnel is not reset on every check.
        if (this.now() < this.publishAfter) {
          if (this.failedPublishes >= 6) this.update('error', 'The secure tunnel could not be set up. Check that Funnel is allowed for this device in Tailscale and that the app is up to date; retrying automatically.', { approvalUrl: undefined });
          return;
        }
        if (!(this.state.status === 'approval' && this.connector.busy)) this.update('checking', 'Preparing the guest-only HTTPS tunnel…', { approvalUrl: undefined });
        const began = this.now();
        this.connector.publish(approval, () => {
          if (epoch !== this.epoch) return;
          // A command that waited for the host's approval is not a failed attempt.
          this.failedPublishes = this.now() - began < quickPublishMs ? this.failedPublishes + 1 : 0;
          if (this.failedPublishes >= 3) { diagnostics.record('online-publish-retry', 1); this.publishAfter = this.now() + Math.min(5 * 60_000, 5000 * 2 ** (this.failedPublishes - 3)); }
          this.checkSoon();
        }); return;
      }
      this.failedPublishes = 0; this.publishAfter = -Infinity;
      if (this.verifiedOrigin !== `https://${host}`) this.forgetVerification();
      this.accepting = true;
      this.state = { ...this.state, origin: `https://${host}`, approvalUrl: undefined, keyExpiry: status.Self?.KeyExpiry };
      this.probe = secret();
      const check = () => this.verify(this.state.origin!, this.probe, this.sign(`probe:${this.probe}`));
      // One end-to-end check supplies both availability and latency. A separate timing
      // request must not turn a successfully verified connection into a false outage.
      const started = performance.now(); const ok = await check();
      const roundTripMs = Math.round(performance.now() - started);
      this.probe = ''; if (!current()) return;
      if (ok) { this.verifiedOrigin = this.state.origin; this.unavailableSince = undefined; this.awaited = undefined; diagnostics.record('online-probe-ms', roundTripMs); }
      else { this.connectionInterrupted(); diagnostics.record('online-probe-failure', 1); }
      // An address that has never answered is still being set up, not broken.
      if (!ok && !this.verifiedOrigin && this.awaited?.origin !== this.state.origin) this.awaited = { origin: this.state.origin!, since: this.now() };
      const settingUp = !ok && !this.verifiedOrigin && this.now() - this.awaited!.since < firstReachMs;
      this.update(ok ? 'ready' : settingUp ? 'checking' : 'offline', ok ? 'Online invitations ready. Friends can join using mobile data or any Wi-Fi.'
        : settingUp ? 'Waiting for the public address to answer. A new address needs a few minutes for its HTTPS certificate; otherwise check internet access.'
        : 'Public reachability could not be confirmed. Check internet access; reconnection is automatic.', { checkedAt: this.now() });
      // Measurements change on every check. Settings polls them, so they never wake room streams.
      if (!ok) { this.netcheckedAt = -Infinity; this.state = { ...this.state, network: undefined }; return; } // The next connection may be on another network.
      if (this.connector.netcheck && this.now() - this.netcheckedAt >= netcheckInterval) {
        this.netcheckedAt = this.now();
        this.udp = await this.connector.netcheck().then(result => result.udp, () => undefined); if (!current()) return;
      }
      this.state = { ...this.state, network: { roundTripMs, ...(this.udp === undefined ? {} : { udp: this.udp }) } };
    } catch {
      this.probe = '';
      this.netcheckedAt = -Infinity;
      if (current()) { this.connectionInterrupted(); diagnostics.record('online-connector-failure', 1); this.accepting = false; this.emit('revoke'); this.update('offline', 'Waiting for the secure connection. Check internet access and Tailscale approval; retrying automatically.', { checkedAt: this.now() }); }
    }
  }
  async pause() { this.epoch++; this.accepting = false; this.forgetVerification(); this.netcheckedAt = -Infinity; this.expectProgress(); this.emit('revoke'); if (this.enabled) this.update('connecting', 'Reconnecting online invitations…'); await this.connector?.stop(); }
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
