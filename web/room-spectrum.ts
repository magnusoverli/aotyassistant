import type { SpectrumPacket } from '../src/spectrum';
import { SpectrumClock } from './spectrum-clock';
import { appPath } from './paths';
import { requestJson } from './request';

/** No audio in the browser: only a small, shared stream of scheduled frequency bins. */
export class RoomSpectrum {
  readonly clock = new SpectrumClock();
  private source?: EventSource;
  private probe?: ReturnType<typeof setInterval>;
  private abort?: AbortController;
  start() {
    if (this.source) return;
    const source = new EventSource(appPath('/api/display/spectrum/events')); this.source = source;
    const abort = new AbortController(); this.abort = abort;
    const synchronize = async () => {
      const sent = performance.now();
      try {
        const result = await requestJson<{ now: number }>('/api/display/spectrum/clock', undefined, 3000, abort.signal);
        if (!abort.signal.aborted) this.clock.synchronize(sent, performance.now(), result.now);
      } catch { /* A stale or missing clock never produces reactive motion. */ }
    };
    source.onopen = () => { this.clock.reset(); void synchronize(); };
    source.addEventListener('state', event => {
      try { this.clock.accept(JSON.parse((event as MessageEvent).data) as SpectrumPacket, performance.now()); }
      catch { this.clock.clear(); }
    });
    source.onerror = () => this.clock.clear();
    this.probe = setInterval(() => { void synchronize(); }, 10_000);
  }
  stop() { this.source?.close(); this.source = undefined; this.abort?.abort(); clearInterval(this.probe); this.clock.reset(); }
}
