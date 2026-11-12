import type { CatalogueBrowse, View } from '../src/model';
import { requestJson } from './request';

/** Private catalogue lifetime excludes turn/speaker changes, but includes membership and credentials. */
export function catalogueIdentity(view: View | undefined) {
  return JSON.stringify([view?.roomId, view?.me?.id, view?.catalogue?.configured, view?.catalogue?.revision]);
}

type Early = { key: string; identity: string; controller: AbortController; result: Promise<CatalogueBrowse> };

export class CatalogueController {
  private epoch = 0;
  private pending?: AbortController;
  private early?: Early;
  constructor(private getView: () => View | undefined, private request = requestJson) {}

  cancel() { this.epoch++; this.pending?.abort(); this.pending = undefined; }

  /** One current catalogue task: a newer one aborts it, and its result never crosses a catalogue or membership change. */
  private async task<T>(work: (signal: AbortSignal) => Promise<T>, pending = new AbortController()): Promise<T | undefined> {
    this.cancel(); this.pending = pending;
    const epoch = this.epoch; const identity = catalogueIdentity(this.getView());
    const current = () => epoch === this.epoch && identity === catalogueIdentity(this.getView());
    try { const result = await work(pending.signal); return current() ? result : undefined; }
    catch (error) { if (current()) throw error; return undefined; }
    finally { if (this.pending === pending) this.pending = undefined; }
  }

  private load<T>(path: string, data: unknown, early?: { controller: AbortController; result: Promise<T> }): Promise<T | undefined> {
    return this.task(signal => early?.result ?? this.request<T>(path, data, 18_000, signal), early?.controller);
  }

  /** A search finds artists only: music is chosen artist, then album, then track. */
  searchArtists(query: string) { return this.browse('artists', query); }

  /** Starts a browse when a finger or button goes down; the click that follows reuses it. */
  prepare(kind: 'artists' | 'albums' | 'tracks', value: string) {
    const key = JSON.stringify([kind, value]); if (this.early?.key === key) return;
    this.unprepare();
    const controller = new AbortController();
    const result = this.request<CatalogueBrowse>('/api/participant/browse', { kind, value }, 18_000, controller.signal);
    result.catch(() => {}); // Surfaced only if the click adopts it.
    this.early = { key, identity: catalogueIdentity(this.getView()), controller, result };
  }

  /** The pointer left or a scroll took over: the click is not coming. */
  unprepare() { this.early?.controller.abort(); this.early = undefined; }

  browse(kind: 'artists' | 'albums' | 'tracks', value: string) {
    const early = this.early; this.early = undefined;
    const reuse = early?.key === JSON.stringify([kind, value]) && early.identity === catalogueIdentity(this.getView());
    if (!reuse) early?.controller.abort();
    return this.load<CatalogueBrowse>('/api/participant/browse', { kind, value }, reuse ? early : undefined);
  }
}
