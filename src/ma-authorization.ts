import { createHash, randomBytes } from 'node:crypto';
import type { Express } from 'express';
import { z } from 'zod';
import { AppError } from './model.js';
import type { IntegrationManager } from './integrations.js';
import { MusicAssistantClient } from './music-assistant.js';
import { MusicAssistantTransport, musicAssistantUrl, maToken } from './music-assistant-transport.js';
import { readServerInfo } from './ma-discovery.js';
import { body, rawCookie } from './http-utils.js';
import { browserOrigin, ingressContext, requestBase } from './ingress.js';

const cookieName = 'aoty_ma_login';
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
type Transaction = { browserHash: string; origin: string; base: string; userId?: string; url: string; browserUrl: string; serverId: string; revision: number; expires: number };
const random = () => randomBytes(32).toString('base64url');
const tokenClaims = (token: string): { jti?: string; exp?: number } => {
  try { return z.object({ jti: z.string().max(200).optional(), exp: z.number().int().positive().optional() }).parse(JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString('utf8'))); }
  catch { return {}; }
};

/** MA's code parameter IS a credential. Never log requests/queries or return it to the UI. */
export function mountAuthorization(app: Express, integrations: IntegrationManager, changed: () => void,
  readInfo = readServerInfo, now = Date.now) {
  const transactions = new Map<string, Transaction>();
  const prune = () => { for (const [key, value] of transactions) if (value.expires <= now()) transactions.delete(key); };
  const timer = setInterval(prune, 60_000); timer.unref();
  app.post('/api/host/auth/start', async (req, res) => {
    const input = body(req, z.object({ url: musicAssistantUrl, browserUrl: musicAssistantUrl.optional(), revision: z.number().int().nonnegative() }).strict());
    integrations.assertSetupRevision(input.revision); prune();
    if (transactions.size >= 32) throw new AppError(429, 'Too many pending connections. Wait a few minutes and try again.');
    const info = await readInfo(input.url).catch(() => { throw new AppError(502, 'Cannot reach Music Assistant. Check its address and try again.'); });
    if (info.schema_version < 28) throw new AppError(422, 'This Music Assistant version does not support browser authorization. Use advanced setup.');
    if (integrations.serverId && integrations.serverId !== info.server_id) throw new AppError(409, 'This is a different server. Disconnect explicitly before replacing the catalogue.');
    const browserUrl = input.browserUrl ?? input.url;
    if (browserUrl !== input.url && (await readInfo(browserUrl)).server_id !== info.server_id) throw new AppError(422, 'The login address points to a different Music Assistant server.');
    integrations.assertSetupRevision(input.revision);
    const state = random(); const browser = random(); const origin = browserOrigin(req, integrations.guestOrigin); const base = requestBase(req);
    const oldBrowser = rawCookie(req, cookieName);
    if (oldBrowser) for (const [key, tx] of transactions) if (tx.browserHash === digest(oldBrowser)) transactions.delete(key);
    if (transactions.size >= 32) throw new AppError(429, 'Too many pending connections. Try again later.');
    transactions.set(state, { browserHash: digest(browser), origin, base, userId: ingressContext(req)?.userId,
      url: input.url, browserUrl, serverId: info.server_id, revision: input.revision, expires: now() + 10 * 60_000 });
    res.cookie(cookieName, browser, { path: `${base}/api/host/auth`, httpOnly: true, sameSite: 'lax', secure: origin.startsWith('https:'), maxAge: 10 * 60_000 });
    const callback = new URL(`${base}/api/host/auth/callback`, origin); callback.searchParams.set('state', state);
    const login = new URL('/login', browserUrl); login.searchParams.set('return_url', callback.href); login.searchParams.set('device_name', 'Albums of the Year');
    res.json({ loginUrl: login.href });
  });
  app.get('/api/host/auth/callback', async (req, res) => {
    // Always finish at a clean local URL, including failure and malformed callbacks.
    const base = requestBase(req); let result = 'failed'; let minted: string | undefined; let transport: MusicAssistantTransport | undefined;
    try {
      prune(); const state = z.string().regex(/^[A-Za-z0-9_-]{43}$/).parse(req.query.state);
      const tx = transactions.get(state); const browser = rawCookie(req, cookieName);
      const context = ingressContext(req);
      if (!tx || !browser || digest(browser) !== tx.browserHash || tx.base !== base || tx.userId !== context?.userId ||
        (context ? context.origin !== tx.origin : req.headers.host !== new URL(tx.origin).host)) throw new Error();
      transactions.delete(state); // Consume before network I/O: callbacks cannot race/replay.
      res.clearCookie(cookieName, { path: `${base}/api/host/auth`, httpOnly: true, sameSite: 'lax', secure: tx.origin.startsWith('https:') });
      integrations.assertSetupRevision(tx.revision);
      if (req.query.error !== undefined) { result = 'cancelled'; throw new Error(); }
      const code = maToken.parse(req.query.code);
      if ((await readInfo(tx.url)).server_id !== tx.serverId) throw new Error();
      // Authenticated inventory proves the session before a credential is created.
      const report = await new MusicAssistantClient(tx.url, code).inspect();
      if (report.serverId !== tx.serverId) throw new Error();
      integrations.assertSetupRevision(tx.revision);
      transport = new MusicAssistantTransport(tx.url, code);
      minted = maToken.parse(await transport.read('/api', 'auth/token/create', { name: 'Albums of the Year' }));
      const expiresAt = tokenClaims(minted).exp;
      await integrations.saveAuthorized(tx.url, minted, tx.serverId, tx.browserUrl, tx.revision, expiresAt ? expiresAt * 1000 : undefined);
      minted = undefined; result = 'connected'; changed();
    } catch {
      // Best-effort cleanup of ONLY the token minted by this failed transaction.
      // Never revoke the user's existing MA login token or previously saved connection.
      const id = minted && tokenClaims(minted).jti;
      if (id && transport) await transport.read('/api', 'auth/token/revoke', { token_id: id }).catch(() => {});
    }
    res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
    res.redirect(303, `${base}/host/settings?ma_auth=${result}`);
  });
  return () => { clearInterval(timer); transactions.clear(); };
}
