import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import type { AddressInfo } from 'node:net';
import { Engine } from '../src/engine.js';
import { FileStore, PersistenceError } from '../src/store.js';
import { IntegrationManager, IntegrationFileStore } from '../src/integrations.js';
import { ManagedPlayback } from '../src/live-playback.js';
import { DemoAdapter } from '../src/playback.js';
import { createApp } from '../src/http.js';
import { AppError, type CatalogueTrack } from '../src/model.js';
import { startMusicAssistantFixture } from './fixtures/music-assistant.js';

async function fixture() {
  const remote = await startMusicAssistantFixture(); const dir = await mkdtemp('/tmp/opencode/aoty-destination-');
  const file = new IntegrationFileStore(dir); let failStore = false;
  const manager = new IntegrationManager({ load: () => file.load(), save: async state => { if (failStore) throw new PersistenceError('not-committed'); await file.save(state); } });
  await manager.init(); await manager.save(remote.origin, 'fixture-token', 0); await manager.selectDestination('sonos:room', manager.view().revision);
  const adapter = new ManagedPlayback(new DemoAdapter(), manager, 20);
  const server = createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const port = (server.address() as AddressInfo).port; const origin = `http://127.0.0.1:${port}`;
  const engine = new Engine(new FileStore(dir), adapter, origin, manager); await engine.init();
  await adapter.refresh();
  const host = () => engine.view({ kind: 'host' });
  const alex = await engine.join('Alex'); const sam = await engine.join('Sam');
  const http = createApp(engine, { port, guestUrl: origin, listenHost: '127.0.0.1', dataDir: dir, mode: 'demo', demoSeconds: 30 }, 'web', manager); server.on('request', http.app);
  const participant = (credential: string) => engine.view({ kind: 'participant', credential });
  const context = (credential: string) => engine.catalogueContext(credential);
  const request = (path: string, credential?: string, data?: unknown) => fetch(origin + path, {
    method: data === undefined ? 'GET' : 'POST', headers: { ...(credential ? { Cookie: `aoty_participant=${credential}` } : {}), ...(data === undefined ? {} : { Origin: origin, 'Content-Type': 'application/json' }) },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  });
  return { remote, manager, adapter, engine, host, participant, context, request, alex, sam, store: file,
    display: () => engine.view({ kind: 'display' }), failStore() { failStore = true; },
    close() { http.close(); adapter.close(); remote.close(); server.closeAllConnections(); server.close(); } };
}
const status = (code: number) => (error: unknown) => error instanceof AppError && error.status === code;
const writes = (f: Awaited<ReturnType<typeof fixture>>) => f.remote.calls.filter(call => /^(players\/cmd\/|player_queues\/(play_media|pause|resume|stop|autoplay|repeat|shuffle)$)/.test(call.command));

test('speaker-only changes preserve participant catalogue identity, cached browse/prepared/artwork references, and membership', async t => {
  const f = await fixture(); t.after(f.close);
  const artists = await f.engine.browse(f.alex, 'artists', 'Fixture');
  const albums = await f.engine.browse(f.alex, 'albums', artists.artists![0]!.id);
  const track = (await f.engine.browse(f.alex, 'tracks', albums.albums![0]!.id)).tracks![0]!;
  const other = (await f.engine.search(f.sam, f.host().turnId!, 'fixture')).tracks[0]!;
  const before = f.participant(f.alex); const otherBefore = f.participant(f.sam); const routing = f.manager.configurationRevision;
  const oldVolumeRevision = before.volume!.revision;
  const response = await f.request('/api/host/integrations/destination', undefined, { id: 'sonos:bedroom', revision: f.manager.view().revision });
  assert.equal(response.status, 200); assert.equal(f.manager.view().playbackAvailable, true);
  const after = f.participant(f.alex); const otherAfter = f.participant(f.sam);
  assert.equal(before.catalogue!.revision, after.catalogue!.revision); assert.notEqual(routing, f.manager.configurationRevision);
  for (const [a, b] of [[before, after], [otherBefore, otherAfter]]) {
    assert.equal(a!.roomId, b!.roomId); assert.equal(a!.me!.id, b!.me!.id); assert.equal(a!.turnId, b!.turnId); assert.equal(a!.revision, b!.revision);
  }
  assert.equal((await f.manager.resolve(track.id, f.context(f.alex))).track.id, track.id);
  assert.equal((await f.manager.resolve(other.id, f.context(f.sam))).track.id, other.id);
  assert.ok((await f.engine.browse(f.alex, 'albums', artists.artists![0]!.id)).albums!.length);
  assert.ok((await f.engine.browse(f.alex, 'tracks', albums.albums![0]!.id)).tracks!.length);
  assert.equal((await f.request(track.artwork!, f.alex)).status, 200);
  assert.equal((await f.request(track.artwork!, f.sam)).status, 409);
  assert.equal((await f.request('/api/host/volume', undefined, { turnId: f.host().turnId, level: 40, volumeRevision: oldVolumeRevision })).status, 409);
  assert.equal(writes(f).length, 0, 'Changing speakers or reading preserved preparation must not start/adjust audio.');
  for (const state of [f.host(), f.display(), f.participant(f.sam)]) assert.ok(!JSON.stringify(state).includes('Fixture album'));
});

test('unchanged-credential saves keep references, but token/origin replacement, forget, and restart invalidate catalogue identity', async t => {
  const f = await fixture(); t.after(f.close);
  const track = (await f.engine.search(f.alex, f.host().turnId!, 'fixture')).tracks[0]!;
  const epoch = f.manager.catalogueRevision;
  await f.manager.save(f.remote.origin, undefined, f.manager.view().revision);
  assert.equal(f.manager.catalogueRevision, epoch); await f.manager.resolve(track.id, f.context(f.alex));
  await f.manager.save(f.remote.origin, 'browser-test-token', f.manager.view().revision);
  assert.notEqual(f.manager.catalogueRevision, epoch); await assert.rejects(f.manager.resolve(track.id, f.context(f.alex)), status(409));
  assert.equal((await f.request(track.artwork!, f.alex)).status, 409);
  await f.manager.save(f.remote.origin, 'fixture-token', f.manager.view().revision);
  assert.notEqual(f.manager.catalogueRevision, epoch); await assert.rejects(f.manager.resolve(track.id, f.context(f.alex)), status(409), 'Returning to old credentials must not resurrect old references.');
  const fresh = (await f.engine.search(f.alex, f.host().turnId!, 'fixture')).tracks[0]!;
  const second = await startMusicAssistantFixture(); t.after(second.close);
  const originEpoch = f.manager.catalogueRevision;
  await assert.rejects(f.manager.save(second.origin, 'fixture-token', f.manager.view().revision), /different Music Assistant server/);
  assert.equal(f.manager.catalogueRevision, originEpoch);
  await f.manager.clear(f.manager.view().revision);
  await f.manager.save(second.origin, 'fixture-token', f.manager.view().revision);
  assert.notEqual(f.manager.catalogueRevision, originEpoch); await assert.rejects(f.manager.resolve(fresh.id, f.context(f.alex)), status(409));
  const current = (await f.engine.search(f.alex, f.host().turnId!, 'fixture')).tracks[0]!;
  const restored = new IntegrationManager(f.store); await restored.init();
  assert.equal(restored.configured, true); assert.equal(restored.view().revision, f.manager.view().revision);
  assert.notEqual(restored.catalogueRevision, f.manager.catalogueRevision); assert.notEqual(restored.configurationRevision, f.manager.configurationRevision);
  await assert.rejects(restored.resolve(current.id, f.context(f.alex)), status(409));
  await assert.rejects(restored.artwork(decodeURIComponent(current.artwork!.split('/').at(-1)!), f.context(f.alex)), status(409));
  const forgotten = f.manager.catalogueRevision; await f.manager.clear(f.manager.view().revision);
  assert.notEqual(f.manager.catalogueRevision, forgotten); assert.equal(f.participant(f.alex).catalogue!.source, 'demo');
  assert.equal((await f.request(current.artwork!, f.alex)).status, 409);
});

test('in-flight private artwork survives a speaker-only change but is denied across a credential change', async t => {
  const f = await fixture(); t.after(f.close);
  const track = (await f.engine.search(f.alex, f.host().turnId!, 'fixture')).tracks[0]!;
  f.remote.delayImages(120);
  const image = f.request(track.artwork!, f.alex);
  for (let i = 0; i < 100 && !f.remote.imageCalls.length; i++) await delay(2);
  assert.ok(f.remote.imageCalls.length);
  await f.manager.selectDestination('sonos:bedroom', f.manager.view().revision);
  assert.equal((await image).status, 200);
  const count = f.remote.imageCalls.length; const portrait = f.request(track.artistArtwork!, f.alex);
  for (let i = 0; i < 100 && f.remote.imageCalls.length === count; i++) await delay(2);
  assert.ok(f.remote.imageCalls.length > count);
  await f.manager.save(f.remote.origin, 'browser-test-token', f.manager.view().revision);
  assert.equal((await portrait).status, 409);
});

test('speaker changes invalidate resolved playback and old volume intents, but an explicit fresh play can reuse the prepared reference', async t => {
  const f = await fixture(); t.after(f.close);
  const track = (await f.engine.search(f.alex, f.host().turnId!, 'fixture')).tracks[0]!;
  const resolved = await f.adapter.resolve(track.id, f.context(f.alex));
  await f.manager.selectDestination('sonos:bedroom', f.manager.view().revision);
  await assert.rejects(f.adapter.play(resolved, crypto.randomUUID()), status(409));
  assert.equal(writes(f).length, 0);
  const start = f.remote.calls.length;
  await f.engine.play(f.alex, f.host().turnId!, null, track.id);
  assert.equal(f.participant(f.alex).ownPlayback!.track.id, track.id);
  assert.ok(f.remote.calls.slice(start).filter(call => call.command === 'player_queues/get_active_queue').every(call => call.args.player_id === 'sonos:bedroom'));
  for (const action of ['playing', 'paused']) {
    if (action === 'paused') await f.engine.control(f.alex, f.host().turnId!, f.participant(f.alex).ownPlayback!.id, 'pause');
    const epoch = f.manager.catalogueRevision; const routing = f.manager.configurationRevision;
    await assert.rejects(f.manager.selectDestination('sonos:room', f.manager.view().revision), status(409));
    assert.equal(f.manager.catalogueRevision, epoch); assert.equal(f.manager.configurationRevision, routing); assert.equal(f.manager.playbackAvailable, true);
  }
});

test('failed persistence changes neither routing/catalogue identity nor cached preparation and playback availability', async t => {
  const f = await fixture(); t.after(f.close);
  const track = (await f.engine.search(f.alex, f.host().turnId!, 'fixture')).tracks[0]!;
  const epoch = f.manager.catalogueRevision; const routing = f.manager.configurationRevision;
  f.failStore(); await assert.rejects(f.manager.selectDestination('sonos:bedroom', f.manager.view().revision), status(503));
  await assert.rejects(f.manager.save(f.remote.origin, 'replacement-token', f.manager.view().revision), status(503));
  assert.equal(f.manager.catalogueRevision, epoch); assert.equal(f.manager.configurationRevision, routing); assert.equal(f.manager.playbackAvailable, true);
  await f.manager.resolve(track.id, f.context(f.alex)); assert.equal(writes(f).length, 0);
});

test('in-flight catalogue search survives routing changes but not credential changes', async () => {
  let finish!: (tracks: CatalogueTrack[]) => void;
  const manager = new IntegrationManager(new IntegrationFileStore(await mkdtemp('/tmp/opencode/aoty-routing-race-')), () => ({
    async inspect() { return { checkedAt: Date.now(), serverVersion: 'fixture', schemaVersion: 65, docsAvailable: true, players: [{ id: 'speaker', name: 'Speaker', available: true }] }; },
    async activeQueue() { return 'queue'; }, search: () => new Promise(resolve => { finish = resolve; }),
  }));
  await manager.init(); await manager.save('http://localhost:8095', 'fake-token', 0);
  const epoch = manager.catalogueRevision; const pending = manager.search('fixture');
  await manager.selectDestination('speaker', manager.view().revision); finish([]);
  assert.deepEqual(await pending, []); assert.equal(manager.catalogueRevision, epoch);
  const changed = manager.search('fixture'); await manager.save('http://localhost:8095', 'different-token', manager.view().revision); finish([]);
  await assert.rejects(changed, status(409));
});

test('browse may finish across a routing change but an already resolving playback cannot silently move destinations', async t => {
  const f = await fixture(); t.after(f.close);
  const artists = await f.engine.browse(f.alex, 'artists', 'Fixture');
  const track = (await f.engine.search(f.alex, f.host().turnId!, 'fixture')).tracks[0]!;
  const api = await f.manager.withPlayback(async client => client);
  const albums = api.albums.bind(api); let releaseBrowse!: () => void;
  const browseGate = new Promise<void>(resolve => { releaseBrowse = resolve; });
  api.albums = async id => { await browseGate; return albums(id); };
  const browsing = f.engine.browse(f.alex, 'albums', artists.artists![0]!.id);
  await f.manager.selectDestination('sonos:bedroom', f.manager.view().revision); releaseBrowse();
  assert.ok((await browsing).albums!.length);
  const resolve = api.resolveTrack.bind(api); let releaseResolve!: () => void;
  const resolveGate = new Promise<void>(done => { releaseResolve = done; });
  api.resolveTrack = async id => { await resolveGate; return resolve(id); };
  const resolving = f.manager.resolve(track.id, f.context(f.alex));
  await f.manager.selectDestination('sonos:room', f.manager.view().revision); releaseResolve();
  await assert.rejects(resolving, error => error instanceof AppError && error.status === 409 && error.message.includes('prepared choice is still available'));
  api.resolveTrack = resolve; await f.manager.resolve(track.id, f.context(f.alex)); assert.equal(writes(f).length, 0);
});
