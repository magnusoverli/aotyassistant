import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { Engine } from '../src/engine.js';
import { FileStore } from '../src/store.js';
import { DemoAdapter } from '../src/playback.js';
import { PreparationFileStore, PreparationManager, type SavedSelection } from '../src/preparations.js';
import { ProgressClock } from '../web/progress-clock.js';

function gate() {
  let release!: () => void; let enter!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const entered = new Promise<void>(resolve => { enter = resolve; });
  return { pending, entered, release, enter };
}

test('progress interpolates between samples, eases small corrections, bounds stale extrapolation and never advances a turn', () => {
  let now = 0; const clock = new ProgressClock(() => now);
  const sample = { id: 'one', status: 'playing' as const, elapsed: 10, duration: 100, fraction: .1 };
  clock.accept(sample); now = 2400;
  assert.equal(clock.position()!.elapsed, 12.4);
  clock.accept({ ...sample, elapsed: 12.2, fraction: .122 });
  assert.equal(clock.position()!.elapsed, 12.4);
  now = 3400; assert.equal(clock.position()!.elapsed, 13.2);
  now = 90_000; assert.equal(clock.position()!.elapsed, 17.2);
  clock.accept({ ...sample, elapsed: 99.8, fraction: .998 }); now += 1000;
  assert.equal(clock.position()!.elapsed, 100); assert.equal(clock.position()!.status, 'playing');
});

test('progress freezes immediately on pending pause/offline, retains the anchor on rerender, and resets on a new identity or seek', () => {
  let now = 0; const clock = new ProgressClock(() => now);
  const sample = { id: 'one', status: 'playing' as const, elapsed: 10, duration: 100, fraction: .1 };
  clock.accept(sample); now = 2000;
  const paused = { ...sample, status: 'paused' as const };
  clock.accept(paused); now = 10_000; clock.accept(paused);
  assert.equal(clock.position()!.elapsed, 12);
  clock.accept({ ...sample, elapsed: 12, fraction: .12 }); now += 1000;
  clock.connect(false); const frozen = clock.position()!.elapsed; now += 20_000;
  assert.equal(clock.position()!.elapsed, frozen);
  clock.connect(true); clock.accept({ ...sample, elapsed: 25, fraction: .25 });
  assert.equal(clock.position()!.elapsed, 25);
  clock.accept({ ...sample, id: 'two', elapsed: 0, fraction: 0 }); assert.equal(clock.position()!.elapsed, 0);
  clock.accept({ id: 'concealed', status: 'playing', fraction: .3 }); now += 1000;
  assert.deepEqual(clock.position(), { id: 'concealed', status: 'playing', fraction: .3 });
  clock.accept({ ...sample, id: 'pending-1', elapsed: 0, fraction: 0 }); now += 1000;
  assert.equal(clock.position()!.elapsed, 0);
});

test('slow Play, Pause and Finish do not occupy the room lane or overwrite concurrent joins/order', async t => {
  const dir = await mkdtemp('/tmp/opencode/aoty-room-lanes-'); const demo = new DemoAdapter(3600); t.after(() => demo.close());
  const engine = new Engine(new FileStore(dir), demo, 'http://localhost:3000'); await engine.init();
  const credential = await engine.join('Current'); await engine.join('Waiting');
  const host = () => engine.view({ kind: 'host' }); const turn = host().turnId!;
  const original = demo.play.bind(demo); const playing = gate(); t.after(playing.release);
  demo.play = async (track, id) => { playing.enter(); await playing.pending; await original(track, id); };
  const play = engine.play(credential, turn, null, 'demo:aurora'); await playing.entered;
  const joined = engine.join('Late');
  assert.equal(await Promise.race([joined.then(() => 'joined'), delay(1000, 'blocked')]), 'joined');
  const ids = host().active!.map(person => person.id).reverse(); await engine.reorder(ids, host().revision);
  playing.release(); await play;
  assert.deepEqual(host().active!.map(person => person.id), ids);
  const id = engine.view({ kind: 'participant', credential }).ownPlayback!.id;
  const control = demo.control.bind(demo);
  for (const action of ['pause', 'stop'] as const) {
    const held = gate(); t.after(held.release);
    demo.control = async command => { held.enter(); await held.pending; await control(command); };
    const mutation = action === 'pause' ? engine.control(credential, turn, id, action) : engine.advance(turn);
    await held.entered;
    assert.equal(await Promise.race([engine.join(`During ${action}`).then(() => 'joined'), delay(1000, 'blocked')]), 'joined');
    held.release(); await mutation;
  }
  assert.equal(host().active!.length, 5); assert.notEqual(host().turnId, turn);
});

test('private snapshots reuse validated immutable state but detect external replacement/corruption and never share mutable loads', async () => {
  const dir = await mkdtemp('/tmp/opencode/aoty-list-cache-'); const store = new PreparationFileStore(dir); const manager = new PreparationManager(store);
  const owner = await manager.createOwner(); const first = await store.snapshot(owner.view.ownerId);
  assert.equal(await store.snapshot(owner.view.ownerId), first);
  assert.ok(Object.isFrozen(first)); assert.ok(Object.isFrozen(first!.entries));
  const mutable = await store.load(owner.view.ownerId); mutable!.revision = 123;
  assert.equal((await manager.read(owner.credential)).revision, 0);
  await manager.issueRecoveryKey(owner.credential, 0);
  assert.notEqual(await store.snapshot(owner.view.ownerId), first);
  await writeFile(`${dir}/preparations/${owner.view.ownerId}.json`, 'broken');
  await assert.rejects(manager.read(owner.credential), /could not be read/);
});

test('private reads remain available during a reserved saved Play, but review, edits and duplicate Play cannot release it', async t => {
  const dir = await mkdtemp('/tmp/opencode/aoty-list-reservation-'); const manager = new PreparationManager(new PreparationFileStore(dir));
  const owner = await manager.createOwner();
  const selected: SavedSelection = { source: 'demo', trackId: 'demo:aurora', metadata: { title: 'Private', artist: '', album: '', version: '', provider: 'Demo', duration: 60 } };
  const operation = (revision: number) => ({ id: randomUUID(), issuedAt: Date.now(), revision });
  const added = await manager.add(owner.credential, operation(0), selected);
  const held = gate(); t.after(held.release); let starts = 0;
  const pending = manager.playHead(owner.credential, added.entryId, added.view.revision, async () => {
    starts++; held.enter(); await held.pending; return { playbackId: randomUUID(), value: 'confirmed' };
  });
  await held.entered;
  const view = await manager.read(owner.credential); assert.equal(view.reviewEntryId, added.entryId);
  assert.deepEqual(await manager.selection(owner.credential, added.entryId), selected);
  await assert.rejects(manager.acknowledgeReview(owner.credential, operation(view.revision), added.entryId), /still starting/);
  await assert.rejects(manager.remove(owner.credential, operation(view.revision), added.entryId), /needs review/);
  await assert.rejects(manager.playHead(owner.credential, added.entryId, view.revision, async () => { throw new Error('Must not start'); }), /Review/);
  held.release(); assert.equal((await pending).preparation!.played[0]!.id, added.entryId); assert.equal(starts, 1);
});

test('private revocation during a saved start cannot disclose a cached list or consume its retained review marker', async t => {
  const dir = await mkdtemp('/tmp/opencode/aoty-list-revoked-start-'); const manager = new PreparationManager(new PreparationFileStore(dir));
  const owner = await manager.createOwner(); const key = await manager.issueRecoveryKey(owner.credential, 0);
  const selected: SavedSelection = { source: 'demo', trackId: 'demo:aurora', metadata: { title: 'Private', artist: '', album: '', version: '', provider: 'Demo', duration: 60 } };
  const added = await manager.add(owner.credential, { id: randomUUID(), issuedAt: Date.now(), revision: key.view.revision }, selected);
  const held = gate(); t.after(held.release);
  const playing = manager.playHead(owner.credential, added.entryId, added.view.revision, async () => {
    held.enter(); await held.pending; return { playbackId: randomUUID(), value: 'audio confirmed' };
  });
  await held.entered;
  const recovered = await manager.recover(key.recoveryKey); await manager.revokeOtherDevices(recovered.credential, recovered.view.revision);
  await assert.rejects(manager.selection(owner.credential, added.entryId), /access is unavailable/);
  held.release(); const result = await playing;
  assert.equal(result.value, 'audio confirmed'); assert.equal(result.preparation, undefined); assert.ok(result.warning);
  assert.equal((await manager.read(recovered.credential)).reviewEntryId, added.entryId);
});
