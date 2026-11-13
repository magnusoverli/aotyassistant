import type { SpectrumPacket } from './spectrum.js';

/** Spectrum packets ride on each screen's existing room stream instead of a second connection per tab
 * (browsers allow six HTTP/1.1 connections per server). One shared tick computes and encodes the packet
 * once for every subscriber, sends only while the visualizer is active, and sends one final inactive
 * packet when it stops so screens clear their needles. Idle rooms send nothing. */
export class SpectrumBroadcast {
  private listeners = new Set<(json: string) => void>();
  private timer?: NodeJS.Timeout;
  private active = false;
  constructor(private packet: () => SpectrumPacket, private interval = 200) {}

  /** Returns the unsubscribe function. */
  subscribe(send: (json: string) => void): () => void {
    this.listeners.add(send);
    if (!this.timer) { this.timer = setInterval(this.tick, this.interval); this.timer.unref(); }
    return () => {
      this.listeners.delete(send);
      if (!this.listeners.size) { clearInterval(this.timer); this.timer = undefined; this.active = false; }
    };
  }

  private tick = () => {
    let packet: SpectrumPacket;
    try { packet = this.packet(); } catch { return; }
    if (!packet.active && !this.active) return;
    this.active = packet.active;
    const json = JSON.stringify(packet);
    for (const send of this.listeners) { try { send(json); } catch { /* A closing stream releases itself. */ } }
  };

  close() { clearInterval(this.timer); this.timer = undefined; this.listeners.clear(); this.active = false; }
}
