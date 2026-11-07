import { randomBytes } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Express, Request, Response } from 'express';
import { z } from 'zod';
import { BrowserSpeakers, requestSpeakerCookie, speakerCookie, speakerPath, speakerRegistration, type SpeakerContext } from './browser-speakers.js';
import { ingressContext, validateIngress } from './ingress.js';
import { publicContext, onlineCookie } from './public-listener.js';
import type { OnlineAccess } from './online-access.js';
import { AppError } from './model.js';
import { body } from './http-utils.js';

export function speakerContext(req: IncomingMessage, kind: SpeakerContext['kind'], guestOrigin: string, port: number, online?: OnlineAccess): SpeakerContext | undefined {
  if (kind === 'ingress') {
    const ingress = ingressContext(req) ?? validateIngress(req);
    if (ingress) return { ...ingress, kind, valid: () => true };
    return;
  }
  if (kind === 'public') {
    const origin = online?.origin; const grant = onlineCookie(req);
    const peer = req.socket.remoteAddress?.replace(/^::ffff:/, '');
    if (!online || !origin || !['127.0.0.1', '::1'].includes(peer ?? '') || req.headers.host !== new URL(origin).host || !online.authorized(grant)) return;
    return { kind, origin, base: '', valid: () => online.origin === origin && online.authorized(grant) };
  }
  const host = req.headers.host;
  if (![new URL(guestOrigin).host, `localhost:${port}`, `127.0.0.1:${port}`].includes(host ?? '')) return;
  const origin = host === new URL(guestOrigin).host ? guestOrigin : `http://${host}`;
  return { kind, origin, base: '', valid: () => true };
}

export function mountBrowserSpeakers(app: Express, speakers: BrowserSpeakers, guestOrigin: () => string, port: number, online?: OnlineAccess, username: (req: Request) => string | undefined = () => undefined) {
  const context = (req: Request) => {
    const result = speakerContext(req, ingressContext(req) ? 'ingress' : publicContext(req) ? 'public' : 'lan', guestOrigin(), port, online);
    if (!result) throw new AppError(403, 'Browser speaker access is unavailable.');
    return result;
  };
  const id = z.string().uuid();
  const refreshCookie = (req: Request, res: Response, c: SpeakerContext) => {
    const existing = requestSpeakerCookie(req);
    res.cookie(speakerCookie, /^[A-Za-z0-9_-]{43}$/.test(existing) ? existing : randomBytes(32).toString('base64url'), {
      httpOnly: true, secure: c.origin.startsWith('https:'), sameSite: 'strict', path: `${c.base}/api`, maxAge: 24 * 60 * 60_000,
    });
  };
  app.get(`${speakerPath}/info`, (req, res) => {
    const c = context(req); const info = speakers.info(); refreshCookie(req, res, c);
    res.json(info);
  });
  app.post(`${speakerPath}/register`, (req, res) => res.json(speakers.register(body(req, speakerRegistration), requestSpeakerCookie(req), context(req), username(req))));
  app.get(`${speakerPath}/session/:id`, (req, res) => {
    const c = context(req); const session = speakers.status(id.parse(req.params.id), requestSpeakerCookie(req), c, username(req));
    refreshCookie(req, res, c); res.json(session);
  });
  app.post(`${speakerPath}/pair`, async (req, res) => {
    const input = body(req, z.object({ id, token: z.string().max(110) }).strict());
    res.json(await speakers.pair(input.id, requestSpeakerCookie(req), context(req), input.token));
  });
  app.post(`${speakerPath}/stop`, (req, res) => {
    const input = body(req, z.object({ id }).strict());
    speakers.owned(input.id, requestSpeakerCookie(req), context(req)); speakers.remove(input.id); res.json({ ok: true });
  });
}
