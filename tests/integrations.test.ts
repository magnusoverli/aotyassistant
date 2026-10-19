import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { MusicAssistantClient, isAllowedAddress, musicAssistantUrl } from '../src/music-assistant.js';
import { IntegrationManager, IntegrationFileStore, type IntegrationView } from '../src/integrations.js';
import { createApp } from '../src/http.js';
import { Engine } from '../src/engine.js';
import { FileStore } from '../src/store.js';
import { DemoAdapter } from '../src/playback.js';
import { AppError, type CatalogueTrack } from '../src/model.js';
import type { Config } from '../src/config.js';

const privateTrack = 'Never disclose this current song';
const privateArtwork = 'http://private-art.invalid/secret.jpg';
async function mockMusicAssistant() {
  const calls: { command: string; args: Record<string, unknown>; authorization: string }[] = [];
  let mode: 'normal' | 'redirect' | 'bad-shape' | 'old-schema' | 'huge' | 'slow' | 'offline-player' | 'missing-player' | 'no-queue' | 'unavailable-queue' | 'echo-token' | 'search-empty' | 'multi-provider' = 'normal';
  const server = createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (mode === 'slow') return;
    if (mode === 'redirect') { res.writeHead(302, { Location: 'http://127.0.0.1:9/steal' }); res.end(); return; }
    if (mode === 'huge') { res.end('x'.repeat(2 * 1024 * 1024 + 1)); return; }
    if (req.url === '/info') { res.end(JSON.stringify({ server_version: '2.mock', schema_version: mode === 'old-schema' ? 27 : 46, min_supported_schema_version: 28 })); return; }
    if (req.url === '/api-docs') { res.setHeader('Content-Type', 'text/html'); res.end('<h1>Mock generated API docs</h1>'); return; }
    if (req.url === '/ws') { res.writeHead(404); res.end(); return; }
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw); calls.push({ command: body.command, args: body.args, authorization: req.headers.authorization ?? '' });
    if (req.headers.authorization === 'Bearer bad-token') { res.statusCode = 401; res.end('bad-token and secret upstream details'); return; }
    if (mode === 'bad-shape') { res.end(JSON.stringify({ result: [], privateTrack })); return; }
    if (body.command === 'players/all') {
      res.end(JSON.stringify([
        { player_id: 'sonos:living', name: mode === 'echo-token' ? 'fixture-token' : 'Living room', available: mode !== 'offline-player', current_media: { title: privateTrack, artwork: privateArtwork } },
        { player_id: 'sonos:group', name: 'Whole house', available: true },
        { player_id: 'sonos:offline', name: 'Offline speaker', available: false },
      ].filter(player => mode !== 'missing-player' || player.player_id !== 'sonos:living')));
    } else if (body.command === 'player_queues/get_active_queue') {
      res.end(JSON.stringify(mode === 'no-queue' ? null : { queue_id: 'group-queue', available: mode !== 'unavailable-queue', current_item: { name: privateTrack, image: privateArtwork }, next_item: { name: 'Secret next song' } }));
    } else if (body.command === 'music/search') {
      const base = { item_id: 'same-recording', provider: 'spotify', name: 'Search result', uri: 'spotify://track/private-original-uri', artists: [{ name: 'Search artist' }],
        album: { name: 'Search album' }, provider_mappings: [{ available: true }], metadata: { images: [{ path: privateArtwork }] } };
      const tracks = mode === 'multi-provider' ? ['spotify', 'tidal', 'filesystem'].map(provider => ({ ...base, provider, uri: `${provider}://track/same-recording` })) : [
        { ...base, duration: 200, version: 'Studio' }, { ...base, duration: 0, version: 'Live', is_playable: false },
      ];
      res.end(JSON.stringify({ tracks: mode === 'search-empty' ? [] : tracks, playlists: [{ name: 'Private playlist that must not be returned' }] }));
    } else { res.statusCode = 400; res.end('Unexpected command'); }
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { origin, calls, setMode(value: typeof mode) { mode = value; }, close() { server.closeAllConnections(); server.close(); } };
}

test('read-only HTTP API uses direct results, strips queue metadata, and never sends playback commands', async t => {
  const mock = await mockMusicAssistant(); t.after(mock.close);
  const client = new MusicAssistantClient(mock.origin, 'fixture-token');
  const report = await client.inspect(); assert.equal(report.docsAvailable, true); assert.equal(report.players.length, 3);
  assert.equal(await client.activeQueue('sonos:group'), 'group-queue');
  assert.deepEqual(mock.calls.map(c => c.command), ['players/all', 'player_queues/get_active_queue']);
  assert.ok(mock.calls.every(c => c.authorization === 'Bearer fixture-token'));
  const json = JSON.stringify(report);
  for (const secret of [privateTrack, privateArtwork, 'fixture-token', 'current_media', 'next_item']) assert.ok(!json.includes(secret));
  mock.setMode('echo-token'); assert.ok(!JSON.stringify(await client.inspect()).includes('fixture-token'));
});

test('checked hostname requests use pinned DNS addresses with IPv4/IPv6 fallback', async t => {
  const mock = await mockMusicAssistant(); t.after(mock.close);
  const client = new MusicAssistantClient(mock.origin.replace('127.0.0.1', 'localhost'), 'fixture-token');
  assert.equal((await client.inspect()).players.length, 3);
});

test('client fails clearly on auth, schemas, malformed results, redirects, oversized responses, and deadlines', async t => {
  const mock = await mockMusicAssistant(); t.after(mock.close);
  await assert.rejects(new MusicAssistantClient(mock.origin, 'bad-token').inspect(), error => error instanceof AppError && !error.message.includes('bad-token') && error.message.includes('rejected'));
  for (const mode of ['old-schema', 'bad-shape', 'redirect', 'huge', 'slow'] as const) {
    mock.setMode(mode);
    await assert.rejects(new MusicAssistantClient(mock.origin, 'fixture-token', 100).inspect(), error => error instanceof AppError && !error.message.includes(privateTrack));
  }
  mock.setMode('no-queue');
  await assert.rejects(new MusicAssistantClient(mock.origin, 'fixture-token').activeQueue('sonos:group'), error => error instanceof AppError && error.status === 422);
});

test('network boundary permits private LAN/loopback and rejects metadata/public/ambiguous origins', async () => {
  for (const allowed of ['127.0.0.1', '192.168.1.20', '10.0.0.5', '172.18.0.2', '::1', 'fd12::1', '::ffff:192.168.1.20']) assert.equal(isAllowedAddress(allowed), true);
  for (const blocked of ['169.254.169.254', '0.0.0.0', '8.8.8.8', '224.0.0.1', 'fe80::1', '2001:4860:4860::8888', '::', '::ffff:169.254.169.254']) assert.equal(isAllowedAddress(blocked), false);
  for (const url of ['ftp://localhost', 'http://user:password@localhost', 'http://localhost/path', 'http://localhost/?token=secret', 'http://localhost/#token=secret', 'http://supervisor']) assert.equal(musicAssistantUrl.safeParse(url).success, false);
  await assert.rejects(new MusicAssistantClient('http://169.254.169.254', 'fixture-token').inspect(), error => error instanceof AppError && error.status === 422);
});

test('frontend settings persist privately, never return tokens, and require a new token when changing origin', async t => {
  const mock = await mockMusicAssistant(); t.after(mock.close);
  const directory = await mkdtemp('/tmp/opencode/aoty-integrations-'); const store = new IntegrationFileStore(directory);
  const manager = new IntegrationManager(store); await manager.init();
  assert.equal(manager.view().status, 'not-configured');
  assert.equal(manager.view().destinationStatus, 'not-selected');
  await manager.save(mock.origin, 'fixture-token', 0);
  assert.equal(manager.view().status, 'not-checked'); assert.equal(manager.view().tokenConfigured, true); assert.equal(mock.calls.length, 0);
  let view = await manager.check(manager.view().revision);
  assert.equal(view.status, 'checked'); assert.equal(view.playbackAvailable, false);
  assert.equal(view.destinationStatus, 'not-selected');
  view = await manager.selectDestination('sonos:group', view.revision);
  assert.deepEqual(view.destination, { id: 'sonos:group', name: 'Whole house' });
  assert.equal(view.destinationStatus, 'checked');
  for (const secret of ['fixture-token', privateTrack, privateArtwork, 'group-queue']) assert.ok(!JSON.stringify(view).includes(secret));
  assert.equal((await stat(join(directory, 'integrations.json'))).mode & 0o777, 0o600);
  const restored = new IntegrationManager(store); await restored.init();
  assert.deepEqual(restored.view().destination, view.destination); assert.equal(restored.view().status, 'not-checked');
  assert.equal(restored.view().destinationStatus, 'not-checked');
  await assert.rejects(restored.save('http://localhost:8095', undefined, view.revision), error => error instanceof AppError && error.status === 400);
  await restored.save(mock.origin, undefined, view.revision);
  assert.equal(restored.view().tokenConfigured, true);
  const oldRevision = restored.view().revision;
  const race = await Promise.allSettled([restored.save(mock.origin, 'replacement-one', oldRevision), restored.save(mock.origin, 'replacement-two', oldRevision)]);
  assert.equal(race.filter(r => r.status === 'fulfilled').length, 1);
  await restored.clear(restored.view().revision);
  assert.equal(restored.view().tokenConfigured, false); assert.equal(restored.view().destination, null);
  assert.ok(!(await readFile(join(directory, 'integrations.json'), 'utf8')).includes('replacement'));
});

test('failed saved destination can be replaced without discarding a valid token; auth failure clears inventory', async t => {
  const mock = await mockMusicAssistant(); t.after(mock.close);
  const manager = new IntegrationManager(new IntegrationFileStore(await mkdtemp('/tmp/opencode/aoty-integrations-'))); await manager.init();
  await manager.save(mock.origin, 'fixture-token', 0); await manager.check(manager.view().revision);
  await assert.rejects(manager.selectDestination('sonos:offline', manager.view().revision));
  await manager.selectDestination('sonos:living', manager.view().revision);
  mock.setMode('offline-player'); let view = await manager.check(manager.view().revision);
  assert.equal(view.status, 'checked'); assert.equal(view.destinationStatus, 'error'); assert.ok(view.report);
  assert.match(view.destinationMessage, /speaker is unavailable/); assert.doesNotMatch(view.message, /speaker|unavailable/);
  view = await manager.selectDestination('sonos:group', view.revision); assert.equal(view.status, 'checked');
  await manager.save(mock.origin, 'bad-token', view.revision); view = await manager.check(manager.view().revision);
  assert.equal(view.status, 'error'); assert.equal(view.report, null); assert.equal(view.destinationStatus, 'not-checked');
  assert.ok(!JSON.stringify(view).includes('bad-token'));
});

test('missing speakers and failed queue checks cannot mark a healthy Music Assistant connection as broken, and checks recover independently', async t => {
  const mock = await mockMusicAssistant(); t.after(mock.close);
  const manager = new IntegrationManager(new IntegrationFileStore(await mkdtemp('/tmp/opencode/aoty-speaker-health-'))); await manager.init();
  t.after(() => manager.close());
  await manager.save(mock.origin, 'fixture-token', 0); await manager.selectDestination('sonos:living', 1);
  const revision = manager.view().revision;
  for (const mode of ['missing-player', 'no-queue', 'unavailable-queue', 'normal'] as const) {
    mock.setMode(mode); const view = await manager.check(revision);
    assert.equal(view.status, 'checked'); assert.equal(view.destinationStatus, mode === 'normal' ? 'checked' : 'error');
    assert.doesNotMatch(view.message, /speaker|queue/);
    if (mode !== 'normal') assert.match(view.destinationMessage, mode === 'missing-player' ? /speaker is unavailable/ : /queue could not be checked/);
  }
  mock.setMode('no-queue'); await assert.rejects(manager.selectDestination('sonos:group', revision), /speaker’s queue/);
  assert.equal(manager.view().status, 'checked'); assert.equal(manager.view().destinationStatus, 'checked');
  assert.equal(manager.view().destination!.id, 'sonos:living', 'A failed candidate must not replace the saved speaker.');
  await assert.rejects(manager.selectDestination('sonos:living', revision), /speaker’s queue/);
  assert.equal(manager.view().status, 'checked'); assert.equal(manager.view().destinationStatus, 'error');
  mock.setMode('normal'); await manager.check(revision);
  await manager.saveGuestOrigin('http://localhost:4000', revision);
  assert.equal(manager.view().status, 'checked'); assert.equal(manager.view().destinationStatus, 'checked');
  assert.ok(mock.calls.every(call => ['players/all', 'player_queues/get_active_queue'].includes(call.command)));
});

test('a Music Assistant authentication failure while selecting a speaker stays a connection error, never a speaker diagnosis', async t => {
  const mock = await mockMusicAssistant(); t.after(mock.close);
  const manager = new IntegrationManager(new IntegrationFileStore(await mkdtemp('/tmp/opencode/aoty-connection-health-'))); await manager.init();
  t.after(() => manager.close());
  await manager.save(mock.origin, 'fixture-token', 0); await manager.selectDestination('sonos:living', 1);
  await manager.save(mock.origin, 'bad-token', manager.view().revision);
  await assert.rejects(manager.selectDestination('sonos:group', manager.view().revision), /rejected the token/);
  const view = manager.view(); assert.equal(view.status, 'error'); assert.equal(view.destinationStatus, 'not-checked');
  assert.equal(view.report, null); assert.match(view.destinationMessage, /cannot be checked/); assert.doesNotMatch(JSON.stringify(view), /bad-token/);
});

test('a delayed speaker-check failure cannot mark a replacement connection or its speaker as unhealthy', async t => {
  let enter!: () => void; let release!: () => void; let held = false;
  const entered = new Promise<void>(resolve => { enter = resolve; }); const gate = new Promise<void>(resolve => { release = resolve; }); t.after(() => release());
  const manager = new IntegrationManager(new IntegrationFileStore(await mkdtemp('/tmp/opencode/aoty-speaker-health-race-')), () => ({
    async inspect() { return { checkedAt: Date.now(), serverVersion: 'fixture', schemaVersion: 65, docsAvailable: true, players: [{ id: 'speaker', name: 'Speaker', available: true }] }; },
    async activeQueue() { if (held) { enter(); await gate; throw new Error('PRIVATE obsolete speaker error'); } return 'queue'; },
    async search() { return []; },
  }));
  await manager.init(); await manager.save('http://localhost:8095', 'old-token', 0); await manager.selectDestination('speaker', 1);
  held = true; const checking = assert.rejects(manager.check(2), error => error instanceof AppError && error.status === 409); await entered;
  await manager.save('http://localhost:8095', 'new-token', 2); release(); await checking;
  const view = manager.view(); assert.equal(view.status, 'not-checked'); assert.equal(view.destinationStatus, 'not-checked');
  assert.equal(view.report, null); assert.doesNotMatch(JSON.stringify(view), /PRIVATE|obsolete/);
});

test('malformed integration files fail startup without losing stored data', async () => {
  const directory = await mkdtemp('/tmp/opencode/aoty-integrations-'); await writeFile(join(directory, 'integrations.json'), 'broken');
  await assert.rejects(new IntegrationFileStore(directory).load());
  assert.equal(await readFile(join(directory, 'integrations.json'), 'utf8'), 'broken');
});

test('HTTP integration endpoints use explicit open-host routes with sanitization, validation, and same-origin checks', async t => {
  const mock = await mockMusicAssistant(); t.after(mock.close);
  const server = createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const port = (server.address() as AddressInfo).port; const origin = `http://127.0.0.1:${port}`;
  const config: Config = { port, guestUrl: origin, listenHost: '127.0.0.1', dataDir: await mkdtemp('/tmp/opencode/aoty-integration-http-'), mode: 'demo', demoSeconds: 30 };
  const manager = new IntegrationManager(new IntegrationFileStore(config.dataDir)); await manager.init();
  const adapter = new DemoAdapter(); const engine = new Engine(new FileStore(config.dataDir), adapter, origin, manager); await engine.init();
  const { app, close } = createApp(engine, config, 'web', manager); server.on('request', app);
  t.after(() => { close(); adapter.close(); server.closeAllConnections(); server.close(); });
  const request = (path: string, data?: unknown, requestOrigin = origin) => fetch(`${origin}${path}`, {
    method: data === undefined ? 'GET' : 'POST', headers: data === undefined ? {} : { Origin: requestOrigin, 'Content-Type': 'application/json' },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  });
  assert.equal((await request('/api/host/integrations/save', { url: mock.origin, accessToken: 'fixture-token', revision: 0 }, 'http://evil.test')).status, 403);
  assert.equal((await request('/api/host/integrations/save', { url: mock.origin, accessToken: 'fixture-token', revision: 0, extra: true })).status, 400);
  for (const role of ['participant', 'display']) assert.equal((await request(`/api/${role}/integrations`)).status, 404);
  const saved = await request('/api/host/integrations/save', { url: mock.origin, accessToken: 'fixture-token', revision: 0 });
  assert.equal(saved.status, 200); assert.equal(saved.headers.get('cache-control'), 'no-store');
  const data = await saved.json() as IntegrationView;
  const checked = await request('/api/host/integrations/check', { revision: data.revision });
  const payload = await checked.text(); assert.ok(!payload.includes('fixture-token')); assert.ok(!payload.includes(privateTrack));
  assert.equal((await request('/api/host/integrations/destination', { id: 'sonos:group', revision: data.revision })).status, 200);
  assert.equal((await request('/api/host/integrations/clear', { revision: data.revision })).status, 409);
  for (const enabled of [true, false]) assert.equal((await request('/api/host/integrations/playback', { enabled, revision: data.revision })).status, 404);
  assert.deepEqual(mock.calls.map(c => c.command), ['players/all', 'players/all', 'player_queues/get_active_queue']);
});

test('catalogue search uses bounded track-only requests and preserves recording versions without exposing full objects', async t => {
  const mock = await mockMusicAssistant(); t.after(mock.close);
  const client = new MusicAssistantClient(mock.origin, 'fixture-token');
  const tracks = await client.search('Search title');
  assert.deepEqual(mock.calls[0]!.args, { search_query: 'Search title', media_types: ['track'], limit: 20 });
  assert.equal(tracks.length, 2); assert.notEqual(tracks[0]!.id, tracks[1]!.id);
  assert.equal(tracks[0]!.version, 'Studio'); assert.equal(tracks[1]!.version, 'Live');
  assert.equal(tracks[0]!.available, true); assert.equal(tracks[1]!.available, false); assert.equal(tracks[1]!.duration, null);
  for (const sensitive of ['fixture-token', privateArtwork, 'spotify://', 'Private playlist', 'metadata']) assert.ok(!JSON.stringify(tracks).includes(sensitive));
  mock.setMode('search-empty'); assert.deepEqual(await client.search('missing'), []);
  mock.setMode('bad-shape'); await assert.rejects(client.search('query'), error => error instanceof AppError && error.message.includes('search response'));
  mock.setMode('normal'); await assert.rejects(new MusicAssistantClient(mock.origin, 'bad-token').search('query'), error => error instanceof AppError && error.message.includes('rejected'));
});

test('changing connection settings during an in-flight search discards the old results', async () => {
  let resolveSearch!: (tracks: CatalogueTrack[]) => void;
  const manager = new IntegrationManager(new IntegrationFileStore(await mkdtemp('/tmp/opencode/aoty-search-race-')), () => ({
    async inspect() { throw new Error('Not used'); }, async activeQueue() { return 'unused'; },
    search: () => new Promise(resolve => { resolveSearch = resolve; }),
  }));
  await manager.init(); await manager.save('http://localhost:8095', 'old-token', 0);
  const result = manager.search('query'); await manager.save('http://localhost:8095', 'new-token', manager.view().revision);
  resolveSearch([]); await assert.rejects(result, error => error instanceof AppError && error.status === 409);
});

test('slow coalesced discovery does not block settings and cannot publish an old connection report', async () => {
  let entered!: () => void; let release!: () => void; let inspections = 0;
  const waiting = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const manager = new IntegrationManager(new IntegrationFileStore(await mkdtemp('/tmp/opencode/aoty-discovery-race-')), () => ({
    async inspect() { inspections++; entered(); await gate; return { checkedAt: Date.now(), serverVersion: 'old-server', schemaVersion: 65, docsAvailable: true, players: [] }; },
    async activeQueue() { return 'queue'; }, async search() { return []; },
  }));
  await manager.init(); await manager.save('http://localhost:8095', 'old-token', 0);
  const first = manager.check(1); const second = manager.check(1);
  const results = Promise.allSettled([first, second]); await waiting;
  try {
    await manager.save('http://localhost:8095', 'new-token', 1);
    assert.equal(manager.view().revision, 2);
  } finally { release(); }
  const outcomes = await results;
  assert.ok(outcomes.every(result => result.status === 'rejected' && result.reason instanceof AppError && result.reason.status === 409));
  assert.equal(inspections, 1); assert.equal(manager.view().report, null);
});

test('global catalogue search includes Spotify, Tidal, and local-file providers without service-specific filtering', async t => {
  const mock = await mockMusicAssistant(); t.after(mock.close); mock.setMode('multi-provider');
  const tracks = await new MusicAssistantClient(mock.origin, 'fixture-token').search('query');
  assert.deepEqual(tracks.map(t => t.provider), ['spotify', 'tidal', 'filesystem']);
  assert.equal(new Set(tracks.map(t => t.id)).size, 3);
  assert.equal(mock.calls[0]!.args.providers, undefined);
  assert.deepEqual(mock.calls[0]!.args.media_types, ['track']);
});

test('slow destination discovery leaves the command lane available and cannot commit over newer settings', async t => {
  let enter!: () => void; let release!: () => void;
  const entered = new Promise<void>(resolve => { enter = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; }); t.after(() => release());
  const manager = new IntegrationManager(new IntegrationFileStore(await mkdtemp('/tmp/opencode/aoty-select-race-')), () => ({
    async inspect() { enter(); await gate; return { checkedAt: Date.now(), serverVersion: 'old-server', schemaVersion: 65, docsAvailable: true, players: [{ id: 'speaker', name: 'Speaker', available: true }] }; },
    async activeQueue() { return 'queue'; }, async search() { return []; },
  }));
  await manager.init(); await manager.save('http://localhost:8095', 'old-token', 0);
  const selecting = assert.rejects(manager.selectDestination('speaker', 1), error => error instanceof AppError && error.status === 409);
  await entered;
  let timeout: NodeJS.Timeout | undefined;
  try {
    await Promise.race([manager.save('http://localhost:8095', 'new-token', 1), new Promise<never>((_, reject) => {
      timeout = setTimeout(() => reject(new Error('Discovery blocked the command lane.')), 1000);
    })]);
  } finally { clearTimeout(timeout); release(); }
  await selecting;
  assert.equal(manager.view().revision, 2); assert.equal(manager.view().destination, null); assert.equal(manager.view().report, null);
});
