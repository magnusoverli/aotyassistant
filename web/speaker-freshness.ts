import type { IntegrationView } from '../src/integrations';
import { speakerFreshnessMs, type SpeakerInventory } from '../src/speaker-inventory';

type Deadlines = { inventory: number; ready: number; wallInventory: number; wallReady: number };

/** Relative server leases avoid clock skew; queued snapshots cannot restart their freshness window. */
export class SpeakerFreshness {
  private received = new WeakMap<IntegrationView, Deadlines>();
  private deadlines?: Deadlines;
  private inventory?: SpeakerInventory;
  private instance?: string;
  private queueCheckedAt: number | null = null;
  constructor(private now = () => performance.now(), private wall = () => Date.now()) {}

  receive(view: IntegrationView) {
    const inventory = view.speakerInventory;
    if (!inventory || this.received.has(view)) return;
    const remaining = inventory.expiresAt === null ? 0 : Math.max(0, Math.min(speakerFreshnessMs, inventory.expiresAt - inventory.asOf));
    const queueRemaining = view.output.checkedAt === null ? 0 : Math.max(0, Math.min(speakerFreshnessMs, view.output.checkedAt + speakerFreshnessMs - inventory.asOf));
    const ready = Math.min(remaining, queueRemaining);
    this.received.set(view, { inventory: this.now() + remaining, ready: this.now() + ready,
      wallInventory: this.wall() + remaining, wallReady: this.wall() + ready });
  }
  accept(view: IntegrationView) {
    this.receive(view);
    let deadlines = this.received.get(view);
    if (deadlines && this.deadlines && this.instance === view.instanceId && this.inventory?.checkedAt === view.speakerInventory?.checkedAt &&
      this.inventory?.expiresAt === view.speakerInventory?.expiresAt) {
      deadlines = { ...deadlines, inventory: Math.min(deadlines.inventory, this.deadlines.inventory),
        wallInventory: Math.min(deadlines.wallInventory, this.deadlines.wallInventory),
        ...(this.queueCheckedAt === view.output.checkedAt ? { ready: Math.min(deadlines.ready, this.deadlines.ready),
          wallReady: Math.min(deadlines.wallReady, this.deadlines.wallReady) } : {}) };
    }
    this.inventory = view.speakerInventory; this.deadlines = deadlines; this.instance = view.instanceId; this.queueCheckedAt = view.output.checkedAt;
  }
  get fresh() {
    if (!this.inventory) return true; // Compatibility with older servers and clients' retained snapshots.
    return ['verified', 'refreshing'].includes(this.inventory.state) && this.inventory.checkedAt !== null && Boolean(this.deadlines &&
      this.deadlines.inventory > this.now() && this.deadlines.wallInventory > this.wall());
  }
  get ready() {
    return this.fresh && (!this.inventory || Boolean(this.deadlines && this.deadlines.ready > this.now() && this.deadlines.wallReady > this.wall()));
  }
  get state(): SpeakerInventory['state'] | undefined {
    return this.inventory?.state === 'verified' && !this.fresh ? 'stale' : this.inventory?.state;
  }
  /** One expiry wake-up per snapshot, not a polling loop or an automatic selection. */
  remaining(ready: boolean): number | undefined {
    if (!this.deadlines || !this.fresh) return;
    const remaining = Math.min(this.deadlines.inventory - this.now(), this.deadlines.wallInventory - this.wall(),
      ...(ready ? [this.deadlines.ready - this.now(), this.deadlines.wallReady - this.wall()] : []));
    return remaining > 0 ? remaining : undefined;
  }
}
