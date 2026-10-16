import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { Engine } from '../src/engine.js';
import { FileStore } from '../src/store.js';
import { DemoAdapter } from '../src/playback.js';
import { ManagedPlayback } from '../src/live-playback.js';
import { IntegrationManager, IntegrationFileStore } from '../src/integrations.js';
import { PreparationFileStore, PreparationManager } from '../src/preparations.js';
import type { PreparationView, PreparationResult } from '../src/preparations.js';
import type { CatalogueSearch, View } from '../src/model.js';
import { createApp } from '../src/http.js';
import { startMusicAssistantFixture } from './fixtures/music-assistant.js';

const prefix = '/api/participant/preparations';
const operation = (revision: number) => ({ id: randomUUID(), revision, issuedAt: Date.now() });
const cookie = (response: Response) => response.headers.get('set-cookie')!.split(';')[0]!;
async function fixture(t: TestContext) {
  const remote = await startMusicAssistantFixture(); const dir = await mkdtemp('/tmp/opencode/aoty-preparation-http-');
  const server = createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const port = (server.address() as AddressInfo).port; const origin = `http://127.0.0.1:${port}`;
  const config = { port, listenHost: '127.0.0.1', guestUrl: origin, dataDir: dir, mode: 'demo' as const, demoSeconds: 3600 };
  async function boot() {
    const integrations = new IntegrationManager(new IntegrationFileStore(dir)); await integrations.init();
    const adapter = new ManagedPlayback(new DemoAdapter(3600), integrations, 30);
    const engine = new Engine(new FileStore(dir), adapter, origin, integrations); await engine.init();
    await adapter.refresh();
    const preparationStore = new PreparationFileStore(dir);
    const preparations = new PreparationManager(preparationStore, Date.now, selection => selection.source === 'demo' ? !integrations.configured : selection.source === 'music-assistant' && selection.sourceBindingId === integrations.sourceBindingId);
    const http = createApp(engine, config, 'dist/web', integrations, preparations); server.on('request', http.app);
    return { integrations, adapter, engine, http, preparationStore, preparations };
  }
  let running = await boot();
  const aborts: AbortController[] = [];
  t.after(() => { for (const abort of aborts) abort.abort(); running.http.close(); running.adapter.close(); server.closeAllConnections(); server.close(); remote.close(); });
  const request = (path: string, data?: unknown, credential = '', headers: Record<string, string> = {}) => fetch(origin + path, {
    method: data === undefined ? 'GET' : 'POST', headers: { ...(data === undefined ? {} : { Origin: origin, 'Content-Type': 'application/json' }), Cookie: credential, ...headers },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }), signal: AbortSignal.timeout(5000),
  });
  async function json<T = View>(path: string, data?: unknown, credential = ''): Promise<T> {
    const response = await request(path, data, credential); assert.equal(response.status, 200, await response.clone().text()); return response.json() as Promise<T>;
  }
  async function openStream(path: string, credential: string) {
    const abort = new AbortController(); aborts.push(abort);
    const response = await fetch(origin + path, { headers: { Cookie: credential }, signal: abort.signal }); assert.equal(response.status, 200);
    const reader = response.body!.getReader(); let buffer = ''; const decoder = new TextDecoder();
    return async () => {
      while (!buffer.includes('\n\n')) { const part = await reader.read(); if (part.done) throw new Error('Stream ended'); buffer += decoder.decode(part.value, { stream: true }); }
      const index = buffer.indexOf('\n\n'); const frame = buffer.slice(0, index); buffer = buffer.slice(index + 2); return frame;
    };
  }
  async function joinMember() {
    const joined = await request('/api/participant/join', { nickname: 'Same nickname' }); assert.equal(joined.status, 200);
    const membership = cookie(joined);
    const initialized = await request(prefix + '/init', {}, membership); assert.equal(initialized.status, 200);
    const privateCookie = cookie(initialized); const preparation = await initialized.json() as PreparationView;
    return { membership, privateCookie, credentials: `${membership}; ${privateCookie}`, preparation, cookieHeader: initialized.headers.get('set-cookie')! };
  }
  const first = await joinMember(); const second = await joinMember();
  await running.integrations.save(remote.origin, 'fixture-token', 0); await running.integrations.selectDestination('sonos:room', running.integrations.view().revision);
  await running.adapter.refresh();
  async function add(member = first) {
    const current = await json('/api/participant/state', undefined, member.membership);
    const search = await json<CatalogueSearch>('/api/participant/search', { turnId: current.turnId, query: 'fixture' }, member.membership);
    const list = await json<PreparationView>(prefix + '/state', undefined, member.privateCookie);
    const body = { operation: operation(list.revision), trackId: search.tracks[0]!.id };
    return { ...(await json<PreparationResult>(prefix + '/add', body, member.credentials)), body, search };
  }
  return { remote, dir, origin, first, second, request, json, add, openStream, get running() { return running; },
    async restart() { running.http.close(); running.adapter.close(); server.removeListener('request', running.http.app); running = await boot(); } };
}

test('saved catalogue entries/artwork survive expired references, fresh readers, and restart without exposing recording internals', async t => {
  const f = await fixture(t); const added = await f.add(); const binding = f.running.integrations.sourceBindingId;
  assert.match(f.first.cookieHeader, /HttpOnly/); assert.match(f.first.cookieHeader, /SameSite=Strict/); assert.match(f.first.cookieHeader, /Path=\/api\/participant\/preparations/);
  const descriptor = (await new PreparationFileStore(f.dir).load(added.view.ownerId))!.entries[0]!.selection;
  const text = JSON.stringify(added.view);
  for (const secret of [binding!, 'private-fixture-uri', 'recording:', 'sourceBindingId', 'image:', 'fixture-token']) assert.ok(!text.includes(secret), secret);
  // Expire both reference layers, then restore the clock before unrelated HTTP deadlines.
  const now = Date.now; Date.now = () => now() + 13 * 60 * 60_000;
  try {
    await assert.rejects(f.running.integrations.resolve(added.body.trackId, f.running.engine.catalogueContext(f.first.membership.split('=')[1]!)));
    const resolved = await f.running.integrations.resolveSaved(descriptor, 'authorized-context', `prepared:${added.entryId}`);
    assert.equal(resolved.uri, f.remote.track.uri);
  } finally { Date.now = now; }
  const writes = () => f.remote.calls.filter(call => /^(players\/cmd\/|player_queues\/(play_media|stop|pause|resume|autoplay|repeat|shuffle)$)/.test(call.command));
  const writesBefore = writes().length; await f.restart(); assert.equal(writes().length, writesBefore);
  assert.equal(f.running.integrations.sourceBindingId, binding); assert.equal(f.running.integrations.playbackAvailable, true);
  assert.deepEqual(await f.json(prefix + '/state', undefined, f.first.privateCookie), added.view);
  const retry = await f.json<PreparationResult>(prefix + '/add', added.body, f.first.credentials); assert.equal(retry.replayed, true);
  assert.equal((await f.request(added.view.upcoming[0]!.artwork!, undefined, f.first.privateCookie)).status, 200);
  assert.equal((await f.request(added.view.upcoming[0]!.artwork!, undefined, f.second.privateCookie)).status, 404);
  assert.equal((await f.request(added.view.upcoming[0]!.artwork!)).status, 401);
  const current = await f.json('/api/participant/state', undefined, f.first.membership);
  const played = await f.json<{ view: View; preparation: PreparationView }>(prefix + '/play', { turnId: current.turnId, previousPlaybackId: null, entryId: added.entryId, revision: added.view.revision }, f.first.credentials);
  assert.equal(played.preparation.played[0]!.id, added.entryId); assert.equal(played.view.ownPlayback!.track.id, `prepared:${added.entryId}`);
  const plays = f.remote.calls.filter(call => call.command === 'player_queues/play_media');
  assert.equal(plays.length, 1); assert.deepEqual(plays[0]!.args.media, [f.remote.track.uri]);
});

test('owner APIs and streams stay private across matching nicknames, recovery, device revocation and room removal', async t => {
  const f = await fixture(t);
  assert.notEqual(f.first.preparation.ownerId, f.second.preparation.ownerId);
  assert.equal((await f.request(prefix + '/state')).status, 401);
  assert.equal((await f.request(prefix + '/init', {})).status, 401);
  assert.equal((await f.request(prefix + '/move', {}, f.first.credentials, { Origin: 'https://evil.invalid' })).status, 403);
  const firstEvent = await f.openStream(prefix + '/events', f.first.privateCookie); await firstEvent();
  const otherEvent = await f.openStream(prefix + '/events', f.second.privateCookie); await otherEvent();
  const hostEvent = await f.openStream('/api/host/events', ''); await hostEvent();
  const memberEvent = await f.openStream('/api/participant/events', f.second.membership); await memberEvent();
  let events = 0; f.running.engine.on('change', () => events++);
  const added = await f.add(); assert.equal(events, 0);
  const ownFrame = await firstEvent(); assert.ok(ownFrame.includes(f.remote.track.name));
  const other = await f.add(f.second); const otherFrame = await otherEvent(); assert.ok(!otherFrame.includes(added.entryId)); assert.ok(otherFrame.includes(other.entryId));
  assert.equal(events, 0);
  f.running.engine.emit('change');
  for (const frame of [await hostEvent(), await memberEvent(), JSON.stringify(await f.json('/api/host/state'))]) {
    for (const secret of [f.remote.track.name, added.entryId, added.view.ownerId, 'upcoming', 'playCount']) assert.ok(!frame.includes(secret), secret);
  }
  assert.equal((await f.request(prefix + '/remove', { operation: operation(other.view.revision), entryId: added.entryId }, f.second.privateCookie)).status, 404);
  const current = await f.json('/api/participant/state', undefined, f.first.membership);
  assert.equal((await f.request(prefix + '/play', { entryId: other.entryId, revision: other.view.revision, turnId: current.turnId, previousPlaybackId: null }, f.second.credentials)).status, 403);
  const recovery = await f.json<{ recoveryKey: string; view: PreparationView }>(prefix + '/recovery-key', { revision: added.view.revision }, f.first.privateCookie);
  await firstEvent();
  assert.equal((await f.request(prefix + '/recover', { recoveryKey: recovery.recoveryKey }, f.second.privateCookie)).status, 409);
  const recovered = await f.request(prefix + '/recover', { recoveryKey: recovery.recoveryKey }); assert.equal(recovered.status, 200);
  const newCookie = cookie(recovered); const recoveredView = await recovered.json() as PreparationView; await firstEvent();
  assert.equal(recoveredView.upcoming[0]!.id, added.entryId);
  await f.json(prefix + '/revoke-devices', { revision: recoveredView.revision }, newCookie);
  assert.match(await firstEvent(), /event: revoked/); assert.equal((await f.request(prefix + '/state', undefined, f.first.privateCookie)).status, 401);
  const host = await f.json('/api/host/state'); await f.json('/api/host/remove', { id: host.current!.id, revision: host.revision });
  assert.equal((await f.request('/api/participant/state', undefined, f.first.membership)).status, 401);
  assert.equal((await f.json<PreparationView>(prefix + '/state', undefined, newCookie)).upcoming[0]!.id, added.entryId);
  const raw = await readFile(join(f.dir, 'preparations', `${added.view.ownerId}.json`), 'utf8'); assert.ok(!raw.includes(recovery.recoveryKey)); assert.ok(!raw.includes(newCookie.split('=')[1]!));
});

test('exact/source failures retain entries for review and never substitute or send an audio command', async t => {
  const f = await fixture(t); const added = await f.add(); const binding = f.running.integrations.sourceBindingId;
  await f.running.integrations.save(f.remote.origin, 'browser-test-token', f.running.integrations.view().revision);
  assert.equal(f.running.integrations.sourceBindingId, binding);
  f.remote.track.version = 'Different remaster';
  let view = await f.json('/api/participant/state', undefined, f.first.membership);
  assert.equal((await f.request(prefix + '/play', { entryId: added.entryId, revision: added.view.revision, turnId: view.turnId, previousPlaybackId: null }, f.first.credentials)).status, 422);
  let list = await f.json<PreparationView>(prefix + '/state', undefined, f.first.privateCookie);
  assert.equal(list.upcoming[0]!.id, added.entryId); assert.equal(list.reviewEntryId, added.entryId);
  f.remote.track.version = 'Original recording';
  list = (await f.json<PreparationResult>(prefix + '/review', { entryId: added.entryId, operation: operation(list.revision) }, f.first.privateCookie)).view;
  await f.running.integrations.clear(f.running.integrations.view().revision);
  list = await f.json<PreparationView>(prefix + '/state', undefined, f.first.privateCookie); assert.equal(list.upcoming[0]!.sourceAvailable, false);
  await f.running.integrations.save(f.remote.origin, 'fixture-token', f.running.integrations.view().revision);
  assert.notEqual(f.running.integrations.sourceBindingId, binding);
  await f.running.integrations.selectDestination('sonos:room', f.running.integrations.view().revision);
  assert.equal((await f.request(prefix + '/play', { entryId: added.entryId, revision: list.revision, turnId: view.turnId, previousPlaybackId: null }, f.first.credentials)).status, 409);
  assert.equal(f.remote.calls.filter(call => call.command === 'player_queues/play_media').length, 0);
  assert.equal((await f.json<PreparationView>(prefix + '/state', undefined, f.first.privateCookie)).upcoming.length, 1);
});

test('saved playback keeps single-track/turn/reveal guards and natural completion never autoplays another choice', async t => {
  const f = await fixture(t); const added = await f.add();
  const current = await f.json('/api/participant/state', undefined, f.first.membership);
  const command = { entryId: added.entryId, revision: added.view.revision, turnId: current.turnId, previousPlaybackId: null };
  const responses = await Promise.all([f.request(prefix + '/play', command, f.first.credentials), f.request(prefix + '/play', command, f.first.credentials)]);
  assert.deepEqual(responses.map(response => response.status).sort(), [200, 409]);
  const playing = await f.json('/api/participant/state', undefined, f.first.membership); const playbackId = playing.ownPlayback!.id;
  for (const action of ['pause', 'resume'] as const) await f.json('/api/participant/control', { turnId: current.turnId, playbackId, action }, f.first.membership);
  await f.json('/api/participant/reveal', { turnId: current.turnId, playbackId }, f.first.membership);
  assert.equal((await f.json<PreparationView>(prefix + '/state', undefined, f.first.privateCookie)).played[0]!.playCount, 1);
  f.remote.finish();
  for (let i = 0; i < 100 && f.running.engine.view({ kind: 'host' }).turnId === current.turnId; i++) await delay(10);
  assert.notEqual(f.running.engine.view({ kind: 'host' }).turnId, current.turnId);
  assert.equal(f.remote.calls.filter(call => call.command === 'player_queues/play_media').length, 1);
  assert.equal(f.running.engine.view({ kind: 'participant', credential: f.first.membership.split('=')[1]! }).ownPlayback, undefined);
});

test('a slow or failed private save cannot hold up another participant’s player or consume its command budget', async t => {
  const f = await fixture(t); const first = await f.add();
  const initial = await f.json('/api/participant/state', undefined, f.first.membership);
  const played = await f.json<{ view: View }>(prefix + '/play', { entryId: first.entryId, revision: first.view.revision, turnId: initial.turnId, previousPlaybackId: null }, f.first.credentials);
  const playbackId = played.view.ownPlayback!.id;
  await f.json('/api/participant/reveal', { turnId: initial.turnId, playbackId }, f.first.membership);
  const store = f.running.preparationStore; const save = store.save.bind(store);
  let entered!: () => void; let release!: () => void;
  const saving = new Promise<void>(resolve => { entered = resolve; }); const gate = new Promise<void>(resolve => { release = resolve; });
  store.save = async state => { if (state.ownerId === f.second.preparation.ownerId) { entered(); await gate; throw new Error('Synthetic storage failure'); } await save(state); };
  t.after(() => release());
  const pending = f.add(f.second).catch(error => error); await saving;
  const paused = await f.json('/api/participant/control', { turnId: initial.turnId, playbackId, action: 'pause' }, f.first.membership);
  assert.equal(paused.ownPlayback!.status, 'paused'); assert.equal(paused.ownPlayback!.revealed, true); assert.equal(paused.turnId, initial.turnId);
  release(); assert.ok(await pending instanceof Error);
  assert.equal(f.remote.calls.filter(call => call.command === 'player_queues/stop').length, 0);
  // Invalid saves still count against this owner's edit lane, not any transport lane.
  for (let i = 0; i < 180; i++) await f.request(prefix + '/remove', {}, f.second.privateCookie);
  assert.equal((await f.request(prefix + '/remove', {}, f.second.privateCookie)).status, 429);
  const resumed = await f.json('/api/participant/control', { turnId: initial.turnId, playbackId, action: 'resume' }, f.first.membership);
  assert.equal(resumed.ownPlayback!.status, 'playing'); assert.equal(resumed.ownPlayback!.revealed, true);
});

test('saved artwork revalidates device and source after downloads; stale access returns no private image', async t => {
  const f = await fixture(t); const first = await f.add(); const recovery = await f.json<{ recoveryKey: string; view: PreparationView }>(prefix + '/recovery-key', { revision: first.view.revision }, f.first.privateCookie);
  const recovered = await f.request(prefix + '/recover', { recoveryKey: recovery.recoveryKey }); const recoveredView = await recovered.json() as PreparationView;
  const newCookie = cookie(recovered); f.remote.delayImages(150);
  let pending = f.request(first.view.upcoming[0]!.artwork!, undefined, f.first.privateCookie);
  for (let i = 0; i < 100 && !f.remote.imageCalls.length; i++) await delay(2);
  await f.json(prefix + '/revoke-devices', { revision: recoveredView.revision }, newCookie);
  assert.equal((await pending).status, 401);
  pending = f.request(first.view.upcoming[0]!.artistArtwork!, undefined, newCookie);
  for (let i = 0; i < 100 && f.remote.imageCalls.length < 2; i++) await delay(2);
  await f.running.integrations.save(f.remote.origin, 'browser-test-token', f.running.integrations.view().revision);
  assert.equal((await pending).status, 409);
});

test('legacy connection files gain a durable source binding once without changing routing/revisions or making network requests', async t => {
  const remote = await startMusicAssistantFixture(); t.after(remote.close);
  const dir = await mkdtemp('/tmp/opencode/aoty-preparation-migrate-');
  const legacy = { schema: 1, revision: 7, musicAssistant: { url: remote.origin, accessToken: 'fixture-token', destination: { id: 'sonos:room', name: 'Living room' } } };
  await writeFile(join(dir, 'integrations.json'), JSON.stringify(legacy), { mode: 0o600 });
  const first = new IntegrationManager(new IntegrationFileStore(dir)); await first.init(); assert.ok(first.sourceBindingId);
  const second = new IntegrationManager(new IntegrationFileStore(dir)); await second.init(); assert.equal(second.sourceBindingId, first.sourceBindingId);
  assert.equal(second.view().revision, 7); assert.deepEqual(second.view().destination, legacy.musicAssistant.destination); assert.equal(remote.calls.length, 0);
});
