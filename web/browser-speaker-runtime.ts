import type { BrowserSpeakerView } from '../src/browser-speakers';
import { RequestError } from './request';

export interface BrowserAudioPlayer {
  readonly clientId: string;
  readonly pairingToken: string;
  readonly isConnected: boolean;
  unlock(): Promise<void>;
  connect(): Promise<void>;
  disconnect(): void;
  destroy(): void;
}
export type BrowserAudioDependencies = {
  request<T>(path: string, data?: unknown): Promise<T>;
  create(id: string, scope: string, reconnected: () => void, exhausted: () => void): BrowserAudioPlayer;
  id(): string;
  name: string;
  schedule(work: () => void, delay: number): () => void;
};

/** One audio lifetime for the document. Routes have no ownership of this service. */
export class BrowserSpeakerRuntime {
  state: 'stopped' | 'connecting' | 'ready' | 'standby' | 'retrying' = 'stopped';
  private player?: BrowserAudioPlayer;
  private session?: BrowserSpeakerView;
  private generation = 0;
  private running = false;
  private busy = false;
  private again = false;
  private attempted = false;
  private failures = 0;
  private cancelTimer?: () => void;
  constructor(private deps: BrowserAudioDependencies) {}
  start() {
    if (this.running) return;
    this.running = true; ++this.generation; this.state = 'connecting'; this.wake();
  }
  /** Called inside ordinary click/key events. Never gate registration on autoplay permission. */
  unlock() {
    try { void this.player?.unlock().catch(() => {}); }
    catch { /* A later user gesture can retry browser audio permission. */ }
  }
  wake() {
    if (!this.running) return;
    this.cancelTimer?.(); this.cancelTimer = undefined;
    if (this.busy) { this.again = true; return; }
    void this.check();
  }
  private async check() {
    if (!this.running || this.busy) return;
    this.busy = true; this.again = false;
    const generation = this.generation;
    const current = () => this.running && generation === this.generation;
    let delay = 10_000;
    try {
      let next: BrowserSpeakerView;
      if (!this.player || !this.session) {
        const info = await this.deps.request<{ scope: string }>('/api/browser-speaker/info');
        if (!current()) return;
        const id = this.deps.id();
        const created = this.deps.create(id, info.scope,
          () => { if (current() && this.player === created) this.wake(); },
          () => { if (current() && this.player === created) { this.attempted = false; this.wake(); } });
        this.player = created;
        this.unlock(); // May remain pending on iOS; connection/pairing proceeds independently.
        next = await this.deps.request<BrowserSpeakerView>('/api/browser-speaker/register', { id, clientId: this.player.clientId, name: this.deps.name });
        if (!current()) { this.release(id); return; }
      } else {
        next = await this.deps.request<BrowserSpeakerView>(`/api/browser-speaker/session/${this.session.id}`);
        if (!current()) return;
      }
      this.session = next;
      const player = this.player!;
      if (!next.active) {
        if (this.attempted) player.disconnect();
        this.attempted = false; this.state = 'standby';
      } else {
        this.state = 'connecting';
        if (!this.attempted) { this.attempted = true; await player.connect(); }
        if (!current()) return;
        if (player.isConnected && !next.paired) {
          // MA's pair_web_player is idempotent for this identity/account, including
          // a lost HTTP response. It never starts playback or alters a queue.
          await this.deps.request('/api/browser-speaker/pair', { id: next.id, token: player.pairingToken });
          if (!current()) return;
        }
        if (player.isConnected) this.state = 'ready';
      }
      this.failures = 0;
    } catch (error) {
      if (!current()) return;
      this.state = 'retrying'; delay = Math.min(30_000, 1000 * 2 ** Math.min(++this.failures, 5));
      if (!this.session || error instanceof RequestError && [401, 403, 409].includes(error.status)) this.reset();
    } finally {
      this.busy = false;
      if (this.running) {
        this.cancelTimer?.();
        this.cancelTimer = this.deps.schedule(() => this.wake(), this.again || generation !== this.generation ? 0 : delay);
      }
    }
  }
  private release(id: string) { void this.deps.request('/api/browser-speaker/stop', { id }).catch(() => {}); }
  private reset() {
    this.player?.destroy(); this.player = undefined; this.attempted = false;
    const session = this.session; this.session = undefined;
    if (session) this.release(session.id);
  }
  stop() {
    this.running = false; ++this.generation; this.cancelTimer?.(); this.cancelTimer = undefined;
    this.reset(); this.state = 'stopped';
  }
}
