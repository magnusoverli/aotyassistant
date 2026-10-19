import { background } from './operation.js';
import type { PlaybackEvent } from './music-assistant-events.js';

type Inventory = { subscribePlayback?(listener: (hint: PlaybackEvent) => void): () => void };
type Player = { available: boolean; name: string };

/** Shared scheduling only; authoritative validation/publication belongs to the integration. */
export class OutputMonitor {
  private active = false;
  private timer?: NodeJS.Timeout;
  private interval?: NodeJS.Timeout;
  private unsubscribe?: () => void;
  private refreshing = false;
  private dirty = false;
  constructor(private source: () => Inventory | undefined, private previous: (id?: string) => Player | undefined,
    private check: () => Promise<unknown>, private changed: () => void) {}
  start(interval = 15_000) {
    if (this.active) return;
    this.active = true; this.watch();
    this.interval = setInterval(() => { this.changed(); this.refreshSoon(); }, interval); this.interval.unref();
  }
  stop() {
    this.active = false; this.dirty = false; clearTimeout(this.timer); this.timer = undefined;
    clearInterval(this.interval); this.unsubscribe?.(); this.unsubscribe = undefined;
  }
  watch() {
    this.unsubscribe?.(); this.unsubscribe = undefined;
    if (!this.active) return;
    const source = this.source(); if (!source) return;
    this.unsubscribe = source.subscribePlayback?.(hint => {
      if (!hint.kind || ['player_added', 'player_removed', 'queue_added'].includes(hint.kind)) { this.refreshSoon(); return; }
      if (hint.kind !== 'player_updated') return;
      const previous = this.previous(hint.objectId);
      if (!previous || hint.available !== undefined && hint.available !== previous.available || hint.name !== undefined && hint.name !== previous.name) this.refreshSoon();
    });
    this.refreshSoon();
  }
  refreshSoon() {
    if (!this.active) return;
    this.dirty = true;
    if (this.timer || this.refreshing) return;
    this.timer = setTimeout(() => {
      this.timer = undefined; this.refreshing = true; this.dirty = false;
      background(() => { void this.check().catch(() => {}).finally(() => {
        this.refreshing = false; if (this.dirty) this.refreshSoon();
      }); });
    }, 250); this.timer.unref();
  }
}
