import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import { z } from 'zod';
import { musicAssistantUrl, resolveLanAddresses } from './lan-network.js';
import { supportsPlaybackSchema } from './music-assistant-policy.js';

export type PlaybackEvent = { connected: boolean; objectId?: string; kind?: string; available?: boolean; name?: string };
const info = z.object({ schema_version: z.number().int().refine(supportsPlaybackSchema) });
const event = z.object({ event: z.enum(['queue_updated', 'queue_items_updated', 'player_added', 'player_updated', 'player_removed', 'queue_added']), object_id: z.string().min(1).max(500),
  data: z.object({ available: z.boolean().optional(), name: z.string().max(200).optional() }).nullish().catch(undefined) });

/** Authenticated event hints only. State is reconciled over HTTP; audio writes are never replayed. */
export class MusicAssistantEvents {
  private listeners = new Set<(event: PlaybackEvent) => void>();
  private socket?: WebSocket;
  private timer?: NodeJS.Timeout;
  private handshake?: NodeJS.Timeout;
  private heartbeat?: NodeJS.Timeout;
  private generation = 0;
  private failures = 0;
  private connected = false;
  private closed = false;
  constructor(private origin: string, private token: string) {}

  subscribe(listener: (event: PlaybackEvent) => void): () => void {
    if (this.closed) return () => {};
    this.listeners.add(listener); listener({ connected: this.connected });
    if (this.listeners.size === 1) void this.connect(++this.generation);
    return () => { this.listeners.delete(listener); if (!this.listeners.size) this.stop(); };
  }
  close() { this.closed = true; this.listeners.clear(); this.stop(); }
  private stop() {
    this.generation++; this.connected = false;
    clearTimeout(this.timer); clearTimeout(this.handshake); clearInterval(this.heartbeat);
    const socket = this.socket; this.socket = undefined; socket?.terminate();
  }
  private notify(value: PlaybackEvent) { for (const listener of this.listeners) listener(value); }
  private retry(generation: number) {
    if (generation !== this.generation || this.closed || !this.listeners.size) return;
    this.connected = false; this.notify({ connected: false });
    clearTimeout(this.handshake); clearInterval(this.heartbeat);
    this.timer = setTimeout(() => { void this.connect(generation); }, Math.min(60_000, 1000 * 2 ** Math.min(this.failures++, 6)));
    this.timer.unref();
  }
  private async connect(generation: number) {
    try {
      const url = new URL('/ws', musicAssistantUrl.parse(this.origin));
      const hostname = url.hostname.replace(/^\[|\]$/g, '');
      const addresses = await resolveLanAddresses(hostname, 8000);
      if (generation !== this.generation || this.closed || !this.listeners.size) return;
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
      const socket = new WebSocket(url, { agent: false, followRedirects: false, handshakeTimeout: 8000, maxPayload: 2 * 1024 * 1024, perMessageDeflate: false,
        lookup: (_hostname, options, callback) => options.all ? callback(null, addresses) : callback(null, addresses[0]!.address, addresses[0]!.family) });
      this.socket = socket;
      const current = () => generation === this.generation && this.socket === socket && !this.closed;
      const authId = randomUUID(); let authenticating = false; let alive = true;
      this.handshake = setTimeout(() => socket.terminate(), 8000); this.handshake.unref();
      socket.on('message', (data, binary) => {
        if (!current()) return;
        try {
          if (binary) throw new Error();
          const message: unknown = JSON.parse(data.toString());
          if (!this.connected && !authenticating) {
            info.parse(message); authenticating = true;
            socket.send(JSON.stringify({ message_id: authId, command: 'auth', args: { token: this.token } })); return;
          }
          if (!this.connected) {
            z.object({ message_id: z.literal(authId), result: z.object({ authenticated: z.literal(true) }) }).parse(message);
            clearTimeout(this.handshake); this.connected = true; this.failures = 0;
            this.notify({ connected: true });
            this.heartbeat = setInterval(() => {
              if (!alive) { socket.terminate(); return; }
              alive = false; socket.ping();
            }, 20_000); this.heartbeat.unref(); return;
          }
          const hint = event.safeParse(message);
          if (hint.success) this.notify({ connected: true, objectId: hint.data.object_id, kind: hint.data.event, available: hint.data.data?.available, name: hint.data.data?.name });
        } catch { socket.terminate(); }
      });
      socket.on('pong', () => { alive = true; });
      socket.on('error', () => { /* Closure schedules reconnection; never expose raw upstream errors. */ });
      socket.on('close', () => { if (current()) { this.socket = undefined; this.retry(generation); } });
    } catch { this.retry(generation); }
  }
}
