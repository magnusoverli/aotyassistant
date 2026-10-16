import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CatalogueController } from '../web/catalogue-controller.js';
import type { requestJson } from '../web/request.js';
import type { View } from '../src/model.js';

function fixture() {
  let view: View = { mode: 'music-assistant', connected: true, roomId: 'room', turnId: 'turn', revision: 1,
    current: null, next: null, me: { id: 'member', nickname: 'Listener' }, catalogue: { source: 'music-assistant', revision: 'catalogue-a', playbackAvailable: true } };
  const calls: { resolve(value: unknown): void; reject(error: Error): void }[] = [];
  const request: typeof requestJson = <T>() => new Promise<T>((resolve, reject) => calls.push({ resolve: value => resolve(value as T), reject }));
  const controller = new CatalogueController(() => view, request);
  return { controller, calls, get view() { return view; }, set view(value: View) { view = value; } };
}

test('delayed search/browse replies and errors cannot cross catalogue or membership changes', async () => {
  for (const operation of ['search', 'albums', 'tracks', 'artists'] as const) {
    const f = fixture();
    const pending = operation === 'search' ? f.controller.search('private query') : f.controller.browse(operation, 'reference');
    f.view = { ...f.view, catalogue: { ...f.view.catalogue!, revision: 'catalogue-b' } };
    f.calls[0]!.resolve({ tracks: [{ title: 'Old private result' }] });
    assert.equal(await pending, undefined, operation);
    const failed = f.controller.search('query'); f.view = { ...f.view, me: undefined };
    f.calls[1]!.reject(new Error('Old owner error')); assert.equal(await failed, undefined);
  }
});

test('turn and speaker changes retain browsing, while lifecycle cancellation discards in-flight results', async () => {
  const f = fixture(); const pending = f.controller.browse('albums', 'artist');
  f.view = { ...f.view, turnId: 'next', volume: { available: false, level: null, revision: 'new-speaker' } };
  const albums = { albums: [], playbackAvailable: true }; f.calls[0]!.resolve(albums);
  assert.deepEqual(await pending, albums);
  const cancelled = f.controller.search('query'); f.controller.cancel(); f.calls[1]!.resolve({ tracks: [] });
  assert.equal(await cancelled, undefined);
});
