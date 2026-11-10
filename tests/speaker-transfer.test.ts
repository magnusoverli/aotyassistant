import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { once } from 'node:events';
import { createServer } from 'node:http';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { Engine } from '../src/engine.js';
import { IntegrationManager } from '../src/integrations.js';
import type { IntegrationState, IntegrationStore } from '../src/integration-store.js';
import { ManagedPlayback } from '../src/live-playback.js';
import { DemoAdapter } from '../src/playback.js';
import { PersistenceError, type Store } from '../src/store.js';
import { AppError, type State } from '../src/model.js';
import { operation } from '../src/operation.js';
import { supportsQueueTransfer } from '../src/music-assistant-policy.js';
import { mountIntegrations } from '../src/integration-http.js';
import { startMusicAssistantFixture } from './fixtures/music-assistant.js';
import type { UploadAssets, UploadSelection } from '../src/uploads.js';
import type { MusicAssistantApi } from '../src/music-assistant.js';

async function fixture(t: TestContext) {
  const remote = await startMusicAssistantFixture(); const target = remote.enableTransfers();
  let integrationState: IntegrationState = { schema: 1, revision: 0, musicAssistant: null };
  const integrationStore: IntegrationStore = { async load() { return structuredClone(integrationState); }, async save(next) { integrationState = structuredClone(next); } };
  let roomState: State = { schema: 3, room: null };
  const store: Store = { async load() { return structuredClone(roomState); }, async save(next) { roomState = structuredClone(next); } };
  const manager = new IntegrationManager(integrationStore); await manager.init();
  await manager.save(remote.origin, 'fixture-token', 0); await manager.selectDestination('sonos:room', manager.view().revision);
  const adapter = new ManagedPlayback(new DemoAdapter(), manager, 60_000);
  const engine = new Engine(store, adapter, 'http://localhost:3000', manager); await engine.init(); await adapter.refresh();
  t.after(async () => {
    engine.beginShutdown(); adapter.beginShutdown(); await engine.drain(); adapter.close(); manager.close(); await manager.drain(); remote.close();
  });
  const alex = await engine.join('Alex'); await engine.join('Sam');
  const host = () => engine.view({ kind: 'host' });
  const participant = () => engine.view({ kind: 'participant', credential: alex });
  const track = (await engine.search(alex, host().turnId!, 'fixture')).tracks[0]!;
  await engine.play(alex, host().turnId!, null, track.id);
  remote.queue.elapsed_time = 70; remote.queue.elapsed_time_last_updated = Date.now() / 1000;
  const move = (id = 'sonos:bedroom', playbackId = participant().ownPlayback!.id, revision = manager.view().revision) =>
    manager.selectDestination(id, revision, playbackId, work => engine.changeSpeaker(playbackId, work));
  const poll = () => (adapter as unknown as { poll(): Promise<void> }).poll();
  const writes = () => remote.calls.filter(c => /^(player_queues\/(transfer|play_media|stop|pause|resume|autoplay|repeat|shuffle|clear)|players\/cmd\/)/.test(c.command));
  return { remote, target, manager, adapter, engine, alex, host, participant, move, poll, writes, integrationStore };
}

test('handoff policy requires the fixed stable MA release and a supported playback schema', () => {
  for (const version of ['2.10.8', '2.10.9', '2.10.10', '2.11.0', '3.0.0']) assert.equal(supportsQueueTransfer(65, version), true, version);
  for (const version of ['2.10.6', '2.10.7', '2.9.99', '1.99.99', '2.10.9b1', '2.fixture', 'unknown']) assert.equal(supportsQueueTransfer(65, version), false, version);
  assert.equal(supportsQueueTransfer(66, '2.10.9'), false);
});

test('native handoff preserves the song, position, turn, reveal and selection lease with one audio write', async t => {
  const f = await fixture(t); const id = f.participant().ownPlayback!.id; const turn = f.host().turnId;
  const catalogue = f.manager.catalogueRevision; const binding = f.manager.sourceBindingId;
  await f.engine.reveal(f.alex, turn!, id);
  let released = 0;
  const own = (f.adapter as unknown as { own: { release?: () => void } }).own;
  own.release = () => { released++; };
  const queueItemId = f.remote.queue.current_item!.queue_item_id;
  const staleVolume = f.adapter.volume.revision;
  f.remote.calls.length = 0;
  const result = await f.move();
  assert.equal(result.destination?.id, 'sonos:bedroom'); assert.equal(result.settingsChangesBlocked, true); assert.equal(result.speakerChangesBlocked, false);
  assert.deepEqual(f.writes().map(c => [c.command, c.args]), [['player_queues/transfer', { source_queue_id: 'fixture-queue', target_queue_id: 'sonos:bedroom', auto_play: true }]]);
  assert.equal(f.remote.queue.items, 0); assert.equal(f.remote.queue.state, 'idle');
  assert.equal(f.target.queue.current_item!.queue_item_id, queueItemId); assert.equal(f.target.queue.state, 'playing');
  assert.ok(f.target.queue.elapsed_time >= 69 && f.target.queue.elapsed_time < 73);
  assert.equal(f.participant().ownPlayback!.id, id); assert.equal(f.host().turnId, turn);
  assert.equal(f.engine.view({ kind: 'display' }).nowPlaying?.revealed, true);
  assert.equal(f.manager.catalogueRevision, catalogue); assert.equal(f.manager.sourceBindingId, binding); assert.equal(released, 0);
  assert.equal((await f.integrationStore.load()).musicAssistant?.destination?.id, 'sonos:bedroom');
  assert.notEqual(f.adapter.volume.revision, staleVolume);
  await f.adapter.refresh(); assert.equal(f.adapter.volume.level, 55); assert.equal(f.target.player.volume_level, 55);
  await f.engine.control(f.alex, turn!, id, 'pause'); assert.equal(f.target.queue.state, 'paused');
  await f.engine.stopForHost(turn!, id); assert.equal(f.target.queue.state, 'idle'); assert.equal(released, 1);
});

test('selecting the current speaker only refreshes its verification without saving or transferring', async t => {
  const f = await fixture(t); const revision = f.manager.view().revision; f.remote.calls.length = 0;
  const view = await f.move('sonos:room');
  assert.equal(view.revision, revision); assert.equal(view.destinationStatus, 'checked'); assert.equal(f.writes().length, 0);
  assert.equal(f.remote.queue.state, 'playing');
});

for (const parked of [false, true]) test(`a paused handoff retains its resume position without starting audio (parked=${parked})`, async t => {
  const f = await fixture(t); const id = f.participant().ownPlayback!.id; const turn = f.host().turnId!;
  await f.engine.control(f.alex, turn, id, 'pause');
  if (parked) f.remote.parkPaused();
  f.remote.calls.length = 0; await f.move();
  assert.deepEqual(f.writes().map(c => c.command), ['player_queues/transfer']);
  assert.equal(f.writes()[0]!.args.auto_play, false); assert.equal(f.target.queue.state, 'idle');
  assert.equal(f.participant().ownPlayback!.status, 'paused');
  assert.ok(f.adapter.progress(id)!.elapsed >= 69); await f.poll(); assert.equal(f.adapter.requiresRecovery, false);
  await f.engine.control(f.alex, turn, id, 'resume'); assert.equal(f.target.queue.state, 'playing'); assert.ok(f.target.queue.elapsed_time >= 69);
});

test('paused handoff refuses a busy target without changing either speaker', async t => {
  const f = await fixture(t); const id = f.participant().ownPlayback!.id;
  await f.engine.control(f.alex, f.host().turnId!, id, 'pause');
  f.target.player.playback_state = 'playing'; f.target.queue.state = 'playing';
  f.remote.calls.length = 0;
  await assert.rejects(f.move(), /idle, ungrouped speaker/);
  assert.equal(f.writes().length, 0); assert.equal(f.remote.queue.state, 'paused'); assert.equal(f.target.queue.state, 'playing');
  assert.equal(f.adapter.requiresRecovery, false);
});

test('a sync member target uses its own queue ID, not the active source queue', async t => {
  const f = await fixture(t);
  f.target.player.synced_to = 'sonos:room';
  f.remote.calls.length = 0; await f.move();
  assert.deepEqual(f.writes().map(c => c.args.target_queue_id), ['sonos:bedroom']);
  assert.equal(f.target.player.synced_to, null); assert.equal(f.target.queue.state, 'playing');
  assert.equal(f.adapter.requiresRecovery, false);
});

test('handoff can target a whole group and subsequent controls stay on that group', async t => {
  const f = await fixture(t); const group = f.remote.addTransferSpeaker('sync:group', 'Whole house', 'group');
  const id = f.participant().ownPlayback!.id; await f.move('sync:group');
  assert.equal(group.queue.state, 'playing'); assert.equal(f.manager.view().destination?.id, 'sync:group');
  await f.engine.stopForHost(f.host().turnId!, id); assert.equal(group.queue.state, 'idle');
});

test('the same song can move again, using the currently owned source rather than the original speaker', async t => {
  const f = await fixture(t); const next = f.remote.addTransferSpeaker('sonos:next', 'Next room');
  const id = f.participant().ownPlayback!.id; await f.move(); f.remote.calls.length = 0;
  await f.move('sonos:next');
  assert.deepEqual(f.writes().map(c => c.args), [{ source_queue_id: 'sonos:bedroom', target_queue_id: 'sonos:next', auto_play: true }]);
  assert.equal(f.target.player.playback_state, 'idle'); assert.equal(f.target.queue.items, 0);
  assert.equal(next.queue.state, 'playing'); assert.equal(f.participant().ownPlayback!.id, id);
});

for (const version of ['2.10.6', '2.10.7', '2.fixture']) test(`handoff does not mutate an unqualified MA release (${version})`, async t => {
  const f = await fixture(t); f.remote.info.server_version = version; await f.manager.check(f.manager.view().revision);
  assert.equal(f.manager.view().speakerChangesBlocked, true); f.remote.calls.length = 0;
  await assert.rejects(f.move(), /2.10.8 or later/);
  assert.equal(f.writes().length, 0); assert.equal(f.remote.queue.state, 'playing'); assert.equal(f.adapter.requiresRecovery, false);
});

test('handoff rejects a newly unsupported schema without changing existing playback', async t => {
  const f = await fixture(t); f.remote.info.schema_version = 66; f.remote.calls.length = 0;
  await assert.rejects(f.move(), /supported playback API/);
  assert.equal(f.writes().length, 0); assert.equal(f.remote.queue.state, 'playing');
});

for (const failure of ['player-unavailable', 'queue-unavailable', 'non-audio', 'unknown-state']) test(`target preflight leaves the source intact (${failure})`, async t => {
  const f = await fixture(t);
  if (failure === 'player-unavailable') f.target.player.available = false;
  if (failure === 'queue-unavailable') f.target.queue.available = false;
  if (failure === 'non-audio') f.target.player.type = 'visualizer';
  if (failure === 'unknown-state') f.target.player.playback_state = 'unknown';
  f.remote.calls.length = 0; await assert.rejects(f.move());
  assert.equal(f.writes().length, 0); assert.equal(f.remote.queue.state, 'playing');
  assert.equal(f.manager.view().destination?.id, 'sonos:room'); assert.equal(f.adapter.requiresRecovery, false);
});

test('a lost transfer acknowledgement is reconciled without repeating the command', async t => {
  const f = await fixture(t); f.remote.loseAcknowledgement('player_queues/transfer'); f.remote.calls.length = 0;
  await f.move(); assert.equal(f.writes().length, 1); assert.equal(f.target.queue.state, 'playing'); assert.equal(f.adapter.requiresRecovery, false);
});

for (const outcome of ['not-applied', 'source-cleared', 'wrong-position', 'wrong-policy', 'wrong-source'] as const) test(`uncertain transfer keeps the turn and recovers only verified owned audio (${outcome})`, async t => {
  const f = await fixture(t); const turn = f.host().turnId; const id = f.participant().ownPlayback!.id;
  if (outcome === 'not-applied') f.remote.loseAcknowledgement('player_queues/transfer', false);
  else f.remote.transferOutcome(outcome);
  f.remote.calls.length = 0;
  await assert.rejects(operation('test-transfer', () => f.move(), 350), /Moving playback could not be confirmed/);
  assert.equal(f.writes().filter(c => c.command === 'player_queues/transfer').length, 1);
  assert.equal(f.writes().length, 1); assert.equal(f.adapter.problem?.code, 'transfer-unconfirmed');
  assert.equal(f.manager.view().speakerChangesBlocked, true); assert.equal(f.host().turnId, turn);
  assert.equal(f.manager.view().destination?.id, 'sonos:room');
  await f.manager.recoverPlayback(f.manager.view().revision);
  assert.equal(f.adapter.requiresRecovery, false); assert.equal(f.host().turnId, turn);
  assert.equal(f.remote.queue.state, 'idle');
  assert.equal(f.target.queue.state, outcome === 'wrong-source' ? 'playing' : 'idle');
  const stops = f.writes().filter(c => c.command === 'player_queues/stop');
  assert.deepEqual(stops.map(c => c.args.queue_id), outcome === 'not-applied' ? ['fixture-queue'] : ['wrong-position', 'wrong-policy'].includes(outcome) ? ['sonos:bedroom'] : []);
  assert.equal(f.participant().ownPlayback, null); await f.engine.complete(id); assert.equal(f.host().turnId, turn);
});

test('transfer recovery keeps its guard when either direct queue cannot be checked', async t => {
  const f = await fixture(t); f.remote.transferOutcome('wrong-position');
  await assert.rejects(operation('test-transfer', () => f.move(), 350));
  f.remote.failReads('player_queues/get', 3); f.remote.calls.length = 0;
  await assert.rejects(f.manager.recoverPlayback(f.manager.view().revision), /recovery could not confirm/);
  assert.equal(f.adapter.requiresRecovery, true); assert.equal(f.writes().length, 0);
  await f.manager.recoverPlayback(f.manager.view().revision);
  assert.equal(f.adapter.requiresRecovery, false); assert.equal(f.target.queue.state, 'idle');
});

test('recovery never stops a target that was replaced after an uncertain handoff', async t => {
  const f = await fixture(t); f.remote.transferOutcome('wrong-position');
  await assert.rejects(operation('test-transfer', () => f.move(), 350));
  f.target.queue.current_item!.queue_item_id = 'external-replacement'; f.remote.calls.length = 0;
  await f.manager.recoverPlayback(f.manager.view().revision);
  assert.equal(f.writes().length, 0); assert.equal(f.target.queue.state, 'playing'); assert.equal(f.adapter.requiresRecovery, false);
});

for (const missing of ['availability', 'stream-evidence']) test(`transfer recovery cannot dismiss an unverified owned target (${missing})`, async t => {
  const f = await fixture(t); f.remote.transferOutcome('wrong-position');
  await assert.rejects(operation('test-transfer', () => f.move(), 350));
  if (missing === 'availability') f.target.queue.available = false;
  else delete f.target.queue.current_item!.streamdetails;
  f.remote.calls.length = 0;
  await assert.rejects(f.manager.recoverPlayback(f.manager.view().revision), /recovery could not confirm/);
  assert.equal(f.adapter.requiresRecovery, true); assert.equal(f.writes().length, 0);
});

test('external source replacement is never transferred or stopped', async t => {
  const f = await fixture(t); f.remote.queue.current_item!.queue_item_id = 'external-item'; f.remote.calls.length = 0;
  await assert.rejects(f.move(), /outside this app/);
  assert.equal(f.writes().length, 0); assert.equal(f.remote.queue.state, 'playing');
});

for (const outcome of ['recovered', 'external-replacement'] as const) test(`an idle speaker can be selected after playback is ${outcome}`, async t => {
  const f = await fixture(t); const turn = f.host().turnId; const previousId = f.participant().ownPlayback!.id;
  const select = (playbackId?: string) => f.manager.selectDestination('sonos:bedroom', f.manager.view().revision, playbackId,
    work => f.engine.changeSpeaker(playbackId ?? null, work));
  if (outcome === 'recovered') {
    f.remote.transferOutcome('wrong-position');
    await assert.rejects(operation('test-transfer', () => f.move(), 350), /Moving playback could not be confirmed/);
    f.remote.calls.length = 0;
    await assert.rejects(select(), /connectivity is uncertain/);
    assert.equal(f.writes().length, 0);
    await f.manager.recoverPlayback(f.manager.view().revision);
  } else {
    f.remote.queue.current_item!.queue_item_id = 'external-item';
    await f.poll();
  }
  await f.engine.drain();
  assert.equal(f.adapter.requiresRecovery, false); assert.equal(f.adapter.ownsPlayback, false);
  assert.equal(f.participant().ownPlayback, null); assert.equal(f.manager.view().speakerChangesBlocked, false);
  f.remote.calls.length = 0;
  const selected = await select();
  assert.equal(selected.destination?.id, 'sonos:bedroom'); assert.equal(selected.output.state, 'ready');
  await assert.rejects(select(previousId), /current song changed/);
  assert.equal(f.writes().length, 0); assert.equal(f.host().turnId, turn); assert.equal(f.participant().ownPlayback, null);
  if (outcome === 'external-replacement') assert.equal(f.remote.queue.state, 'playing');
});

test('missing source stream evidence retains the recovery guard and never dispatches transfer', async t => {
  const f = await fixture(t); delete f.remote.queue.current_item!.streamdetails; f.remote.calls.length = 0;
  await assert.rejects(f.move(), /could not confirm/);
  assert.equal(f.writes().length, 0); assert.equal(f.adapter.requiresRecovery, true); assert.equal(f.adapter.ownsPlayback, true);
  assert.equal(f.adapter.problem?.code, 'state-unconfirmed');
});

test('a stale current item cannot vouch for a different item in the source queue', async t => {
  const f = await fixture(t);
  const own = (f.adapter as unknown as { own: { api: MusicAssistantApi } }).own;
  const queueItems = own.api.queueItems.bind(own.api);
  own.api.queueItems = async queueId => (await queueItems(queueId)).map(item => ({ ...item, queue_item_id: 'external-item' }));
  f.remote.calls.length = 0; await assert.rejects(f.move(), /outside this app/);
  assert.equal(f.writes().length, 0); assert.equal(f.remote.queue.state, 'playing');
});

test('an uploaded song keeps the exact finite-track URL and lease across handoff', async t => {
  const f = await fixture(t); let active = true; let observed = false; let leases = 0;
  const server = createServer((_req, res) => { observed = true; res.statusCode = active ? 200 : 404; res.end('Synthetic finite audio'); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); t.after(() => { server.closeAllConnections(); server.close(); });
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/private-fixture.wav`;
  const uploads: Pick<UploadAssets, 'lease'> = { async lease() {
    leases++; return { url, revoke() { active = false; }, suspend() { active = false; }, get observed() { return observed; } };
  } };
  f.manager.attachUploads(uploads as UploadAssets, 'http://localhost:3000');
  const previousId = f.participant().ownPlayback!.id;
  await f.engine.stopForHost(f.host().turnId!, previousId);
  const selection: UploadSelection = { source: 'upload', assetId: crypto.randomUUID(),
    metadata: { title: 'Private upload', artist: 'Private artist', album: '', version: '', provider: 'Uploaded file', duration: 180 } };
  const id = await f.engine.playPrepared(f.alex, f.host().turnId!, previousId, selection, crypto.randomUUID());
  f.remote.queue.elapsed_time = 70; f.remote.queue.elapsed_time_last_updated = Date.now() / 1000;
  f.remote.calls.length = 0; await f.move();
  assert.equal(f.participant().ownPlayback!.id, id); assert.equal(leases, 1); assert.equal(active, true);
  assert.equal(f.target.queue.current_item!.media_item.uri, `builtin://track/${url}`);
  assert.equal((await fetch(url)).status, 200);
  assert.deepEqual(f.writes().map(c => c.command), ['player_queues/transfer']);
  await f.engine.stopForHost(f.host().turnId!, id); assert.equal(active, false);
});

for (const outcome of ['not-committed', 'uncertain'] as const) test(`confirmed handoff stays controllable when saving the route fails (${outcome})`, async t => {
  const f = await fixture(t); const save = f.integrationStore.save;
  f.integrationStore.save = async next => { if (outcome === 'uncertain') await save(next); throw new PersistenceError(outcome); };
  const id = f.participant().ownPlayback!.id; f.remote.calls.length = 0;
  await assert.rejects(f.move(), /Playback moved, but/);
  assert.equal(f.manager.view().destination?.id, 'sonos:bedroom'); assert.equal(f.manager.view().destinationSavePending, true);
  assert.equal(f.adapter.requiresRecovery, false); assert.equal(f.engine.ready, true);
  await f.engine.control(f.alex, f.host().turnId!, id, 'pause'); assert.equal(f.target.queue.state, 'paused');
  f.integrationStore.save = save; await f.manager.check(f.manager.view().revision);
  assert.equal(f.manager.view().destinationSavePending, false);
  assert.equal((await f.integrationStore.load()).musicAssistant?.destination?.id, 'sonos:bedroom');
  assert.equal(f.writes().filter(c => c.command === 'player_queues/transfer').length, 1);
  assert.equal(f.participant().ownPlayback!.id, id);
});

test('slow speaker discovery does not block Stop or move a song after it was stopped', async t => {
  const f = await fixture(t); const gate = f.remote.holdNextInventoryRead(); t.after(() => gate.release());
  const id = f.participant().ownPlayback!.id; const result = assert.rejects(f.move(), /current song changed/);
  await gate.entered; await operation('test-stop', () => f.engine.stopForHost(f.host().turnId!, id), 1000);
  gate.release(); await result;
  assert.equal(f.remote.calls.some(c => c.command === 'player_queues/transfer'), false);
});

test('a replacement song publishes its new handoff identity and rejects an older move intention', async t => {
  const f = await fixture(t); const gate = f.remote.holdNextInventoryRead(); t.after(() => gate.release());
  const id = f.participant().ownPlayback!.id; const updates: (string | undefined)[] = [];
  const unsubscribe = f.manager.subscribe(() => updates.push(f.manager.view().playbackId)); t.after(unsubscribe);
  const result = assert.rejects(f.move(), /current song changed/); await gate.entered;
  const track = (await f.engine.search(f.alex, f.host().turnId!, 'fixture')).tracks[0]!;
  await f.engine.play(f.alex, f.host().turnId!, id, track.id);
  const nextId = f.participant().ownPlayback!.id;
  assert.notEqual(nextId, id); assert.ok(updates.includes(nextId));
  gate.release(); await result;
  assert.equal(f.remote.calls.some(c => c.command === 'player_queues/transfer'), false);
});

test('Stop queued during a native handoff runs on the new speaker, not the old queue', async t => {
  const f = await fixture(t); const gate = f.remote.holdNextTransfer(); t.after(gate.release);
  const id = f.participant().ownPlayback!.id; f.remote.calls.length = 0;
  const moving = f.move(); await gate.entered;
  const stopping = f.engine.stopForHost(f.host().turnId!, id);
  gate.release(); await Promise.all([moving, stopping]);
  assert.deepEqual(f.writes().map(c => [c.command, c.args.queue_id]), [['player_queues/transfer', undefined], ['player_queues/stop', 'sonos:bedroom']]);
  assert.equal(f.target.queue.state, 'idle'); assert.equal(f.participant().ownPlayback!.status, 'stopped');
});

test('a stale ended-source snapshot cannot pass the turn after handoff', async t => {
  const f = await fixture(t); const id = f.participant().ownPlayback!.id; const turn = f.host().turnId;
  Object.assign(f.remote.queue, { state: 'idle', ended: true });
  const gate = f.remote.holdNextQueueRead(); t.after(() => gate.release());
  const polling = f.poll(); await gate.entered;
  Object.assign(f.remote.queue, { state: 'playing', ended: false });
  await f.move(); gate.release(); await polling;
  assert.equal(f.adapter.requiresRecovery, false); assert.equal(f.host().turnId, turn); assert.equal(f.participant().ownPlayback!.id, id);
});

for (const failure of [false, true]) test(`stale source polling cannot invalidate transferred playback (read failure=${failure})`, async t => {
  const f = await fixture(t); const gate = f.remote.holdNextQueueRead(); t.after(() => gate.release());
  const id = f.participant().ownPlayback!.id; const turn = f.host().turnId; const polling = f.poll(); await gate.entered;
  await f.move(); gate.release(failure); await polling;
  assert.equal(f.adapter.requiresRecovery, false); assert.equal(f.participant().ownPlayback!.id, id); assert.equal(f.host().turnId, turn);
});

test('natural completion on the new speaker advances exactly once without another Play', async t => {
  const f = await fixture(t); const id = f.participant().ownPlayback!.id; await f.move();
  f.target.queue.state = 'idle'; f.target.queue.ended = true;
  await f.poll();
  for (let i = 0; i < 100 && f.host().current?.nickname !== 'Sam'; i++) await delay(5);
  assert.equal(f.host().current?.nickname, 'Sam'); const turn = f.host().turnId;
  await f.engine.complete(id); assert.equal(f.host().turnId, turn);
  assert.equal(f.writes().filter(c => c.command === 'player_queues/play_media').length, 1);
});

test('the host destination endpoint requires the current playback intent and performs native handoff', async t => {
  const f = await fixture(t); const app = express(); app.use(express.json());
  const close = mountIntegrations(app, f.engine, f.manager); t.after(close);
  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(error instanceof AppError ? error.status : 500).json({ error: error instanceof Error ? error.message : 'Request failed.' });
  });
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/host/integrations/destination`;
  const post = (data: object) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  const id = f.participant().ownPlayback!.id; const revision = f.manager.view().revision;
  assert.equal((await post({ id: 'sonos:bedroom', revision })).status, 409);
  assert.equal((await post({ id: 'sonos:bedroom', revision, playbackId: crypto.randomUUID() })).status, 409);
  const response = await post({ id: 'sonos:bedroom', revision, playbackId: id }); assert.equal(response.status, 200);
  const view = await response.json(); assert.equal(view.destination.id, 'sonos:bedroom');
  assert.equal(f.participant().ownPlayback!.id, id);
  assert.equal((await post({ id: 'sonos:room', revision, playbackId: id })).status, 409);
  assert.equal(f.writes().filter(c => c.command === 'player_queues/transfer').length, 1);
  assert.equal(JSON.stringify(view).includes('fixture-token'), false);
  assert.equal(JSON.stringify(view).includes(f.remote.track.uri), false);
});
