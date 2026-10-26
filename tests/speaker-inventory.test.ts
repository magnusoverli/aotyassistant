import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { IntegrationManager } from '../src/integrations.js';
import type { IntegrationState } from '../src/integration-store.js';
import { AppError } from '../src/model.js';

const living = { id: 'living', name: 'Living room', available: true };
const bedroom = { id: 'bedroom', name: 'Bedroom', available: true };
function gate() {
  let enter!: () => void; let release!: () => void;
  return { entered: new Promise<void>(resolve => { enter = resolve; }), pending: new Promise<void>(resolve => { release = resolve; }),
    enter: () => enter(), release: () => release() };
}
async function fixture(t: TestContext) {
  let saved: IntegrationState = { schema: 1, revision: 0, musicAssistant: null };
  const store = { async load() { return structuredClone(saved); }, async save(state: IntegrationState) { saved = structuredClone(state); } };
  let players = [living, bedroom]; let offline = false; let queueOffline = false; let held: ReturnType<typeof gate> | undefined; let reads = 0;
  const manager = new IntegrationManager(store, () => ({
    async inspect() {
      reads++; const waiting = held; held = undefined;
      if (waiting) { waiting.enter(); await waiting.pending; }
      if (offline) throw new AppError(502, 'Music Assistant unavailable');
      return { serverId: 'fixture', checkedAt: Date.now(), serverVersion: 'fixture', schemaVersion: 65, docsAvailable: false, players: [...players] };
    },
    async activeQueue() { if (queueOffline) throw new AppError(502, 'Queue unavailable'); return 'queue'; }, async search() { return []; },
  }));
  await manager.init(); t.after(() => manager.close());
  manager.attachPlayback({ ownsPlayback: false, issue: '', configurationChanged() {}, async recover() {} });
  await manager.save('http://fixture.local:8095', 'fixture-token', 0);
  return { manager, store, get reads() { return reads; }, players(value: typeof players) { players = value; },
    offline(value: boolean) { offline = value; }, queueOffline(value: boolean) { queueOffline = value; },
    hold() { return held = gate(); } };
}

test('loading and refreshing are explicit, checks coalesce, and normal refreshes keep verified playback ready', async t => {
  const f = await fixture(t); const { manager } = f;
  const first = f.hold(); t.after(first.release);
  const checking = manager.check(1); const duplicate = manager.check(1); await first.entered;
  assert.equal(manager.view().speakerInventory?.state, 'loading'); assert.equal(f.reads, 1);
  first.release(); const checked = await checking; await duplicate;
  assert.equal(checked.speakerInventory?.state, 'verified'); assert.deepEqual(checked.speakerInventory?.players, [living, bedroom]);
  await manager.selectDestination(living.id, manager.view().revision);
  const next = f.hold(); t.after(next.release);
  const refreshing = manager.check(manager.view().revision); await next.entered;
  assert.equal(manager.view().speakerInventory?.state, 'refreshing'); assert.equal(manager.playbackAvailable, true);
  assert.deepEqual(manager.view().speakerInventory?.players, [living, bedroom]);
  next.release(); assert.equal((await refreshing).speakerInventory?.state, 'verified');
});

test('expiry and failed reads retain only labelled last-known inventory, not ready status or legacy evidence', async t => {
  const f = await fixture(t); const { manager } = f;
  await manager.selectDestination(living.id, 1);
  const original = manager.view().speakerInventory!;
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() }); t.mock.timers.tick(45_001);
  assert.equal(manager.view().speakerInventory?.state, 'stale'); assert.equal(manager.view().report, null);
  assert.equal(manager.output.state, 'checking'); assert.deepEqual(manager.view().speakerInventory?.players, [living, bedroom]);
  f.offline(true); const failed = await manager.check(manager.view().revision);
  assert.equal(failed.speakerInventory?.state, 'failed'); assert.equal(failed.speakerInventory?.checkedAt, original.checkedAt);
  assert.equal(failed.speakerInventory?.expiresAt, original.expiresAt); assert.equal(failed.report, null); assert.equal(failed.playbackAvailable, false);
  assert.deepEqual(failed.speakerInventory?.players, [living, bedroom]);
  f.offline(false); f.players([bedroom]); const fresh = await manager.check(manager.view().revision);
  assert.equal(fresh.speakerInventory?.state, 'verified'); assert.deepEqual(fresh.speakerInventory?.players, [bedroom]);
  assert.equal(fresh.output.state, 'unavailable'); assert.equal(fresh.destination?.id, living.id);
  await assert.rejects(manager.selectDestination(living.id, manager.view().revision));
});

test('queue readiness and inventory availability are separate and discovered inventory is never persisted', async t => {
  const f = await fixture(t); const { manager } = f;
  await manager.selectDestination(living.id, 1); f.queueOffline(true);
  const next = await manager.check(manager.view().revision);
  assert.equal(next.speakerInventory?.state, 'verified'); assert.equal(next.output.state, 'unavailable');
  assert.deepEqual(next.speakerInventory?.players, [living, bedroom]);
  const restarted = new IntegrationManager(f.store); await restarted.init(); t.after(() => restarted.close());
  assert.deepEqual(restarted.view().destination, next.destination); assert.deepEqual(restarted.view().speakerInventory?.players, []);
  assert.equal(restarted.view().report, null); assert.equal(restarted.view().speakerInventory?.checkedAt, null);
  assert.ok(!JSON.stringify(await f.store.load()).includes('speakerInventory'));
});

test('credential changes discard old inventory and an older in-flight inspection cannot bring it back', async t => {
  const f = await fixture(t); const { manager } = f;
  await manager.selectDestination(living.id, 1);
  const held = f.hold(); t.after(held.release);
  const old = manager.check(manager.view().revision); await held.entered;
  await manager.save('http://fixture.local:8095', 'new-token', manager.view().revision);
  assert.equal(manager.view().speakerInventory?.state, 'loading'); assert.deepEqual(manager.view().speakerInventory?.players, []);
  const rejected = assert.rejects(old); held.release(); await rejected;
  assert.deepEqual(manager.view().speakerInventory?.players, []);
  f.players([bedroom]); const checked = await manager.check(manager.view().revision);
  assert.equal(checked.speakerInventory?.state, 'verified'); assert.deepEqual(checked.speakerInventory?.players, [bedroom]);
});
