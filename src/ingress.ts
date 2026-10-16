import type { IncomingMessage, RequestListener } from 'node:http';
import type { Request } from 'express';

type IngressContext = { base: string; origin: string; userId: string };
const contexts = new WeakMap<IncomingMessage, IngressContext>();
export const ingressContext = (request: IncomingMessage) => contexts.get(request);
export const requestBase = (request: IncomingMessage) => ingressContext(request)?.base ?? '';
export function browserOrigin(request: Request, guestOrigin: string) {
  const ingress = ingressContext(request);
  if (ingress) return ingress.origin;
  // Origin is validated by the direct listener's middleware, not a forwarded header.
  const origin = request.headers.origin;
  return origin || guestOrigin;
}

/** This wrapper is attached ONLY to the unpublished Ingress listener. */
export function ingressListener(handler: RequestListener, proxyAddress = '172.30.32.2'): RequestListener {
  return (req, res) => {
    const peer = req.socket.remoteAddress?.replace(/^::ffff:/, '');
    const base = req.headers['x-ingress-path'];
    const proto = req.headers['x-forwarded-proto'];
    const host = req.headers['x-forwarded-host'];
    const userId = req.headers['x-remote-user-id'];
    try {
      if (peer !== proxyAddress || typeof base !== 'string' || !/^\/api\/hassio_ingress\/[A-Za-z0-9_-]+$/.test(base) ||
        typeof host !== 'string' || !['http', 'https'].includes(String(proto)) || typeof userId !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(userId)) throw new Error();
      const url = new URL(`${proto}://${host}`);
      if (url.host !== host || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error();
      contexts.set(req, { base, origin: url.origin, userId });
      handler(req, res);
    } catch { res.writeHead(403, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' }); res.end('Home Assistant Ingress required.'); }
  };
}
