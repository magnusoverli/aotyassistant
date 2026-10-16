import type { Config } from './config.js';
import type { IntegrationManager } from './integrations.js';
import { SupervisorClient, supervisorHints, emptyHints, type SupervisorHints } from './supervisor.js';
import { discoverServers, mdnsOrigins, type DiscoveredServer } from './ma-discovery.js';

export type SetupView = { status: 'idle' | 'checking' | 'ready' | 'waiting'; message: string; supervisor: SupervisorHints; servers: DiscoveredServer[] };

/** Read-only discovery, with narrowly scoped first-run address persistence. Never selects a speaker. */
export class SetupManager {
  private state: SetupView;
  private pending?: Promise<SetupView>;
  private timer?: NodeJS.Timeout;
  private closed = false;
  private lastAttempt = 0;
  constructor(private config: Config, private integrations: IntegrationManager, private guestChanged: (origin: string) => void,
    private supervisor?: Pick<SupervisorClient, 'read'>,
    private browse = mdnsOrigins, private discover = discoverServers) {
    this.state = { status: 'idle', message: 'Looking for Music Assistant does not start audio.', supervisor: emptyHints(Boolean(config.addon)), servers: [] };
  }
  view(): SetupView { return structuredClone(this.state); }
  allowsGuestHost(host: string): boolean {
    return this.state.supervisor.available && this.state.supervisor.guestOrigins.some(origin => new URL(origin).host === host);
  }
  async refresh(): Promise<SetupView> {
    if (this.pending) return this.pending;
    if (this.closed || Date.now() - this.lastAttempt < 2500) return this.view();
    this.lastAttempt = Date.now(); this.state.status = 'checking';
    this.pending = this.scan();
    try { return await this.pending; } finally { this.pending = undefined; }
  }
  private async scan(): Promise<SetupView> {
    const [hints, mdns] = await Promise.all([
      this.supervisor ? supervisorHints(this.supervisor, this.config.port).catch(() => emptyHints(true)) : Promise.resolve(emptyHints(Boolean(this.config.addon))),
      this.browse().catch(() => [] as string[]),
    ]);
    // Address access must not wait for MA discovery, authentication or media checks.
    this.state.supervisor = hints;
    const saved = this.integrations.view().url;
    const servers = await this.discover([...(saved ? [saved] : []), ...hints.maOrigins, ...mdns]);
    if (this.closed) return this.view();
    this.integrations.setEnvironmentMediaOrigins(hints.mediaOrigins);
    if (this.config.addon && !this.config.guestOverride && hints.guestOrigins.length === 1) {
      try { this.guestChanged(await this.integrations.initializeGuestOrigin(hints.guestOrigins[0]!)); } catch { /* Retry via next scan/UI; preserve saved settings. */ }
    }
    if (this.integrations.configured) {
      try {
        if (this.integrations.serverId && !servers.some(s => s.url === saved)) {
          // mDNS is an untrusted suggestion, never authority to forward a retained bearer token.
          const moved = servers.find(s => s.id === this.integrations.serverId && hints.maOrigins.includes(s.url));
          if (moved) await this.integrations.relocate(moved.url, moved.id, this.integrations.view().revision);
        }
        await this.integrations.check(this.integrations.view().revision);
        if (this.integrations.addressing().mediaCheck.status !== 'checking') {
          await this.integrations.checkMediaOrigins(this.integrations.mediaCandidates(), this.integrations.view().revision, true);
        }
      } catch { /* Availability errors remain visible in integration/addressing status. */ }
    }
    this.state = { supervisor: hints, servers, status: servers.length ? 'ready' : 'waiting',
      message: servers.length ? 'Music Assistant found. Connect, then choose a speaker.' : 'Waiting for Music Assistant. Start it and finish its onboarding, or enter its address below.' };
    return this.view();
  }
  start() {
    // Retry startup races without blocking the HTTP listener or restarting on MA failures.
    const delays = [3000, 10_000, 30_000, 60_000];
    const attempt = async (index: number) => {
      try { await this.refresh(); } catch { this.state.status = 'waiting'; }
      if (!this.closed && index < delays.length && (this.state.status !== 'ready' || this.integrations.view().status === 'error' || this.integrations.addressing().mediaCheck.status === 'failed')) {
        this.timer = setTimeout(() => { void attempt(index + 1); }, delays[index]); this.timer.unref();
      }
    };
    void attempt(0);
  }
  close() { this.closed = true; clearTimeout(this.timer); }
}
