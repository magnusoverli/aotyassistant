import express, { type Request, type Response } from 'express';
import type { IncomingMessage, RequestListener } from 'node:http';
import { grantLifetime, type OnlineAccess } from './online-access.js';
import { RateLimiter, isLoopbackPeer, readCookie } from './http-guards.js';

/** `authorized`: the invitation cookie is valid. The page shell exposes only this yes/no. */
const contexts = new WeakMap<IncomingMessage, { origin: string; session: string; authorized: boolean }>();
export const publicContext = (request: IncomingMessage) => contexts.get(request);
const cookieName = '__Host-doom_room_online';
export const onlineCookie = (req: IncomingMessage) => readCookie(req, cookieName);
const readRoutes = [
  /^\/api\/browser-speaker\/(?:info|session\/[a-f0-9-]{36})$/,
  /^\/api\/participant\/browser-speaker\/session\/[a-f0-9-]{36}$/,
  /^\/(?:join|participant|user\/settings|display)?$/, /^\/demo-cover\.svg$/, /^\/assets\/[a-zA-Z0-9_-]+\.(?:js|css|svg|woff2)$/,
  /^\/api\/participant\/(?:identity|state|events)$/,
  /^\/api\/participant\/identity\/events$/,
  /^\/api\/user-pictures\/[a-f0-9-]{36}\/[a-f0-9]{32}\.webp$/,
  /^\/api\/participant\/preparations\/(?:state|live|events|import)$/,
  /^\/api\/participant\/preparations\/uploads\/[a-f0-9-]{36}(?:\/artwork)?$/,
  /^\/api\/participant\/preparations\/artwork\/[a-f0-9-]{36}\/(?:artwork|artistArtwork)$/,
  /^\/api\/display\/(?:state|events)$/, /^\/api\/display\/artwork\/[a-f0-9-]{36}\/(?:artwork|artistArtwork)$/,
  /^\/api\/display\/spectrum\/(?:clock|events)$/,
  /^\/api\/display\/prepared-artwork\/[a-f0-9-]{36}$/,
  /^\/api\/listening-order\/events$/,
  /^\/api\/logo(?:\/[a-f0-9]{16})?$/,
];
const writeRoutes = [
  /^\/api\/browser-speaker\/(?:register|pair|stop)$/,
  /^\/api\/participant\/browser-speaker\/(?:register|telemetry)$/,
  /^\/api\/participant\/(?:join|logout|finish|search|browse|play|control|seek|volume|reveal)$/,
  /^\/api\/participant\/picture(?:\/remove)?$/,
  /^\/api\/participant\/import\/(?:read|match)$/,
  /^\/api\/participant\/preparations\/(?:join|pin|init|add|add-upload|replace-upload|purge-upload|clear|move|remove|restore|review|play|import|import\/stop|album|replace)$/,
  /^\/api\/participant\/preparations\/uploads\/[a-f0-9-]{36}(?:\/discard)?$/,
];
export function publicRoute(method: string, path: string) {
  // Catalogue URLs encode the colon in ref:<base64url>. Accept only that exact
  // segment grammar, leaving Express to decode it once for the normal handler.
  // No general percent-decoding: encoded slashes, traversal and double encoding stay blocked.
  if ((method === 'GET' || method === 'HEAD') && /^\/api\/participant\/artwork\/(?:upload(?::|%3[Aa]))?ref(?::|%3[Aa])[A-Za-z0-9_-]{1,996}$/.test(path)) return true;
  // Reject ambiguous encodings and paths before Express's case-insensitive routing/decoding.
  if (/[\\%]|\/\//.test(path)) return false;
  return (method === 'GET' || method === 'HEAD' ? readRoutes : method === 'POST' ? writeRoutes : []).some(pattern => pattern.test(path));
}

/** Attached only to loopback:8098. No trust-proxy setting or forwarded header can create this context. */
export function publicListener(handler: RequestListener, online: OnlineAccess) {
  const gateway = express(); gateway.disable('x-powered-by');
  const active = new Set<Response>();
  const rates = new RateLimiter(2048);
  const limited = (key: string, maximum: number) => { rates.prune(); return rates.hit(key, maximum) !== 'ok'; };
  const revoke = () => { for (const response of active) response.destroy(); };
  online.on('revoke', revoke);
  gateway.use((req, res, next) => {
    res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY',
      'Strict-Transport-Security': 'max-age=31536000', 'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'" });
    const origin = online.origin;
    if (!origin || !isLoopbackPeer(req) || req.headers.host !== new URL(origin).host) { res.status(503).json({ error: 'Online invitations are unavailable. Ask the host to check the connection.' }); return; }
    if (active.size >= 256) { res.status(503).json({ error: 'The room is busy. Try again shortly.' }); return; }
    active.add(res); res.once('close', () => active.delete(res));
    const path = req.url.split('?')[0]!;
    if (path === '/api/online/probe' && req.method === 'GET') {
      const answer = online.probeResponse(typeof req.query.challenge === 'string' ? req.query.challenge : '');
      res.status(answer ? 200 : 404).type('text/plain').send(answer || 'Not found'); return;
    }
    const write = !['GET', 'HEAD'].includes(req.method);
    if (write && (req.headers.origin !== origin || req.headers['sec-fetch-site'] === 'cross-site')) { res.status(403).json({ error: 'Cross-origin controls are not allowed.' }); return; }
    const grant = onlineCookie(req);
    const authorized = online.authorized(grant);
    // Only invited guests draw on the shared budget for actions. The address is public, so
    // requests without an invitation are turned away below without spending anything a guest needs.
    if (write && authorized && limited('writes', 600)) { res.status(429).set('Retry-After', '60').json({ error: 'Too many requests. Wait a minute.' }); return; }
    if (authorized) {
      const expiry = setTimeout(() => res.destroy(), Math.max(1, Number(grant.split('.')[0]) - Date.now())); expiry.unref();
      res.once('close', () => clearTimeout(expiry));
    }
    if (path === '/api/online/redeem' && req.method === 'POST') {
      if (!req.is('application/json')) { res.status(415).json({ error: 'Send JSON.' }); return; }
      next(); return;
    }
    if (path === '/api/online/session' && req.method === 'GET') { res.status(authorized ? 200 : 401).json({ ok: authorized }); return; }
    if (!publicRoute(req.method, path)) { res.status(404).json({ error: 'Page not found.' }); return; }
    // The shell contains no room data. It redeems the fragment before starting any room requests.
    const shell = ['GET', 'HEAD'].includes(req.method) && (['/', '/join', '/participant', '/user/settings', '/display', '/demo-cover.svg'].includes(path) || path.startsWith('/assets/'));
    if (!shell && !authorized) { res.status(401).json({ error: 'Open the latest invitation from your host to continue.' }); return; }
    if (req.method === 'POST' && /^\/api\/participant\/preparations\/uploads\/[a-f0-9-]{36}$/.test(path)) {
      const length = req.headers['content-length'];
      if (!length || !/^\d+$/.test(length)) { res.status(411).json({ error: 'Online uploads need a known file size. Select a file in your browser.' }); return; }
      if (Number(length) > 256 * 1024 * 1024) { res.status(413).json({ error: 'Online uploads support files up to 256 MiB. Use local Wi-Fi for larger files.' }); return; }
    }
    if (!shell && limited(`session:${grant}`, req.method === 'POST' ? 240 : 1200)) { res.status(429).set('Retry-After', '60').json({ error: 'Too many requests. Wait a minute.' }); return; }
    contexts.set(req, { origin, session: grant, authorized });
    if (path === '/') { res.redirect('/join'); return; }
    handler(req, res);
  });
  gateway.post('/api/online/redeem', express.json({ limit: '1kb' }), (req, res) => {
    // Checking an invitation is one cheap comparison, so wrong guesses and real invitations are
    // counted apart: a flood of guesses cannot keep an invited friend out.
    const busy = () => { res.status(429).set('Retry-After', '60').json({ error: 'Too many attempts. Wait a minute.' }); };
    const grant = typeof req.body?.invitation === 'string' ? online.redeem(req.body.invitation) : undefined;
    if (!grant) {
      if (limited('rejected-invites', 60)) { busy(); return; }
      res.status(403).json({ error: 'This invitation is no longer valid. Ask the host for a new link.' }); return;
    }
    if (limited('invites', 120)) { busy(); return; }
    res.cookie(cookieName, grant, { httpOnly: true, secure: true, sameSite: 'strict', path: '/', maxAge: grantLifetime }); res.json({ ok: true });
  });
  gateway.use((_error: unknown, _req: Request, res: Response, _next: express.NextFunction) => { res.status(400).json({ error: 'Invalid request.' }); });
  return { listener: gateway, close: () => { online.off('revoke', revoke); revoke(); rates.clear(); } };
}
