import WebSocket from 'ws';
import { diagnostics } from './diagnostics.js';

export type RelaySocket = Pick<WebSocket, 'readyState' | 'bufferedAmount' | 'pause' | 'resume' | 'send'>;
type Frame = { data: WebSocket.RawData; binary: boolean; bytes: number };
const highWater = 512 * 1024;
const lowWater = 128 * 1024;
const hardLimit = 8 * 1024 * 1024;
const stallLimitMs = 15_000;
export const frameBytes = (data: WebSocket.RawData) => Array.isArray(data)
  ? data.reduce((total, part) => total + part.byteLength, 0) : data.byteLength;

/** Ordered, bounded relay of opaque Sendspin frames. Pause the producer rather
 * than dropping encrypted messages or treating an ordinary burst as a failure. */
export class SpeakerRelay {
  private queue: Frame[] = [];
  private queuedBytes = 0;
  private sending = false;
  private closed = false;
  private paused = false;
  private resumedAt = -Infinity;
  private progressAt: number;
  bytes = 0;
  peakBytes = 0;
  private startedAt?: number;
  private closedAt?: number;
  private startupBytes = 0;
  private samples: { at: number; bytes: number }[] = [];
  constructor(private source: RelaySocket, private target: RelaySocket, private fail: () => void,
    private valid: () => boolean, private now = () => performance.now()) { this.progressAt = now(); }
  /** Successful WebSocket payload writes, including protocol/encryption bytes,
   * not codec bitrate or TCP/TLS overhead. First 30 s are startup; a full later
   * 30 s window is required before calling the rate steady. No polling dependency. */
  rates() {
    const now = this.closedAt ?? this.now(); this.sample(now);
    const elapsed = this.startedAt === undefined ? 0 : Math.max(0, now - this.startedAt);
    const first = this.samples[0]; const windowMs = first ? Math.max(0, now - first.at) : 0;
    const recentKbps = windowMs ? (this.bytes - first!.bytes) * 8 / windowMs : 0;
    const startupMs = Math.min(elapsed, 30_000);
    return { phase: this.closed ? 'closed' as const : elapsed < 30_000 ? 'startup' as const : elapsed < 60_000 ? 'settling' as const : 'steady' as const,
      windowMs, recentKbps: this.closed ? 0 : recentKbps, steadyKbps: !this.closed && elapsed >= 60_000 ? recentKbps : null,
      startupBytes: this.startupBytes, startupKbps: startupMs ? this.startupBytes * 8 / startupMs : 0 };
  }
  private sample(now: number) {
    if (this.startedAt === undefined || this.closed) return;
    const last = this.samples.at(-1);
    if (!last || now - last.at >= 1000) this.samples.push({ at: now, bytes: this.bytes });
    while (this.samples.length > 1 && this.samples[1]!.at <= now - 30_000) this.samples.shift();
  }
  /** A paused reader cannot consume pong frames. Give it one heartbeat period
   * after resuming; the separate stall deadline still bounds a blocked relay. */
  get heartbeatDeferred() { return this.paused || this.now() - this.resumedAt < 20_000; }
  forward(data: WebSocket.RawData, binary: boolean) {
    if (this.closed) return;
    if (!this.valid() || this.target.readyState !== WebSocket.OPEN) { this.fail(); return; }
    const bytes = frameBytes(data);
    if (this.queuedBytes + this.target.bufferedAmount + bytes > hardLimit) {
      diagnostics.record('audio-relay-overflow', 1); this.fail(); return;
    }
    if (!this.sending && !this.queue.length) this.progressAt = this.now();
    this.queue.push({ data, binary, bytes }); this.queuedBytes += bytes;
    this.peakBytes = Math.max(this.peakBytes, this.queuedBytes + this.target.bufferedAmount);
    this.flow(); this.pump();
  }
  private flow() {
    const buffered = this.queuedBytes + this.target.bufferedAmount;
    if (!this.paused && buffered >= highWater) { this.paused = true; this.source.pause(); diagnostics.record('audio-relay-backpressure', 1); }
    else if (this.paused && buffered <= lowWater) { this.paused = false; this.resumedAt = this.now(); this.source.resume(); }
  }
  private pump() {
    if (this.closed || this.sending) return;
    if (!this.valid() || this.target.readyState !== WebSocket.OPEN) { this.fail(); return; }
    const frame = this.queue.shift();
    if (!frame) { this.flow(); return; }
    this.sending = true;
    try {
      this.target.send(frame.data, { binary: frame.binary }, error => {
        if (this.closed) return;
        if (error) { this.fail(); return; }
        const now = this.now();
        if (this.startedAt === undefined) { this.startedAt = now; this.samples.push({ at: now, bytes: 0 }); }
        if (now - this.startedAt < 30_000) this.startupBytes += frame.bytes;
        this.sending = false; this.queuedBytes -= frame.bytes; this.bytes += frame.bytes;
        this.sample(now);
        this.progressAt = this.now(); this.flow(); this.pump();
      });
    } catch { this.fail(); }
  }
  check() {
    if (this.closed) return;
    this.sample(this.now());
    if (!this.valid()) { this.fail(); return; }
    if ((this.sending || this.queue.length) && this.now() - this.progressAt >= stallLimitMs) {
      diagnostics.record('audio-relay-stall', 1); this.fail();
    }
  }
  close() { this.closedAt ??= this.now(); this.closed = true; this.queue = []; this.queuedBytes = 0; }
}
