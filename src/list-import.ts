import type { CatalogueTrack } from './model.js';
import type { SharedSong } from './shared-list.js';

/** What finding a shared song needs from Music Assistant. */
export type SongFinder = {
  search(query: string): Promise<CatalogueTrack[]>;
  /** One album's tracks in album order, by a streaming service's own album ID. */
  serviceAlbumTracks(provider: string, itemId: string): Promise<CatalogueTrack[]>;
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

/** Finds one shared song: on its own album when a link names it, otherwise by searching. */
export async function findSong(finder: SongFinder, song: SharedSong): Promise<CatalogueTrack | undefined> {
  let failure: unknown; let searched = false;
  const references = new Map<string, { provider: string; itemId: string }>();
  for (const link of song.albumLinks) { const reference = albumReference(link); if (reference) references.set(`${reference.provider}:${reference.itemId}`, reference); }
  for (const reference of references.values()) {
    let tracks: CatalogueTrack[];
    // The service may not be connected in Music Assistant; the next link or a search follows.
    try { tracks = await finder.serviceAlbumTracks(reference.provider, reference.itemId); } catch { continue; }
    const found = bestMatch(song, tracks, false);
    if (found) return found;
    // Same album, renamed track: its position, when the lengths agree.
    const numbered = song.trackNumber ? tracks[song.trackNumber - 1] : undefined;
    if (numbered?.available && song.duration && numbered.duration && Math.abs(song.duration - numbered.duration) <= 5) return numbered;
  }
  // A second search without "(Remastered)"-style extras, only when the title has them.
  const loose = normalized(song.title, true);
  const queries = [`${song.artist} ${song.title}`, ...(loose && loose !== normalized(song.title) ? [`${song.artist} ${loose}`] : [])];
  for (const query of queries) {
    try { const found = bestMatch(song, await finder.search(query)); searched = true; if (found) return found; }
    catch (error) { failure ??= error; }
  }
  if (!searched && failure) throw failure;
}
