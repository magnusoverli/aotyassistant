import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type WebSocket from 'ws';
import { createVisualizerClient, visualizerIdentity, type VisualizerStorage, type VisualizerClientConfig, type VisualizerClient } from './sendspin-server.js';
import { AppError } from './model.js';
import { readPrivateJson, writePrivateJson } from './store.js';
import { SerialQueue } from './serial.js';
import { MusicAssistantTransport } from './music-assistant-transport.js';
import { openSpeakerSocket, configureBrowserPlayer, type SpeakerConnection } from './browser-speakers.js';
import { SpectrumAnalyser } from './spectrum-analysis.js';
import { SpectrumBuffer, type SpectrumPacket, type VisualizerSettings, type VisualizerView } from './spectrum.js';

export const visualizerSettingsSchema = z.object({ revision: z.number().int().nonnegative(), enabled: z.boolean(), delayMs: z.number().int().min(-5000).max(5000) }).strict();
const secretsSchema = z.record(z.string().max(200), z.string().max(8192));
const name = 'Doom Room Visualizer';
export type VisualizerTarget = { roomId: string | null; participantId: string | null; playbackId: string | null; playing: boolean; destination: string | null };
type Dependencies = {
  connection(): SpeakerConnection;
  target(): VisualizerTarget;
  open?: typeof openSpeakerSocket;
  client?: (config: VisualizerClientConfig) => VisualizerClient;
  read?: (connection: SpeakerConnection, command: string, args: Record<string, unknown>) => Promise<unknown>;
  configure?: typeof configureBrowserPlayer;
};

/** One silent audio receiver for the room, independently of browser tabs or audio permissions.
 * MA owns grouping. Only frequency magnitudes and presentation times leave this service. */
export class RoomVisualizer {
  readonly ready: Promise<void>;
  private settings: VisualizerSettings = { revision: 0, enabled: false, delayMs: 0 };
  private secrets: Record<string, string> = Object.create(null);
  private writes = new SerialQueue();
  private unavailable = false;
  private closed = false;
  private busy = false;
  private generation = 0;
  private client?: VisualizerClient;
  private socket?: WebSocket;
  private connectionEpoch = '';
  private state: VisualizerView['state'] = 'disabled';
  private message = 'Enable the client, then add it to your Music Assistant speaker group.';
  private timer: NodeJS.Timeout;
  private heartbeat?: NodeJS.Timeout;
  private frames = new SpectrumBuffer();
  private analyser: SpectrumAnalyser;
  private epoch = randomUUID();
  private matched = false;
  private verifiedAt = 0;
  private targetKey = '';
  private ownerKey = '';
  private nextAttempt = 0;
  private failures = 0;

  constructor(private directory: string, private deps: Dependencies) {
    this.analyser = new SpectrumAnalyser((serverTimeUs, bins) => {
      const core = this.client;
      if (!core?.timeSyncInfo.synced) return;
      const at = core._timeFilter.computeClientTime(serverTimeUs) / 1000;
      this.frames.push({ at, bins }, performance.now());
    });
    this.ready = this.load();
    this.timer = setInterval(() => { void this.wake(); }, 2000); this.timer.unref();
    void this.ready.then(() => this.wake());
  }
  private async load() {
    try {
      this.settings = await readPrivateJson(join(this.directory, 'visualizer.json'), visualizerSettingsSchema, 4096) ?? this.settings;
      this.secrets = await readPrivateJson(join(this.directory, 'visualizer-identity.json'), secretsSchema, 65536) ?? Object.create(null);
    } catch { this.unavailable = true; this.state = 'error'; this.message = 'Visualizer storage could not be read. Check storage and restart the app.'; }
  }
  view(): VisualizerView { return { ...this.settings, name, state: this.state, message: this.message }; }
  async save(input: VisualizerSettings) {
    await this.ready;
    return this.writes.run(async () => {
      if (this.unavailable || this.closed) throw new AppError(503, 'Visualizer storage is unavailable. Restart after checking storage.');
      const parsed = visualizerSettingsSchema.parse(input);
      if (parsed.revision !== this.settings.revision) throw new AppError(409, 'Visualizer settings changed. Reload before saving.');
      const next = { ...parsed, revision: parsed.revision + 1 };
      try { await writePrivateJson(this.directory, 'visualizer.json', next, 4096); }
      catch {
        this.unavailable = true; this.drop(); this.state = 'error'; this.message = 'Visualizer settings could not be saved. Check storage and restart.';
        throw new AppError(503, this.message);
      }
      const reconnect = next.enabled !== this.settings.enabled;
      this.settings = next;
      if (reconnect) { this.drop(); this.nextAttempt = 0; }
      else this.epoch = randomUUID();
      this.state = next.enabled ? this.client ? this.state : 'connecting' : 'disabled';
      this.message = next.enabled ? this.client ? this.message : 'Connecting to Music Assistant…' : 'Visualizer client disabled.';
      // Leave the write lane before a connection flushes newly generated identity keys.
      queueMicrotask(() => { void this.wake(); });
      return this.view();
    });
  }
  private storage(scope: string): VisualizerStorage {
    return {
      getItem: key => this.secrets[`${scope}:${key}`] ?? null,
      setItem: (key, value) => {
        if (this.closed || this.unavailable) return;
        const full = `${scope}:${key}`;
        if (this.secrets[full] === value) return;
        this.secrets[full] = value;
        void this.writes.run(async () => {
          try { await writePrivateJson(this.directory, 'visualizer-identity.json', this.secrets, 65536); }
          catch { this.unavailable = true; this.drop(); this.state = 'error'; this.message = 'Visualizer identity could not be saved. Check storage and restart.'; }
        });
      },
    };
  }
  private async read(connection: SpeakerConnection, command: string, args: Record<string, unknown>) {
    if (this.deps.read) return this.deps.read(connection, command, args);
    const transport = new MusicAssistantTransport(connection.origin, connection.token, 10_000);
    try { return await transport.read('/api', command, args); }
    finally { transport.close(); }
  }
  private resetFrames() { this.frames.clear(); this.analyser.clear(); this.epoch = randomUUID(); }
  private drop() {
    this.generation++; this.matched = false; this.verifiedAt = 0;
    const core = this.client; this.client = undefined;
    if (core) {
      core.onAudioData = undefined; core.onConnectionClose = undefined; core.onStreamStart = undefined;
      core.onStreamClear = undefined; core.onStreamEnd = undefined; core.disconnect();
    }
    this.socket?.terminate(); this.socket = undefined;
    clearInterval(this.heartbeat); this.heartbeat = undefined;
    this.resetFrames();
  }
  private observeTarget() {
    const target = this.deps.target();
    const owner = JSON.stringify([target.roomId, target.participantId, target.destination]);
    if (owner !== this.ownerKey) { this.ownerKey = owner; this.resetFrames(); }
    const key = JSON.stringify([target.roomId, target.participantId, target.playbackId, target.destination, target.playing]);
    if (key !== this.targetKey) {
      this.targetKey = key; this.matched = false; this.verifiedAt = 0; this.epoch = randomUUID();
    }
    return target;
  }
  packet(): SpectrumPacket {
    const target = this.observeTarget(); const now = performance.now();
    const active = target.playing && this.matched && now - this.verifiedAt < 6000 && Boolean(this.client?.isConnected && this.client.timeSyncInfo.synced);
    return { epoch: this.epoch, roomId: target.roomId, participantId: target.participantId, active,
      frames: active ? this.frames.window(now, this.settings.delayMs) : [] };
  }
  async wake() {
    await this.ready;
    if (this.closed || this.busy || this.unavailable || !this.settings.enabled) return;
    this.busy = true;
    try {
      this.observeTarget();
      const connection = this.deps.connection();
      if (this.client && this.connectionEpoch !== connection.epoch) this.drop();
      if (!this.client) {
        if (performance.now() < this.nextAttempt) return;
        this.state = 'connecting'; this.message = 'Connecting to Music Assistant…';
        const generation = this.generation;
        const current = () => {
          if (this.closed || this.unavailable || !this.settings.enabled || generation !== this.generation) return false;
          try { if (this.deps.connection().epoch === connection.epoch) return true; } catch { /* Connection settings were removed. */ }
          this.drop(); return false;
        };
        const storage = this.storage(connection.scope);
        const identity = visualizerIdentity(storage);
        await this.writes.drain(); if (!current()) return;
        const socket = await (this.deps.open ?? openSpeakerSocket)(connection, identity.clientId);
        if (!current()) { socket.terminate(); return; }
        this.socket = socket; this.connectionEpoch = connection.epoch;
        const core = (this.deps.client ?? createVisualizerClient)({
          webSocket: socket, storage, clientName: name,
          productName: 'Web Player', manufacturer: 'Doom Room', codecs: ['pcm'], unpairedAccess: false,
          bufferCapacity: 6_000_000, requiredLeadTimeMs: 1200, minBufferMs: 1200,
        });
        this.client = core;
        core.onAudioData = chunk => { if (this.client === core) this.analyser.push(chunk); };
        core.onStreamStart = () => this.resetFrames();
        core.onStreamClear = () => this.resetFrames();
        // End-of-stream can arrive ahead of playback: let already scheduled frames drain.
        core.onStreamEnd = () => this.analyser.clear();
        core.onConnectionClose = () => {
          if (this.client !== core) return;
          this.drop(); this.state = 'connecting'; this.message = 'Visualizer disconnected. Reconnecting…';
        };
        let alive = true;
        socket.on('pong', () => { alive = true; });
        this.heartbeat = setInterval(() => { if (!alive) socket.terminate(); else { alive = false; socket.ping(); } }, 20_000); this.heartbeat.unref();
        await core.connect(); if (!current()) return;
        await this.read(connection, 'sendspin/pair_web_player', { pairing_token: core.pairingToken });
        if (!current()) return;
        await (this.deps.configure ?? configureBrowserPlayer)(connection, core.clientId, name, current);
        await this.writes.drain(); if (!current()) return;
        this.failures = 0;
        this.state = 'ready'; this.message = `Add “${name}” to your MA speaker group, then select that group as the room output.`;
      }
      const core = this.client; const target = this.observeTarget();
      if (!core || !target.playing || !target.destination) {
        this.matched = false;
        if (core) { this.state = 'ready'; this.message = 'Visualizer connected. Waiting for room playback through its speaker group.'; }
        return;
      }
      const key = this.targetKey;
      const queue = z.object({ queue_id: z.string(), available: z.boolean().optional() });
      let queues;
      try {
        queues = await Promise.all([core.clientId, target.destination].map(player_id =>
          this.read(connection, 'player_queues/get_active_queue', { player_id }).then(value => queue.parse(value))));
      } catch {
        if (this.client === core) {
          this.matched = false; this.resetFrames(); this.state = 'ready';
          this.message = 'The room’s playback group could not be verified. Check grouping in Music Assistant; checking again automatically.';
        }
        return;
      }
      const [receiver, room] = queues;
      this.observeTarget();
      if (this.client !== core || this.targetKey !== key) return;
      this.matched = receiver!.queue_id === room!.queue_id && receiver!.available !== false && room!.available !== false;
      this.verifiedAt = performance.now();
      const frames = this.packet().frames;
      this.state = frames.length ? 'receiving' : 'ready';
      this.message = !this.matched ? 'The visualizer is not in the room’s active playback group.' : frames.length
        ? 'Receiving real audio spectrum. Sendspin groups share timing; Universal Groups may need adjustment.'
        : 'Connected to the room’s group. Waiting for audio…';
    } catch {
      this.matched = false;
      if (!this.closed && this.settings.enabled && !this.unavailable) {
        this.drop(); this.state = 'error';
        this.message = 'Visualizer connection could not be confirmed. Check Music Assistant and grouping; retrying automatically.';
        this.nextAttempt = performance.now() + Math.min(30_000, 2000 * 2 ** Math.min(this.failures++, 4));
      }
    } finally { this.busy = false; }
  }
  close() { this.closed = true; clearInterval(this.timer); this.drop(); }
  async drain() { await this.writes.drain(); }
}
