import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { EventEmitter } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import type WebSocket from 'ws';
import { RoomVisualizer, type VisualizerTarget } from '../src/room-visualizer.js';
import { createVisualizerClient, visualizerIdentity, type VisualizerClient, type VisualizerClientConfig, type VisualizerChunk } from '../src/sendspin-server.js';
import { publicRoute } from '../src/public-listener.js';

class Socket extends EventEmitter { terminated = false; terminate() { this.terminated = true; } ping() {} }
class Client implements VisualizerClient {
  isConnected = false;
  timeSyncInfo = { synced: true };
  _timeFilter = { computeClientTime: (time: number) => time };
  onAudioData: VisualizerClient['onAudioData']; onStreamStart: VisualizerClient['onStreamStart'];
  onStreamClear: VisualizerClient['onStreamClear']; onStreamEnd: VisualizerClient['onStreamEnd']; onConnectionClose: VisualizerClient['onConnectionClose'];
  clientId: string; pairingToken: string;
  constructor(readonly config: VisualizerClientConfig) {
    const identity = visualizerIdentity(config.storage); this.clientId = identity.clientId; this.pairingToken = identity.pairingToken!;
  }
  async connect() { this.isConnected = true; }
  disconnect() { this.isConnected = false; }
  audio() {
    const start = performance.now() * 1000;
    this.onAudioData?.({ samples: [Float32Array.from({ length: 48000 }, (_, i) => .8 * Math.sin(2 * Math.PI * 1000 * i / 48000))],
      sampleRate: 48000, serverTimeUs: start, generation: 1 });
  }
}
async function eventually(check: () => boolean) {
  const deadline = Date.now() + 3000;
  while (!check() && Date.now() < deadline) await delay(10);
  assert.ok(check());
}
async function fixture(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), 'room-visualizer-'));
  const target: VisualizerTarget = { roomId: 'room', participantId: 'person', playbackId: 'song', playing: false, destination: 'sonos-group' };
  let receiverQueue = 'sonos-group'; const clients: Client[] = []; const sockets: Socket[] = []; const commands: string[] = [];
  const deps = {
    connection: () => ({ origin: 'http://ma.local:8095', token: 'private-token', epoch: 'one', scope: 'fixture', version: '2.10.9', serverId: 'server' }),
    target: () => target,
    open: async () => { const socket = new Socket(); sockets.push(socket); return socket as unknown as WebSocket; },
    client: (config: VisualizerClientConfig) => { const client = new Client(config); clients.push(client); return client; },
    configure: async () => {},
    read: async (_connection: unknown, command: string, args: Record<string, unknown>) => {
      commands.push(command);
      return command === 'player_queues/get_active_queue' ? { queue_id: args.player_id === target.destination ? target.destination : receiverQueue, available: true } : null;
    },
  };
  const service = new RoomVisualizer(directory, deps);
  t.after(async () => { service.close(); await service.drain(); await rm(directory, { recursive: true, force: true }); });
  await service.ready;
  return { service, deps, target, clients, sockets, commands, directory, mismatch: () => { receiverQueue = 'another-room'; } };
}

test('silent receiver persists identity, receives PCM, verifies the room group and exposes only spectrum', async t => {
  const f = await fixture(t);
  assert.equal(f.clients.length, 0);
  await f.service.save({ revision: 0, enabled: true, delayMs: 0 });
  await eventually(() => f.service.view().state === 'ready');
  const client = f.clients[0]!;
  assert.deepEqual(client.config.codecs, ['pcm']); assert.equal(client.config.unpairedAccess, false);
  f.target.playing = true; await f.service.wake(); client.audio();
  const packet = f.service.packet();
  assert.equal(packet.active, true); assert.ok(packet.frames.length > 20);
  assert.deepEqual(Object.keys(packet).sort(), ['active', 'epoch', 'frames', 'participantId', 'roomId']);
  assert.equal(JSON.stringify(packet).includes(client.pairingToken), false);
  assert.ok(f.commands.includes('sendspin/pair_web_player'));
  assert.ok(f.commands.every(command => ['sendspin/pair_web_player', 'player_queues/get_active_queue'].includes(command)));
  client.onStreamEnd?.(); assert.ok(f.service.packet().frames.length > 20, 'Stream end preserves already scheduled audio.');
  const before = packet.epoch; client.onStreamClear?.();
  assert.notEqual(f.service.packet().epoch, before); assert.deepEqual(f.service.packet().frames, []);
  client.audio(); f.mismatch(); await f.service.wake();
  assert.equal(f.service.packet().active, false); assert.deepEqual(f.service.packet().frames, []);
  await f.service.drain();
  const stored = JSON.parse(await readFile(join(f.directory, 'visualizer-identity.json'), 'utf8'));
  assert.ok(Object.keys(stored).length > 0);
  f.service.close();
  const restarted = new RoomVisualizer(f.directory, f.deps); t.after(async () => { restarted.close(); await restarted.drain(); });
  await eventually(() => f.clients.length === 2);
  assert.equal(f.clients[1]!.clientId, client.clientId);
});

test('pause, turn changes, disabling and stale revisions cannot leave another participant reacting', async t => {
  const f = await fixture(t); await f.service.save({ revision: 0, enabled: true, delayMs: 100 });
  await eventually(() => f.service.view().state === 'ready');
  f.target.playing = true; await f.service.wake(); f.clients[0]!.audio(); assert.equal(f.service.packet().active, true);
  f.target.participantId = 'next'; assert.equal(f.service.packet().active, false);
  await f.service.wake(); assert.deepEqual(f.service.packet().frames, [], 'New participant cannot inherit buffered audio.');
  f.target.playing = false; await f.service.wake(); assert.deepEqual(f.service.packet().frames, []);
  await assert.rejects(f.service.save({ revision: 0, enabled: false, delayMs: 0 }), /settings changed/);
  await f.service.save({ revision: 1, enabled: false, delayMs: 0 });
  assert.equal(f.service.view().state, 'disabled'); assert.equal(f.clients[0]!.isConnected, false);
  assert.ok(f.sockets.every(socket => socket.terminated));
});

test('a temporary queue-read failure keeps the persistent receiver connected and recovers without pairing again', async t => {
  const f = await fixture(t); await f.service.save({ revision: 0, enabled: true, delayMs: 0 });
  await eventually(() => f.service.view().state === 'ready');
  f.target.playing = true; await f.service.wake(); f.clients[0]!.audio();
  const read = f.deps.read;
  f.deps.read = async () => { throw new Error('Temporarily unavailable'); };
  await f.service.wake(); assert.equal(f.service.packet().active, false);
  assert.equal(f.clients[0]!.isConnected, true); assert.equal(f.sockets[0]!.terminated, false);
  f.deps.read = read; await f.service.wake(); f.clients[0]!.audio();
  assert.equal(f.service.packet().active, true); assert.equal(f.clients.length, 1);
});

test('disabling or losing configuration while a socket opens closes the late socket without pairing', async t => {
  for (const action of ['disable', 'disconnect', 'close'] as const) {
    const f = await fixture(t); const socket = new Socket();
    let release!: () => void; let opening = false;
    f.deps.open = async () => { opening = true; await new Promise<void>(resolve => { release = resolve; }); return socket as unknown as WebSocket; };
    await f.service.save({ revision: 0, enabled: true, delayMs: 0 });
    await eventually(() => opening);
    if (action === 'disable') await f.service.save({ revision: 1, enabled: false, delayMs: 0 });
    else if (action === 'disconnect') f.deps.connection = () => { throw new Error('Disconnected'); };
    else f.service.close();
    release(); await eventually(() => socket.terminated);
    assert.equal(f.clients.length, 0); assert.deepEqual(f.commands, []);
  }
});

test('the real headless SDK advertises PCM and decodes timestamped samples without browser audio APIs', async t => {
  const stored = new Map<string, string>();
  const core = createVisualizerClient({ webSocket: undefined, storage: {
    getItem: key => stored.get(key) ?? null, setItem: (key, value) => { stored.set(key, value); },
  }, clientName: 'Visualizer fixture', productName: 'Web Player', manufacturer: 'Doom Room', codecs: ['pcm'],
  unpairedAccess: false, bufferCapacity: 6_000_000, requiredLeadTimeMs: 1200, minBufferMs: 1200 });
  t.after(() => core.disconnect());
  type Format = { codec: string; channels: number; sample_rate: number; bit_depth: number };
  const internals = core as unknown as {
    protocolHandler: { sendClientHello(): void }; transport: { sendControl(message: unknown): void };
    decoder: { handleBinaryMessage(data: ArrayBuffer, format: Format, generation: number): Promise<void> };
    _stateManager: { streamGeneration: number };
  };
  let hello: unknown;
  internals.transport.sendControl = message => { hello = message; }; internals.protocolHandler.sendClientHello();
  const formats = (hello as { payload: { 'player@v1_support': { supported_formats: Format[] } } }).payload['player@v1_support'].supported_formats;
  assert.deepEqual([...new Set(formats.map(format => format.codec))], ['pcm']);
  const chunks: VisualizerChunk[] = []; core.onAudioData = chunk => chunks.push(chunk);
  const data = new ArrayBuffer(21); const bytes = new DataView(data); bytes.setUint8(0, 4); bytes.setBigInt64(1, 1234567n);
  [16384, -16384, 8192, -8192].forEach((value, i) => bytes.setInt16(13 + i * 2, value, true));
  await internals.decoder.handleBinaryMessage(data, { codec: 'pcm', channels: 2, sample_rate: 48000, bit_depth: 16 }, internals._stateManager.streamGeneration);
  assert.equal(chunks.length, 1); assert.equal(chunks[0]!.serverTimeUs, 1234567);
  assert.deepEqual(chunks[0]!.samples.map(channel => [...channel]), [[.5, .25], [-.5, -.25]]);
});

test('invited screens can read magnitudes and clock but cannot administer the receiver', () => {
  assert.equal(publicRoute('GET', '/api/display/spectrum/events'), true);
  assert.equal(publicRoute('GET', '/api/display/spectrum/clock'), true);
  assert.equal(publicRoute('POST', '/api/display/spectrum/events'), false);
  assert.equal(publicRoute('GET', '/api/host/visualizer'), false);
  assert.equal(publicRoute('POST', '/api/host/visualizer'), false);
});
