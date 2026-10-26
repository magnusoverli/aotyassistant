import type { View } from '../src/model';
import { RequestError } from './request';

export type ParticipantAccessState = 'checking' | 'unjoined' | 'member' | 'error' | 'offline';

/** Membership and private-list ownership are independent. Only a 401 means "not joined". */
export class ParticipantAccess {
  state: ParticipantAccessState = 'checking';
  removed = false;
  message = '';
  private epoch = 0;
  private pending?: Promise<void>;

  constructor(private request: () => Promise<View>, private online: () => boolean, private accepted: (view: View) => void, private denied: () => void, private changed: () => void) {}

  check(): Promise<void> {
    if (this.pending) return this.pending;
    if (!this.online()) { this.offline(); return Promise.resolve(); }
    const epoch = ++this.epoch;
    // Revalidate an existing member in the background; the visible page has not changed.
    if (this.state !== 'member') { this.state = 'checking'; this.message = ''; this.changed(); }
    const pending = Promise.resolve().then(() => this.request()).then(view => {
      if (epoch !== this.epoch) return;
      if (!view.me) throw new Error('Room membership could not be confirmed. Try again.');
      this.enter(view);
    }).catch(error => {
      if (epoch !== this.epoch) return;
      if (error instanceof RequestError && error.status === 401) {
        if (this.state === 'member') this.removed = true;
        this.state = 'unjoined'; this.message = ''; this.denied();
      } else {
        this.state = this.online() ? 'error' : 'offline';
        this.message = error instanceof Error ? error.message : 'The room could not be reached.';
      }
    }).finally(() => {
      if (this.pending === pending) this.pending = undefined;
      if (epoch === this.epoch) this.changed();
    });
    this.pending = pending; return pending;
  }

  enter(view: View) {
    const changed = this.state !== 'member';
    this.epoch++; this.pending = undefined; this.state = 'member'; this.removed = false; this.message = '';
    this.accepted(view); if (changed) this.changed();
  }

  revoke() {
    this.epoch++; this.pending = undefined; this.state = 'unjoined'; this.removed = true; this.message = '';
    this.denied(); this.changed();
  }

  offline() {
    this.epoch++; this.pending = undefined; this.state = 'offline'; this.message = ''; this.changed();
  }
}
