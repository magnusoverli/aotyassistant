import type { CatalogueBrowse, CatalogueSearch, View } from '../src/model';
import { requestJson } from './request';

/** Private catalogue lifetime excludes turn/speaker changes, but includes membership and credentials. */
export function catalogueIdentity(view: View | undefined) {
  return JSON.stringify([view?.roomId, view?.me?.id, view?.catalogue?.source, view?.catalogue?.revision]);
}

export class CatalogueController {
  private epoch = 0;
  constructor(private getView: () => View | undefined, private request = requestJson) {}

  cancel() { this.epoch++; }

  private async load<T>(path: string, data: unknown): Promise<T | undefined> {
    const epoch = this.epoch; const identity = catalogueIdentity(this.getView());
    const current = () => epoch === this.epoch && identity === catalogueIdentity(this.getView());
    try { const result = await this.request<T>(path, data); return current() ? result : undefined; }
    catch (error) { if (current()) throw error; return undefined; }
  }

  search(query: string) {
    return this.load<CatalogueSearch>('/api/participant/search', { turnId: this.getView()?.turnId, query });
  }

  browse(kind: 'artists' | 'albums' | 'tracks', value: string) {
    return this.load<CatalogueBrowse>('/api/participant/browse', { kind, value });
  }
}
