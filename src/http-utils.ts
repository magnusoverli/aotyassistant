import { createHash } from 'node:crypto';
import { gzip } from 'node:zlib';
import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { ingressContext, requestBase } from './ingress.js';
import { publicContext } from './public-listener.js';
import type { ArtworkData } from './music-assistant-transport.js';

/** Old open tabs may still ask for 128; normalize it before reaching MA or the image cache. */
export const artworkSize = z.enum(['128', '160', '512', '1024']).default('512')
  .transform(size => size === '128' || size === '160' ? 160 : size === '1024' ? 1024 : 512);

export const body = <T extends z.ZodTypeAny>(request: Request, schema: T): z.infer<T> => schema.parse(request.body);

// Change when resizing or encoding changes, so browsers fetch the new pixels.
const artworkFormat = 'jpeg-1';
/** Stored artwork revalidates on every reuse. Callers authorize and resolve `key`
 * (the pixels' identity) first, so a matching browser copy needs no image read. */
export async function sendArtwork(req: Request, res: Response, key: string, read: () => Promise<ArtworkData>, recheck: () => unknown = () => {}) {
  res.set('Cache-Control', 'private, no-cache').vary('Cookie');
  res.set('ETag', `W/"${createHash('sha256').update(`${artworkFormat}:${key}`).digest('base64url').slice(0, 27)}"`);
  if (req.fresh) { await recheck(); res.status(304).end(); return; }
  const image = await read(); await recheck();
  res.type(image.contentType).send(image.body);
}

/** Large JSON crosses Funnel's limited bandwidth gzipped. Cross-site requests are
 * already refused, so responses cannot be used as a compression oracle. */
export function compressJson(req: Request, res: Response, next: NextFunction) {
  const json = res.json.bind(res);
  res.json = (value: unknown) => {
    const text = JSON.stringify(value);
    if (text === undefined || text.length < 1024 || !req.acceptsEncodings('gzip')) return json(value);
    gzip(text, (error, data) => {
      if (res.headersSent || res.destroyed) return;
      if (error) { json(value); return; }
      res.vary('Accept-Encoding').set('Content-Encoding', 'gzip').type('json').send(data);
    });
    return res;
  };
  next();
}

export function setPrivateCookie(response: Response, name: string, value: string, path: string, origin: string) {
  response.cookie(name, value, { path, httpOnly: true, sameSite: 'strict', secure: origin.startsWith('https:'), maxAge: 365 * 24 * 60 * 60_000 });
}

export function setParticipantCookie(request: Request, response: Response, name: string, value: string, path: string, configuredOrigin: string) {
  // Forwarded headers are authoritative only on the validated Ingress listener.
  const direct = request.secure ? `https://${request.headers.host}` : new URL(configuredOrigin).host === request.headers.host ? configuredOrigin : `${request.protocol}://${request.headers.host}`;
  const origin = publicContext(request)?.origin ?? ingressContext(request)?.origin ?? direct;
  setPrivateCookie(response, name, value, `${requestBase(request)}${path}`, origin);
}

/** A single satisfiable byte range. null means 416; undefined requests the entire file. */
export function byteRange(header: string | undefined, size: number): { start: number; end: number; status: 200 | 206 } | null {
  if (!Number.isSafeInteger(size) || size <= 0) return null;
  if (header === undefined) return { start: 0, end: size - 1, status: 200 };
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2])) return null;
  const first = match[1] ? Number(match[1]) : undefined;
  const last = match[2] ? Number(match[2]) : undefined;
  if ([first, last].some(value => value !== undefined && (!Number.isSafeInteger(value) || value < 0))) return null;
  if (first === undefined) return last! > 0 ? { start: Math.max(0, size - last!), end: size - 1, status: 206 } : null;
  if (first >= size || (last !== undefined && last < first)) return null;
  return { start: first, end: Math.min(last ?? size - 1, size - 1), status: 206 };
}

export function mediaRange(request: Request, response: Response, size: number, contentType: string) {
  const range = byteRange(request.headers.range, size);
  if (!range) { response.status(416).set('Content-Range', `bytes */${size}`).end(); return null; }
  const { start, end, status } = range;
  response.status(status).set({ 'Content-Type': contentType, 'Content-Length': String(end - start + 1), 'Accept-Ranges': 'bytes',
    ...(status === 206 ? { 'Content-Range': `bytes ${start}-${end}/${size}` } : {}) });
  return range;
}
