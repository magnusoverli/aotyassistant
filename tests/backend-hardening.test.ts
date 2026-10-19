import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, mkdir, rm, writeFile, stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';
import type { AddressInfo } from 'node:net';
import { IntegrationManager, IntegrationFileStore } from '../src/integrations.js';
import { ManagedPlayback } from '../src/live-playback.js';
import { DemoAdapter } from '../src/playback.js';
import { Engine } from '../src/engine.js';
import { FileStore } from '../src/store.js';
import { createApp } from '../src/http.js';
import { PreparationFileStore, PreparationManager, type SavedSelection } from '../src/preparations.js';
import { SerialQueue } from '../src/serial.js';
import { operation, playbackResolution } from '../src/operation.js';
import { MusicAssistantTransport } from '../src/music-assistant-transport.js';
import { presentCatalogueItems } from '../src/catalogue-grouping.js';
import { UploadAssets } from '../src/uploads.js';
import { durability } from '../src/backup.js';
import { startMusicAssistantFixture } from './fixtures/music-assistant.js';
import { resolveLanAddresses } from '../src/lan-network.js';

function gate() {
  let release!: () => void; let enter!: () => void;
  return { pending: new Promise<void>(resolve => { release = resolve; }), entered: new Promise<void>(resolve => { enter = resolve; }),
    release: () => release(), enter: () => enter() };
}
const selected: SavedSelection = { source: 'demo', trackId: 'demo:aurora', metadata: { title: 'Private', artist: '', album: '', duration: 60, version: '', provider: 'Demo' } };
const edit = (revision: number) => ({ id: randomUUID(), revision, issuedAt: Date.now() });
async function live(t: TestContext, afterSave = () => {}) {
  const remote = await startMusicAssistantFixture(); const directory = await mkdtemp('/tmp/opencode/aoty-hardening-');
  const file = new IntegrationFileStore(directory);
  const manager = new IntegrationManager({ load: () => file.load(), save: async state => { await file.save(state); afterSave(); } });
  await manager.init(); await manager.save(remote.origin, 'fixture-token', 0); await manager.selectDestination('sonos:room', manager.view().revision);
  const adapter = new ManagedPlayback(new DemoAdapter(), manager, 60_000);
  const engine = new Engine(new FileStore(directory), adapter, 'http://localhost:3000', manager); await engine.init();
  t.after(async () => { adapter.close(); manager.close(); remote.close(); await rm(directory, { recursive: true, force: true }); });
  const credential = await engine.join('Current'); const turn = engine.view({ kind: 'host' }).turnId!;
  const track = (await engine.search(credential, turn, 'fixture')).tracks[0]!;
  return { remote, directory, file, manager, adapter, engine, credential, turn, track };
}

test('playback recovery leaves the watchdog live, membership/catalogue available, and audio ownership guarded', async t => {
  const f = await live(t); const server = createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const port = (server.address() as AddressInfo).port; const origin = `http://127.0.0.1:${port}`;
  const http = createApp(f.engine, { port, listenHost: '127.0.0.1', guestUrl: origin, dataDir: f.directory, mode: 'demo', demoSeconds: 30 }, 'web', f.manager);
  server.on('request', http.app); t.after(() => { http.close(); server.closeAllConnections(); server.close(); });
  f.remote.failNextPlaybackVerification(); await assert.rejects(f.engine.play(f.credential, f.turn, null, f.track.id));
  f.remote.fail(false); await f.manager.check(f.manager.view().revision);
  const response = await fetch(origin + '/api/health'); assert.equal(response.status, 200);
  assert.equal((await response.json()).playbackAvailable, false);
  await f.engine.join('During recovery'); assert.ok((await f.engine.search(f.credential, f.turn, 'fixture')).tracks.length);
  assert.equal(f.adapter.ownsPlayback, true); assert.equal(f.manager.output.state, 'recovery');
  await assert.rejects(f.engine.play(f.credential, f.turn, null, f.track.id));
  assert.equal(f.remote.calls.filter(call => call.command === 'player_queues/play_media').length, 1);
});

test('automatic policy stops require observed idle and retain recovery ownership when ignored', async t => {
  const f = await live(t); await f.engine.play(f.credential, f.turn, null, f.track.id);
  f.remote.queue.autoplay_enabled = true; f.remote.ignoreControl('stop');
  await operation('policy-stop-test', () => (f.adapter as unknown as { poll(): Promise<void> }).poll(), 150);
  assert.equal(f.remote.queue.state, 'playing'); assert.match(f.adapter.issue, /Stopping could not be confirmed/);
  assert.equal(f.adapter.ownsPlayback, true); assert.equal(f.adapter.requiresRecovery, true);
  assert.equal(f.engine.view({ kind: 'host' }).turnId, f.turn);
  assert.equal(f.remote.calls.filter(call => call.command === 'player_queues/stop').length, 1);
});

test('ambiguous settings commits disable routing until a durable reconciliation revalidates the stored speaker', async t => {
  let uncertain = false; const f = await live(t, () => { if (uncertain) throw new Error('After replacement'); });
  const revision = f.manager.view().revision; uncertain = true;
  await assert.rejects(f.manager.selectDestination('sonos:bedroom', revision));
  assert.equal((await f.file.load()).musicAssistant!.destination!.id, 'sonos:bedroom');
  assert.equal(f.manager.playbackAvailable, false); assert.equal(f.manager.output.state, 'unconfirmed');
  await assert.rejects(f.engine.play(f.credential, f.turn, null, f.track.id));
  await assert.rejects(f.manager.check(revision)); assert.equal(f.manager.playbackAvailable, false);
  uncertain = false; await f.manager.check(revision);
  assert.equal(f.manager.view().destination!.id, 'sonos:bedroom'); assert.equal(f.manager.playbackAvailable, true);
  assert.equal(f.remote.calls.some(call => call.command === 'player_queues/play_media'), false);
});

test('an ambiguous first connection save cannot fall back to demo playback', async t => {
  const directory = await mkdtemp('/tmp/opencode/aoty-first-save-'); const file = new IntegrationFileStore(directory);
  let fail = true;
  const manager = new IntegrationManager({ load: () => file.load(), save: async state => { await file.save(state); if (fail) throw new Error('After replacement'); } });
  await manager.init(); const adapter = new ManagedPlayback(new DemoAdapter(), manager);
  const engine = new Engine(new FileStore(directory), adapter, 'http://localhost:3000', manager); await engine.init();
  t.after(async () => { adapter.close(); manager.close(); await rm(directory, { recursive: true, force: true }); });
  const member = await engine.join('Current'); const turn = engine.view({ kind: 'host' }).turnId!;
  await assert.rejects(manager.save('http://127.0.0.1:1', 'synthetic-token', 0));
  assert.equal(manager.view().status, 'error'); assert.equal(engine.playbackAvailable, false);
  await assert.rejects(engine.play(member, turn, null, 'demo:aurora')); assert.equal(adapter.ownsPlayback, false);
  fail = false; await manager.check(0); assert.equal(manager.view().url, 'http://127.0.0.1:1'); assert.equal(engine.playbackAvailable, false);
});

test('queue deadlines/cancellation remove waiting work immediately, bound admission, and preserve dispatched work', async t => {
  const queue = new SerialQueue(1); const held = gate(); t.after(held.release); let dispatched = 0;
  const first = queue.run(async () => { held.enter(); await held.pending; }); await held.entered;
  const expired = assert.rejects(operation('queued', () => queue.run(async () => { dispatched++; }), 30), /timed out/);
  await assert.rejects(queue.run(async () => {}), /Too many pending/);
  assert.equal(await Promise.race([expired.then(() => true), delay(1000, false)]), true);
  const abort = new AbortController();
  const cancelled = assert.rejects(operation('cancelled', () => queue.run(async () => { dispatched++; }), 1000, abort.signal), /cancelled/);
  abort.abort(); await cancelled; assert.equal(dispatched, 0);
  held.release(); await first; await queue.drain(); await queue.run(async () => { dispatched++; }); assert.equal(dispatched, 1);
  const running = gate(); t.after(running.release); const controller = new AbortController();
  const command = operation('dispatched', () => queue.run(async () => { running.enter(); await running.pending; return 'confirmed'; }), 1000, controller.signal);
  await running.entered; controller.abort(); running.release(); assert.equal(await command, 'confirmed');
});

test('private capture releases the owner lane, coalesces retries and drains the eventual commit', async t => {
  const directory = await mkdtemp('/tmp/opencode/aoty-capture-'); t.after(() => rm(directory, { recursive: true, force: true }));
  const manager = new PreparationManager(new PreparationFileStore(directory)); const owner = await manager.createOwner(); const held = gate(); t.after(held.release);
  const operation = edit(0); let captures = 0;
  const capture = () => manager.addCaptured(owner.credential, operation, 'reference', async () => { captures++; held.enter(); await held.pending; return selected; });
  const first = capture(); await held.entered; const retry = capture();
  assert.equal(await Promise.race([manager.read(owner.credential).then(view => view.revision), delay(1000, -1)]), 0);
  await assert.rejects(manager.discardUpload(owner.credential, randomUUID(), async () => { throw new Error('Must not delete while capture is pending'); }), /track is being saved/);
  let drained = false; const draining = manager.drain().then(() => { drained = true; }); await delay(10); assert.equal(drained, false);
  held.release(); const results = await Promise.all([first, retry]); await draining;
  assert.equal(captures, 1); assert.equal(results[0]!.entryId, results[1]!.entryId); assert.equal(results[1]!.replayed, true);
  const replay = await manager.addCaptured(owner.credential, operation, 'reference', async () => { throw new Error('Expired reference'); });
  assert.equal(replay.replayed, true); assert.equal((await manager.read(owner.credential)).upcoming.length, 1);
});

test('capture reauthorizes and checks the current revision after provider work', async t => {
  const directory = await mkdtemp('/tmp/opencode/aoty-capture-revocation-'); t.after(() => rm(directory, { recursive: true, force: true }));
  const manager = new PreparationManager(new PreparationFileStore(directory)); const owner = await manager.createOwner();
  const key = await manager.issueRecoveryKey(owner.credential, 0); const recovered = await manager.recover(key.recoveryKey);
  const held = gate(); t.after(held.release);
  const adding = manager.addCaptured(owner.credential, edit(recovered.view.revision), 'reference', async () => { held.enter(); await held.pending; return selected; });
  const rejected = assert.rejects(adding, /access is unavailable/); await held.entered;
  await manager.revokeOtherDevices(recovered.credential, recovered.view.revision); held.release(); await rejected;
  assert.equal((await manager.read(recovered.credential)).upcoming.length, 0);
  const stale = gate(); t.after(stale.release); const view = await manager.read(recovered.credential);
  const pending = manager.addCaptured(recovered.credential, edit(view.revision), 'reference', async () => { stale.enter(); await stale.pending; return selected; });
  const conflict = assert.rejects(pending, /changed in another page/); await stale.entered;
  await manager.issueRecoveryKey(recovered.credential, view.revision); stale.release(); await conflict;
});

test('completed upload deletions are not retried; legacy tombstones migrate in bounded durable batches', async t => {
  const directory = await mkdtemp('/tmp/opencode/aoty-cleanup-batches-'); t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new PreparationFileStore(directory); const manager = new PreparationManager(store); const owner = await manager.createOwner();
  const state = (await store.load(owner.view.ownerId))!; state.deletedUploads = Array.from({ length: 20 }, () => randomUUID()); await store.save(state);
  const calls: string[] = []; const remove = async (_owner: string, asset: string) => { calls.push(asset); };
  await manager.cleanupDeletedUploads(owner.credential, remove); assert.equal(calls.length, 16);
  const restored = new PreparationManager(new PreparationFileStore(directory));
  await restored.cleanupDeletedUploads(owner.credential, remove); await restored.cleanupDeletedUploads(owner.credential, remove);
  assert.equal(calls.length, 20); assert.equal(new Set(calls).size, 20);
  const saved = (await store.load(owner.view.ownerId))!;
  assert.equal(saved.deletedUploads!.length, 20); assert.deepEqual(saved.pendingUploadDeletions, []); assert.equal(saved.revision, 0);
});

test('playback-critical recording resolution bypasses a saturated search pool', async t => {
  const held = gate(); t.after(held.release); let searches = 0;
  const server = createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    if (JSON.parse(raw).command === 'music/search') { if (++searches === 4) held.enter(); await held.pending; }
    res.setHeader('Content-Type', 'application/json'); res.end('{}');
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); t.after(() => { server.closeAllConnections(); server.close(); });
  const transport = new MusicAssistantTransport(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, 'synthetic'); t.after(() => transport.close());
  const pending = Array.from({ length: 4 }, () => transport.read('/api', 'music/search', {})); await held.entered;
  const resolving = playbackResolution(() => transport.read('/api', 'music/item_by_uri', {}));
  assert.equal(await Promise.race([resolving.then(() => true), delay(1000, false)]), true);
  held.release(); await Promise.all(pending);
});

test('shared LAN resolution cancels pending DNS promptly and rejects mixed public/private answers', async t => {
  const held = gate(); t.after(held.release); const controller = new AbortController();
  const lookup = resolveLanAddresses('fixture.internal', 8000, async () => { held.enter(); await held.pending; return [{ address: '127.0.0.1', family: 4 }]; }, controller.signal);
  const rejected = assert.rejects(lookup, /cancelled/); await held.entered; controller.abort();
  assert.equal(await Promise.race([rejected.then(() => true), delay(1000, false)]), true); held.release();
  await assert.rejects(resolveLanAddresses('fixture.internal', 1000, async () => [{ address: '127.0.0.1', family: 4 }, { address: '8.8.8.8', family: 4 }]), /private LAN/);
});

test('large metadata buckets retain exact choices and contradictory identity evidence stays separate', () => {
  const items = Array.from({ length: 2000 }, (_, i) => ({ item_id: `${i}`, provider: i % 2 ? 'tidal' : 'spotify', name: 'Same title', version: '', artists: [{ name: 'Same artist' }], external_ids: [] as [string, string][] }));
  const groups = presentCatalogueItems('album', items); assert.equal(groups.length, 1); assert.equal(groups[0]!.items.length, 2000); assert.equal(groups[0]!.matchKind, 'metadata');
  items[0]!.external_ids = [['barcode', '1234567890123']]; items[1]!.external_ids = [['barcode', '1234567890124']];
  const split = presentCatalogueItems('album', items);
  assert.ok(!split.some(group => group.items.includes(items[0]!) && group.items.includes(items[1]!)));
  assert.equal(split.reduce((count, group) => count + group.items.length, 0), 2000);
});

test('backup freeze does not wait for upload analysis; publication waits, and restored staging is disposable', async t => {
  const directory = await mkdtemp('/tmp/opencode/aoty-backup-staging-'); t.after(() => rm(directory, { recursive: true, force: true }));
  const held = gate(); t.after(() => { held.release(); durability.thaw(); });
  const assets = new UploadAssets(directory, async () => { held.enter(); await held.pending; return {
    extension: 'mp3', contentType: 'audio/mpeg', artwork: false,
    metadata: { title: 'Staged', artist: '', album: '', version: '', provider: 'Uploaded file', duration: 60 },
  }; }); t.after(() => assets.close());
  const owner = randomUUID(); const asset = randomUUID();
  const receiving = assets.receive(owner, asset, 'recording.mp3', Readable.from(Buffer.from('fixture'))); await held.entered;
  await durability.freeze(100); await assert.rejects(assets.inspect(owner, asset), /not found/);
  held.release(); let published = false; void receiving.then(() => { published = true; }); await delay(20); assert.equal(published, false);
  durability.thaw(); await receiving; assert.equal((await assets.inspect(owner, asset)).title, 'Staged');
  const abandoned = `${directory}/upload-staging/${randomUUID()}`; await mkdir(abandoned); await writeFile(`${abandoned}/audio`, 'partial');
  await assets.cleanup(); await assert.rejects(stat(abandoned)); assert.equal((await assets.inspect(owner, asset)).title, 'Staged');
});

test('shutdown drains an admitted Play before disposing its transport and preserves its commit', async t => {
  const f = await live(t); const held = f.remote.holdNextQueueRead(); t.after(() => held.release());
  const playing = f.engine.play(f.credential, f.turn, null, f.track.id); await held.entered;
  f.engine.beginShutdown(); f.manager.stopMonitoring(); f.adapter.beginShutdown();
  let drained = false; const draining = f.engine.drain().then(() => { drained = true; }); await delay(10); assert.equal(drained, false);
  held.release(); await playing; await draining;
  assert.equal(f.engine.live, false); assert.equal(f.adapter.ownsPlayback, true);
  assert.equal((await new FileStore(f.directory).load()).room!.playback!.track.id, f.track.id);
});
