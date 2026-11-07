import express, { type Request, type Response } from 'express';
import type { IncomingMessage, RequestListener } from 'node:http';
import { grantLifetime, type OnlineAccess } from './online-access.js';

const contexts = new WeakMap<IncomingMessage, { origin: string; session: string }>();
export const publicContext = (request: IncomingMessage) => contexts.get(request);
const cookieName = '__Host-aoty_online';
export const onlineCookie = (req: IncomingMessage) => req.headers.cookie?.split(';').map(v => v.trim()).find(v => v.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1) ?? '';
const cookie = onlineCookie;
const readRoutes = [
  /^\/api\/browser-speaker\/(?:info|session\/[a-f0-9-]{36})$/,
  /^\/api\/participant\/browser-speaker\/session\/[a-f0-9-]{36}$/,
  /^\/(?:join|participant|display)?$/, /^\/demo-cover\.svg$/, /^\/assets\/[a-zA-Z0-9_-]+\.(?:js|css|svg|woff2)$/,
  /^\/api\/participant\/(?:identity|state|events)$/, /^\/api\/participant\/artwork\/[^/]+$/,
  /^\/api\/participant\/preparations\/(?:state|live|events)$/,
  /^\/api\/participant\/preparations\/uploads\/[a-f0-9-]{36}(?:\/artwork)?$/,
  /^\/api\/participant\/preparations\/artwork\/[a-f0-9-]{36}\/(?:artwork|artistArtwork)$/,
  /^\/api\/display\/(?:state|events)$/, /^\/api\/display\/artwork\/[a-f0-9-]{36}\/(?:artwork|artistArtwork)$/,
  /^\/api\/listening-order\/events$/,
];
const writeRoutes = [
  /^\/api\/browser-speaker\/(?:register|pair|stop)$/,
  /^\/api\/participant\/browser-speaker\/register$/,
  /^\/api\/participant\/(?:join|logout|finish|search|browse|play|control|volume|reveal)$/,
  /^\/api\/participant\/preparations\/(?:join|pin|init|add|add-upload|purge-upload|move|remove|restore|review|play)$/,
  /^\/api\/participant\/preparations\/uploads\/[a-f0-9-]{36}(?:\/discard)?$/,
];
export function publicRoute(method: string, path: string) {
  // Reject ambiguous encodings and paths before Express's case-insensitive routing/decoding.
  if (/[\\%]|\/\//.test(path)) return false;
  return (method === 'GET' || method === 'HEAD' ? readRoutes : method === 'POST' ? writeRoutes : []).some(pattern => pattern.test(path));
}

/** Attached only to loopback:8098. No trust-proxy setting or forwarded header can create this context. */
export function publicListener(handler: RequestListener, online: OnlineAccess) {
  const gateway = express(); gateway.disable('x-powered-by');
  const active = new Set<Response>();
  const rates = new Map<string, { at: number; count: number }>();
  const limited = (key: string, maximum: number) => {
    const now = Date.now();
    for (const [key, entry] of rates) if (now - entry.at >= 60_000) rates.delete(key);
    const entry = rates.get(key) ?? { at: now, count: 0 };
    if (!rates.has(key) && rates.size >= 2048) return true;
    entry.count++; rates.set(key, entry); return entry.count > maximum;
  };
  const revoke = () => { for (const response of active) response.destroy(); };
  online.on('revoke', revoke);
  gateway.use((req, res, next) => {
    res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY',
      'Strict-Transport-Security': 'max-age=31536000', 'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'" });
    const origin = online.origin;
    const peer = req.socket.remoteAddress?.replace(/^::ffff:/, '');
    if (!origin || !['127.0.0.1', '::1'].includes(peer ?? '') || req.headers.host !== new URL(origin).host) { res.status(503).json({ error: 'Online invitations are unavailable. Ask the host to check the connection.' }); return; }
    if (active.size >= 256) { res.status(503).json({ error: 'The room is busy. Try again shortly.' }); return; }
    active.add(res); res.once('close', () => active.delete(res));
    const path = req.url.split('?')[0]!;
    if (path === '/api/online/probe' && req.method === 'GET') {
      const answer = online.probeResponse(typeof req.query.challenge === 'string' ? req.query.challenge : '');
      res.status(answer ? 200 : 404).type('text/plain').send(answer || 'Not found'); return;
    }
    if (!['GET', 'HEAD'].includes(req.method)) {
      if (req.headers.origin !== origin || req.headers['sec-fetch-site'] === 'cross-site') { res.status(403).json({ error: 'Cross-origin controls are not allowed.' }); return; }
      if (limited('writes', 600)) { res.status(429).set('Retry-After', '60').json({ error: 'Too many requests. Wait a minute.' }); return; }
    }
    const grant = cookie(req);
    const authorized = online.authorized(grant);
    if (authorized) {
      const expiry = setTimeout(() => res.destroy(), Math.max(1, Number(grant.split('.')[0]) - Date.now())); expiry.unref();
      res.once('close', () => clearTimeout(expiry));
    }
    if (path === '/api/online/redeem' && req.method === 'POST') {
      if (limited('invites', 60)) { res.status(429).set('Retry-After', '60').json({ error: 'Too many attempts. Wait a minute.' }); return; }
      if (!req.is('application/json')) { res.status(415).json({ error: 'Send JSON.' }); return; }
      next(); return;
    }
    if (path === '/api/online/session' && req.method === 'GET') { res.status(authorized ? 200 : 401).json({ ok: authorized }); return; }
    if (!publicRoute(req.method, path)) { res.status(404).json({ error: 'Page not found.' }); return; }
    // The shell contains no room data. It redeems the fragment before starting any room requests.
    const shell = ['GET', 'HEAD'].includes(req.method) && (['/', '/join', '/participant', '/display', '/demo-cover.svg'].includes(path) || path.startsWith('/assets/'));
    if (!shell && !authorized) { res.status(401).json({ error: 'Open the latest invitation from your host to continue.' }); return; }
    if (req.method === 'POST' && /^\/api\/participant\/preparations\/uploads\/[a-f0-9-]{36}$/.test(path)) {
      const length = req.headers['content-length'];
      if (!length || !/^\d+$/.test(length)) { res.status(411).json({ error: 'Online uploads need a known file size. Select a file in your browser.' }); return; }
      if (Number(length) > 256 * 1024 * 1024) { res.status(413).json({ error: 'Online uploads support files up to 256 MiB. Use local Wi-Fi for larger files.' }); return; }
    }
    if (!shell && limited(`session:${grant}`, req.method === 'POST' ? 240 : 1200)) { res.status(429).set('Retry-After', '60').json({ error: 'Too many requests. Wait a minute.' }); return; }
    contexts.set(req, { origin, session: grant });
    if (path === '/') { res.redirect('/join'); return; }
    handler(req, res);
  });
  gateway.post('/api/online/redeem', express.json({ limit: '1kb' }), (req, res) => {
    const grant = typeof req.body?.invitation === 'string' ? online.redeem(req.body.invitation) : undefined;
    if (!grant) { res.status(403).json({ error: 'This invitation is no longer valid. Ask the host for a new link.' }); return; }
    res.cookie(cookieName, grant, { httpOnly: true, secure: true, sameSite: 'strict', path: '/', maxAge: grantLifetime }); res.json({ ok: true });
  });
  gateway.use((_error: unknown, _req: Request, res: Response, _next: express.NextFunction) => { res.status(400).json({ error: 'Invalid request.' }); });
  return { listener: gateway, close: () => { online.off('revoke', revoke); revoke(); rates.clear(); } };
}
