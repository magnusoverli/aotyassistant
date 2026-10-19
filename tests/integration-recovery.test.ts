import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { IntegrationManager, IntegrationFileStore } from '../src/integrations.js';
import { MusicAssistantClient } from '../src/music-assistant.js';
import { SetupManager } from '../src/setup.js';
import { discoverServers, type ServerInfo } from '../src/ma-discovery.js';
import { AppError } from '../src/model.js';
import { startMusicAssistantFixture } from './fixtures/music-assistant.js';

async function directory(t: TestContext) {
  const dir = await mkdtemp('/tmp/opencode/aoty-integration-recovery-'); t.after(() => rm(dir, { recursive: true, force: true })); return dir;
}
async function eventually(check: () => boolean) {
  for (let i = 0; i < 250; i++) { if (check()) return; await delay(10); }
  assert.ok(check(), 'Expected integration recovery');
}

test('manual same-server address changes retain exact saved selections and speaker across restart; replacements require disconnect', async t => {
  const remote = await startMusicAssistantFixture(); const other = await startMusicAssistantFixture(); t.after(remote.close); t.after(other.close);
  const store = new IntegrationFileStore(await directory(t)); const manager = new IntegrationManager(store); t.after(() => manager.close()); await manager.init();
  await manager.save(remote.origin, 'fixture-token', 0); await manager.check(1); await manager.selectDestination('sonos:room', 1);
  const track = (await manager.search('fixture', 'owner'))[0]!; const saved = await manager.captureSaved(track.id, 'owner');
  const binding = manager.sourceBindingId; const destination = manager.view().destination; const revision = manager.view().revision;
  const moved = remote.origin.replace('127.0.0.1', 'localhost');
  await assert.rejects(manager.save(moved, undefined, revision), /old token cannot be reused/);
  await manager.save(moved, 'browser-test-token', revision);
  assert.equal(manager.sourceBindingId, binding); assert.deepEqual(manager.view().destination, destination); assert.equal(manager.view().browserUrl, moved);
  assert.equal((await manager.resolveSaved(saved, 'owner', 'saved-entry')).uri, remote.track.uri);
  const restored = new IntegrationManager(store); t.after(() => restored.close()); await restored.init();
  assert.equal(restored.sourceBindingId, binding); assert.deepEqual(restored.view().destination, destination);
  assert.equal((await restored.resolveSaved(saved, 'owner', 'saved-entry')).uri, remote.track.uri);
  const before = await store.load();
  await assert.rejects(manager.save(other.origin, 'fixture-token', manager.view().revision), /different Music Assistant server/);
  await assert.rejects(manager.save('http://127.0.0.1:1', 'fixture-token', manager.view().revision), /Cannot connect/);
  await assert.rejects(manager.save(remote.origin, 'bad-token', manager.view().revision), /rejected the token/);
  assert.deepEqual(await store.load(), before);
  assert.ok(remote.calls.every(call => ['players/all', 'player_queues/get_active_queue', 'music/search', 'music/item_by_uri'].includes(call.command)));
});

test('slow address validation leaves the command lane free and cannot overwrite newer settings or owned playback', async t => {
  let enter!: () => void; let release!: () => void; let gate: Promise<void> | undefined;
  let owned = false;
  const manager = new IntegrationManager(new IntegrationFileStore(await directory(t)), () => ({
    async inspect() { enter?.(); await gate; return { serverId: 'same', checkedAt: Date.now(), serverVersion: 'fixture', schemaVersion: 65, docsAvailable: false, players: [] }; },
    async activeQueue() { return 'queue'; }, async search() { return []; },
  })); t.after(() => manager.close()); await manager.init();
  manager.attachPlayback({ get ownsPlayback() { return owned; }, issue: '', configurationChanged() {}, async recover() {} });
  await manager.save('http://old.local:8095', 'token', 0); await manager.check(1);
  for (const conflict of ['settings', 'playback'] as const) {
    const entered = new Promise<void>(resolve => { enter = resolve; }); gate = new Promise(resolve => { release = resolve; });
    const moving = assert.rejects(manager.save('http://new.local:8095', 'new-token', manager.view().revision), conflict === 'settings' ? /settings changed/ : /Stop or finish/);
    await entered;
    if (conflict === 'settings') await manager.saveGuestOrigin('http://party.local:3000', manager.view().revision);
    else owned = true;
    release(); await moving; owned = false;
    assert.equal(manager.view().url, 'http://old.local:8095');
  }
});

async function recoveryFixture(t: TestContext) {
  const dir = await directory(t);
  const info: ServerInfo = { server_id: 'stable-server', server_version: '2.10.6', schema_version: 65, min_supported_schema_version: 28, onboard_done: true };
  let address = '192.168.1.10'; let online = true; let mdns: string[] = []; let enumerate = true; let scans = 0; let owned = false;
  const calls: { url: string; command?: string; token: string }[] = []; const mediaChecks: string[] = [];
  const current = () => `http://${address}:8095`;
  const readInfo = async (url: string) => { if (!online || url !== current()) throw new AppError(502, 'Cannot connect'); return info; };
  const manager = new IntegrationManager(new IntegrationFileStore(dir), (url, token) => new MusicAssistantClient(url, token, 100, {
    async read(path, command, args) {
      calls.push({ url, command, token }); await readInfo(url);
      if (path === '/info') return info;
      if (command === 'players/all') return [{ player_id: 'speaker', name: 'Speaker', available: true }];
      if (command === 'player_queues/get_active_queue') return { queue_id: 'queue', available: true };
      if (command === 'music/item_by_uri') {
        const uri = (args as { uri: string }).uri;
        return { item_id: uri.slice('builtin://track/'.length), uri, provider: 'builtin', name: 'Diagnostic', duration: 3, is_playable: true, provider_mappings: [{ available: true }] };
      }
      throw new Error(`Unexpected fixture command ${command}`);
    },
  })); await manager.init(); t.after(() => manager.close());
  manager.attachUploads({} as never, 'http://party.local:3000');
  manager.attachPlayback({ get ownsPlayback() { return owned; }, issue: '', configurationChanged() {}, async recover() {} });
  manager.attachMediaChecks({ create(origin: string) { mediaChecks.push(origin); return { url: `${origin}/check.wav`, observed: true, revoke() {} }; } } as never);
  await manager.saveAuthorized(current(), 'saved-token', info.server_id, current(), 0); await manager.selectDestination('speaker', 1);
  const supervisor = { async read(path: string) {
    if (path === '/addons/self/info') return { hostname: 'aoty-internal', ip_address: '172.30.33.5', network: { '3000/tcp': 4000 } };
    if (path === '/network/info') return { interfaces: [{ primary: true, ipv4: { address: [`${address}/24`] } }] };
    if (path === '/supervisor/info') return enumerate ? { addons: [{ slug: 'official_music_assistant' }] } : {};
    if (path === '/addons/official_music_assistant/info') return { state: 'started', discovery: ['music_assistant'], host_network: true };
    return {};
  } };
  const config = { port: 3000, listenHost: '127.0.0.1', guestUrl: 'http://party.local:3000', guestOverride: true, addon: true, dataDir: dir, mode: 'demo' as const, demoSeconds: 30 };
  const setup = new SetupManager(config, manager, () => assert.fail('Saved guest origin changed'), supervisor, async () => mdns,
    async origins => { scans++; return discoverServers(origins, readInfo); }, { retryMs: 10, maxRetryMs: 20, refreshMs: 60, minimumMs: 1, jitter: () => 1 });
  t.after(() => setup.close());
  return { manager, setup, calls, mediaChecks, current, get scans() { return scans; },
    online(value: boolean) { online = value; }, move(value: string) { address = value; }, mdns(value: string[]) { mdns = value; }, enumerate(value: boolean) { enumerate = value; }, own(value: boolean) { owned = value; } };
}

test('runtime discovery continues beyond startup retries and verifies media when MA finally returns', async t => {
  const f = await recoveryFixture(t); f.online(false); f.setup.start(); f.setup.start();
  await eventually(() => f.scans >= 7);
  assert.equal(f.manager.view().status, 'error'); assert.equal(f.mediaChecks.length, 0);
  f.online(true); await eventually(() => f.manager.view().status === 'checked' && f.manager.addressing().mediaCheck.status === 'verified');
  assert.equal(f.manager.output.state, 'ready'); assert.equal(f.setup.view().status, 'ready');
  assert.ok(f.calls.every(call => !call.command || ['players/all', 'player_queues/get_active_queue', 'music/item_by_uri'].includes(call.command)));
  f.setup.close(); const scans = f.scans; await delay(80); assert.equal(f.scans, scans);
});

test('healthy periodic discovery relocates the same trusted server, updates browser login, and preserves guest/media overrides', async t => {
  const f = await recoveryFixture(t);
  await f.manager.saveMediaOrigin('http://manual-media.local:3000', f.manager.view().revision);
  f.setup.start(); await eventually(() => f.setup.view().status === 'ready');
  const binding = f.manager.sourceBindingId; const destination = f.manager.view().destination; const checks = f.mediaChecks.length;
  f.move('192.168.1.11');
  await eventually(() => f.manager.view().url === f.current() && f.manager.addressing().mediaCheck.status === 'verified');
  assert.equal(f.manager.view().browserUrl, f.current()); assert.equal(f.manager.sourceBindingId, binding); assert.deepEqual(f.manager.view().destination, destination);
  assert.equal(f.manager.guestOrigin, 'http://party.local:3000'); assert.equal(f.manager.addressing().mediaOrigin, 'http://manual-media.local:3000');
  assert.ok(f.mediaChecks.length > checks); assert.ok(f.mediaChecks.every(origin => origin === 'http://manual-media.local:3000'));
});

test('an output-monitor reconnection triggers media verification even when the previous check is still fresh', async t => {
  const f = await recoveryFixture(t); f.setup.start();
  await eventually(() => f.manager.addressing().mediaCheck.status === 'verified');
  const checks = f.mediaChecks.length;
  f.online(false); await f.manager.check(f.manager.view().revision); assert.equal(f.manager.view().status, 'error');
  f.online(true); await f.manager.check(f.manager.view().revision); assert.equal(f.manager.view().status, 'checked');
  await eventually(() => f.mediaChecks.length > checks && f.manager.addressing().mediaCheck.status === 'verified');
});

test('concurrent discovery requests share one scan and closing during discovery prevents later configuration work', async t => {
  const manager = new IntegrationManager(new IntegrationFileStore(await directory(t))); await manager.init(); t.after(() => manager.close());
  let release!: () => void; let enter!: () => void; let scans = 0;
  const entered = new Promise<void>(resolve => { enter = resolve; }); const gate = new Promise<void>(resolve => { release = resolve; });
  const setup = new SetupManager({ port: 3000, listenHost: '127.0.0.1', guestUrl: 'http://party.local:3000', dataDir: '', mode: 'demo', demoSeconds: 30 }, manager,
    () => assert.fail('Unexpected guest change'), undefined, async () => [], async () => { scans++; enter(); await gate; return []; },
    { retryMs: 10, maxRetryMs: 20, refreshMs: 60, minimumMs: 1 });
  t.after(() => { release(); setup.close(); });
  setup.start(); await entered;
  const reads = [setup.refresh(), setup.refresh()]; assert.equal(scans, 1);
  setup.close(); release(); await Promise.all(reads); await delay(50);
  assert.equal(scans, 1); assert.equal(manager.view().revision, 0);
});

test('mDNS suggestions cannot receive saved tokens, and automatic relocation waits for playback to finish', async t => {
  const f = await recoveryFixture(t); const old = f.current();
  f.setup.start(); await eventually(() => f.setup.view().status === 'ready');
  f.enumerate(false); f.move('192.168.1.12'); f.mdns([f.current()]);
  const before = f.scans; await eventually(() => f.scans >= before + 2);
  assert.equal(f.manager.view().url, old); assert.ok(!f.calls.some(call => call.url === f.current()));
  f.enumerate(true); f.own(true); const blocked = f.scans; await eventually(() => f.scans >= blocked + 2);
  assert.equal(f.manager.view().url, old); assert.ok(!f.calls.some(call => call.url === f.current()));
  f.own(false); await eventually(() => f.manager.view().url === f.current());
});

test('unsupported playback schema is independent of healthy speaker/queue checks and never authorizes playback', async t => {
  const remote = await startMusicAssistantFixture(); t.after(remote.close);
  const manager = new IntegrationManager(new IntegrationFileStore(await directory(t))); t.after(() => manager.close()); await manager.init();
  manager.attachPlayback({ ownsPlayback: false, issue: '', configurationChanged() {}, async recover() {} });
  await manager.save(remote.origin, 'fixture-token', 0); await manager.selectDestination('sonos:room', 1);
  remote.info.schema_version = 66; await manager.check(manager.view().revision);
  const view = manager.view(); assert.equal(view.status, 'checked'); assert.equal(view.destinationStatus, 'checked');
  assert.equal(view.output.state, 'incompatible'); assert.equal(view.output.reason, 'unsupported-schema'); assert.equal(view.playbackAvailable, false);
  assert.equal(view.report?.players.find(player => player.id === 'sonos:room')?.available, true);
  assert.equal(view.compatibility?.schemaVersion, 66); assert.match(view.compatibility!.message, /schema 66.*schema 65.*Update Albums of the Year/);
  const client = new MusicAssistantClient(remote.origin, 'fixture-token'); t.after(() => client.close());
  await assert.rejects(client.playbackCapability('sonos:room'), /requires the verified/);
  remote.info.schema_version = 65; await manager.check(manager.view().revision); assert.equal(manager.playbackAvailable, true);
  assert.equal(remote.calls.some(call => /play_media|cmd\//.test(call.command)), false);
});
