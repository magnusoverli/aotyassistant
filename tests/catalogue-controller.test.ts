import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CatalogueController } from '../web/catalogue-controller.js';
import type { requestJson } from '../web/request.js';
import type { View } from '../src/model.js';

function fixture() {
  let view: View = { connected: true, roomId: 'room', turnId: 'turn', revision: 1,
    current: null, next: null, me: { id: 'member', nickname: 'Listener' }, catalogue: { configured: true, revision: 'catalogue-a', playbackAvailable: true } };
  const calls: { resolve(value: unknown): void; reject(error: Error): void; signal?: AbortSignal }[] = [];
  const request: typeof requestJson = <T>(_path: string, _data?: unknown, _timeout?: number, signal?: AbortSignal) => new Promise<T>((resolve, reject) => calls.push({ resolve: value => resolve(value as T), reject, signal }));
  const controller = new CatalogueController(() => view, request);
  return { controller, calls, get view() { return view; }, set view(value: View) { view = value; } };
}

test('delayed artist search/browse replies and errors cannot cross catalogue or membership changes', async () => {
  for (const operation of ['search', 'albums', 'tracks'] as const) {
    const f = fixture();
    const pending = operation === 'search' ? f.controller.searchArtists('private query') : f.controller.browse(operation, 'reference');
    f.view = { ...f.view, catalogue: { ...f.view.catalogue!, revision: 'catalogue-b' } };
    f.calls[0]!.resolve({ tracks: [{ title: 'Old private result' }] });
    assert.equal(await pending, undefined, operation);
    const failed = f.controller.searchArtists('query'); f.view = { ...f.view, me: undefined };
    f.calls[1]!.reject(new Error('Old owner error')); assert.equal(await failed, undefined);
  }
});

test('turn and speaker changes retain browsing, while lifecycle cancellation discards in-flight results', async () => {
  const f = fixture(); const pending = f.controller.browse('albums', 'artist');
  f.view = { ...f.view, turnId: 'next', volume: { available: false, level: null, revision: 'new-speaker' } };
  const albums = { albums: [], playbackAvailable: true }; f.calls[0]!.resolve(albums);
  assert.deepEqual(await pending, albums);
  const cancelled = f.controller.searchArtists('query'); f.controller.cancel(); f.calls[1]!.resolve({ tracks: [] });
  assert.equal(f.calls[1]!.signal?.aborted, true);
  assert.equal(await cancelled, undefined);
});

test('starting a new browse aborts the old request and ignores its late failure', async () => {
  const f = fixture(); const old = f.controller.searchArtists('old'); const current = f.controller.browse('artists', 'new');
  assert.equal(f.calls[0]!.signal?.aborted, true); assert.equal(f.calls[1]!.signal?.aborted, false);
  f.calls[0]!.reject(new Error('Aborted')); f.calls[1]!.resolve({ artists: [] });
  assert.equal(await old, undefined); assert.deepEqual(await current, { artists: [] });
});

test('a browse started on pointer down is reused by its click, and dropped when no click follows', async () => {
  const f = fixture();
  f.controller.prepare('albums', 'artist'); f.controller.prepare('albums', 'artist');
  assert.equal(f.calls.length, 1, 'Repeated pointer downs on one button send one request.');
  const albums = { albums: [], playbackAvailable: true }; f.calls[0]!.resolve(albums);
  assert.deepEqual(await f.controller.browse('albums', 'artist'), albums);
  assert.equal(f.calls.length, 1, 'The click adopts the early request.');
  f.controller.prepare('albums', 'scrolled-past'); f.controller.unprepare();
  assert.equal(f.calls[1]!.signal?.aborted, true, 'A scroll that takes over cancels the early request.');
  f.controller.prepare('tracks', 'one'); const other = f.controller.browse('tracks', 'two');
  assert.equal(f.calls[2]!.signal?.aborted, true); assert.equal(f.calls.length, 4, 'A click elsewhere does its own request.');
  f.calls[3]!.resolve({ tracks: [], playbackAvailable: true }); await other;
  f.controller.prepare('albums', 'artist'); f.view = { ...f.view, catalogue: { ...f.view.catalogue!, revision: 'catalogue-b' } };
  const fresh = f.controller.browse('albums', 'artist');
  assert.equal(f.calls[4]!.signal?.aborted, true); assert.equal(f.calls.length, 6, 'An early request from another catalogue is not reused.');
  f.calls[5]!.resolve(albums); assert.deepEqual(await fresh, albums);
});

test('a search asks only for matching artists: songs are never searched for directly', async () => {
  const requests: { path: string; data: unknown }[] = [];
  const view: View = { connected: true, roomId: 'room', turnId: 'turn', revision: 1, current: null, next: null,
    me: { id: 'member', nickname: 'Listener' }, catalogue: { configured: true, revision: 'catalogue-a', playbackAvailable: true } };
  const request: typeof requestJson = <T>(path: string, data?: unknown) => { requests.push({ path, data }); return Promise.resolve({ artists: [], playbackAvailable: true } as T); };
  const controller = new CatalogueController(() => view, request);
  assert.deepEqual(await controller.searchArtists('Night'), { artists: [], playbackAvailable: true });
  assert.deepEqual(requests, [{ path: '/api/participant/browse', data: { kind: 'artists', value: 'Night' } }]);
});
