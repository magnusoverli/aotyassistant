import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, writeFile, rename, unlink, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { PreparationIdentity } from '../src/preparation-identity.js';
import { PreparationFileStore, PreparationManager, type SavedSelection } from '../src/preparations.js';

const member = () => randomBytes(32).toString('base64url');
const selection = (trackId = 'demo:saved'): SavedSelection => ({ source: 'demo', trackId,
  metadata: { title: 'Saved song', artist: 'Artist', album: 'Album', version: '', provider: 'Demo', duration: 180 } });
const operation = (revision: number) => ({ id: randomUUID(), issuedAt: Date.now(), revision });
async function fixture() {
  const directory = await mkdtemp('/tmp/opencode/aoty-single-list-');
  const store = new PreparationFileStore(directory); const manager = new PreparationManager(store);
  return { directory, store, manager, identity: new PreparationIdentity(manager, directory) };
}

test('one implicit list is reused across simultaneous tabs, a lost list cookie and server restarts', async () => {
  const f = await fixture(); const credential = member();
  const results = await Promise.all(Array.from({ length: 8 }, () => f.identity.ensure(credential, '')));
  assert.equal(new Set(results.map(result => result.view.ownerId)).size, 1);
  assert.deepEqual(results[0]!.view.upcoming, []);
  const saved = await f.manager.add(results[0]!.credential, operation(0), selection());
  const restarted = new PreparationIdentity(new PreparationManager(new PreparationFileStore(f.directory)), f.directory);
  assert.deepEqual(await restarted.ensure(credential, ''), { credential: results[0]!.credential, view: saved.view });
  assert.equal((await readdir(join(f.directory, 'preparations'))).filter(name => name.endsWith('.json')).length, 1);
  const binding = join(f.directory, 'preparations', 'bindings', `${createHash('sha256').update(credential).digest('hex')}.json`);
  assert.deepEqual(JSON.parse(await readFile(binding, 'utf8')), { schema: 1, ownerId: saved.view.ownerId });
  assert.equal((await stat(binding)).mode & 0o777, 0o600);
  assert.equal((await stat(join(f.directory, 'preparations', 'bindings'))).mode & 0o777, 0o700);
  const other = await restarted.ensure(member(), ''); assert.notEqual(other.view.ownerId, results[0]!.view.ownerId);
});

test('existing list credentials are adopted without losing entries, history, uploads or legacy authorization', async () => {
  const f = await fixture(); const owner = await f.manager.createOwner();
  const edit = async () => operation((await f.manager.read(owner.credential)).revision);
  const played = await f.manager.add(owner.credential, operation(0), selection());
  await f.manager.playHead(owner.credential, played.entryId, played.view.revision, async () => ({ playbackId: randomUUID(), value: undefined }));
  const removed = await f.manager.add(owner.credential, await edit(), selection('demo:removed'));
  await f.manager.remove(owner.credential, operation(removed.view.revision), removed.entryId);
  const upload: SavedSelection = { source: 'upload', assetId: randomUUID(), artworkAssetId: randomUUID(), sha256: 'a'.repeat(64),
    metadata: { ...selection().metadata, title: 'Private uploaded song', provider: 'Upload' } };
  const uploaded = await f.manager.add(owner.credential, await edit(), upload);
  const saved = await f.manager.add(owner.credential, operation(uploaded.view.revision), selection('demo:upcoming'));
  await f.manager.move(owner.credential, operation(saved.view.revision), saved.entryId, uploaded.entryId);
  const before = await f.manager.read(owner.credential); const state = (await f.store.load(owner.view.ownerId))!;
  const file = join(f.directory, 'preparations', `${owner.view.ownerId}.json`);
  await writeFile(file, JSON.stringify({ ...state, schema: 1, recoveryHash: 'f'.repeat(64) }));
  const joined = await f.identity.ensure(member(), owner.credential);
  assert.deepEqual(joined.view, before);
  assert.deepEqual(joined.view.upcoming.map(entry => entry.id), [saved.entryId, uploaded.entryId]);
  assert.equal(joined.view.played[0]!.id, played.entryId); assert.equal(joined.view.removed[0]!.id, removed.entryId);
  assert.deepEqual(await f.manager.selection(joined.credential, uploaded.entryId), upload);
  const adopted = (await f.store.load(owner.view.ownerId))!;
  assert.deepEqual({ ...adopted, credentials: state.credentials }, state, 'Only authorization and the obsolete schema field change.');
  assert.deepEqual(await f.manager.read(owner.credential), joined.view);
  const raw = await readFile(file, 'utf8'); assert.equal(JSON.parse(raw).schema, 2);
  assert.ok(!raw.includes('recoveryHash')); assert.ok(!raw.includes(joined.credential));
  const rejoined = await f.identity.ensure(member(), joined.credential); assert.equal(rejoined.view.ownerId, owner.view.ownerId);
  const restarted = new PreparationIdentity(new PreparationManager(new PreparationFileStore(f.directory)), f.directory);
  assert.deepEqual((await restarted.ensure(member(), rejoined.credential)).view, before);
  assert.equal((await stat(file)).mode & 0o777, 0o600);
});

test('a known participant cannot switch lists using another valid list cookie', async () => {
  const f = await fixture(); const first = member(); const a = await f.identity.ensure(first, ''); const b = await f.identity.ensure(member(), '');
  const again = await f.identity.ensure(first, b.credential); assert.equal(again.view.ownerId, a.view.ownerId);
});

test('a stale cookie without saved data does not block automatic setup for an unbound participant', async () => {
  const f = await fixture(); const credential = member(); const staleOwner = randomUUID();
  const result = await f.identity.ensure(credential, `${staleOwner}.${'x'.repeat(43)}`);
  assert.notEqual(result.view.ownerId, staleOwner); assert.deepEqual(result.view.upcoming, []);
  assert.deepEqual(await f.identity.ensure(credential, ''), result);
  assert.equal(await f.store.load(staleOwner), null);
});

test('invalid authorization and corrupt data in an existing unbound list cannot be mistaken for a stale cookie', async () => {
  const f = await fixture(); const owner = await f.manager.createOwner();
  const saved = await f.manager.add(owner.credential, operation(0), selection());
  await assert.rejects(f.identity.ensure(member(), `${owner.view.ownerId}.${'x'.repeat(43)}`), /selections are unavailable/);
  assert.deepEqual(await f.manager.read(owner.credential), saved.view);
  const file = join(f.directory, 'preparations', `${owner.view.ownerId}.json`);
  await writeFile(file, 'corrupt-list');
  await assert.rejects(f.identity.ensure(member(), owner.credential), /Nothing was reset/);
  assert.equal(await readFile(file, 'utf8'), 'corrupt-list');
  assert.equal((await readdir(join(f.directory, 'preparations'))).filter(name => name.endsWith('.json')).length, 1);
});

test('invalid bindings fail closed rather than creating an empty replacement', async () => {
  const f = await fixture(); const credential = member(); const owner = await f.identity.ensure(credential, '');
  const saved = await f.manager.add(owner.credential, operation(0), selection());
  const binding = join(f.directory, 'preparations', 'bindings', `${createHash('sha256').update(credential).digest('hex')}.json`);
  await writeFile(binding, 'invalid'); await assert.rejects(f.identity.ensure(credential, owner.credential), /Nothing was reset/);
  assert.deepEqual(await f.manager.read(owner.credential), saved.view);
  await assert.rejects(f.identity.ensure(member(), 'invalid-cookie'), /selections are unavailable/);
});

test('a missing binding reuses the deterministic list without losing its entries', async () => {
  const f = await fixture(); const credential = member(); const owner = await f.identity.ensure(credential, '');
  const saved = await f.manager.add(owner.credential, operation(0), selection());
  const binding = join(f.directory, 'preparations', 'bindings', `${createHash('sha256').update(credential).digest('hex')}.json`);
  await unlink(binding);
  assert.deepEqual((await f.identity.ensure(credential, '')).view, saved.view);
});

test('missing or corrupt bound list data is never replaced with an empty list', async () => {
  const f = await fixture(); const credential = member(); const owner = await f.identity.ensure(credential, '');
  const saved = await f.manager.add(owner.credential, operation(0), selection());
  const file = join(f.directory, 'preparations', `${owner.view.ownerId}.json`); const preserved = file + '.preserved';
  await rename(file, preserved);
  await assert.rejects(f.identity.ensure(credential, ''), /Nothing was reset/);
  await assert.rejects(stat(file), { code: 'ENOENT' });
  await writeFile(file, 'corrupt-list'); await assert.rejects(f.identity.ensure(credential, ''), /Nothing was reset/);
  assert.equal(await readFile(file, 'utf8'), 'corrupt-list');
  await rename(preserved, file);
  assert.deepEqual((await f.identity.ensure(credential, '')).view, saved.view);
});
