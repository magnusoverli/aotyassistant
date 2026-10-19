import { randomBytes, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import ipaddr from 'ipaddr.js';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { errorPage, escapeHtml as escape } from './error-page.js';
import { AppError } from './model.js';
import { isAllowedAddress } from './music-assistant-transport.js';
import { mediaRange } from './http-utils.js';

export const applicationOrigin = z.string().trim().max(2048).url().transform((value, context) => {
  const url = new URL(value); const hostname = url.hostname.replace(/^\[|\]$/g, '');
  const address = isIP(hostname) ? ipaddr.process(hostname) : undefined;
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash ||
    hostname.toLowerCase() === 'supervisor' || (address && !['unicast', 'private', 'loopback', 'uniqueLocal', 'carrierGradeNat'].includes(address.range()))) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Use an application HTTP(S) origin without credentials, paths, query or fragment; unspecified, metadata and multicast addresses are not allowed.' });
    return z.NEVER;
  }
  return url.origin;
});

export type MediaCheck = { status: 'unchecked' | 'checking' | 'verified' | 'failed' | 'expired'; origin: string | null; checkedAt: number | null; message: string };
export type AddressingView = { revision: number; guestOrigin: string; mediaOrigin: string | null; automaticMediaOrigin: string | null;
  effectiveMediaOrigin: string; configured: boolean; mediaCheck: MediaCheck; sequence?: number; instanceId?: string };

/** Recovery/setup only. Never authorize ordinary APIs by trusting an arbitrary Host or forwarded header. */
export function setupHostAllowed(host: string, remote: string) {
  try {
    const url = new URL(`http://${host}`); const hostname = url.hostname.replace(/^\[|\]$/g, '');
    if (url.host !== host || !applicationOrigin.safeParse(url.origin).success || !isAllowedAddress(remote)) return false;
    return isIP(hostname) ? isAllowedAddress(hostname) : /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.local$/i.test(hostname);
  } catch { return false; }
}

/** Browser recovery for a LAN address that has not been configured or verified by Supervisor. */
export function guestAddressHelp(origin: string, path: string) {
  return errorPage('This address needs setup', `
<p>The listening room is using a different guest address. Your saved room and lists are still available.</p>
<p><a href="${escape(origin + path)}">Continue at the saved address (${escape(origin)})</a></p>
<p>If that address no longer works, the host can <a href="/host/settings">open address settings</a> and choose <strong>Use this browser address for guest links</strong>.</p>
`);
}

// A short finite PCM WAV, generated without FFmpeg/filesystem/library imports. It is never queued or played.
export const diagnosticDuration = 3;
const audio = Buffer.alloc(44 + 8000 * 2 * diagnosticDuration);
audio.write('RIFF', 0); audio.writeUInt32LE(audio.length - 8, 4); audio.write('WAVEfmt ', 8); audio.writeUInt32LE(16, 16);
audio.writeUInt16LE(1, 20); audio.writeUInt16LE(1, 22); audio.writeUInt32LE(8000, 24); audio.writeUInt32LE(16000, 28);
audio.writeUInt16LE(2, 32); audio.writeUInt16LE(16, 34); audio.write('data', 36); audio.writeUInt32LE(audio.length - 44, 40);
type CheckLease = { key: string; origin: string; observed: boolean; expires: number };

/** Only synthetic bytes and random, short-lived capabilities. Never serves private uploads or accepts target paths. */
export class MediaChecks {
  private leases = new Set<CheckLease>();
  private closed = false;
  constructor(private now = Date.now) {}
  create(origin: string) {
    if (this.closed) throw new AppError(503, 'File connection checks are shutting down.');
    if (this.leases.size >= 1) throw new AppError(429, 'A file connection check is already running.');
    const lease: CheckLease = { key: randomBytes(32).toString('base64url'), origin: applicationOrigin.parse(origin), observed: false, expires: this.now() + 30_000 };
    this.leases.add(lease);
    const timer = setTimeout(() => this.leases.delete(lease), 30_000); timer.unref();
    const live = this.leases; const now = this.now;
    return { url: `${lease.origin}/api/media/check/${lease.key}/track.wav`, get observed() { return live.has(lease) && lease.expires > now() && lease.observed; },
      revoke: () => { clearTimeout(timer); this.leases.delete(lease); } };
  }
  private find(req: Request) {
    const key = /^\/api\/media\/check\/([A-Za-z0-9_-]{43})\/track\.wav$/.exec(req.path)?.[1];
    if (!key || !['GET', 'HEAD'].includes(req.method)) return undefined;
    return [...this.leases].find(lease => lease.expires > this.now() && new URL(lease.origin).host === req.headers.host && timingSafeEqual(Buffer.from(key), Buffer.from(lease.key)));
  }
  allows(req: Request) { return Boolean(this.find(req)); }
  serve(req: Request, res: Response) {
    const lease = this.find(req); if (!lease) throw new AppError(404, 'Connection check unavailable.');
    const range = mediaRange(req, res, audio.length, 'audio/wav'); if (!range) return;
    if (req.method === 'HEAD') res.end();
    else { lease.observed = true; res.end(audio.subarray(range.start, range.end + 1)); }
  }
  close() { this.closed = true; this.leases.clear(); }
}
