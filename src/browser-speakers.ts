import { createHash } from 'node:crypto';
import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import WebSocket, { WebSocketServer } from 'ws';
import { z } from 'zod';
import { AppError } from './model.js';
import { MusicAssistantTransport } from './music-assistant-transport.js';
import { lanWebSocket } from './lan-network.js';
import { readCookie } from './http-guards.js';
import { supportsPlaybackSchema } from './music-assistant-policy.js';
import { browserDevices, browserSpeakerName, type BrowserDevice } from './browser-speaker-name.js';
import { SpeakerRelay } from './speaker-relay.js';
import { diagnostics } from './diagnostics.js';
import type { AudioHealth } from './browser-audio-health.js';

export type SpeakerConnection = { origin: string; token: string; epoch: string; scope: string; version: string; serverId: string };
export type SpeakerContext = { origin: string; base: string; kind: 'lan' | 'ingress' | 'public'; valid: () => boolean };
type Transfer = { bytesToBrowser: number; peakQueuedBytes: number; connections: number };
export type BrowserSpeakerView = { id: string; name: string; active: boolean; connected: boolean; paired: boolean; expiresAt: number; configurationError?: string; audio?: AudioHealth; audioReportedAt?: number; transfer?: Transfer };
type Session = BrowserSpeakerView & { clientId: string; device: BrowserDevice; owner: string; epoch: string; context: SpeakerContext; leaseUntil: number; close?: () => void; pairing?: Promise<void>; configuring?: Promise<void>; configuredName?: string; revoked: boolean; transferStats?: () => Transfer };
export const speakerCookie = 'doom_room_browser_speaker';
export const speakerPath = '/api/browser-speaker';
export const speakerId = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
export const speakerRegistration = z.object({ id: z.string().uuid(), clientId: speakerId, name: z.string().trim().min(1).max(60), device: z.enum(browserDevices).optional() }).strict();
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export const requestSpeakerCookie = (req: IncomingMessage) => readCookie(req, speakerCookie);

/** Version-0 pairing token: base32(client public key || PSK), with 9 replacing 2. */
export function pairingClientId(token: string): string | undefined {
  if (!/^SP:0[A-Z3-79]{103}$/.test(token)) return;
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; let value = 0; let bits = 0; const bytes: number[] = [];
  for (const character of token.slice(4).replaceAll('9', '2')) {
    value = (value << 5) | alphabet.indexOf(character); bits += 5;
    if (bits >= 8) { bits -= 8; bytes.push((value >>> bits) & 255); value &= (1 << bits) - 1; }
  }
  if (bytes.length !== 64 || value !== 0) return;
  return Buffer.from(bytes.slice(0, 32)).toString('base64url');
}

/** Only authenticated upstream sockets leave this function; auth frames never reach the browser. */
export async function openSpeakerSocket(connection: SpeakerConnection, clientId: string): Promise<WebSocket> {
  // An address can be reused by a different MA installation. Verify identity before
  // authentication/pairing; a cached inventory or matching API schema is insufficient.
  const transport = new MusicAssistantTransport(connection.origin, connection.token);
  try {
    const info = z.object({ server_id: z.string(), schema_version: z.number().int() }).parse(await transport.read('/info'));
    if (info.server_id !== connection.serverId || !supportsPlaybackSchema(info.schema_version)) throw new Error();
  } catch { throw new AppError(502, 'Music Assistant identity or browser-audio compatibility could not be confirmed. Refresh its connection in Settings.'); }
  finally { transport.close(); }
  const socket = await lanWebSocket(connection.origin, '/sendspin');
  return new Promise((resolve, reject) => {
    const timer = setTimeout(fail, 10_000); timer.unref();
    function fail() { clearTimeout(timer); socket.terminate(); reject(new AppError(502, 'The Music Assistant browser audio connection could not be established.')); }
    socket.once('open', () => socket.send(JSON.stringify({ type: 'auth', token: connection.token, client_id: clientId })));
    const message = (data: WebSocket.RawData, binary: boolean) => {
      try {
        if (binary || data.toString().length > 4096 || JSON.parse(data.toString()).type !== 'auth_ok') { fail(); return; }
        clearTimeout(timer); socket.off('message', message); socket.off('close', fail); socket.off('error', fail);
        socket.on('error', () => {}); resolve(socket);
      } catch { fail(); }
    };
    socket.on('message', message); socket.once('error', fail); socket.once('close', fail);
  });
}

async function pair(connection: SpeakerConnection, token: string) {
  const transport = new MusicAssistantTransport(connection.origin, connection.token, 20_000);
  try { await transport.read('/api', 'sendspin/pair_web_player', { pairing_token: token }); }
  finally { transport.close(); }
}

/** Patch only this paired player's display settings; MA still owns groups and playback. */
export async function configureBrowserPlayer(connection: SpeakerConnection, clientId: string, name: string, current: () => boolean) {
  const transport = new MusicAssistantTransport(connection.origin, connection.token, 20_000);
  const schema = z.object({ player_id: z.literal(clientId), name: z.string().nullable().optional(),
    values: z.object({ hide_in_ui: z.object({ value: z.boolean().nullable() }) }) });
  try {
    const config = schema.parse(await transport.read('/api', 'config/players/get', { player_id: clientId }));
    if (!current()) return;
    const values: Record<string, string | boolean> = {};
    if (config.name !== name) values.name = name;
    if (config.values.hide_in_ui.value !== false) values.hide_in_ui = false;
    if (!Object.keys(values).length) return;
    const saved = schema.parse(await transport.read('/api', 'config/players/save', { player_id: clientId, values }));
    if (saved.name !== name || saved.values.hide_in_ui.value !== false) throw new Error('Browser player settings were not confirmed.');
  } finally { transport.close(); }
}

/** Automatic browser sessions. Only one tab per Sendspin identity may hold the audio lease. */
export class BrowserSpeakers {
  private sessions = new Map<string, Session>();
  private upgrades = new WebSocketServer({ noServer: true, maxPayload: 128 * 1024, perMessageDeflate: false });
  private timer: NodeJS.Timeout;
  private closed = false;
  constructor(private connection: () => SpeakerConnection, private changed: () => void = () => {},
    private open = openSpeakerSocket, private pairClient = pair, private now = Date.now, private configure = configureBrowserPlayer) {
    this.timer = setInterval(() => this.sweep(), 5000); this.timer.unref();
  }
  info() {
    if (this.closed) throw new AppError(503, 'Browser audio is shutting down.');
    const c = this.connection();
    return { scope: c.scope, version: c.version };
  }
  private usable(session: Session) {
    try { return !this.closed && !session.revoked && this.now() < session.expiresAt && session.context.valid() && this.connection().epoch === session.epoch; }
    catch { return false; }
  }
  private revoke(session: Session) { session.revoked = true; session.close?.(); this.sessions.delete(session.id); }
  sweep() {
    for (const session of this.sessions.values()) {
      if (!this.usable(session)) this.revoke(session);
      else if (session.active && !session.close && this.now() >= session.leaseUntil) session.active = false;
    }
  }
  private view(s: Session): BrowserSpeakerView { return { id: s.id, name: s.name, active: s.active, connected: s.connected, paired: s.paired, expiresAt: s.expiresAt,
    ...(s.configurationError ? { configurationError: s.configurationError } : {}),
    ...(s.audio ? { audio: { ...s.audio }, audioReportedAt: s.audioReportedAt } : {}),
    ...(s.transferStats ? { transfer: s.transferStats() } : {}) }; }
  report(id: string, owner: string, context: SpeakerContext, audio: AudioHealth) {
    const s = this.owned(id, owner, context);
    if (!s.active || !s.connected) throw new AppError(409, 'Browser audio is not connected.');
    // Client-reported diagnostics, never an input to authorization or routing.
    s.audio = { ...audio }; s.audioReportedAt = this.now();
  }
  private syncPlayer(s: Session): Promise<void> {
    if (s.configuring) return s.configuring;
    if (!s.active || !s.connected || !s.paired || s.configuredName === s.name) return Promise.resolve();
    const name = s.name; const connection = this.connection(); const close = s.close;
    const current = () => this.usable(s) && s.connected && s.close === close && s.name === name;
    s.configuring = this.configure(connection, s.clientId, name, current).then(() => {
      if (current()) { s.configuredName = name; s.configurationError = undefined; this.changed(); }
    }).catch(() => {
      if (current()) s.configurationError = 'Browser player naming/group visibility could not be updated. Check Music Assistant player-configuration permissions.';
    }).finally(() => { s.configuring = undefined; });
    return s.configuring;
  }
  private claim(s: Session) {
    this.sweep();
    if (!s.active && ![...this.sessions.values()].some(other => other !== s && other.active && other.clientId === s.clientId)) {
      s.active = true; s.leaseUntil = this.now() + 30_000;
    }
  }
  list() { this.sweep(); return [...this.sessions.values()].map(s => this.view(s)); }
  register(input: z.infer<typeof speakerRegistration>, owner: string, context: SpeakerContext, username?: string) {
    this.info(); this.sweep();
    if (!/^[\w-]{43}$/.test(owner)) throw new AppError(401, 'Browser speaker access is unavailable.');
    const prior = this.sessions.get(input.id);
    if (prior) return this.status(input.id, owner, context, username);
    if (this.sessions.size >= 64) throw new AppError(429, 'The browser player is busy. It will retry shortly.');
    const device = input.device ?? 'Browser';
    const s: Session = { ...input, device, name: browserSpeakerName(device, username), owner: digest(owner), context, epoch: this.connection().epoch, active: false, connected: false, paired: false, revoked: false,
      leaseUntil: 0, expiresAt: this.now() + 60_000 };
    this.sessions.set(s.id, s);
    this.claim(s);
    return this.view(s);
  }
  owned(id: string, owner: string, context: SpeakerContext) {
    const s = this.sessions.get(id);
    if (!s || !this.usable(s) || s.owner !== digest(owner) || s.context.origin !== context.origin || s.context.base !== context.base || s.context.kind !== context.kind) throw new AppError(403, 'The browser player session expired. Reconnecting.');
    return s;
  }
  status(id: string, owner: string, context: SpeakerContext, username?: string) {
    const s = this.owned(id, owner, context); this.claim(s);
    s.name = browserSpeakerName(s.device, username);
    s.expiresAt = this.now() + (s.connected ? 8 * 60 * 60_000 : 60_000);
    void this.syncPlayer(s);
    return this.view(s);
  }
  remove(id: string) { const s = this.sessions.get(id); if (s) this.revoke(s); }
  revokePublic() { for (const s of this.sessions.values()) if (s.context.kind === 'public') this.revoke(s); }
  revokeOwner(owner: string) { for (const s of this.sessions.values()) if (s.owner === digest(owner)) this.revoke(s); }
  async pair(id: string, owner: string, context: SpeakerContext, token: string) {
    const s = this.owned(id, owner, context);
    if (!s.active || !s.connected || pairingClientId(token) !== s.clientId) throw new AppError(403, 'This browser player cannot be paired with the current session.');
    if (!s.pairing) {
      s.pairing = this.pairClient(this.connection(), token).then(() => {
        if (!this.usable(s) || !s.connected) throw new AppError(409, 'The speaker connection changed during pairing.');
        s.paired = true; this.changed();
      }).catch(() => { throw new AppError(502, 'Music Assistant could not pair this browser. Check its version and the integration account permissions.'); }).finally(() => { s.pairing = undefined; });
    }
    await s.pairing;
    await this.syncPlayer(s); return this.view(s);
  }
  /** Every listener supplies its own provenance validator; Express is not involved in upgrades. */
  attach(server: Server, context: (req: IncomingMessage) => SpeakerContext | undefined) {
    server.on('upgrade', (req, socket, head) => { void this.upgrade(req, socket, head, context); });
  }
  private async upgrade(req: IncomingMessage, socket: Duplex, head: Buffer, getContext: (req: IncomingMessage) => SpeakerContext | undefined) {
    let upstream: WebSocket | undefined;
    let session: Session | undefined;
    const reject = () => { upstream?.terminate(); if (!socket.destroyed) socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'); };
    try {
      socket.on('error', () => {});
      const context = getContext(req); if (!context || req.headers.origin !== context.origin || req.headers['sec-fetch-site'] === 'cross-site') { reject(); return; }
      if (req.method !== 'GET' || req.headers.upgrade?.toLowerCase() !== 'websocket' || req.headers['sec-websocket-version'] !== '13' ||
        typeof req.headers['sec-websocket-key'] !== 'string' || !/^[+/0-9A-Za-z]{22}==$/.test(req.headers['sec-websocket-key']) || /[\\%]|\/\//.test(req.url ?? '')) { reject(); return; }
      const url = new URL(req.url!, context.origin);
      if (url.pathname !== `${context.base}${speakerPath}/socket` && url.pathname !== `${speakerPath}/socket` || url.searchParams.size !== 1) { reject(); return; }
      session = this.owned(z.string().uuid().parse(url.searchParams.get('id')), requestSpeakerCookie(req), context);
      if (!session.active || session.close) { reject(); return; }
      const s = session;
      const close = () => { upstream?.terminate(); socket.destroy(); if (s.close === close) s.close = undefined; };
      s.close = close; // Reserve before awaiting DNS/auth; racing upgrades cannot acquire the same lease.
      socket.once('close', close);
      upstream = await this.open(this.connection(), s.clientId);
      if (!this.usable(s) || socket.destroyed || upstream.readyState !== WebSocket.OPEN) { close(); return; }
      const remote = upstream;
      this.upgrades.handleUpgrade(req, socket, head, client => {
        socket.off('close', close);
        s.connected = true; s.expiresAt = this.now() + 8 * 60 * 60_000;
        let clientAlive = true; let remoteAlive = true; let done = false;
        const timer = setInterval(() => {
          if (!this.usable(s) || (!clientAlive && !toMa.heartbeatDeferred) || (!remoteAlive && !toBrowser.heartbeatDeferred)) { finish(); return; }
          s.expiresAt = this.now() + 8 * 60 * 60_000;
          clientAlive = remoteAlive = false; client.ping(); remote.ping();
        }, 20_000); timer.unref();
        const finish = () => {
          if (done) return; done = true; clearInterval(timer); clearInterval(flowTimer);
          toMa.close(); toBrowser.close();
          diagnostics.record('audio-relay-bytes', toBrowser.bytes); diagnostics.record('audio-relay-peak', toBrowser.peakBytes);
          client.terminate(); remote.terminate();
          s.audio = undefined; s.audioReportedAt = undefined;
          s.connected = false; s.paired = false; s.active = false; s.close = undefined; s.configuredName = undefined; s.expiresAt = this.now() + 60_000; this.changed();
        };
        const toMa = new SpeakerRelay(client, remote, finish, () => this.usable(s));
        const toBrowser = new SpeakerRelay(remote, client, finish, () => this.usable(s));
        const previousTransfer = s.transferStats?.();
        s.transferStats = () => ({ bytesToBrowser: (previousTransfer?.bytesToBrowser ?? 0) + toBrowser.bytes,
          peakQueuedBytes: Math.max(previousTransfer?.peakQueuedBytes ?? 0, toBrowser.peakBytes), connections: (previousTransfer?.connections ?? 0) + 1 });
        const flowTimer = setInterval(() => { toMa.check(); toBrowser.check(); }, 1000); flowTimer.unref();
        s.close = finish;
        // Any frame proves a peer is alive. Over Funnel a ping can wait behind queued
        // audio in the relays, while the browser's own time-sync messages still arrive.
        client.on('pong', () => { clientAlive = true; }); remote.on('pong', () => { remoteAlive = true; });
        client.on('message', (data, binary) => { clientAlive = true; toMa.forward(data, binary); });
        remote.on('message', (data, binary) => { remoteAlive = true; toBrowser.forward(data, binary); });
        client.on('close', finish); remote.on('close', finish); client.on('error', finish); remote.on('error', finish);
      });
    } catch { if (session && !session.connected) session.close = undefined; reject(); }
  }
  close() { if (this.closed) return; this.closed = true; clearInterval(this.timer); for (const s of this.sessions.values()) this.revoke(s); this.upgrades.close(); }
}
