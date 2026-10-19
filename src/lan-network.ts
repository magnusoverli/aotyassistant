import { lookup } from 'node:dns/promises';
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
export function isAllowedAddress(value: string): boolean {
  if (!ipaddr.isValid(value)) return false;
  let address = ipaddr.parse(value);
  if (address.kind() === 'ipv6' && (address as ipaddr.IPv6).isIPv4MappedAddress()) address = (address as ipaddr.IPv6).toIPv4Address();
  return ['private', 'loopback', 'uniqueLocal'].includes(address.range());
}
export const lookupAll = (hostname: string) => lookup(hostname, { all: true });
export async function resolveLanAddresses(hostname: string, timeout: number, resolve = lookupAll, signal?: AbortSignal) {
  let timer: NodeJS.Timeout | undefined; let aborted: (() => void) | undefined;
  try {
    if (signal?.aborted) throw new AppError(499, 'Catalogue request cancelled.');
    const addresses = isIP(hostname) ? [{ address: hostname, family: isIP(hostname) }] : await Promise.race([
      resolve(hostname),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new AppError(504, 'Music Assistant did not respond in time. Check LAN connectivity.')), Math.max(1, timeout)); timer.unref();
        aborted = () => reject(new AppError(499, 'Catalogue request cancelled.')); signal?.addEventListener('abort', aborted, { once: true });
        if (signal?.aborted) aborted();
      }),
    ]);
    if (!addresses.length || addresses.some(a => !isAllowedAddress(a.address))) throw new AppError(422, 'Use a private LAN or loopback Music Assistant address. Public, link-local, and metadata-service addresses are blocked.');
    return addresses;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(502, 'Cannot resolve the Music Assistant hostname. Check its LAN address.');
  } finally { clearTimeout(timer); if (aborted) signal?.removeEventListener('abort', aborted); }
}
