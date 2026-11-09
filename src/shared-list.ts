import { lookup as dnsLookup } from 'node:dns/promises';
import { request } from 'node:https';
import type { IncomingMessage } from 'node:http';
import { isIP, type LookupFunction } from 'node:net';
import ipaddr from 'ipaddr.js';
import { z } from 'zod';
import { AppError } from './model.js';

/** A list shared from SuShe Online: a public link that works for one week, `https://<host>/lr/<token>`.
 * The server opens it like any public web address. Nothing about the apps is linked or configured. */
export const sharedListLimits = { bytes: 512 * 1024, songs: 500, timeoutMs: 10_000 } as const;
const text = z.string().trim().min(1).max(500);
export const sharedSongSchema = z.object({
  rank: z.number().int().min(1).max(100_000),
  artist: text, title: text, album: z.string().trim().max(500).catch(''),
  trackNumber: z.number().int().min(1).max(1000).nullable().catch(null),
  duration: z.number().int().min(1).max(24 * 60 * 60).nullable().catch(null),
  albumLinks: z.array(z.object({ service: z.string().max(40), url: z.string().max(2000) })).max(10).catch([]),
});
export type SharedSong = z.infer<typeof sharedSongSchema>;
const listSchema = z.object({
  format: z.literal('sushe-listening-room'), version: z.literal(1),
  list: z.object({ name: text, year: z.number().int().nullable().catch(null) }),
  leftOut: z.object({ noPick: z.number().int().min(0).catch(0), disqualified: z.number().int().min(0).catch(0) }).catch({ noPick: 0, disqualified: 0 }),
  songs: z.array(z.unknown()).max(sharedListLimits.songs),
});
export type SharedList = { list: { name: string; year: number | null }; leftOut: { noPick: number; disqualified: number }; songs: SharedSong[] };

const notALink = 'Paste the link from SuShe Online’s Share to Listening Room window.';
/** Finds the share link in pasted text, such as a whole chat message. */
export function sharedListLink(input: string): URL {
  const found = /https?:\/\/[^\s<>"'`]+/i.exec(input)?.[0]?.replace(/[),.;:!?\]]+$/, '');
  if (!found) throw new AppError(422, notALink);
  let url: URL;
  try { url = new URL(found); } catch { throw new AppError(422, notALink); }
  if (url.protocol !== 'https:') throw new AppError(422, 'The link must start with https://. Copy it from SuShe Online’s share window.');
  if (url.username || url.password) throw new AppError(422, notALink);
  const path = url.pathname.replace(/\/$/, '');
  if (!/\/lr\/[A-Za-z0-9_-]{22}$/.test(path)) throw new AppError(422, `This isn’t a SuShe Online share link. ${notALink}`);
  return new URL(`${url.origin}${path}`);
}

/** Only addresses on the public internet: never this machine or the home network. */
export function publicAddress(address: string) {
  return ipaddr.isValid(address) && ipaddr.process(address).range() === 'unicast';
}

/** Reads the shared JSON, validating each song separately so one odd entry never blocks the rest. */
export function parseSharedList(value: unknown): SharedList & { skipped: number } {
  const version = z.object({ format: z.literal('sushe-listening-room'), version: z.number() }).safeParse(value);
  if (!version.success) throw new AppError(502, 'This link didn’t return a SuShe Online list. Copy the link from SuShe Online’s share window.');
  if (version.data.version !== 1) throw new AppError(422, 'This list comes from a newer SuShe Online. Update Doom Room to import it.');
  const parsed = listSchema.safeParse(value);
  if (!parsed.success) throw new AppError(502, 'SuShe Online returned a list Doom Room can’t read. Try sharing the list again.');
  const songs: SharedSong[] = []; let skipped = 0;
  for (const raw of parsed.data.songs) {
    const song = sharedSongSchema.safeParse(raw);
    if (song.success) songs.push(song.data); else skipped++;
  }
  return { list: parsed.data.list, leftOut: parsed.data.leftOut, songs, skipped };
}

type Address = { address: string; family: number };
export type SharedListTransport = (url: URL, address: Address, signal: AbortSignal) => Promise<IncomingMessage>;
type Options = { resolve?: (hostname: string) => Promise<Address[]>; transport?: SharedListTransport; timeoutMs?: number };

const resolveHost = (hostname: string) => dnsLookup(hostname, { all: true, verbatim: true });
/** Connects to the already checked address, so a second DNS answer can never point elsewhere. */
const httpsTransport: SharedListTransport = (url, address, signal) => new Promise((resolve, reject) => {
  const lookup: LookupFunction = (_hostname, options, callback) => {
    if (options.all) callback(null, [address]); else callback(null, address.address, address.family);
  };
  const outgoing = request(url, { method: 'GET', agent: false, lookup, signal,
    headers: { Accept: 'application/json', 'User-Agent': 'Doom Room (+https://github.com/magnusoverli/aotyassistant)' } }, resolve);
  outgoing.on('error', reject); outgoing.end();
});

async function readBody(response: IncomingMessage, limit: number) {
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of response) {
    size += (chunk as Buffer).length;
    if (size > limit) { response.destroy(); throw new AppError(502, 'This shared list is too large to import.'); }
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** Opens a share link: https only, public addresses only, no redirects, and small time and size limits. */
export async function fetchSharedList(link: URL, options: Options = {}): Promise<SharedList & { skipped: number }> {
  const signal = AbortSignal.timeout(options.timeoutMs ?? sharedListLimits.timeoutMs);
  const hostname = link.hostname.replace(/^\[|\]$/g, '');
  let addresses: Address[];
  try { addresses = isIP(hostname) ? [{ address: hostname, family: isIP(hostname) }] : await (options.resolve ?? resolveHost)(hostname); }
  catch { throw new AppError(422, 'The link’s address could not be found. Check the link and try again.'); }
  // Connect only to public addresses; a host that has none is never contacted.
  const address = addresses.find(candidate => publicAddress(candidate.address));
  if (!address) throw new AppError(422, 'Doom Room only opens links on the public internet, not on your home network.');
  let response: IncomingMessage;
  try { response = await (options.transport ?? httpsTransport)(link, address, signal); }
  catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? '';
    if (/CERT|SSL|TLS|SELF_SIGNED/i.test(code)) throw new AppError(502, 'SuShe Online’s secure connection could not be verified.');
    throw new AppError(502, 'SuShe Online could not be reached. Try again later.');
  }
  try {
    const status = response.statusCode ?? 0;
    if (status === 404 || status === 410) throw new AppError(404, 'This link no longer works. Shared links last one week; share the list again in SuShe Online.');
    if (status >= 300 && status < 400) throw new AppError(422, 'This link points somewhere else. Copy the link from SuShe Online’s share window.');
    if (status !== 200) throw new AppError(502, `SuShe Online couldn’t share the list right now (error ${status}). Try again later.`);
    if (!/^application\/json\b/i.test(response.headers['content-type'] ?? '')) throw new AppError(502, 'This link didn’t return a SuShe Online list. Copy the link from SuShe Online’s share window.');
    let value: unknown;
    try { value = JSON.parse(await readBody(response, sharedListLimits.bytes)); }
    catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(502, signal.aborted ? 'SuShe Online took too long to answer. Try again.' : 'SuShe Online returned a list Doom Room can’t read.');
    }
    return parseSharedList(value);
  } finally { response.destroy(); }
}
