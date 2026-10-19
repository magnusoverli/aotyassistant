import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Engine } from '../src/engine.js';
import { FileStore } from '../src/store.js';
import { DemoAdapter } from '../src/playback.js';
import { AppError } from '../src/model.js';

async function fixture() {
  const directory = await mkdtemp('/tmp/opencode/aoty-persistent-room-'); const store = new FileStore(directory);
  const adapter = new DemoAdapter(3600); const engine = new Engine(store, adapter, 'http://app.local:3000'); await engine.init();
  return { directory, store, adapter, engine, host: () => engine.view({ kind: 'host' }),
    participant: (credential: string) => engine.view({ kind: 'participant', credential }) };
}

test('the room exists on boot with permanent public links and no lifecycle fields or actions', async t => {
  const f = await fixture(); t.after(() => f.adapter.close()); const room = f.host();
  assert.ok(room.roomId); assert.equal(room.current, null); assert.deepEqual(room.active, []);
  assert.equal(room.joinUrl, 'http://app.local:3000/join'); assert.equal(room.displayUrl, 'http://app.local:3000/display');
  assert.equal(f.engine.view({ kind: 'display' }).joinUrl, room.joinUrl);
  for (const name of ['create', 'start', 'end', 'admit', 'invitation']) assert.equal(name in f.engine, false);
  for (const name of ['sessionId', 'phase', 'waiting', 'invitation', 'invitationExpires', 'displayCredential']) {
    assert.equal(name in room, false); assert.equal(name in (await f.store.load()).room!, false);
  }
  await assert.rejects(f.engine.advance(room.turnId!), error => error instanceof AppError && error.status === 409);
});

test('direct joins select the first listener once, preserve order and rejoin without duplicates', async t => {
  const f = await fixture(); t.after(() => f.adapter.close());
  const credentials = await Promise.all(Array.from({ length: 20 }, (_, n) => f.engine.join(`Listener ${n}`)));
  assert.deepEqual(f.host().active!.map(person => person.nickname), Array.from({ length: 20 }, (_, n) => `Listener ${n}`));
  assert.equal(f.host().current!.id, f.participant(credentials[0]!).me!.id); const turn = f.host().turnId;
  for (const credential of credentials) assert.equal(await f.engine.join('Ignored new nickname', credential), credential);
  assert.equal(f.host().active!.length, 20); assert.equal(f.host().turnId, turn);
  assert.equal(f.participant(credentials[0]!).ownPlayback, null);
});

test('a late join leaves a revealed pause and current turn untouched', async t => {
  const f = await fixture(); t.after(() => f.adapter.close()); const first = await f.engine.join('First');
  await f.engine.play(first, f.host().turnId!, null, 'demo:aurora'); const id = f.participant(first).ownPlayback!.id;
  await f.engine.reveal(first, f.host().turnId!, id); await f.engine.control(first, f.host().turnId!, id, 'pause');
  const before = f.participant(first); const late = await f.engine.join('Late'); const after = f.participant(first);
  assert.equal(after.turnId, before.turnId); assert.deepEqual(after.ownPlayback, before.ownPlayback);
  assert.equal(after.ownPlayback!.status, 'paused'); assert.equal(f.participant(late).myTurn, false);
  assert.equal(JSON.stringify(f.participant(late)).includes('Northern Lights'), false);
});

test('the room persists through restarts and emptying/rejoining without any session creation', async t => {
  const f = await fixture(); t.after(() => f.adapter.close()); const first = await f.engine.join('First');
  const before = f.host(); const adapter = new DemoAdapter(); t.after(() => adapter.close());
  const recovered = new Engine(f.store, adapter, 'http://app.local:3000'); await recovered.init();
  const host = () => recovered.view({ kind: 'host' });
  assert.equal(host().roomId, before.roomId); assert.equal(host().displayUrl, before.displayUrl); assert.equal(host().joinUrl, before.joinUrl);
  assert.equal(recovered.view({ kind: 'participant', credential: first }).me!.nickname, 'First');
  await recovered.remove(host().current!.id, host().revision); assert.equal(host().current, null);
  assert.doesNotThrow(() => recovered.view({ kind: 'display' }));
  const next = await recovered.join('Next'); assert.equal(recovered.view({ kind: 'participant', credential: next }).myTurn, true);
  assert.equal(host().roomId, before.roomId);
});

test('room capacity and invalid names are enforced without losing existing participants', async t => {
  const f = await fixture(); t.after(() => f.adapter.close());
  for (const nickname of ['', ' ', 'x'.repeat(41), 'bad\x00name']) await assert.rejects(f.engine.join(nickname), error => error instanceof AppError && error.status === 400);
  await Promise.all(Array.from({ length: 100 }, (_, n) => f.engine.join(`Listener ${n}`)));
  const before = f.host(); await assert.rejects(f.engine.join('One too many'), error => error instanceof AppError && error.status === 409);
  assert.deepEqual(f.host(), before);
});

test('legacy room records stop startup without overwriting room or private data', async t => {
  const f = await fixture(); t.after(() => f.adapter.close());
  const other = join(f.directory, 'private-data-fixture'); await writeFile(other, 'saved-music-settings-fixture');
  for (const schema of [1, 2]) {
    const bytes = JSON.stringify({ schema, session: { id: randomUUID(), participants: ['retained'] } });
    await writeFile(join(f.directory, 'state.json'), bytes);
    const adapter = new DemoAdapter(); t.after(() => adapter.close()); const engine = new Engine(f.store, adapter, 'http://app.local:3000');
    await assert.rejects(engine.init(), /Persistent state could not be loaded/);
    assert.equal(await readFile(join(f.directory, 'state.json'), 'utf8'), bytes);
    assert.equal(await readFile(other, 'utf8'), 'saved-music-settings-fixture');
  }
});

test('invalid current room records and unsupported versions are not silently reset', async t => {
  const f = await fixture(); t.after(() => f.adapter.close()); await f.engine.join('First'); const saved = await f.store.load();
  for (const invalid of [{ ...saved, schema: 4 }, { ...saved, room: { ...saved.room!, currentId: randomUUID() } }, { ...saved, room: { ...saved.room!, active: [] } }]) {
    const bytes = JSON.stringify(invalid); await writeFile(join(f.directory, 'state.json'), bytes); await assert.rejects(f.store.load());
    assert.equal(await readFile(join(f.directory, 'state.json'), 'utf8'), bytes);
  }
});
