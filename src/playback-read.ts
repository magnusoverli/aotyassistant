import { setTimeout as delay } from 'node:timers/promises';
import { maBudget, maRemaining, maSignal } from './ma-operation.js';
import { retryableRead } from './upstream-error.js';
import { diagnostics } from './diagnostics.js';

export class StalePlaybackRead extends Error {}

/** Read-only reconciliation, never a wrapper for Play/Pause/Resume/Stop or policy writes. */
export async function playbackRead<T>(read: () => Promise<T>, current = () => true): Promise<T> {
  return maBudget(8000, async () => {
    for (let attempt = 0; ; attempt++) {
      if (!current()) throw new StalePlaybackRead();
      try {
        const result = await read();
        if (!current()) throw new StalePlaybackRead();
        return result;
      } catch (error) {
        if (!current()) throw new StalePlaybackRead();
        if (attempt >= 2 || !retryableRead(error)) throw error;
        const wait = attempt === 0 ? 150 : 350;
        if (maRemaining(Infinity) <= wait) throw error;
        diagnostics.record('playback-read-retry', 1);
        await delay(wait, undefined, { signal: maSignal() });
      }
    }
  });
}
