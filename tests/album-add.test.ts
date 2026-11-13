import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { z } from 'zod';
import { AppError } from '../src/model.js';
import { PreparationManager, preparationLimits, preparationStateSchema, type PreparationState, type PreparationStore, type SavedSelection } from '../src/preparations.js';
import { IntegrationManager } from '../src/integrations.js';
import { publicRoute } from '../src/public-listener.js';
import { requestPriority } from '../src/operation.js';
import { mountPreparations } from '../src/preparation-http.js';
import type { Engine } from '../src/engine.js';
import type { UploadAssets } from '../src/uploads.js';
import type { UserManager } from '../src/users.js';

class MemoryStore implements PreparationStore {
  states = new Map<string, PreparationState>();
  fail: 'before' | 'after' | undefined;
  async load(id: string) { return structuredClone(this.states.get(id) ?? null); }
  async save(state: PreparationState) {
    if (this.fail === 'before') throw new Error('Save failed');
    this.states.set(state.ownerId, preparationStateSchema.parse(structuredClone(state)));
    if (this.fail === 'after') throw new Error('Acknowledgement lost');
  }
}
const binding = randomUUID();
const selected = (n: number): SavedSelection => ({ source: 'music-assistant', sourceBindingId: binding,
  recording: { provider: 'provider', itemId: String(n), uri: `provider://track/${n}`, version: '' },
  metadata: { title: `Song ${n}`, artist: 'Artist', album: 'Album', version: '', provider: 'Provider', duration: 180 } });
const status = (code: number) => (error: unknown) => error instanceof AppError && error.status === code;
const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; };
async function fixture() {
  const store = new MemoryStore(); const manager = new PreparationManager(store); const owner = await manager.createOwner();
  const op = async () => ({ id: randomUUID(), revision: (await manager.read(owner.credential)).revision, issuedAt: Date.now() });
  return { store, manager, owner, op };
}

test('album addition appends missing recordings in display order, maps duplicates, and publishes one saved revision', async () => {
  const f = await fixture(); const first = await f.manager.add(f.owner.credential, await f.op(), selected(2));
  const events: unknown[] = []; const off = await f.manager.subscribe(f.owner.credential, view => events.push(view));
  const equivalent = selected(2);
  if (equivalent.source !== 'music-assistant') throw Error();
  equivalent.recording = { provider: 'other', itemId: 'same', uri: 'other://track/same', version: '', equivalents: [equivalent.recording] };
  const operation = await f.op(); const refs = ['one', 'two-equivalent', 'three', 'one-again'];
  const result = await f.manager.addAlbumCaptured(f.owner.credential, operation, 'album', refs, async () => [selected(1), equivalent, selected(3), selected(1)]);
  assert.deepEqual(result.view.upcoming.map(entry => entry.title), ['Song 2', 'Song 1', 'Song 3']);
  assert.equal(result.entryIds!.length, 4); assert.equal(result.entryIds![1], first.entryId); assert.equal(result.entryIds![0], result.entryIds![3]);
  assert.equal(result.view.revision, first.view.revision + 1); assert.deepEqual(events, [result.view]); off();
  await assert.rejects(f.manager.addAlbumCaptured(f.owner.credential, operation, 'album', [...refs].reverse(), async () => []), status(409));
  assert.equal(publicRoute('POST', '/api/participant/preparations/add-album'), true);
});

test('album receipts survive restart and lost acknowledgements without recapture or resurrecting removed tracks', async () => {
  const f = await fixture(); const operation = await f.op(); const refs = ['one', 'two']; let captures = 0;
  const capture = async () => { captures++; return [selected(1), selected(2)]; };
  f.store.fail = 'before'; await assert.rejects(f.manager.addAlbumCaptured(f.owner.credential, operation, 'album', refs, capture), status(503));
  assert.equal((await f.manager.read(f.owner.credential)).upcoming.length, 0);
  f.store.fail = 'after'; await assert.rejects(f.manager.addAlbumCaptured(f.owner.credential, operation, 'album', refs, capture), status(503));
  const committed = await f.manager.read(f.owner.credential); assert.equal(committed.upcoming.length, 2);
  f.store.fail = undefined;
  await f.manager.remove(f.owner.credential, await f.op(), committed.upcoming[0]!.id);
  const restored = new PreparationManager(f.store);
  const retry = await restored.addAlbumCaptured(f.owner.credential, operation, 'album', refs, async () => { throw new Error('Expired reference'); });
  assert.equal(captures, 2); assert.equal(retry.replayed, true);
  assert.deepEqual(retry.entryIds, committed.upcoming.map(entry => entry.id));
  assert.deepEqual(retry.view.upcoming.map(entry => entry.title), ['Song 2']);
});

for (const limit of ['upcoming', 'entries'] as const) test(`an album exceeding ${limit} capacity saves no prefix and keeps history`, async () => {
  const f = await fixture(); const state = (await f.store.load(f.owner.view.ownerId))!;
  const count = preparationLimits[limit] - 1;
  for (let n = 0; n < count; n++) {
    const id = randomUUID();
    state.entries.push({ id, selection: selected(n), state: limit === 'upcoming' ? 'upcoming' : 'removed', addedAt: 0, playbackIds: [], ...(limit === 'entries' ? { removedAt: 0 } : {}) });
    if (limit === 'upcoming') state.order.push(id);
  }
  await f.store.save(state); const before = await f.manager.read(f.owner.credential);
  await assert.rejects(f.manager.addAlbumCaptured(f.owner.credential, await f.op(), 'album', ['new-one', 'new-two'], async () => [selected(3000), selected(3001)]), status(409));
  assert.deepEqual(await f.manager.read(f.owner.credential), before);
  assert.deepEqual(await f.store.load(before.ownerId), state, 'No partial tracks or receipt may be saved.');
});

test('album capture failures and incomplete responses leave the list intact', async () => {
  const f = await fixture(); const before = await f.manager.read(f.owner.credential);
  await assert.rejects(f.manager.addAlbumCaptured(f.owner.credential, await f.op(), 'album', ['one', 'two'], async () => { throw new AppError(422, 'Track unavailable'); }), status(422));
  await assert.rejects(f.manager.addAlbumCaptured(f.owner.credential, await f.op(), 'album', ['one', 'two'], async () => [selected(1)]), status(502));
  await assert.rejects(f.manager.addAlbumCaptured(f.owner.credential, await f.op(), 'album', [], async () => []), status(400));
  await assert.rejects(f.manager.addAlbumCaptured(f.owner.credential, await f.op(), 'album', Array(2001).fill('ref'), async () => []), status(400));
  assert.deepEqual(await f.manager.read(f.owner.credential), before);
});

test('concurrent retries share album capture and save exactly once', async () => {
  const f = await fixture(); const operation = await f.op(); const started = deferred<void>(); const held = deferred<SavedSelection[]>(); let captures = 0;
  const capture = async () => { captures++; started.resolve(); return held.promise; };
  const first = f.manager.addAlbumCaptured(f.owner.credential, operation, 'album', ['one', 'two'], capture); await started.promise;
  const second = f.manager.addAlbumCaptured(f.owner.credential, operation, 'album', ['one', 'two'], capture);
  held.resolve([selected(1), selected(2)]);
  const results = await Promise.all([first, second]);
  assert.equal(captures, 1); assert.equal(results.filter(result => result.replayed).length, 1);
  assert.deepEqual(results[0]!.entryIds, results[1]!.entryIds); assert.equal(results[1]!.view.revision, 1);
});

test('album capture does not hold the owner lane and commits after a concurrent list edit without overwriting it', async () => {
  const f = await fixture(); const started = deferred<void>(); const held = deferred<SavedSelection[]>();
  const pending = f.manager.addAlbumCaptured(f.owner.credential, await f.op(), 'album', ['one'], async () => { started.resolve(); return held.promise; });
  await started.promise;
  const other = await f.manager.add(f.owner.credential, await f.op(), selected(2));
  held.resolve([selected(1)]); const album = await pending;
  assert.deepEqual(album.view.upcoming.map(entry => entry.id), [other.entryId, album.entryId]);
  assert.deepEqual(await f.manager.read(f.owner.credential), album.view);
});

test('revoked list ownership during album capture prevents the commit', async () => {
  const f = await fixture(); const started = deferred<void>(); const held = deferred<SavedSelection[]>();
  const pending = f.manager.addAlbumCaptured(f.owner.credential, await f.op(), 'album', ['one'], async () => { started.resolve(); return held.promise; });
  await started.promise; f.manager.setCredentialPolicy(() => false); held.resolve([selected(1)]);
  await assert.rejects(pending, status(401));
  assert.equal((await f.store.load(f.owner.view.ownerId))!.entries.length, 0);
});

test('album recording lookup uses bounded bulk concurrency and retains order despite out-of-order replies', async () => {
  const manager = new IntegrationManager({ async load() { return { schema: 1, revision: 0, musicAssistant: null }; }, async save() {} });
  let active = 0; let maximum = 0; const finished: number[] = [];
  manager.captureSaved = async id => {
    assert.equal(requestPriority(), 'bulk'); const n = Number(id); active++; maximum = Math.max(maximum, active);
    for (let i = 0; i < 4 - n % 4; i++) await new Promise<void>(resolve => setImmediate(resolve));
    active--; finished.push(n); return selected(n);
  };
  const result = await manager.captureSavedAlbum(Array.from({ length: 9 }, (_, i) => String(i)), 'member');
  assert.equal(maximum, 4); assert.notDeepEqual(finished, Array.from({ length: 9 }, (_, i) => i));
  assert.deepEqual(result.map(item => item.metadata.title), Array.from({ length: 9 }, (_, i) => `Song ${i}`));
});

test('album HTTP saves require a private list, valid membership, bounded references and stable capture context', async t => {
  const f = await fixture(); const app = express(); app.use(express.json({ limit: '2mb' }));
  let context = 'context'; let changeDuringCapture = false; let captures = 0;
  const engine = { catalogueContext(member: string) { if (member !== 'member') throw new AppError(401, 'Join first'); return context; } };
  const integrations = { configured: true, async captureSavedAlbum(ids: string[], capturedContext: string) {
    captures++; assert.equal(capturedContext, context);
    if (ids.includes('foreign')) throw new AppError(409, 'Reference belongs to another participant');
    if (changeDuringCapture) context = 'changed';
    return ids.map(id => selected(Number(id)));
  } };
  const close = mountPreparations(app, f.manager, engine as unknown as Engine,
    { port: 3000, listenHost: '127.0.0.1', guestUrl: 'http://localhost:3000', dataDir: 'unused' },
    integrations as unknown as IntegrationManager, {} as UploadAssets, {} as UserManager);
  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(error instanceof AppError ? error.status : error instanceof z.ZodError ? 400 : 500).json({ error: 'Request failed' });
  });
  const server = app.listen(0, '127.0.0.1'); t.after(() => { close(); server.closeAllConnections(); server.close(); }); await once(server, 'listening');
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const credentials = `doom_room_participant=member; doom_room_preparation=${f.owner.credential}`;
  const request = async (trackIds: string[], cookie = credentials, extra = {}) => fetch(`${origin}/api/participant/preparations/add-album`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ operation: await f.op(), albumId: 'album', trackIds, ...extra }), signal: AbortSignal.timeout(5000),
  });
  assert.equal((await request(['1'], '')).status, 401);
  assert.equal((await request(['1'], `doom_room_preparation=${f.owner.credential}`)).status, 401); assert.equal(captures, 0);
  assert.equal((await request([])).status, 400); assert.equal((await request(Array(2001).fill('1'))).status, 400);
  assert.equal((await request(['1'], credentials, { selections: [selected(1)] })).status, 400);
  assert.equal((await request(['1', 'foreign'])).status, 409);
  changeDuringCapture = true; assert.equal((await request(['1', '2'])).status, 401);
  assert.equal((await f.manager.read(f.owner.credential)).upcoming.length, 0);
  changeDuringCapture = false; const response = await request(['2', '1']); assert.equal(response.status, 200);
  const result = await response.json() as { entryIds: string[]; view: { upcoming: { id: string; title: string }[] } };
  assert.deepEqual(result.view.upcoming.map(entry => entry.title), ['Song 2', 'Song 1']);
  assert.deepEqual(result.entryIds, result.view.upcoming.map(entry => entry.id));
});
