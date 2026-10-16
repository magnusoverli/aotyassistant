import { randomUUID } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import ipaddr from 'ipaddr.js';
import { z } from 'zod';
import { AppError } from './model.js';

export const musicAssistantUrl = z.string().trim().max(2048).url().transform((value, context) => {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash || url.hostname.toLowerCase() === 'supervisor') {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Use the Music Assistant HTTP(S) origin, without credentials, paths, query, or fragment.' });
    return z.NEVER;
  }
  return url.origin;
});
export const maToken = z.string().trim().min(1).max(8192).regex(/^[\x21-\x7e]+$/);
export type ArtworkData = { body: Buffer; contentType: string };
type Path = '/info' | '/api-docs' | '/api' | `/imageproxy/${string}`;

export function isAllowedAddress(value: string): boolean {
  if (!ipaddr.isValid(value)) return false;
  let address = ipaddr.parse(value);
  if (address.kind() === 'ipv6' && (address as ipaddr.IPv6).isIPv4MappedAddress()) address = (address as ipaddr.IPv6).toIPv4Address();
  return ['private', 'loopback', 'uniqueLocal'].includes(address.range());
}

/** Network policy only: pinned LAN DNS, bounded responses/deadlines and sanitized failures. */
export class MusicAssistantTransport {
  constructor(private origin: string, private token: string, private timeoutMs = 8000) {}

  async read(path: Path, command?: string, args = {}, binary = false): Promise<unknown> {
    const url = new URL(path, musicAssistantUrl.parse(this.origin));
    const hostname = url.hostname.replace(/^\[|\]$/g, '');
    let addresses: { address: string; family: number }[];
    let dnsTimer: NodeJS.Timeout | undefined;
    try {
      addresses = isIP(hostname) ? [{ address: hostname, family: isIP(hostname) }]
        : await Promise.race([
          lookup(hostname, { all: true }),
          new Promise<never>((_resolve, reject) => { dnsTimer = setTimeout(() => reject(new Error()), this.timeoutMs); dnsTimer.unref(); }),
        ]);
    } catch { throw new AppError(502, 'Cannot resolve the Music Assistant hostname. Check its LAN address.'); }
    finally { clearTimeout(dnsTimer); }
    if (!addresses.length || addresses.some(a => !isAllowedAddress(a.address))) throw new AppError(422, 'Use a private LAN or loopback Music Assistant address. Public, link-local, and metadata-service addresses are blocked.');
    const target = addresses[0]!;
    const payload = command ? JSON.stringify({ message_id: randomUUID(), command, args }) : undefined;
    return new Promise((resolve, reject) => {
      const fail = (status: number, message: string) => reject(new AppError(status, message));
      const request = (url.protocol === 'https:' ? httpsRequest : httpRequest)(url, {
        method: command ? 'POST' : 'GET', agent: false,
        // A checked DNS result is used by the socket, preventing a second/rebound lookup.
        lookup: (_hostname, options, callback) => options.all ? callback(null, addresses) : callback(null, target.address, target.family),
        headers: { Accept: binary ? 'image/png,image/jpeg,image/webp' : path === '/api-docs' ? 'text/html' : 'application/json',
          ...(payload || binary ? { Authorization: `Bearer ${this.token}` } : {}),
          ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}) },
      }, response => {
        const status = response.statusCode ?? 500;
        if (status !== 200) {
          response.destroy();
          if (status === 401 || status === 403) fail(502, 'Music Assistant rejected the token or its permissions. Replace the token and check again.');
          else if (status >= 300 && status < 400) fail(502, 'Music Assistant redirected the request. Use its direct LAN API origin; redirects are not followed.');
          else fail(502, 'Music Assistant did not accept the request. Check setup and the deployed API documentation.');
          return;
        }
        const chunks: Buffer[] = []; let size = 0;
        response.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > 2 * 1024 * 1024) { response.destroy(); fail(502, 'Music Assistant returned an oversized response.'); }
          else chunks.push(chunk);
        });
        response.on('error', () => fail(502, 'Music Assistant connection was interrupted. Check the address and try again.'));
        response.on('end', () => {
          if (path === '/api-docs') { resolve(true); return; }
          const body = Buffer.concat(chunks);
          if (binary) {
            let contentType = '';
            if (body.length >= 24 && body.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) && body.readUInt32BE(16) <= 4096 && body.readUInt32BE(20) <= 4096) contentType = 'image/png';
            else if (body.length > 3 && body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff) contentType = 'image/jpeg';
            else if (body.length > 12 && body.toString('ascii', 0, 4) === 'RIFF' && body.toString('ascii', 8, 12) === 'WEBP') contentType = 'image/webp';
            if (!contentType) { fail(502, 'Artwork is unavailable or not a supported raster image.'); return; }
            resolve({ body, contentType } satisfies ArtworkData); return;
          }
          try { resolve(JSON.parse(body.toString('utf8'))); }
          catch { fail(502, 'Music Assistant returned an unsupported response. Check the deployed API documentation.'); }
        });
      });
      // Absolute request deadline, including the response body; activity cannot extend it.
      const timer = setTimeout(() => { request.destroy(); fail(504, 'Music Assistant did not respond in time. Check LAN connectivity.'); }, this.timeoutMs);
      timer.unref(); request.on('close', () => clearTimeout(timer));
      request.on('error', () => fail(502, 'Cannot connect to Music Assistant. Check its LAN URL and trusted TLS certificate.'));
      if (payload) request.write(payload); request.end();
    });
  }
}
