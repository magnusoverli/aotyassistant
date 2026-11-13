import type { SpectrumPacket } from '../src/spectrum';
import { SpectrumClock } from './spectrum-clock';
import { requestJson } from './request';

/** No audio in the browser: the room's scheduled frequency bins arrive as 'spectrum' events on whichever
 * room stream the page already has, so a tab never needs a second connection for them. Every animation on
 * the page reads this one clock; the server clock is probed only while one of them is running. */
export const spectrumClock = new SpectrumClock();
let running = 0;
let probe: ReturnType<typeof setInterval> | undefined;
let abort: AbortController | undefined;

async function synchronize(signal: AbortSignal) {
  const sent = performance.now();
  try {
    const result = await requestJson<{ now: number }>('/api/display/spectrum/clock', undefined, 3000, signal);
    if (!signal.aborted) spectrumClock.synchronize(sent, performance.now(), result.now);
  } catch { /* A stale or missing clock never produces reactive motion. */ }
}

/** Called for each room stream a page opens. A reconnect may reach a restarted server with another clock. */
export function receiveSpectrum(source: EventSource) {
  source.addEventListener('spectrum', event => {
    try { spectrumClock.accept(JSON.parse((event as MessageEvent).data) as SpectrumPacket, performance.now()); }
    catch { spectrumClock.clear(); }
  });
  source.addEventListener('open', () => { spectrumClock.reset(); if (abort) void synchronize(abort.signal); });
  source.addEventListener('error', () => spectrumClock.clear());
}

/** One animation's use of the shared feed. */
export class RoomSpectrum {
  readonly clock = spectrumClock;
  private active = false;
  start() {
    if (this.active) return; this.active = true;
    if (running++) return;
    abort = new AbortController(); const signal = abort.signal;
    void synchronize(signal); probe = setInterval(() => { void synchronize(signal); }, 10_000);
  }
  stop() {
    if (!this.active) return; this.active = false;
    if (--running) return;
    abort?.abort(); abort = undefined; clearInterval(probe); probe = undefined;
  }
}
