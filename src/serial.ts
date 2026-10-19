import { performance } from 'node:perf_hooks';
import { AsyncLocalStorage } from 'node:async_hooks';
import { timing, operationWait } from './operation.js';
import { AppError } from './model.js';
import { diagnostics } from './diagnostics.js';

/** Bounded FIFO lanes. Only waiting work expires; dispatched mutations always finish. */
export class SerialQueue {
  private waiting: Array<() => void> = [];
  private running = false;
  private drained = new Set<() => void>();
  constructor(private limit = 256) {}
  get busy() { return this.running || this.waiting.length > 0; }
  drain(): Promise<void> { return this.busy ? new Promise(resolve => this.drained.add(resolve)) : Promise.resolve(); }

  run<T>(work: () => Promise<T>, lane = 'serial'): Promise<T> {
    diagnostics.record('queue-depth', this.waiting.length + Number(this.running));
    if (this.waiting.length >= this.limit) return Promise.reject(new AppError(429, 'Too many pending operations. Wait for the current work to finish.'));
    const queued = performance.now();
    const context = AsyncLocalStorage.snapshot();
    const { deadline, signal } = operationWait();
    return new Promise<T>((resolve, reject) => {
      let timer: NodeJS.Timeout | undefined; let started = false;
      const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', aborted); };
      const cancel = (error: AppError) => {
        if (started) return;
        const index = this.waiting.indexOf(start); if (index >= 0) this.waiting.splice(index, 1);
        cleanup(); reject(error); this.notifyDrain();
      };
      const aborted = () => { diagnostics.failure('CANCELLED'); cancel(new AppError(499, 'Request cancelled before dispatch.')); };
      const expired = () => { diagnostics.failure('TIMEOUT'); cancel(new AppError(504, 'Operation timed out before dispatch. Refresh before trying again.')); };
      const start = () => {
        if (signal?.aborted) { aborted(); this.next(); return; }
        if (deadline !== undefined && deadline <= performance.now()) { expired(); this.next(); return; }
        started = true; cleanup(); this.running = true;
        void context(async () => {
          timing(`${lane}-wait`, queued);
          try { resolve(await work()); } catch (error) { reject(error); }
          finally { this.running = false; this.next(); }
        });
      };
      if (signal?.aborted) { aborted(); return; }
      if (deadline !== undefined && deadline <= performance.now()) { expired(); return; }
      if (this.running) {
        this.waiting.push(start);
        signal?.addEventListener('abort', aborted, { once: true });
        if (deadline !== undefined) timer = setTimeout(expired, Math.max(1, deadline - performance.now()));
      } else start();
    });
  }
  private next() { const start = this.waiting.shift(); if (start) start(); else this.notifyDrain(); }
  private notifyDrain() { if (!this.busy) { for (const resolve of this.drained) resolve(); this.drained.clear(); } }
}

/** Independent lanes for owners/assets; idle keys are released rather than retained forever. */
export class KeyedSerialQueue {
  private queues = new Map<string, SerialQueue>();

  has(key: string) { return this.queues.get(key)?.busy ?? false; }
  async drain() { while (this.queues.size) await Promise.all([...this.queues.values()].map(queue => queue.drain())); }

  run<T>(key: string, work: () => Promise<T>): Promise<T> {
    let queue = this.queues.get(key);
    if (!queue) { queue = new SerialQueue(); this.queues.set(key, queue); }
    const result = queue.run(work, 'owner');
    const release = () => { if (!queue.busy && this.queues.get(key) === queue) this.queues.delete(key); };
    void result.then(release, release);
    return result;
  }
}
