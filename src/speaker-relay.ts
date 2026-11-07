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
  constructor(private source: RelaySocket, private target: RelaySocket, private fail: () => void,
    private valid: () => boolean, private now = Date.now) { this.progressAt = now(); }
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
        this.sending = false; this.queuedBytes -= frame.bytes; this.bytes += frame.bytes;
        this.progressAt = this.now(); this.flow(); this.pump();
      });
    } catch { this.fail(); }
  }
  check() {
    if (this.closed) return;
    if (!this.valid()) { this.fail(); return; }
    if ((this.sending || this.queue.length) && this.now() - this.progressAt >= stallLimitMs) {
      diagnostics.record('audio-relay-stall', 1); this.fail();
    }
  }
  close() { this.closed = true; this.queue = []; this.queuedBytes = 0; }
}
