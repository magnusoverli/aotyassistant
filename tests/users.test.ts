import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, unlink, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { UserManager } from '../src/users.js';
import { Engine } from '../src/engine.js';
import { FileStore } from '../src/store.js';
import { DemoAdapter } from '../src/playback.js';
import { PreparationFileStore, PreparationManager, type SavedSelection } from '../src/preparations.js';
import { PreparationIdentity } from '../src/preparation-identity.js';
import { AppError } from '../src/model.js';

const selection: SavedSelection = { source: 'demo', trackId: 'demo:aurora', metadata: {
  title: 'Private song', artist: 'Private artist', album: 'Private album', version: '', provider: 'demo', duration: 180,
} };
const status = (code: number) => (error: unknown) => error instanceof AppError && error.status === code;
async function fixture(t: TestContext) {
  const directory = await mkdtemp('/tmp/opencode/aoty-users-');
  const engine = new Engine(new FileStore(directory), new DemoAdapter(3600), 'http://localhost:3000'); await engine.init();
  const lists = new PreparationManager(new PreparationFileStore(directory));
  let now = Date.now(); const users = new UserManager(directory, lists, engine, () => now); await users.ready;
  t.after(() => engine.adapter.close());
  return { directory, engine, lists, users, advance(ms: number) { now += ms; } };
}

test('one permanent user has one private playlist and one seat across devices, tabs and restart', async t => {
  const f = await fixture(t); const first = await f.users.register('Alex', '0042');
  await f.engine.joinUser(first.user.id, first.token);
  const list = await f.users.ensureList(first.token, '');
  const added = await f.lists.add(list.credential, { id: randomUUID(), revision: list.view.revision, issuedAt: Date.now() }, selection);
  const second = await f.users.login(first.user.id, '0042');
  await Promise.all([f.engine.joinUser(second.user.id, second.token), f.engine.joinUser(first.user.id, first.token)]);
  const otherList = await f.users.ensureList(second.token, '');
  assert.notEqual(second.token, first.token); assert.notEqual(list.credential, otherList.credential);
  assert.equal(otherList.view.ownerId, list.view.ownerId); assert.equal(otherList.view.upcoming[0]!.id, added.entryId);
  assert.equal(f.engine.view({ kind: 'host' }).active!.length, 1);
  assert.notEqual(first.user.id, list.view.ownerId, 'Public user IDs do not expose private playlist IDs.');
  const raw = await readFile(join(f.directory, 'users.json'), 'utf8');
  assert.ok(!raw.includes(first.token)); assert.ok(!raw.includes('"pin":"0042"')); assert.ok(!raw.includes('Private song'));
  const fresh = new UserManager(f.directory, f.lists, f.engine); await fresh.ready;
  assert.equal(fresh.current(second.token)?.id, first.user.id);
  assert.equal((await fresh.ensureList(second.token, '')).view.upcoming[0]!.id, added.entryId);
});

test('same names remain separate users; wrong PINs, cooldowns and expiration never grant access', async t => {
  const f = await fixture(t); const a = await f.users.register('Sam', '1234'); const b = await f.users.register('Sam', '9876');
  assert.notEqual(a.user.id, b.user.id);
  for (let i = 0; i < 5; i++) await assert.rejects(f.users.login(a.user.id, '9876'), status(401));
  await assert.rejects(f.users.login(a.user.id, '1234'), status(429));
  assert.equal((await f.users.login(b.user.id, '9876')).user.id, b.user.id);
  f.advance(60_001); assert.equal((await f.users.login(a.user.id, '1234')).user.id, a.user.id);
  assert.equal(f.users.current(a.user.id), undefined);
  f.advance(366 * 24 * 60 * 60_000); assert.equal(f.users.current(a.token), undefined);
});

test('PIN reset revokes browser and playlist credentials, including subscribed streams, without changing music or membership', async t => {
  const f = await fixture(t); const first = await f.users.register('Alex', '1234');
  await f.engine.joinUser(first.user.id, first.token);
  const list = await f.users.ensureList(first.token, '');
  await f.lists.add(list.credential, { id: randomUUID(), revision: 0, issuedAt: Date.now() }, selection);
  const events: unknown[] = []; const off = await f.lists.subscribe(list.credential, value => events.push(value)); t.after(off);
  const before = f.engine.view({ kind: 'host' });
  await f.users.setPin(first.user.id, '0007');
  assert.equal(f.users.current(first.token), undefined); assert.equal(events.at(-1), null);
  await assert.rejects(f.lists.read(list.credential), status(401));
  await assert.rejects(f.users.ensureList(first.token, list.credential), status(401));
  await assert.rejects(f.users.login(first.user.id, '1234'), status(401));
  const login = await f.users.login(first.user.id, '0007'); const restored = await f.users.ensureList(login.token, '');
  assert.equal(restored.view.upcoming[0]!.title, 'Private song'); assert.equal(restored.view.ownerId, list.view.ownerId);
  assert.deepEqual(f.engine.view({ kind: 'host' }).active, before.active);
  assert.equal(f.engine.view({ kind: 'host' }).turnId, before.turnId);
});

test('logout affects one device; room removal persists until explicit rejoin and retains the user and list', async t => {
  const f = await fixture(t); const a = await f.users.register('Alex', '1234'); const b = await f.users.login(a.user.id, '1234');
  await f.engine.joinUser(a.user.id, a.token);
  const list = await f.users.ensureList(a.token, ''); const second = await f.users.ensureList(b.token, '');
  await f.users.logout(a.token);
  await assert.rejects(f.lists.read(list.credential), status(401)); assert.equal((await f.lists.read(second.credential)).ownerId, list.view.ownerId);
  const host = f.engine.view({ kind: 'host' }); await f.engine.remove(host.current!.id, host.revision);
  assert.equal(f.users.current(b.token)?.id, a.user.id); assert.equal(f.users.directoryView().users.length, 1);
  assert.throws(() => f.engine.view({ kind: 'participant', credential: b.token }), status(401));
  await f.users.ensureList(b.token, ''); assert.equal(f.engine.view({ kind: 'host' }).active!.length, 0);
  await f.engine.joinUser(a.user.id, b.token); assert.equal(f.engine.view({ kind: 'host' }).active!.length, 1);
});

test('legacy browser ownership migrates without moving list data, and old bindings cannot bypass the chosen PIN', async t => {
  const f = await fixture(t); const member = await f.engine.join('Existing listener');
  const old = await new PreparationIdentity(f.lists, f.directory).ensure(member, '');
  const entry = await f.lists.add(old.credential, { id: randomUUID(), revision: 0, issuedAt: Date.now() }, selection);
  await f.users.migrate(); const user = f.users.current(member)!;
  assert.equal(user.pinRequired, true); assert.equal((await f.lists.read(old.credential)).upcoming[0]!.id, entry.entryId);
  await f.users.ensureList(member, old.credential); await f.users.setPin(user.id, '0123', member);
  const newDevice = await f.users.login(user.id, '0123'); const restored = await f.users.ensureList(newDevice.token, '');
  assert.equal(restored.view.ownerId, old.view.ownerId); assert.equal(restored.view.upcoming[0]!.id, entry.entryId);
  await f.users.setPin(user.id, '5555');
  await assert.rejects(f.users.ensureList(member, old.credential), status(401));
  await assert.rejects(f.lists.read(old.credential), status(401));
  const fresh = new UserManager(f.directory, f.lists, f.engine); await fresh.migrate();
  assert.equal(fresh.current(member), undefined);
});

test('an authorized orphaned legacy list is adopted without nickname matching or replacing saved entries', async t => {
  const f = await fixture(t); const old = await f.lists.createOwner();
  await f.lists.add(old.credential, { id: randomUUID(), revision: 0, issuedAt: Date.now() }, selection);
  const user = await f.users.register('Returning', '0042', randomUUID(), old.credential);
  assert.equal((await f.users.ensureList(user.token, '')).view.ownerId, old.view.ownerId);
  assert.equal((await f.users.ensureList(user.token, '')).view.upcoming[0]!.title, 'Private song');
});

test('registration receipts reuse the user after a lost response; missing established data is not silently recreated', async t => {
  const f = await fixture(t); const operation = randomUUID(); const first = await f.users.register('Alex', '1234', operation);
  const retry = await f.users.register('Alex', '1234', operation);
  assert.equal(retry.user.id, first.user.id); assert.equal(f.users.directoryView().users.length, 1);
  const list = await f.users.ensureList(first.token, ''); await unlink(join(f.directory, 'preparations', `${list.view.ownerId}.json`));
  await assert.rejects(f.users.ensureList(first.token, ''), status(503));
});

test('corrupt identity storage fails visibly without overwriting existing profiles', async t => {
  const f = await fixture(t); await f.users.register('Alex', '1234');
  await writeFile(join(f.directory, 'users.json'), '{broken');
  const fresh = new UserManager(f.directory, f.lists, f.engine); await assert.rejects(fresh.ready, status(503));
  assert.equal(await readFile(join(f.directory, 'users.json'), 'utf8'), '{broken');
});

test('interrupted migration resumes its persisted user without duplicating identities or replacing saved music', async t => {
  const f = await fixture(t); const token = await f.engine.join('Existing listener');
  const list = await new PreparationIdentity(f.lists, f.directory).ensure(token, '');
  const added = await f.lists.add(list.credential, { id: randomUUID(), revision: 0, issuedAt: Date.now() }, selection);
  const link = f.engine.linkUsers.bind(f.engine);
  f.engine.linkUsers = async () => { throw new Error('Interrupted after user commit'); };
  await assert.rejects(f.users.migrate(), /Interrupted/); f.engine.linkUsers = link;
  const restarted = new UserManager(f.directory, f.lists, f.engine); await restarted.migrate();
  assert.equal(restarted.directoryView().users.length, 1);
  const recovered = await restarted.ensureList(token, '');
  assert.equal(recovered.view.ownerId, list.view.ownerId); assert.equal(recovered.view.upcoming[0]!.id, added.entryId);
});

test('a failed initial playlist creation resumes the registration receipt, and concurrent logins share one seat', async t => {
  const f = await fixture(t); const operation = randomUUID(); const bind = f.lists.bindParticipant.bind(f.lists);
  f.lists.bindParticipant = async () => { throw new Error('Interrupted before playlist creation'); };
  await assert.rejects(f.users.register('Alex', '0042', operation), /Interrupted/); f.lists.bindParticipant = bind;
  const retry = await f.users.register('Alex', '0042', operation);
  const list = await f.users.ensureList(retry.token, ''); assert.equal(list.view.upcoming.length, 0);
  const devices = await Promise.all(Array.from({ length: 6 }, () => f.users.login(retry.user.id, '0042')));
  await Promise.all(devices.map(device => f.engine.joinUser(device.user.id, device.token)));
  assert.equal(f.engine.view({ kind: 'host' }).active!.length, 1);
  assert.equal(f.users.directoryView().users.length, 1);
});

test('permanent deletion removes the user, playlist and seat while keeping other users; old sessions and registration retries stay revoked', async t => {
  const f = await fixture(t); const registration = randomUUID(); const first = await f.users.register('Delete me', '0042', registration);
  const second = await f.users.register('Keep me', '1234'); const anotherDevice = await f.users.login(first.user.id, '0042');
  await f.engine.joinUser(first.user.id, first.token); await f.engine.joinUser(second.user.id, second.token);
  const list = await f.users.ensureList(first.token, ''); const kept = await f.users.ensureList(second.token, '');
  await f.lists.add(list.credential, { id: randomUUID(), revision: 0, issuedAt: Date.now() }, selection);
  const keptFile = join(f.directory, 'preparations', `${kept.view.ownerId}.json`); const before = await readFile(keptFile, 'utf8');
  const events: unknown[] = []; const off = await f.lists.subscribe(list.credential, value => events.push(value)); t.after(off);
  const removed: string[] = []; await f.users.deleteUser(first.user.id, async ownerId => { removed.push(ownerId); });
  assert.deepEqual(removed, [list.view.ownerId]); assert.equal(events.at(-1), null);
  assert.deepEqual(f.users.directoryView().users.map(user => user.id), [second.user.id]);
  assert.equal(f.engine.view({ kind: 'host' }).current!.id, second.user.id);
  for (const token of [first.token, anotherDevice.token]) {
    assert.equal(f.users.current(token), undefined); await assert.rejects(f.users.ensureList(token, list.credential), status(401));
  }
  await assert.rejects(f.users.login(first.user.id, '0042'), status(401));
  await assert.rejects(f.lists.read(list.credential), status(401));
  await assert.rejects(readFile(join(f.directory, 'preparations', `${list.view.ownerId}.json`)), { code: 'ENOENT' });
  assert.equal(await readFile(keptFile, 'utf8'), before);
  const restarted = new UserManager(f.directory, f.lists, f.engine); await restarted.ready;
  await restarted.deleteUser(first.user.id, async () => assert.fail('An acknowledged retry must not run cleanup again'));
  await assert.rejects(restarted.register('Delete me', '0042', registration), status(401));
  assert.ok(!(await readFile(join(f.directory, 'users.json'), 'utf8')).includes('Delete me'));
  const replacement = await restarted.register('Delete me', '0042', randomUUID(), list.credential);
  const newList = await restarted.ensureList(replacement.token, list.credential);
  assert.notEqual(replacement.user.id, first.user.id); assert.notEqual(newList.view.ownerId, list.view.ownerId);
  assert.equal(newList.view.upcoming.length, 0); assert.equal(newList.view.played.length, 0); assert.equal(newList.view.removed.length, 0);
  assert.equal(restarted.current(first.token), undefined); await assert.rejects(f.lists.read(list.credential), status(401));
});

test('interrupted deletion stays revoked across restart, appears only to the host, and finishes on explicit retry', async t => {
  const f = await fixture(t); const token = await f.engine.join('Legacy listener');
  const old = await new PreparationIdentity(f.lists, f.directory).ensure(token, ''); await f.users.migrate();
  const user = f.users.current(token)!;
  await assert.rejects(f.users.deleteUser(user.id, async () => { throw new AppError(503, 'Disk temporarily unavailable'); }), status(503));
  assert.equal(f.users.current(token), undefined); assert.equal(f.users.directoryView().users.length, 0);
  assert.equal(f.users.directoryView('', true).users[0]!.deletionPending, true);
  assert.equal(f.engine.view({ kind: 'host' }).active!.length, 0);
  const restarted = new UserManager(f.directory, f.lists, f.engine); await restarted.ready;
  await assert.rejects(f.lists.read(old.credential), status(401));
  await restarted.deleteUser(user.id, async () => {});
  assert.equal(restarted.directoryView('', true).users.length, 0);
  assert.deepEqual(await readdir(join(f.directory, 'preparations', 'bindings')), []);
  assert.equal(restarted.ownerAvailable(old.view.ownerId), false);
});
