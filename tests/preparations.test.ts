import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, stat, writeFile, open } from 'node:fs/promises';
import { join } from 'node:path';
import { AppError } from '../src/model.js';
import { Engine } from '../src/engine.js';
import { DemoAdapter } from '../src/playback.js';
import { FileStore } from '../src/store.js';
import { PreparationManager, PreparationFileStore, preparationLimits, preparationStateSchema,
  type PreparationStore, type PreparationState, type PreparationOperation, type SavedSelection } from '../src/preparations.js';

class MemoryStore implements PreparationStore {
  states = new Map<string, PreparationState>();
  fail: 'before' | 'after' | null = null;
  async load(id: string) { return structuredClone(this.states.get(id) ?? null); }
  async save(state: PreparationState) {
    if (this.fail === 'before') throw new Error('Synthetic storage failure.');
    this.states.set(state.ownerId, preparationStateSchema.parse(structuredClone(state)));
    if (this.fail === 'after') throw new Error('Synthetic lost acknowledgement.');
  }
}
const status = (code: number) => (error: unknown) => error instanceof AppError && error.status === code;
const binding = randomUUID();
const selected = (number = 1): SavedSelection => ({ source: 'music-assistant', sourceBindingId: binding,
  recording: { provider: 'private-provider-instance', itemId: `recording-${number}`, uri: `spotify://track/private-uri-${number}`, version: 'Original' },
  metadata: { title: `Private title ${number}`, artist: 'Private artist', album: 'Private album', version: 'Original', provider: 'Spotify', duration: 180,
    artworkId: `image:${'a'.repeat(64)}`, artistArtworkId: `image:${'b'.repeat(64)}` } });
async function fixture(store: PreparationStore = new MemoryStore()) {
  let now = 1_800_000_000_000;
  const manager = new PreparationManager(store, () => now); const owner = await manager.createOwner();
  const op = async (): Promise<PreparationOperation> => ({ id: randomUUID(), revision: (await manager.read(owner.credential)).revision, issuedAt: now });
  return { store, manager, owner, op, now: () => now, advance(ms: number) { now += ms; },
    add: async (number = 1) => manager.add(owner.credential, await op(), selected(number)) };
}

test('private preparation persists exact identities/order across restart with private file permissions and an allowlisted owner view', async () => {
  const dir = await mkdtemp('/tmp/opencode/aoty-preparation-store-'); const store = new PreparationFileStore(dir);
  const f = await fixture(store); const first = await f.add(); const second = await f.add(2);
  await f.manager.move(f.owner.credential, await f.op(), second.entryId, first.entryId);
  const restored = new PreparationManager(new PreparationFileStore(dir)); const view = await restored.read(f.owner.credential);
  assert.deepEqual(view.upcoming.map(item => item.id), [second.entryId, first.entryId]);
  const saved = await restored.selection(f.owner.credential, second.entryId); assert.deepEqual(saved, selected(2));
  const filename = join(dir, 'preparations', `${view.ownerId}.json`); const raw = await readFile(filename, 'utf8');
  assert.equal((await stat(filename)).mode & 0o777, 0o600); assert.equal((await stat(join(dir, 'preparations'))).mode & 0o777, 0o700);
  assert.ok(raw.includes('spotify://track/private-uri-2')); assert.ok(!raw.includes(f.owner.credential));
  const serialized = JSON.stringify(view);
  for (const secret of ['private-provider-instance', 'private-uri', binding, 'image:', 'credentials', 'recoveryHash', 'receipts', f.owner.credential]) assert.ok(!serialized.includes(secret), secret);
  assert.equal(view.upcoming[0]!.title, 'Private title 2'); assert.equal(view.upcoming[0]!.provider, 'Spotify');
});

test('add appends, exact duplicates do not multiply, retry identities cannot be reused for different changes', async () => {
  const f = await fixture(); const operation = await f.op(); const first = await f.manager.add(f.owner.credential, operation, selected());
  const retry = await f.manager.add(f.owner.credential, operation, selected());
  assert.equal(retry.replayed, true); assert.equal(retry.view.revision, first.view.revision); assert.equal(retry.entryId, first.entryId);
  const duplicate = await f.add(); assert.equal(duplicate.entryId, first.entryId); assert.equal(duplicate.view.upcoming.length, 1);
  const second = await f.add(2); assert.deepEqual(second.view.upcoming.map(item => item.id), [first.entryId, second.entryId]);
  await assert.rejects(f.manager.add(f.owner.credential, operation, selected(3)), status(409));
  await assert.rejects(f.manager.move(f.owner.credential, operation, second.entryId, first.entryId), status(409));
});

test('concurrent edits use independent list revisions and cannot overwrite additions or newer order', async () => {
  const f = await fixture(); const operation = await f.op();
  const outcomes = await Promise.allSettled([f.manager.add(f.owner.credential, operation, selected()),
    f.manager.add(f.owner.credential, { ...operation, id: randomUUID() }, selected(2))]);
  assert.equal(outcomes.filter(result => result.status === 'fulfilled').length, 1);
  const rejected = outcomes.find(result => result.status === 'rejected') as PromiseRejectedResult; assert.ok(status(409)(rejected.reason));
  const second = await f.add(2); const first = second.view.upcoming[0]!;
  const stale = await f.op(); const third = await f.add(3);
  await assert.rejects(f.manager.move(f.owner.credential, stale, second.entryId, first.id), status(409));
  assert.deepEqual((await f.manager.read(f.owner.credential)).upcoming.map(item => item.id), [first.id, second.entryId, third.entryId]);
  const moved = await f.manager.move(f.owner.credential, await f.op(), third.entryId, first.id);
  assert.deepEqual(moved.view.upcoming.map(item => item.id), [third.entryId, first.id, second.entryId]);
  const bottom = await f.manager.move(f.owner.credential, await f.op(), third.entryId, null);
  assert.deepEqual(bottom.view.upcoming.map(item => item.id), [first.id, second.entryId, third.entryId]);
});

test('removal is reversible without dropping source identity and foreign/missing anchors cannot edit another owner’s list', async () => {
  const f = await fixture(); const first = await f.add(); const second = await f.add(2);
  const removed = await f.manager.remove(f.owner.credential, await f.op(), first.entryId);
  assert.deepEqual(removed.view.upcoming.map(item => item.id), [second.entryId]); assert.equal(removed.view.removed[0]!.id, first.entryId);
  await assert.rejects(f.manager.restore(f.owner.credential, await f.op(), first.entryId, randomUUID()), status(404));
  const restored = await f.manager.restore(f.owner.credential, await f.op(), first.entryId, second.entryId);
  assert.deepEqual(restored.view.upcoming.map(item => item.id), [first.entryId, second.entryId]); assert.equal(restored.view.removed.length, 0);
  assert.deepEqual(await f.manager.selection(f.owner.credential, first.entryId), selected());
  const other = await f.manager.createOwner(); const otherEntry = await f.manager.add(other.credential, { id: randomUUID(), revision: 0, issuedAt: f.now() }, selected(3));
  await assert.rejects(f.manager.move(f.owner.credential, await f.op(), first.entryId, otherEntry.entryId), status(404));
  await assert.rejects(f.manager.remove(other.credential, { id: randomUUID(), revision: otherEntry.view.revision, issuedAt: f.now() }, first.entryId), status(404));
});

test('played history is non-destructive; stale play requests and add retries never consume or resurrect another head', async () => {
  const f = await fixture(); const operation = await f.op(); const first = await f.manager.add(f.owner.credential, operation, selected()); const second = await f.add(2);
  let starts = 0; const start = async () => { starts++; return { playbackId: randomUUID(), value: undefined }; };
  await assert.rejects(f.manager.playHead(f.owner.credential, second.entryId, second.view.revision, start), status(409));
  await assert.rejects(f.manager.playHead(f.owner.credential, first.entryId, first.view.revision, start), status(409));
  const played = (await f.manager.playHead(f.owner.credential, first.entryId, second.view.revision, start)).preparation!;
  assert.deepEqual(played.upcoming.map(item => item.id), [second.entryId]); assert.equal(played.played[0]!.id, first.entryId); assert.equal(played.played[0]!.playCount, 1);
  await assert.rejects(f.manager.playHead(f.owner.credential, first.entryId, second.view.revision, start), status(409));
  const retry = await f.manager.add(f.owner.credential, operation, selected()); assert.equal(retry.replayed, true); assert.deepEqual(retry.view, played);
  const restore = await f.manager.restore(f.owner.credential, await f.op(), first.entryId, second.entryId);
  assert.equal(restore.view.upcoming[0]!.id, first.entryId); assert.equal(restore.view.upcoming[0]!.playCount, 1);
  await f.manager.remove(f.owner.credential, await f.op(), first.entryId);
  await assert.rejects(f.manager.playHead(f.owner.credential, first.entryId, (await f.op()).revision, start), status(409));
  assert.equal(starts, 1);
  assert.equal((await f.manager.read(f.owner.credential)).removed[0]!.id, first.entryId);
});

test('durable descriptors have no browse expiry and different source bindings are never silently merged or rebound', async () => {
  const f = await fixture(); const first = await f.add(); f.advance(24 * 60 * 60_000);
  const restored = new PreparationManager(f.store, f.now);
  assert.deepEqual(await restored.selection(f.owner.credential, first.entryId), selected());
  const otherSource = { ...selected(), sourceBindingId: randomUUID() } as SavedSelection;
  const second = await restored.add(f.owner.credential, await f.op(), otherSource);
  assert.equal(second.view.upcoming.length, 2); assert.notEqual(second.entryId, first.entryId);
  const raw = await f.store.load(f.owner.view.ownerId); assert.equal(raw!.entries[0]!.selection.source, 'music-assistant');
  assert.deepEqual(raw!.entries[0]!.selection, selected());
});

test('private owner events disclose nothing to another owner and disconnected listeners cannot break saves', async () => {
  const f = await fixture(); const other = await f.manager.createOwner(); const ownerEvents: unknown[] = []; const otherEvents: unknown[] = [];
  const off = await f.manager.subscribe(f.owner.credential, view => ownerEvents.push(view));
  const offOther = await f.manager.subscribe(other.credential, view => otherEvents.push(view));
  const offBroken = await f.manager.subscribe(f.owner.credential, () => { throw new Error('Disconnected'); });
  await f.manager.read(f.owner.credential); assert.equal(ownerEvents.length, 0);
  const added = await f.add(); assert.equal(ownerEvents.length, 1); assert.equal(otherEvents.length, 0);
  assert.deepEqual(ownerEvents[0], added.view);
  await assert.rejects(f.manager.move(f.owner.credential, { ...await f.op(), revision: 0 }, added.entryId, null), status(409));
  assert.equal(ownerEvents.length, 1); off(); offOther(); offBroken();
});

test('read access requires the private owner secret, never a nickname, owner ID, or recovery key used as a device credential', async () => {
  const f = await fixture(); await f.add();
  for (const credential of ['Alex', f.owner.view.ownerId, '../state', `${f.owner.view.ownerId}.${'z'.repeat(43)}`, `${randomUUID()}.${'z'.repeat(43)}`, '', null as unknown as string]) {
    await assert.rejects(f.manager.read(credential), status(401));
  }
  const recovery = await f.manager.issueRecoveryKey(f.owner.credential, (await f.op()).revision);
  await assert.rejects(f.manager.read(recovery.recoveryKey), status(401)); await assert.rejects(f.manager.recover(f.owner.credential), status(401));
});

test('private recovery survives restart, stores hashes only, rotates explicitly, and revokes other devices without deleting tracks', async () => {
  const f = await fixture(); const first = await f.add();
  const oldKey = await f.manager.issueRecoveryKey(f.owner.credential, first.view.revision);
  const key = await f.manager.issueRecoveryKey(f.owner.credential, oldKey.view.revision);
  await assert.rejects(f.manager.recover(oldKey.recoveryKey), status(401));
  const manager = new PreparationManager(f.store, f.now); const device = await manager.recover(key.recoveryKey);
  assert.equal(device.view.ownerId, f.owner.view.ownerId); assert.equal(device.view.upcoming[0]!.id, first.entryId); assert.notEqual(device.credential, f.owner.credential);
  const oldEvents: unknown[] = []; const off = await manager.subscribe(f.owner.credential, view => oldEvents.push(view));
  const view = await manager.revokeOtherDevices(device.credential, device.view.revision); assert.equal(view.upcoming.length, 1); assert.deepEqual(oldEvents, [null]); off();
  await assert.rejects(manager.read(f.owner.credential), status(401)); assert.deepEqual(await manager.read(device.credential), view);
  const raw = JSON.stringify(await f.store.load(view.ownerId));
  for (const secret of [f.owner.credential, device.credential, key.recoveryKey, oldKey.recoveryKey]) assert.ok(!raw.includes(secret));
});

test('device capacity never silently revokes an existing device or deletes preparation', async () => {
  const f = await fixture(); await f.add(); const recovery = await f.manager.issueRecoveryKey(f.owner.credential, (await f.op()).revision);
  let last = f.owner.credential;
  for (let i = 1; i < preparationLimits.devices; i++) last = (await f.manager.recover(recovery.recoveryKey)).credential;
  await assert.rejects(f.manager.recover(recovery.recoveryKey), status(409));
  assert.equal((await f.manager.read(f.owner.credential)).upcoming.length, 1); assert.equal((await f.manager.read(last)).upcoming.length, 1);
});

test('failed writes retain saved data; ambiguous committed writes reconcile by operation ID without duplicate adds', async () => {
  const store = new MemoryStore(); const f = await fixture(store); const first = await f.add(); const operation = await f.op();
  store.fail = 'before'; await assert.rejects(f.manager.add(f.owner.credential, operation, selected(2)), status(503));
  assert.deepEqual(await f.manager.read(f.owner.credential), first.view);
  store.fail = 'after'; await assert.rejects(f.manager.add(f.owner.credential, operation, selected(2)), status(503));
  const committed = await f.manager.read(f.owner.credential); assert.equal(committed.upcoming.length, 2);
  store.fail = null; const retry = await f.manager.add(f.owner.credential, operation, selected(2));
  assert.equal(retry.replayed, true); assert.deepEqual(retry.view, committed);
});

test('capacity errors preserve all entries/history, while undo can restore an existing retained entry without allocating another', async () => {
  const store = new MemoryStore(); const f = await fixture(store);
  for (let i = 0; i < preparationLimits.upcoming; i++) await f.add(i);
  const before = await f.manager.read(f.owner.credential); await assert.rejects(f.add(999), status(409));
  assert.deepEqual(await f.manager.read(f.owner.credential), before);
  const removed = await f.manager.remove(f.owner.credential, await f.op(), before.upcoming[0]!.id);
  const state = (await store.load(before.ownerId))!;
  for (let i = state.entries.length; i < preparationLimits.entries; i++) state.entries.push({ id: randomUUID(), selection: selected(1000 + i), state: 'removed', addedAt: f.now(), removedAt: f.now(), playbackIds: [] });
  await store.save(state); await assert.rejects(f.add(999), status(409));
  const restored = await f.manager.restore(f.owner.credential, await f.op(), removed.entryId);
  assert.equal(restored.view.upcoming.length, preparationLimits.upcoming); assert.equal((await store.load(before.ownerId))!.entries.length, preparationLimits.entries);
});

test('old edits expire instead of being replayed after their deduplication window and recent receipts are never silently evicted', async () => {
  const store = new MemoryStore(); const f = await fixture(store); const first = await f.add(); const state = (await store.load(first.view.ownerId))!;
  const old = await f.op();
  state.revision = preparationLimits.receipts;
  state.receipts = Array.from({ length: preparationLimits.receipts }, (_, i) => ({ id: randomUUID(), intent: '0'.repeat(64), issuedAt: f.now(), revision: i + 1, entryId: first.entryId }));
  await store.save(state); await assert.rejects(f.add(2), status(409));
  f.advance(preparationLimits.operationLifetime + 1);
  await assert.rejects(f.manager.move(f.owner.credential, { ...old, revision: state.revision }, first.entryId, null), status(409));
  const fresh = await f.manager.move(f.owner.credential, await f.op(), first.entryId, null);
  assert.equal(fresh.view.upcoming.length, 1); assert.equal((await store.load(state.ownerId))!.receipts.length, 1);
  const future = { ...await f.op(), issuedAt: f.now() + preparationLimits.futureClockTolerance + 1 };
  await assert.rejects(f.manager.move(f.owner.credential, future, first.entryId, null), status(409));
});

test('corrupt/mismatched/oversized preparation files fail closed and never overwrite another owner or unrelated app state', async () => {
  const dir = await mkdtemp('/tmp/opencode/aoty-preparation-corrupt-'); const store = new PreparationFileStore(dir); const f = await fixture(store); await f.add();
  const other = await f.manager.createOwner(); const filename = join(dir, 'preparations', `${f.owner.view.ownerId}.json`);
  const initial = await readFile(filename, 'utf8');
  await writeFile(join(dir, 'state.json'), 'Unrelated existing event state');
  for (const bad of ['broken json', JSON.stringify({ ...JSON.parse(initial), schema: 2 }), JSON.stringify({ ...JSON.parse(initial), ownerId: randomUUID() })]) {
    await writeFile(filename, bad); await assert.rejects(f.manager.read(f.owner.credential), status(503)); assert.equal(await readFile(filename, 'utf8'), bad);
    assert.equal((await f.manager.read(other.credential)).ownerId, other.view.ownerId);
  }
  const file = await open(filename, 'w'); await file.truncate(32 * 1024 * 1024 + 1); await file.close();
  await assert.rejects(f.manager.read(f.owner.credential), status(503)); assert.equal((await stat(filename)).size, 32 * 1024 * 1024 + 1);
  assert.equal(await readFile(join(dir, 'state.json'), 'utf8'), 'Unrelated existing event state');
  await assert.rejects(store.load('../state'), status(400));
});

test('validated owner snapshots can be restored from backup and reject invalid order without replacing saved data', async () => {
  const dir = await mkdtemp('/tmp/opencode/aoty-preparation-backup-'); const store = new PreparationFileStore(dir); const f = await fixture(store); const first = await f.add();
  const state = (await store.load(first.view.ownerId))!;
  await assert.rejects(store.save({ ...state, order: [state.order[0]!, state.order[0]!] }), status(503));
  assert.deepEqual(await store.load(state.ownerId), state);
  const restoreDir = await mkdtemp('/tmp/opencode/aoty-preparation-restored-'); await mkdir(join(restoreDir, 'preparations'), { mode: 0o700 });
  const restoredStore = new PreparationFileStore(restoreDir); await restoredStore.save(state);
  assert.deepEqual(await new PreparationManager(restoredStore).read(f.owner.credential), first.view);
});

test('a schema-valid state exceeding the readable byte bound cannot replace a saved private list', async () => {
  const dir = await mkdtemp('/tmp/opencode/aoty-preparation-large-'); const store = new PreparationFileStore(dir);
  const f = await fixture(store); const first = await f.add(); const initial = (await store.load(first.view.ownerId))!;
  const large = structuredClone(initial); large.entries = []; large.order = [];
  // UTF-8 bytes and JSON escaping exceed character-based schema bounds. No invalid
  // object is needed to trigger the old save-success/read-failure mismatch.
  const text = '\u0001'.repeat(1000);
  for (let i = 0; i < 1000; i++) {
    const selection = selected(i); assert.equal(selection.source, 'music-assistant');
    if (selection.source !== 'music-assistant') throw new Error();
    selection.recording.itemId = '\u0001'.repeat(2048);
    selection.metadata = { ...selection.metadata, title: text, artist: text, album: text };
    large.entries.push({ id: randomUUID(), selection, state: 'removed', addedAt: f.now(), removedAt: f.now(), playbackIds: [] });
  }
  // Each record has >30KB; add legitimate retained history to cross 32MiB.
  for (const entry of large.entries) entry.playbackIds = Array.from({ length: 100 }, () => randomUUID());
  assert.ok(preparationStateSchema.safeParse(large).success);
  assert.ok(Buffer.byteLength(JSON.stringify(large)) > 32 * 1024 * 1024);
  await assert.rejects(store.save(large), status(503));
  assert.deepEqual(await store.load(initial.ownerId), initial);
});

test('invalid descriptor metadata/proxy URLs and mutated operation bodies fail before any saved entry changes', async () => {
  const f = await fixture(); const raw = selected();
  for (const invalid of [{ ...raw, metadata: { ...raw.metadata, artworkId: 'https://untrusted.invalid/image.png' } },
    { ...raw, metadata: { ...raw.metadata, version: 'Different recording' } }, { ...raw, arbitrarySecret: 'not allowed' }]) {
    await assert.rejects(f.manager.add(f.owner.credential, await f.op(), invalid as SavedSelection), status(400));
  }
  assert.deepEqual((await f.manager.read(f.owner.credential)).upcoming, []);
});

test('preparation edits and save failures do not touch a running engine, its turn/reveal, or playback controls', async t => {
  const dir = await mkdtemp('/tmp/opencode/aoty-preparation-isolation-'); const adapter = new DemoAdapter(3600); t.after(() => adapter.close());
  let controls = 0; const control = adapter.control.bind(adapter); adapter.control = async action => { controls++; await control(action); };
  const engine = new Engine(new FileStore(dir), adapter, 'http://localhost:3000'); await engine.init();
  const member = await engine.join('Alex');
  await engine.play(member, engine.view({ kind: 'host' }).turnId!, null, 'demo:aurora');
  let current = engine.view({ kind: 'participant', credential: member }); await engine.reveal(member, current.turnId!, current.ownPlayback!.id);
  current = engine.view({ kind: 'participant', credential: member }); const controlCount = controls; let engineEvents = 0; engine.on('change', () => engineEvents++);
  const store = new MemoryStore(); const f = await fixture(store); const first = await f.add(); const second = await f.add(2);
  await f.manager.move(f.owner.credential, await f.op(), second.entryId, first.entryId);
  store.fail = 'before'; await assert.rejects(f.manager.remove(f.owner.credential, await f.op(), first.entryId), status(503));
  const after = engine.view({ kind: 'participant', credential: member });
  assert.equal(after.turnId, current.turnId); assert.deepEqual(after.ownPlayback, current.ownPlayback); assert.equal(controls, controlCount); assert.equal(engineEvents, 0);
  for (const role of [engine.view({ kind: 'host' }), after]) assert.ok(!JSON.stringify(role).includes('Private title'));
});

test('captured additions retry by receipt even after their original catalogue reference is gone', async () => {
  const f = await fixture(); const operation = await f.op(); let captures = 0;
  const first = await f.manager.addCaptured(f.owner.credential, operation, 'sealed-reference', async () => { captures++; return selected(); });
  const retry = await f.manager.addCaptured(f.owner.credential, operation, 'sealed-reference', async () => { throw new Error('Reference expired'); });
  assert.equal(retry.replayed, true); assert.equal(retry.entryId, first.entryId); assert.equal(captures, 1);
  await assert.rejects(f.manager.addCaptured(f.owner.credential, operation, 'different-reference', async () => selected()), status(409));
});

test('future private uploads share list ordering/history/recovery without disclosing or accepting file paths', async () => {
  const f = await fixture(); const first = await f.add(); const assetId = randomUUID();
  const upload: SavedSelection = { source: 'upload', assetId, artworkAssetId: randomUUID(), metadata: { ...selected().metadata, provider: 'Uploaded file' } };
  const added = await f.manager.add(f.owner.credential, await f.op(), upload);
  assert.equal((await f.manager.add(f.owner.credential, await f.op(), upload)).entryId, added.entryId);
  const moved = await f.manager.move(f.owner.credential, await f.op(), added.entryId, first.entryId);
  assert.deepEqual(moved.view.upcoming.map(entry => entry.source), ['upload', 'music-assistant']);
  assert.ok(!JSON.stringify(moved.view).includes(assetId));
  const key = await f.manager.issueRecoveryKey(f.owner.credential, moved.view.revision); const restored = await new PreparationManager(f.store, f.now).recover(key.recoveryKey);
  assert.deepEqual(await f.manager.selection(restored.credential, added.entryId), upload);
  await assert.rejects(f.manager.add(f.owner.credential, await f.op(), { ...upload, path: '/etc/passwd' } as SavedSelection), status(400));
});

test('Play next pins the exact head/revision, serializes double clicks once, and retains confirmed played history', async () => {
  const f = await fixture(); const first = await f.add(); const second = await f.add(2); let starts = 0;
  const work = async (selection: SavedSelection) => { starts++; assert.deepEqual(selection, selected()); return { playbackId: randomUUID(), value: 'confirmed' }; };
  await assert.rejects(f.manager.playHead(f.owner.credential, second.entryId, second.view.revision, work), status(409));
  await assert.rejects(f.manager.playHead(f.owner.credential, first.entryId, first.view.revision, work), status(409));
  assert.equal(starts, 0);
  const results = await Promise.allSettled([f.manager.playHead(f.owner.credential, first.entryId, second.view.revision, work), f.manager.playHead(f.owner.credential, first.entryId, second.view.revision, work)]);
  assert.equal(starts, 1); assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  const saved = await f.manager.read(f.owner.credential);
  assert.deepEqual(saved.upcoming.map(entry => entry.id), [second.entryId]); assert.equal(saved.played[0]!.id, first.entryId); assert.equal(saved.reviewEntryId, undefined);
});

test('failed/uncertain Play next survives restart with an explicit review marker and never consumes or retries audio', async () => {
  const f = await fixture(); const first = await f.add(); let starts = 0;
  await assert.rejects(f.manager.playHead(f.owner.credential, first.entryId, first.view.revision, async () => { starts++; throw new AppError(502, 'Uncertain start'); }), status(502));
  const manager = new PreparationManager(f.store, f.now); const saved = await manager.read(f.owner.credential);
  assert.equal(saved.upcoming[0]!.id, first.entryId); assert.equal(saved.reviewEntryId, first.entryId); assert.equal(starts, 1);
  await assert.rejects(manager.playHead(f.owner.credential, first.entryId, saved.revision, async () => { starts++; return { playbackId: randomUUID(), value: null }; }), status(409));
  await assert.rejects(manager.remove(f.owner.credential, await f.op(), first.entryId), status(409));
  const reviewed = await manager.acknowledgeReview(f.owner.credential, await f.op(), first.entryId);
  assert.equal(reviewed.view.reviewEntryId, undefined); assert.equal(reviewed.view.upcoming.length, 1); assert.equal(starts, 1);
});

test('pre-play durability failures send no audio; post-start bookkeeping failures return success plus uncertainty without replay', async () => {
  for (const failure of ['before', 'after'] as const) {
    const store = new MemoryStore(); const f = await fixture(store); const first = await f.add(); let starts = 0;
    store.fail = failure;
    await assert.rejects(f.manager.playHead(f.owner.credential, first.entryId, first.view.revision, async () => { starts++; return { playbackId: randomUUID(), value: null }; }), status(503));
    assert.equal(starts, 0); assert.equal((await f.manager.read(f.owner.credential)).upcoming.length, 1);
    store.fail = null;
    let view = await f.manager.read(f.owner.credential);
    if (view.reviewEntryId) view = (await f.manager.acknowledgeReview(f.owner.credential, await f.op(), first.entryId)).view;
    const result = await f.manager.playHead(f.owner.credential, first.entryId, view.revision, async () => { starts++; store.fail = failure; return { playbackId: randomUUID(), value: 'audio-confirmed' }; });
    assert.equal(result.value, 'audio-confirmed'); assert.ok(result.warning); assert.equal(starts, 1);
    const saved = await f.manager.read(f.owner.credential);
    assert.equal(saved.upcoming.length, failure === 'before' ? 1 : 0);
    assert.equal(saved.played.length, failure === 'after' ? 1 : 0);
    assert.equal(saved.reviewEntryId, failure === 'before' ? first.entryId : undefined);
  }
});
