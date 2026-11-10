import type { IncomingMessage, Server } from 'node:http';

/** Dependency-free request primitives shared by the LAN, Ingress and public listeners. */
export const readCookie = (request: IncomingMessage, name: string): string =>
  request.headers.cookie?.split(';').map(value => value.trim()).find(value => value.startsWith(`${name}=`))?.slice(name.length + 1) ?? '';

/** The socket peer, with IPv4-mapped IPv6 addresses normalized. Never a forwarded header. */
export const peerAddress = (request: IncomingMessage) => request.socket.remoteAddress?.replace(/^::ffff:/, '');
export const isLoopbackPeer = (request: IncomingMessage) => ['127.0.0.1', '::1'].includes(peerAddress(request) ?? '');

/** Closes connections that arrive from this machine itself, before any request is read.
 * The bundled Tailscale daemon hands a tailnet device's connection to any port on to loopback
 * at the same port, so without this a tailnet device would reach a listener meant for the LAN. */
export function refuseLoopbackPeers(server: Server) {
  server.on('connection', socket => {
    if (['127.0.0.1', '::1'].includes(socket.remoteAddress?.replace(/^::ffff:/, '') ?? '')) socket.destroy();
  });
}

/** Host headers the direct listener answers for: the guest origin and loopback on its own port. */
export const directHosts = (guestOrigin: string, port: number) => [new URL(guestOrigin).host, ...loopbackHosts(port)];
export const loopbackHosts = (port: number) => [`localhost:${port}`, `127.0.0.1:${port}`];

/** Fixed one-minute windows per key. `full` means a new key would exceed the tracked-key budget. */
export class RateLimiter {
  private windows = new Map<string, { start: number; count: number }>();
  constructor(private maxKeys = Infinity, private windowMs = 60_000, private now = Date.now) {}
  hit(key: string, limit: number): 'ok' | 'limited' | 'full' {
    const now = this.now(); let window = this.windows.get(key);
    if (!window || now - window.start >= this.windowMs) {
      if (!window && this.windows.size >= this.maxKeys) return 'full';
      window = { start: now, count: 0 }; this.windows.set(key, window);
    }
    return ++window.count > limit ? 'limited' : 'ok';
  }
  prune() { const now = this.now(); for (const [key, window] of this.windows) if (now - window.start >= this.windowMs) this.windows.delete(key); }
  clear() { this.windows.clear(); }
}
