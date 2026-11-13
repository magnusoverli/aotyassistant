import type { Response } from 'express';
import { constants, createGzip, type Gzip } from 'node:zlib';
import { AppError } from './model.js';
type StreamEvent = 'state' | 'setup' | 'revoked' | 'preparation' | 'preparation-revoked' | 'spectrum';

/** Reserve before asynchronous authorization. Headers/data still wait for authorization. */
export class EventStreams {
  private streams = new Set<EventStream>();
  private closed = false;
  constructor(private limit: number, private fullMessage: string) {}

  reserve(response: Response) {
    if (this.closed || this.streams.size >= this.limit) throw new AppError(503, this.fullMessage);
    const stream = new EventStream(response, () => this.streams.delete(stream));
    this.streams.add(stream);
    if (response.destroyed || response.writableEnded) stream.release();
    return stream;
  }

  close() { this.closed = true; for (const stream of this.streams) stream.end(); }
}

class EventStream {
  closed = false;
  private disposers = new Set<() => void>();
  private draining = false;
  private pending = new Map<string, string>();
  private stall?: NodeJS.Timeout;
  private gzip?: Gzip;
  constructor(private response: Response, private released: () => void) {
    response.once('close', this.release); response.on('drain', this.drain);
  }

  onClose(dispose: () => void) { if (this.closed) dispose(); else this.disposers.add(dispose); }

  open() {
    if (this.closed) return false;
    this.response.set({ 'Content-Type': 'text/event-stream', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });
    this.response.vary('Accept-Encoding');
    if (this.response.req.acceptsEncodings('gzip')) {
      this.response.set('Content-Encoding', 'gzip');
      // Fast streaming compression, with Node pipe backpressure in both directions.
      const gzip = this.gzip = createGzip({ level: constants.Z_BEST_SPEED });
      gzip.on('error', () => { this.release(); this.response.destroy(); });
      gzip.on('drain', this.drain);
      this.response.once('close', () => gzip.destroy());
      gzip.pipe(this.response);
    }
    this.response.flushHeaders(); return true;
  }

  send(event: StreamEvent, data: unknown) {
    this.sendEncoded(event, JSON.stringify(data));
  }
  /** Accept only JSON produced from an already authorized/filtered projection. */
  sendEncoded(event: StreamEvent, json: string) {
    if (this.closed) return;
    const frame = `event: ${event}\ndata: ${json}\n\n`;
    if (event === 'revoked') { this.pending.clear(); this.write(frame); this.end(); return; }
    if (event === 'preparation-revoked') this.pending.delete('preparation');
    // A large valid snapshot can exceed the socket's high-water mark on its own.
    // Wait for drain and retain only the latest update, rather than reconnect forever.
    if (this.draining || this.response.writableNeedDrain) { this.block(); this.pending.set(event, frame); }
    else this.write(frame);
  }

  heartbeat() { if (!this.closed && !this.draining) this.write(': heartbeat\n\n'); }

  private write(frame: string) {
    const accepted = (this.gzip ?? this.response).write(frame);
    // A sync flush makes even a tiny event/heartbeat decodable immediately,
    // without closing the gzip stream or resetting its reusable dictionary.
    this.gzip?.flush(constants.Z_SYNC_FLUSH);
    if (accepted && !this.response.writableNeedDrain && !this.gzip?.writableNeedDrain) return;
    this.block();
  }

  private block() {
    if (this.draining) return;
    this.draining = true;
    this.stall = setTimeout(() => { this.release(); this.response.destroy(); }, 30_000); this.stall.unref();
  }

  private drain = () => {
    if (this.closed || this.response.writableNeedDrain || this.gzip?.writableNeedDrain) return;
    clearTimeout(this.stall); this.draining = false;
    for (const [event, frame] of this.pending) {
      if (this.closed || this.draining) break;
      this.pending.delete(event); this.write(frame);
    }
  };

  every(work: () => void, interval: number) {
    if (this.closed) return;
    const timer = setInterval(work, interval); timer.unref(); this.onClose(() => clearInterval(timer));
  }

  release = () => {
    if (this.closed) return;
    this.closed = true; this.pending.clear(); clearTimeout(this.stall);
    this.response.off('close', this.release); this.response.off('drain', this.drain); this.released();
    this.gzip?.off('drain', this.drain);
    for (const dispose of this.disposers) dispose();
    this.disposers.clear();
  };

  end() {
    if (this.closed) return;
    this.release();
    if (!this.gzip) { this.response.end(); return; }
    const deadline = setTimeout(() => this.response.destroy(), 30_000); deadline.unref();
    this.response.once('close', () => clearTimeout(deadline));
    this.gzip.end();
  }
}
