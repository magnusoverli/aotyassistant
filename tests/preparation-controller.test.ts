import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { PreparationController, type preparationRequest } from '../web/preparation-controller.js';
import { RequestError } from '../web/request.js';
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
/** Lets queued promise callbacks run. */
const tick = () => new Promise(resolve => setTimeout(resolve, 5));

function fixture(t: TestContext, retryDelays: number[] = []) {
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
  const controller = new PreparationController(() => {}, () => true, request, retryDelays);
  t.after(() => controller.stop());
  const another = () => { const next = new PreparationController(() => {}, () => true, request, retryDelays); t.after(() => next.stop()); return next; };
  return { controller, calls, request, storage, another, async start(initial = view()) { const pending = controller.start(); calls.at(-1)!.resolve(initial); await pending; return Stream.all.at(-1)!; } };
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
  await tick(); assert.equal(f.calls.at(-1)!.path, '/state');
  f.calls.at(-1)!.resolve(view('owner-a', 1)); assert.equal(await pending, false);
  assert.ok(f.controller.pending); assert.equal(f.controller.stalled, true); assert.equal(f.controller.lastSavedUploadId, undefined);
  const restored = f.another();
  restored.accept(view('owner-a', 1)); assert.equal(restored.pending?.path, 'replace-upload'); assert.equal(restored.stalled, true);
  const retry = restored.retry(); assert.equal(f.calls.at(-1)!.path, '/replace-upload'); assert.deepEqual(f.calls.at(-1)!.data, sent.data);
  f.calls.at(-1)!.resolve({ view: view('owner-a', 2), entryId: 'replacement-entry', replayed: true }); await retry;
  assert.equal(restored.pending, undefined); assert.equal(restored.lastSavedUploadId, 'new-file'); assert.equal(restored.view?.revision, 2);
});

const album: CatalogueAlbum = { id: 'album-ref', name: 'Album', artist: 'Artist', year: 2025, version: '', provider: 'Provider' };
const tracks = (ids: string[]): CatalogueTrack[] => ids.map(id => ({ id, title: id, artist: 'Artist', album: 'Album', version: '', provider: 'Provider', duration: 180, available: true }));
const entry = (id: string) => ({ id, source: 'music-assistant' as const, title: id, artist: 'Artist', album: 'Album', version: '', provider: 'Provider', duration: 180, addedAt: 0, playCount: 0 });
const savedView = (ids: string[], revision = 1, removed: string[] = []): PreparationView => ({ ...view('owner-a', revision), upcoming: ids.map(entry), removed: removed.map(entry) });
const order = (controller: PreparationController) => controller.view?.upcoming.map(item => item.id);

test('Add album snapshots the displayed order and updates all row acknowledgements from one save', async t => {
  const f = fixture(t); await f.start(); const songs = tracks(['one', 'two']);
  const pending = f.controller.addAlbum(album, songs); songs.reverse(); await Promise.resolve();
  const sent = f.calls.at(-1)!; assert.equal(sent.path, '/add-album');
  assert.deepEqual((sent.data as { trackIds: string[] }).trackIds, ['one', 'two']);
  // Saving shows, but the list stays usable.
  assert.equal(f.controller.saving, true); assert.equal(f.controller.locked, false);
  assert.equal(f.controller.isQueued('add-album', body => body.albumId === album.id), true);
  const saved = savedView(['entry-one', 'entry-two']); f.controller.accept(saved); // SSE can arrive before the HTTP reply.
  sent.resolve({ view: saved, entryId: 'entry-one', entryIds: ['entry-one', 'entry-two'], replayed: false }); await pending;
  assert.deepEqual([...f.controller.added], ['one', 'two']); assert.equal(f.controller.saving, false);
  f.controller.accept(savedView(['entry-two'], 2)); assert.deepEqual([...f.controller.added], ['two']);
});

test('large album drafts restore and retry the same operation; replay only marks entries still queued', async t => {
  const f = fixture(t); await f.start(); const songs = tracks(Array.from({ length: 200 }, (_, i) => `${i}-${'x'.repeat(150)}`));
  const pending = f.controller.addAlbum(album, songs); await Promise.resolve(); const sent = f.calls.at(-1)!;
  sent.reject(new Error('Connection lost')); await tick();
  f.calls.at(-1)!.resolve(view()); await pending;
  const restored = f.another(); restored.accept(view());
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
  const f = fixture(t, [0, 0]); await f.start();
  const pending = f.controller.addAlbum(album, tracks(['one', 'two'])); await Promise.resolve();
  f.calls.at(-1)!.resolve({ view: savedView(['entry-one']), entryId: 'entry-one', entryIds: ['entry-one'], replayed: false });
  // Never resent automatically: the reply arrived, it just cannot confirm the change.
  await tick(); assert.equal(f.calls.at(-1)!.path, '/state'); f.calls.at(-1)!.resolve(savedView(['entry-one'])); await pending;
  assert.ok(f.controller.pending); assert.equal(f.controller.added.size, 0); assert.match(f.controller.error, /incomplete/);
});

test('edits made while others save are queued, shown at once and sent in order, one at a time', async t => {
  const f = fixture(t); await f.start(savedView(['a', 'b', 'c']));
  const moved = f.controller.edit('move', { entryId: 'c', beforeId: 'a' });
  const removed = f.controller.edit('remove', { entryId: 'b' }, 'b');
  // Both show before either is saved; nothing is locked.
  assert.deepEqual(order(f.controller), ['c', 'a']); assert.deepEqual(f.controller.view?.removed.map(item => item.id), ['b']);
  assert.equal(f.controller.locked, false); assert.equal(f.controller.saving, true);
  assert.equal(f.calls.length, 2); assert.equal(f.calls[1]!.path, '/move');
  const restored = f.controller.edit('restore', { entryId: 'b' });
  assert.deepEqual(order(f.controller), ['c', 'a', 'b']); assert.equal(f.calls.length, 2);
  // An unrelated save from another page arrives meanwhile; the queued changes stay on top of it.
  f.controller.accept(savedView(['a', 'b', 'c', 'd'], 2)); assert.deepEqual(order(f.controller), ['c', 'a', 'd', 'b']);
  f.calls[1]!.resolve({ view: savedView(['c', 'a', 'b', 'd'], 3), entryId: 'c', replayed: false }); assert.equal(await moved, true);
  assert.equal(f.calls[2]!.path, '/remove'); assert.equal(f.calls.length, 3);
  f.calls[2]!.resolve({ view: savedView(['c', 'a', 'd'], 4, ['b']), entryId: 'b', replayed: false }); assert.equal(await removed, true);
  f.calls[3]!.resolve({ view: savedView(['c', 'a', 'd', 'b'], 5), entryId: 'b', replayed: false }); assert.equal(await restored, true);
  assert.deepEqual(order(f.controller), ['c', 'a', 'd', 'b']); assert.equal(f.controller.saving, false); assert.equal(f.controller.pending, undefined);
  // Every queued change had its own operation id and carried the revision its page saw.
  const operations = f.calls.slice(1).map(call => (call.data as { operation: { id: string; revision: number } }).operation);
  assert.equal(new Set(operations.map(item => item.id)).size, 3); assert.deepEqual(operations.map(item => item.revision), [1, 1, 1]);
});

test('a double tap is one queued change', async t => {
  const f = fixture(t); await f.start();
  const first = f.controller.add(tracks(['one'])[0]!); const second = f.controller.add(tracks(['one'])[0]!); await tick();
  assert.equal(f.calls.filter(call => call.path === '/add').length, 1);
  f.calls.at(-1)!.resolve({ view: savedView(['entry-one']), entryId: 'entry-one', replayed: false }); await Promise.all([first, second]);
  assert.deepEqual([...f.controller.added], ['one']); assert.equal(f.calls.length, 2);
});

test('a lost reply is resent with the same operation; repeated failures hold the change for Retry or Discard', async t => {
  const f = fixture(t, [0]); await f.start(savedView(['a', 'b']));
  const removed = f.controller.edit('remove', { entryId: 'a' }, 'a');
  f.calls.at(-1)!.reject(new TypeError('Failed to fetch')); await tick();
  const resent = f.calls.at(-1)!; assert.equal(resent.path, '/remove'); assert.deepEqual(resent.data, f.calls[1]!.data);
  assert.equal(f.controller.saving, true); assert.equal(f.controller.error, '');
  resent.reject(new RequestError('Service unavailable', 503)); await tick();
  assert.equal(f.calls.at(-1)!.path, '/state'); f.calls.at(-1)!.resolve(savedView(['a', 'b'])); assert.equal(await removed, false);
  // Held: still shown, still kept in this browser, and later edits wait until it is retried or discarded.
  assert.equal(f.controller.stalled, true); assert.equal(f.controller.locked, true); assert.deepEqual(order(f.controller), ['b']);
  assert.equal(await f.controller.edit('remove', { entryId: 'b' }), false); assert.equal(await f.controller.settled(), false);
  const retry = f.controller.retry(); assert.deepEqual(f.calls.at(-1)!.data, f.calls[1]!.data);
  f.calls.at(-1)!.resolve({ view: savedView(['b'], 2, ['a']), entryId: 'a', replayed: true }); await retry;
  assert.equal(f.controller.stalled, false); assert.equal(f.controller.pending, undefined); assert.deepEqual(order(f.controller), ['b']);
});

test('a conflict holds only its change; Discard drops it and the queued changes after it are saved', async t => {
  const f = fixture(t); await f.start(savedView(['a', 'b', 'c']));
  const moved = f.controller.edit('move', { entryId: 'a', beforeId: null });
  const removed = f.controller.edit('remove', { entryId: 'c' }, 'c');
  f.calls[1]!.reject(new RequestError('Only upcoming entries can be reordered.', 409)); await tick();
  assert.equal(f.calls.at(-1)!.path, '/state'); f.calls.at(-1)!.resolve(savedView(['a', 'b', 'c'], 2));
  assert.equal(await moved, false); assert.equal(await removed, false);
  assert.equal(f.controller.conflict, true); assert.match(f.controller.error, /reordered/); assert.equal(f.controller.queued.length, 2);
  const discard = f.controller.discardDraft(); await tick(); f.calls.at(-1)!.resolve(savedView(['a', 'b', 'c'], 2)); await discard; await tick();
  assert.equal(f.controller.error, ''); assert.equal(f.controller.stalled, false); assert.deepEqual(order(f.controller), ['a', 'b']);
  const sent = f.calls.at(-1)!; assert.equal(sent.path, '/remove');
  sent.resolve({ view: savedView(['a', 'b'], 3, ['c']), entryId: 'c', replayed: false }); await tick();
  assert.equal(f.controller.pending, undefined); assert.deepEqual(order(f.controller), ['a', 'b']);
});

test('a reload restores every queued change in order, including a single draft saved by an older version', async t => {
  const f = fixture(t); await f.start(savedView(['a', 'b']));
  void f.controller.edit('remove', { entryId: 'a' }, 'a'); void f.controller.edit('move', { entryId: 'b', beforeId: null });
  f.controller.stop();
  const restored = f.another(); restored.accept(savedView(['a', 'b']));
  assert.deepEqual(restored.queued.map(item => item.path), ['remove', 'move']); assert.equal(restored.stalled, true);
  assert.match(restored.error, /needs confirmation/); assert.deepEqual(order(restored), ['b']);
  // 2.1.7 kept one change under its own key.
  f.storage.clear();
  f.storage.set('doom-room.preparation-pending.v1.owner-a', JSON.stringify(f.controller.pending));
  const migrated = f.another(); migrated.accept(savedView(['a', 'b']));
  assert.deepEqual(migrated.queued.map(item => item.path), ['remove']);
  const retry = migrated.retry(); f.calls.at(-1)!.resolve({ view: savedView(['b'], 2, ['a']), entryId: 'a', replayed: false }); await retry;
  assert.equal(migrated.pending, undefined); assert.deepEqual([...f.storage.keys()], []);
});

test('Play and Clear list wait for the queued changes, and resume them after the page was hidden', async t => {
  const f = fixture(t); await f.start(savedView(['a', 'b']));
  assert.equal(await f.controller.settled(), true);
  void f.controller.edit('move', { entryId: 'b', beforeId: 'a' });
  let settled: boolean | undefined; void f.controller.settled().then(value => { settled = value; });
  // Hidden mid-save: the change is resent once the list starts again.
  f.controller.stop(); assert.equal(settled, undefined); await tick(); assert.equal(settled, false);
  const start = f.controller.start(); f.calls.at(-1)!.resolve(savedView(['a', 'b'])); await start;
  const resent = f.calls.at(-1)!; assert.equal(resent.path, '/move'); assert.deepEqual(resent.data, f.calls[1]!.data);
  const waiting = f.controller.settled(); resent.resolve({ view: savedView(['b', 'a'], 2), entryId: 'b', replayed: false });
  assert.equal(await waiting, true); assert.deepEqual(order(f.controller), ['b', 'a']);
});
