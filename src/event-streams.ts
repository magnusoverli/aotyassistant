import type { Response } from 'express';
import { AppError } from './model.js';

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
  private pending?: string;
  private stall?: NodeJS.Timeout;
  constructor(private response: Response, private released: () => void) {
    response.once('close', this.release); response.on('drain', this.drain);
  }

  onClose(dispose: () => void) { if (this.closed) dispose(); else this.disposers.add(dispose); }

  open() {
    if (this.closed) return false;
    this.response.set({ 'Content-Type': 'text/event-stream', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });
    this.response.flushHeaders(); return true;
  }

  send(event: 'state' | 'revoked', data: unknown) {
    if (this.closed) return;
    const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    if (event === 'revoked') { this.pending = undefined; this.response.write(frame); this.end(); return; }
    // A large valid snapshot can exceed the socket's high-water mark on its own.
    // Wait for drain and retain only the latest update, rather than reconnect forever.
    if (this.draining) this.pending = frame;
    else this.write(frame);
  }

  private write(frame: string) {
    if (this.response.write(frame)) return;
    this.draining = true;
    this.stall = setTimeout(() => { this.release(); this.response.destroy(); }, 30_000); this.stall.unref();
  }

  private drain = () => {
    clearTimeout(this.stall); this.draining = false;
    const frame = this.pending; this.pending = undefined;
    if (!this.closed && frame) this.write(frame);
  };

  every(work: () => void, interval: number) {
    if (this.closed) return;
    const timer = setInterval(work, interval); timer.unref(); this.onClose(() => clearInterval(timer));
  }

  release = () => {
    if (this.closed) return;
    this.closed = true; this.pending = undefined; clearTimeout(this.stall);
    this.response.off('close', this.release); this.response.off('drain', this.drain); this.released();
    for (const dispose of this.disposers) dispose();
    this.disposers.clear();
  };

  end() { this.release(); this.response.end(); }
}
