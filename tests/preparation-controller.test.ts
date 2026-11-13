import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { PreparationController, type preparationRequest } from '../web/preparation-controller.js';
import type { PreparationView } from '../src/preparations.js';
import type { CatalogueAlbum, CatalogueTrack } from '../src/model.js';

class Stream extends EventTarget {
  static all: Stream[] = [];
  closed = false;
  constructor(_url: string) { super(); Stream.all.push(this); }
  close() { this.closed = true; }
  send(type: string, value: unknown = {}) { this.dispatchEvent(new MessageEvent(type, { data: JSON.stringify(value) })); }
}

const view = (ownerId = 'owner-a', revision = 0): PreparationView => ({ ownerId, revision,
  capacity: { upcoming: 200, entries: 1000 }, upcoming: [], played: [], removed: [] });

function fixture(t: TestContext) {
  const storage = new Map<string, string>(); Stream.all = [];
  const globals = { navigator: { onLine: true }, EventSource: Stream, localStorage: {
    getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key),
  } };
  for (const [key, value] of Object.entries(globals)) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { value, configurable: true });
    t.after(() => { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); });
  }
  const calls: { path: string; data?: unknown; resolve(value: unknown): void; reject(error: Error): void }[] = [];
  const request: typeof preparationRequest = <T>(path: string, data?: unknown) => new Promise<T>((resolve, reject) => calls.push({ path, data, resolve: value => resolve(value as T), reject }));
  const controller = new PreparationController(() => {}, () => true, request);
  t.after(() => controller.stop());
  return { controller, calls, request, async start() { const pending = controller.start(); calls.at(-1)!.resolve(view()); await pending; return Stream.all.at(-1)!; } };
}

test('a stopped private-list load cannot overwrite a restarted load or clear its loading state', async t => {
  const f = fixture(t); const old = f.controller.start(); f.controller.stop(); const fresh = f.controller.start();
  f.calls[0]!.resolve(view('old-owner')); await old;
  assert.equal(Boolean(f.controller.view), false); assert.equal(f.controller.loading, true);
  f.calls[1]!.resolve(view('new-owner')); await fresh;
  assert.equal(f.controller.view?.ownerId, 'new-owner'); assert.equal(f.controller.loading, false);
});

test('an ended authorization fences delayed reads without offering list recovery', async t => {
  const f = fixture(t); const stream = await f.start();
  const refresh = f.controller.refresh();
  stream.send('revoked');
  f.calls[1]!.resolve(view('owner-a', 1)); await refresh;
  assert.equal(f.controller.view, undefined); assert.doesNotMatch(f.controller.error, /recover/i);
  assert.equal(f.controller.saving, false); assert.equal(stream.closed, true);
});

test('automatic startup and the first add share one list initialization', async t => {
  const f = fixture(t); const first = f.controller.start(); const second = f.controller.ensureOwner();
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0]!.path, '/init');
  f.calls[0]!.resolve(view()); await Promise.all([first, second]);
  assert.equal(f.controller.view?.ownerId, 'owner-a'); assert.equal(f.controller.loading, false);
});

test('uploaded replacement drafts restore their endpoint, target and operation receipt after an uncertain save', async t => {
  const f = fixture(t); await f.start();
  const pending = f.controller.edit('replace-upload', { entryId: 'original-entry', uploadId: 'new-file', text: { title: 'New song', artist: '', album: '' } }, 'New song');
  const sent = f.calls.at(-1)!; assert.equal(sent.path, '/replace-upload');
  f.calls.at(-1)!.reject(new Error('Connection lost'));
  await Promise.resolve(); assert.equal(f.calls.at(-1)!.path, '/state');
  f.calls.at(-1)!.resolve(view('owner-a', 1)); await pending;
  assert.ok(f.controller.pending); assert.equal(f.controller.lastSavedUploadId, undefined);
  const restored = new PreparationController(() => {}, () => true, f.request); t.after(() => restored.stop());
  restored.accept(view('owner-a', 1)); assert.equal(restored.pending?.path, 'replace-upload');
  const retry = restored.retry(); assert.equal(f.calls.at(-1)!.path, '/replace-upload'); assert.deepEqual(f.calls.at(-1)!.data, sent.data);
  f.calls.at(-1)!.resolve({ view: view('owner-a', 2), entryId: 'replacement-entry', replayed: true }); await retry;
  assert.equal(restored.pending, undefined); assert.equal(restored.lastSavedUploadId, 'new-file'); assert.equal(restored.view?.revision, 2);
});

const album: CatalogueAlbum = { id: 'album-ref', name: 'Album', artist: 'Artist', year: 2025, version: '', provider: 'Provider' };
const tracks = (ids: string[]): CatalogueTrack[] => ids.map(id => ({ id, title: id, artist: 'Artist', album: 'Album', version: '', provider: 'Provider', duration: 180, available: true }));
const savedView = (ids: string[], revision = 1): PreparationView => ({ ...view('owner-a', revision), upcoming: ids.map(id => ({
  id, source: 'music-assistant', title: id, artist: 'Artist', album: 'Album', version: '', provider: 'Provider', duration: 180, addedAt: 0, playCount: 0,
})) });

test('Add album snapshots the displayed order and updates all row acknowledgements from one save', async t => {
  const f = fixture(t); await f.start(); const songs = tracks(['one', 'two']);
  const pending = f.controller.addAlbum(album, songs); songs.reverse(); await Promise.resolve();
  const sent = f.calls.at(-1)!; assert.equal(sent.path, '/add-album');
  assert.deepEqual((sent.data as { trackIds: string[] }).trackIds, ['one', 'two']);
  assert.equal(f.controller.saving, true); assert.equal(f.controller.locked, true);
  const saved = savedView(['entry-one', 'entry-two']); f.controller.accept(saved); // SSE can arrive before the HTTP reply.
  sent.resolve({ view: saved, entryId: 'entry-one', entryIds: ['entry-one', 'entry-two'], replayed: false }); await pending;
  assert.deepEqual([...f.controller.added], ['one', 'two']); assert.equal(f.controller.locked, false);
  f.controller.accept(savedView(['entry-two'], 2)); assert.deepEqual([...f.controller.added], ['two']);
});

test('large album drafts restore and retry the same operation; replay only marks entries still queued', async t => {
  const f = fixture(t); await f.start(); const songs = tracks(Array.from({ length: 200 }, (_, i) => `${i}-${'x'.repeat(150)}`));
  const pending = f.controller.addAlbum(album, songs); await Promise.resolve(); const sent = f.calls.at(-1)!;
  sent.reject(new Error('Connection lost')); await Promise.resolve();
  f.calls.at(-1)!.resolve(view()); await pending;
  const restored = new PreparationController(() => {}, () => true, f.request); t.after(() => restored.stop()); restored.accept(view());
  assert.equal(restored.pending?.body.trackIds?.length, 200);
  const retry = restored.retry(); assert.deepEqual(f.calls.at(-1)!.data, sent.data);
  const ids = songs.map((_, i) => `entry-${i}`);
  f.calls.at(-1)!.resolve({ view: savedView(ids.slice(1), 2), entryId: ids[0], entryIds: ids, replayed: true }); await retry;
  assert.equal(restored.pending, undefined); assert.equal(restored.added.size, 199); assert.equal(restored.added.has(songs[0]!.id), false);
});

test('album confirmation cannot mark tracks in a different owner or resurrect an entry removed by a newer event', async t => {
  const f = fixture(t); await f.start();
  const pending = f.controller.addAlbum(album, tracks(['one'])); await Promise.resolve(); const sent = f.calls.at(-1)!;
  f.controller.accept(savedView([], 3));
  sent.resolve({ view: savedView(['entry-one']), entryId: 'entry-one', entryIds: ['entry-one'], replayed: false }); await pending;
  assert.equal(f.controller.added.size, 0); assert.equal(f.controller.view!.revision, 3);
  const next = f.controller.addAlbum(album, tracks(['two'])); await Promise.resolve(); const delayed = f.calls.at(-1)!;
  f.controller.accept(view('owner-b'));
  delayed.resolve({ view: savedView(['entry-two'], 4), entryId: 'entry-two', entryIds: ['entry-two'], replayed: false }); await next;
  assert.equal(f.controller.view!.ownerId, 'owner-b'); assert.equal(f.controller.added.size, 0);
});

test('an incomplete album receipt stays pending instead of claiming that every track was added', async t => {
  const f = fixture(t); await f.start();
  const pending = f.controller.addAlbum(album, tracks(['one', 'two'])); await Promise.resolve();
  f.calls.at(-1)!.resolve({ view: savedView(['entry-one']), entryId: 'entry-one', entryIds: ['entry-one'], replayed: false });
  await Promise.resolve(); f.calls.at(-1)!.resolve(savedView(['entry-one'])); await pending;
  assert.ok(f.controller.pending); assert.equal(f.controller.added.size, 0); assert.match(f.controller.error, /incomplete/);
});
