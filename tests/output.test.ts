import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { IntegrationFileStore, IntegrationManager } from '../src/integrations.js';
import { ManagedPlayback } from '../src/live-playback.js';
import { DemoAdapter } from '../src/playback.js';
import { startMusicAssistantFixture } from './fixtures/music-assistant.js';

const room = { player_id: 'sonos:room', name: 'Living room', available: true };
const bedroom = { player_id: 'sonos:bedroom', name: 'Bedroom', available: true };
async function eventually(check: () => boolean) {
  for (let i = 0; i < 250; i++) { if (check()) return; await delay(20); }
  assert.ok(check(), 'Expected live output update');
}
async function fixture() {
  const remote = await startMusicAssistantFixture();
  const manager = new IntegrationManager(new IntegrationFileStore(await mkdtemp('/tmp/opencode/aoty-output-'))); await manager.init();
  const adapter = new ManagedPlayback(new DemoAdapter(), manager, 60_000);
  await manager.save(remote.origin, 'fixture-token', 0);
  return { remote, manager, adapter, close() { adapter.close(); remote.close(); } };
}

test('one shared event connection discovers speakers without a selection, coalesces hints, and keeps readiness live', async t => {
  const f = await fixture(); t.after(f.close); const { manager, remote } = f;
  remote.setSpeakers([]); manager.startMonitoring(60_000);
  await eventually(() => manager.view().report?.players.length === 0 && remote.eventClients === 1);
  assert.equal(manager.output.state, 'none'); const revision = manager.view().revision;
  const before = remote.calls.filter(c => c.command === 'players/all').length;
  remote.setSpeakers([room]);
  for (let i = 0; i < 20; i++) remote.notify('player_added', room.player_id, room);
  await eventually(() => manager.view().report?.players.length === 1);
  assert.equal(remote.calls.filter(c => c.command === 'players/all').length, before + 1);
  assert.equal(manager.view().revision, revision); assert.equal(manager.output.state, 'none');
  await manager.selectDestination(room.player_id, revision);
  await f.adapter.refresh(); assert.equal(remote.eventClients, 1); assert.equal(manager.playbackAvailable, true);
  remote.setSpeakers([bedroom]);
  await eventually(() => manager.output.state === 'unavailable');
  assert.equal(manager.playbackAvailable, false); assert.equal(manager.routeConfigured, true);
  assert.equal(manager.view().destination?.id, room.player_id);
  remote.setSpeakers([{ ...room, name: 'Renamed living room' }, bedroom]);
  await eventually(() => manager.output.state === 'ready' && manager.output.name === 'Renamed living room');
  const scans = remote.calls.filter(c => c.command === 'players/all').length;
  for (let i = 0; i < 10; i++) { remote.notify(); remote.notify('player_updated', room.player_id, { available: true, name: 'Renamed living room', volume_level: i }); }
  await delay(350);
  assert.equal(remote.calls.filter(c => c.command === 'players/all').length, scans);
  assert.equal(manager.view().revision, revision + 1);
  assert.equal(remote.calls.some(c => /play_media|\/cmd\/|\/stop$|\/pause$|\/resume$/.test(c.command)), false);
});

test('read-only polling recovers missing hints, authorization failures, and a lost event connection', async t => {
  const f = await fixture(); t.after(f.close); const { manager, remote } = f;
  await manager.selectDestination(room.player_id, manager.view().revision); manager.startMonitoring(500);
  await eventually(() => remote.eventClients === 1);
  remote.setSpeakers([{ ...room, available: false }], false);
  await eventually(() => manager.output.state === 'unavailable');
  remote.fail(true);
  await eventually(() => manager.output.state === 'unconfirmed');
  assert.equal(manager.playbackAvailable, false);
  remote.disconnectEvents(); remote.fail(false); remote.setSpeakers([room], false);
  await eventually(() => manager.output.state === 'ready');
  await eventually(() => remote.eventClients === 1);
  assert.equal(manager.view().destination?.id, room.player_id);
  assert.equal(remote.calls.some(c => /play_media|\/cmd\//.test(c.command)), false);
});

test('an event arriving during a slow check gets a fresh follow-up observation', async t => {
  const f = await fixture(); t.after(f.close); const { manager, remote } = f;
  await manager.selectDestination(room.player_id, manager.view().revision); await f.adapter.refresh();
  manager.startMonitoring(60_000);
  await eventually(() => remote.eventClients === 1); await delay(350);
  const gate = remote.holdNextQueueRead(); t.after(() => gate.release());
  manager.refreshOutputSoon(); await gate.entered;
  remote.setSpeakers([]); await delay(20); gate.release();
  await eventually(() => manager.output.state === 'unavailable');
  assert.equal(manager.view().destination?.id, room.player_id);
});

test('stale observations cannot reverse a confirmed switch and remembered readiness expires', async t => {
  const f = await fixture(); t.after(f.close); const { manager, remote } = f;
  await manager.selectDestination(room.player_id, manager.view().revision); await f.adapter.refresh();
  const gate = remote.holdNextQueueRead(); t.after(() => gate.release());
  const checking = manager.check(manager.view().revision); await gate.entered;
  const selected = await manager.selectDestination(bedroom.player_id, manager.view().revision);
  gate.release(true); await assert.rejects(checking);
  assert.equal(manager.output.state, 'ready'); assert.equal(manager.output.name, bedroom.name);
  assert.equal(manager.view().revision, selected.revision);
  const now = Date.now; Date.now = () => now() + 46_000;
  try { assert.equal(manager.output.state, 'checking'); assert.equal(manager.playbackAvailable, false); assert.equal(manager.routeConfigured, true); }
  finally { Date.now = now; }
});

test('speaker disappearance keeps owned playback guarded and recovery never resumes audio', async t => {
  const f = await fixture(); t.after(f.close); const { manager, remote, adapter } = f;
  await manager.selectDestination(room.player_id, manager.view().revision);
  const [track] = await manager.search('fixture', 'member');
  await adapter.play(await adapter.resolve(track!.id, 'member'), 'owned-track');
  remote.setSpeakers([bedroom]); await manager.check(manager.view().revision);
  assert.equal(manager.output.state, 'unavailable'); assert.equal(adapter.ownsPlayback, true);
  await assert.rejects(manager.selectDestination(bedroom.player_id, manager.view().revision));
  await adapter.control('stop'); assert.equal(adapter.ownsPlayback, false); assert.equal(remote.queue.state, 'idle');
  remote.setSpeakers([room]); await manager.check(manager.view().revision);
  remote.failNextPlaybackVerification();
  await assert.rejects(adapter.play(await adapter.resolve(track!.id, 'member'), 'uncertain-track'));
  assert.equal(manager.output.state, 'recovery'); assert.equal(adapter.ownsPlayback, true);
  remote.fail(false); await manager.check(manager.view().revision);
  assert.equal(manager.output.state, 'recovery'); assert.equal(manager.playbackAvailable, false);
  const plays = remote.calls.filter(c => c.command === 'player_queues/play_media').length;
  await manager.recoverPlayback(manager.view().revision);
  assert.equal(manager.output.state, 'ready'); assert.equal(adapter.ownsPlayback, false);
  assert.equal(remote.calls.filter(c => c.command === 'player_queues/play_media').length, plays);
});
