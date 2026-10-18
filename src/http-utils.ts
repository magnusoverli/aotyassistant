import type { Request, Response } from 'express';
import { z } from 'zod';

/** Old open tabs may still ask for 128; normalize it before reaching MA or the image cache. */
export const artworkSize = z.enum(['128', '160', '512', '1024']).default('512')
  .transform(size => size === '128' || size === '160' ? 160 : size === '1024' ? 1024 : 512);

export const body = <T extends z.ZodTypeAny>(request: Request, schema: T): z.infer<T> => schema.parse(request.body);

export const rawCookie = (request: Request, name: string): string =>
  request.headers.cookie?.split(';').map(value => value.trim()).find(value => value.startsWith(`${name}=`))?.slice(name.length + 1) ?? '';

export function setPrivateCookie(response: Response, name: string, value: string, path: string, origin: string) {
  response.cookie(name, value, { path, httpOnly: true, sameSite: 'strict', secure: origin.startsWith('https:'), maxAge: 365 * 24 * 60 * 60_000 });
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
