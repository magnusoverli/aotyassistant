import type { Config } from './config.js';
import type { IntegrationManager } from './integrations.js';
import { SupervisorClient, supervisorHints, emptyHints, type SupervisorHints } from './supervisor.js';
import { discoverServers, mdnsOrigins, type DiscoveredServer } from './ma-discovery.js';

export type SetupView = { status: 'idle' | 'checking' | 'ready' | 'waiting'; message: string; supervisor: SupervisorHints; servers: DiscoveredServer[] };
type Schedule = { retryMs: number; maxRetryMs: number; refreshMs: number; minimumMs: number; jitter: () => number };
const scheduleDefaults: Schedule = { retryMs: 3000, maxRetryMs: 60_000, refreshMs: 5 * 60_000, minimumMs: 2500, jitter: Math.random };

/** Read-only discovery, with narrowly scoped first-run address persistence. Never selects a speaker. */
export class SetupManager {
  private state: SetupView;
  private pending?: Promise<SetupView>;
  private timer?: NodeJS.Timeout;
  private closed = false;
  private lastAttempt = 0;
  private started = false;
  private failures = 0;
  private requested = false;
  private observedConnection = '';
  private connectionFailed = false;
  private recheckMedia = false;
  private unsubscribe?: () => void;
  private listeners = new Set<() => void>();
  private schedule: Schedule;
  constructor(private config: Config, private integrations: IntegrationManager, private guestChanged: (origin: string) => void,
    private supervisor?: Pick<SupervisorClient, 'read'>,
    private browse = mdnsOrigins, private discover = discoverServers, schedule: Partial<Schedule> = {}) {
    this.schedule = { ...scheduleDefaults, ...schedule };
    this.state = { status: 'idle', message: 'Looking for Music Assistant does not start audio.', supervisor: emptyHints(Boolean(config.addon)), servers: [] };
  }
  view(): SetupView { return structuredClone(this.state); }
  subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private changed() { for (const listener of this.listeners) listener(); }
  allowsGuestHost(host: string): boolean {
    return this.state.supervisor.available && this.state.supervisor.guestOrigins.some(origin => new URL(origin).host === host);
  }
  async refresh(): Promise<SetupView> {
    if (this.pending) return this.pending;
    if (this.closed) return this.view();
    const remaining = this.schedule.minimumMs - (Date.now() - this.lastAttempt);
    if (remaining > 0) { this.scheduleNext(remaining); return this.view(); }
    clearTimeout(this.timer); this.requested = false;
    this.lastAttempt = Date.now(); this.state.status = 'checking';
    this.changed();
    this.pending = this.scan();
    try { return await this.pending; }
    catch (error) { this.state.status = 'waiting'; this.state.message = 'Setup discovery could not finish. It will retry automatically.'; throw error; }
    finally {
      this.pending = undefined; this.changed();
      const retry = this.view().status !== 'ready' || this.integrations.view().status === 'error' || this.integrations.addressing().mediaCheck.status === 'failed';
      this.failures = retry ? this.failures + 1 : 0;
      const delay = this.requested ? this.schedule.retryMs : retry
        ? Math.min(this.schedule.maxRetryMs, this.schedule.retryMs * 2 ** Math.min(this.failures - 1, 6)) : this.schedule.refreshMs;
      this.scheduleNext(delay);
    }
  }
  private async scan(): Promise<SetupView> {
    const [hints, mdns] = await Promise.all([
      this.supervisor ? supervisorHints(this.supervisor, this.config.port).catch(() => emptyHints(true)) : Promise.resolve(emptyHints(Boolean(this.config.addon))),
      this.browse().catch(() => [] as string[]),
    ]);
    // Address access must not wait for MA discovery, authentication or media checks.
    if (this.closed) return this.view();
    const mediaChanged = JSON.stringify(this.state.supervisor.mediaOrigins) !== JSON.stringify(hints.mediaOrigins);
    if (mediaChanged) this.recheckMedia = true;
    this.state.supervisor = hints;
    this.changed();
    const saved = this.integrations.view().url;
    const servers = await this.discover([...(saved ? [saved] : []), ...hints.maOrigins, ...mdns]);
    if (this.closed) return this.view();
    this.integrations.setEnvironmentMediaOrigins(hints.mediaOrigins);
    if (this.config.addon && !this.config.guestOverride && hints.guestOrigins.length === 1) {
      try { this.guestChanged(await this.integrations.initializeGuestOrigin(hints.guestOrigins[0]!)); } catch { /* Retry via next scan/UI; preserve saved settings. */ }
    }
    if (this.closed) return this.view();
    if (this.integrations.configured) {
      try {
        if (this.integrations.serverId && !servers.some(s => s.url === saved)) {
          // mDNS is an untrusted suggestion, never authority to forward a retained bearer token.
          const moved = servers.find(s => s.id === this.integrations.serverId && hints.maOrigins.includes(s.url));
          if (moved) await this.integrations.relocate(moved.url, moved.id, this.integrations.view().revision, moved.browserUrl);
        }
        if (this.closed) return this.view();
        const wasDisconnected = this.integrations.view().status !== 'checked';
        if (wasDisconnected) this.recheckMedia = true;
        const connection = await this.integrations.check(this.integrations.view().revision);
        if (this.closed) return this.view();
        const addressing = this.integrations.addressing(); const media = addressing.mediaCheck;
        if (connection.status === 'checked' && !connection.settingsChangesBlocked && media.status !== 'checking' &&
          (this.recheckMedia || media.status !== 'verified' || media.origin !== addressing.effectiveMediaOrigin)) {
          this.recheckMedia = false;
          await this.integrations.checkMediaOrigins(this.integrations.mediaCandidates(), this.integrations.view().revision, true);
        }
      } catch { /* Availability errors remain visible in integration/addressing status. */ }
    }
    if (this.closed) return this.view();
    this.state = { supervisor: hints, servers, status: servers.length ? 'ready' : 'waiting',
      message: servers.length ? this.integrations.configured ? 'Music Assistant found. Connection status updates automatically.' : 'Music Assistant found. Connect, then choose a speaker.'
        : 'Waiting for Music Assistant. Discovery will retry automatically; you can also enter its direct address.' };
    return this.view();
  }
  private scheduleNext(delay: number) {
    if (!this.started || this.closed) return;
    clearTimeout(this.timer);
    // One coalesced scan, with bounded jitter/backoff; healthy networks are scanned infrequently.
    const wait = Math.max(this.schedule.minimumMs - (Date.now() - this.lastAttempt), delay * (0.8 + this.schedule.jitter() * 0.2));
    this.timer = setTimeout(() => { void this.refresh().catch(() => {}); }, wait); this.timer.unref();
  }
  private connectionKey() {
    const view = this.integrations.view(); const addresses = this.integrations.addressing();
    return JSON.stringify([this.integrations.catalogueRevision, view.status === 'error', addresses.guestOrigin, addresses.mediaOrigin, view.settingsChangesBlocked]);
  }
  start() {
    if (this.started || this.closed) return;
    this.started = true; this.observedConnection = this.connectionKey(); this.connectionFailed = this.integrations.view().status === 'error';
    this.unsubscribe = this.integrations.subscribe(() => {
      const failed = this.integrations.view().status === 'error';
      if (this.connectionFailed && !failed) this.recheckMedia = true;
      this.connectionFailed = failed;
      const key = this.connectionKey();
      if (key === this.observedConnection) return;
      this.observedConnection = key;
      if (this.pending) this.requested = true;
      else this.scheduleNext(this.schedule.retryMs);
    });
    this.scheduleNext(this.schedule.retryMs);
    void this.refresh().catch(() => {});
  }
  close() { this.closed = true; clearTimeout(this.timer); this.unsubscribe?.(); this.listeners.clear(); }
}
