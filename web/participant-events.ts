import { appPath } from './paths';

type Listener = { state(event: MessageEvent): void; revoked(): void; error?(): void };

/** One participant connection per page, including browsers limited to six HTTP/1.1 sockets. */
export class ParticipantEvents {
  private room?: Listener;
  private library?: Listener;
  private source?: EventSource;
  private mode = '';
  private holds = 0;
  private forced = false;
  subscribe(channel: 'room' | 'library', listener: Listener) {
    this[channel] = listener; this.refresh(channel === 'library');
    return () => { if (this[channel] === listener) { this[channel] = undefined; this.refresh(); } };
  }
  /** Defers (re)connecting until every hold is released, so a page can subscribe both
   * feeds first and open one connection. Returns an idempotent release. */
  hold() {
    this.holds++; let held = true;
    return () => {
      if (!held) return; held = false;
      if (--this.holds) return;
      const force = this.forced; this.forced = false; this.refresh(force);
    };
  }
  private refresh(force = false) {
    if (this.holds) { this.forced ||= force; return; }
    const mode = this.room ? 'live' : this.library ? 'events' : '';
    if (mode === this.mode && !force) return;
    this.source?.close(); this.source = undefined; this.mode = mode;
    if (!mode || !navigator.onLine) return;
    const source = new EventSource(appPath(`/api/participant/preparations/${mode}`)); this.source = source;
    source.addEventListener('state', event => {
      if (this.source === source) (mode === 'live' ? this.room : this.library)?.state(event as MessageEvent);
    });
    source.addEventListener('preparation', event => { if (this.source === source) this.library?.state(event as MessageEvent); });
    source.addEventListener('preparation-revoked', () => { if (this.source === source) this.library?.revoked(); });
    source.addEventListener('revoked', () => { if (this.source === source) (mode === 'live' ? this.room : this.library)?.revoked(); });
    source.onerror = () => { if (this.source === source) { this.room?.error?.(); this.library?.error?.(); } };
  }
}
export const participantEvents = new ParticipantEvents();
