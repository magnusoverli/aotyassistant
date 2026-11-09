import type { CatalogueTrack } from './model.js';
import type { SharedSong } from './shared-list.js';

/** What finding a shared song needs from Music Assistant. */
export type SongFinder = {
  /** `providers` limits the search to some sources ("library" and service domains). */
  search(query: string, providers?: string[]): Promise<CatalogueTrack[]>;
  /** One album's tracks in album order, by a streaming service's own album ID. */
  serviceAlbumTracks(provider: string, itemId: string): Promise<CatalogueTrack[]>;
  /** The connected services by domain, when known. */
  providers?: readonly string[];
};

/** Lowercase letters and digits only. `loose` also drops bracketed parts, "- Remastered"-style
 * suffixes and featured artists, which services write differently. */
export function normalized(value: string, loose = false) {
  let result = value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[’'`]/g, '').replace(/&/g, ' and ');
  if (loose) result = result.replace(/[([{][^)\]}]*[)\]}]/g, ' ').replace(/\s[-–—]\s.*$/, ' ').replace(/\b(?:feat|ft|featuring)\b.*$/, ' ');
  return result.replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}
/** Each credited artist, so "A & B" matches "A, B" and "The National" matches "National". */
export function artistNames(value: string) {
  return value.split(/\s*(?:,|;|\/|\+|&)\s*|\s+(?:and|x|with|feat\.?|ft\.?|featuring)\s+/i)
    .map(name => normalized(name).replace(/^the /, '')).filter(Boolean);
}
const sameArtist = (a: string, b: string) => { const names = new Set(artistNames(b)); return artistNames(a).some(name => names.has(name)); };

/** The Music Assistant provider and album ID behind a shared album link, when it can be read. */
export function albumReference(link: { service: string; url: string }): { provider: string; itemId: string } | undefined {
  let url: URL;
  try { url = new URL(link.url); } catch { return; }
  if (url.protocol !== 'https:') return;
  const host = url.hostname.toLowerCase().replace(/^www\./, ''); const path = url.pathname;
  const match = (provider: string, pattern: RegExp) => { const id = pattern.exec(path)?.[1]; return id ? { provider, itemId: id } : undefined; };
  if (host === 'open.spotify.com') return match('spotify', /^\/(?:intl-[a-z-]+\/)?album\/([A-Za-z0-9]{22})\/?$/);
  if (host === 'tidal.com' || host === 'listen.tidal.com') return match('tidal', /^\/(?:browse\/)?album\/(\d{1,20})\/?$/);
  if (host === 'open.qobuz.com' || host === 'play.qobuz.com') return match('qobuz', /^\/album\/([A-Za-z0-9]{1,40})\/?$/);
  if (host === 'qobuz.com') return match('qobuz', /^\/[a-z]{2}-[a-z]{2}\/album\/[^/]+\/([A-Za-z0-9]{1,40})\/?$/);
  if (host === 'music.apple.com' || host === 'itunes.apple.com') return match('apple_music', /^\/[a-z]{2}\/album\/(?:[^/]+\/)?(?:id)?(\d{1,20})\/?$/);
  if (host === 'deezer.com') return match('deezer', /^\/(?:[a-z]{2}\/)?album\/(\d{1,20})\/?$/);
}

/** Words that mark a different recording. Both sides must agree on them: a live or
 * remixed track is never taken for the original, nor the other way round. */
const recordingWords = ['live', 'remix', 'instrumental', 'acoustic', 'demo', 'karaoke'];
const recordingKind = (value: string) => { const words = new Set(normalized(value).split(' ')); return recordingWords.filter(word => words.has(word)).join(' '); };
/** Higher is better; undefined means "not this song". */
function score(song: SharedSong, track: CatalogueTrack, checkArtist: boolean) {
  if (!track.available) return;
  const exact = normalized(song.title) === normalized(track.title);
  if (!exact && normalized(song.title, true) !== normalized(track.title, true)) return;
  if (recordingKind(song.title) !== recordingKind(`${track.title} ${track.version}`)) return;
  if (checkArtist && !sameArtist(song.artist, track.artist)) return;
  const difference = song.duration && track.duration ? Math.abs(song.duration - track.duration) : undefined;
  if (difference !== undefined && difference > 20) return;
  let points = exact ? 6 : 3;
  if (difference !== undefined) points += difference <= 3 ? 2 : difference <= 10 ? 1 : 0;
  const album = normalized(song.album, true); const other = normalized(track.album, true);
  if (album && other) points += album === other ? 2 : album.includes(other) || other.includes(album) ? 1 : 0;
  return points;
}
/** The best matching track, or undefined. The first of equal matches wins (Music Assistant's order). */
export function bestMatch(song: SharedSong, tracks: CatalogueTrack[], checkArtist = true) {
  let best: { track: CatalogueTrack; points: number } | undefined;
  for (const track of tracks) {
    const points = score(song, track, checkArtist);
    if (points !== undefined && (!best || points > best.points)) best = { track, points };
  }
  return best?.track;
}

/** Music Assistant limits each service's requests: Spotify's shared login allows one every 2 seconds,
 * Deezer 1, Qobuz 2 and Tidal 4 a second. Faster services are tried first; slow ones only when needed. */
export const serviceSpeed = ['tidal', 'qobuz', 'deezer', 'apple_music', 'ytmusic', 'soundcloud'];
export const slowServices = new Set(['spotify']);
const speedRank = (provider: string) => slowServices.has(provider) ? 99 : serviceSpeed.includes(provider) ? serviceSpeed.indexOf(provider) : serviceSpeed.length;

type Step = { kind: 'album'; provider: string; itemId: string } | { kind: 'search'; providers?: string[] };
/** The lookups for one song, cheapest first: albums on fast services, a search of the library and fast
 * services, then albums and a search on slow services. Unknown connections search everything once. */
export function songSteps(song: SharedSong, connected?: readonly string[]): Step[] {
  const albums = new Map<string, { provider: string; itemId: string }>();
  for (const link of song.albumLinks) {
    const reference = albumReference(link);
    if (reference && (!connected || connected.includes(reference.provider))) albums.set(`${reference.provider}:${reference.itemId}`, reference);
  }
  const sorted = [...albums.values()].sort((a, b) => speedRank(a.provider) - speedRank(b.provider));
  const album = (fast: boolean) => sorted.filter(item => slowServices.has(item.provider) !== fast).map(item => ({ kind: 'album' as const, ...item }));
  if (!connected) return [...album(true), ...album(false), { kind: 'search' }];
  const slow = connected.filter(provider => slowServices.has(provider));
  return [...album(true), { kind: 'search', providers: ['library', ...connected.filter(provider => !slowServices.has(provider))] },
    ...album(false), ...(slow.length ? [{ kind: 'search' as const, providers: slow }] : [])];
}

/** Finds one shared song with the fewest and fastest lookups. Throws only when no lookup could be made at all. */
export async function findSong(finder: SongFinder, song: SharedSong): Promise<CatalogueTrack | undefined> {
  let failure: unknown; let checked = false;
  // A second search without "(Remastered)"-style extras, only when the title has them.
  const loose = normalized(song.title, true);
  const queries = [`${song.artist} ${song.title}`, ...(loose && loose !== normalized(song.title) ? [`${song.artist} ${loose}`] : [])];
  for (const step of songSteps(song, finder.providers)) {
    if (step.kind === 'album') {
      let tracks: CatalogueTrack[];
      // The service may not have the album; the next step follows.
      try { tracks = await finder.serviceAlbumTracks(step.provider, step.itemId); checked = true; } catch (error) { failure ??= error; continue; }
      const found = bestMatch(song, tracks, false);
      if (found) return found;
      // Same album, renamed track: its position, when the lengths agree.
      const numbered = song.trackNumber ? tracks[song.trackNumber - 1] : undefined;
      if (numbered?.available && song.duration && numbered.duration && Math.abs(song.duration - numbered.duration) <= 5) return numbered;
      continue;
    }
    for (const query of queries) {
      try { const found = bestMatch(song, await finder.search(query, step.providers)); checked = true; if (found) return found; }
      catch (error) { failure ??= error; }
    }
  }
  if (!checked && failure) throw failure;
}

/** At most this many requests per service wait in Music Assistant's queue at once, across all imports.
 * More would only queue longer inside Music Assistant and run into time limits. */
const serviceCapacity: Record<string, number> = { spotify: 1, deezer: 1, qobuz: 2, tidal: 3, library: 4 };
export class ServiceGates {
  private active = new Map<string, number>();
  private waiting = new Map<string, (() => void)[]>();
  constructor(private capacity: Record<string, number> = serviceCapacity, private fallback = 2) {}
  /** The gate for a lookup: the slowest service it touches. */
  static key(providers: readonly string[] | undefined) {
    if (!providers) return 'spotify'; // An unrestricted search reaches every service, Spotify included.
    return [...providers].sort((a, b) => (serviceCapacity[a] ?? 2) - (serviceCapacity[b] ?? 2))[0] ?? 'library';
  }
  async run<T>(key: string, work: () => Promise<T>): Promise<T> {
    const active = this.active.get(key) ?? 0;
    // A finished request hands its slot straight to the next in line, so newcomers cannot jump ahead.
    if (active >= (this.capacity[key] ?? this.fallback)) await new Promise<void>(resolve => { const queue = this.waiting.get(key) ?? []; queue.push(resolve); this.waiting.set(key, queue); });
    else this.active.set(key, active + 1);
    try { return await work(); }
    finally {
      const next = this.waiting.get(key)?.shift();
      if (next) next(); else this.active.set(key, this.active.get(key)! - 1);
    }
  }
}

/** The same song in anyone's list: so a song another person already imported is found instantly. */
export function songKey(song: SharedSong) {
  return JSON.stringify([normalized(song.artist), normalized(song.title), normalized(song.album, true), song.trackNumber, song.duration]);
}
