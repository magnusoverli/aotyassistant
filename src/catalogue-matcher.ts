import { presentCatalogueItems, sameCatalogueItem, sameMetadataPresentation, type IdentityMedia } from './catalogue-grouping.js';

type Kind = 'artist' | 'album' | 'track';
const key = (item: IdentityMedia) => JSON.stringify([item.provider, item.item_id]);
const name = (value: string) => value.normalize('NFC').trim().toLowerCase();

/** Compare full, ordered releases, never a title-only or incomplete tracklist. */
export function sameTracklist(a: IdentityMedia[], b: IdentityMedia[]): boolean {
  if (!a.length || a.length >= 500 || a.length !== b.length) return false;
  const positions = (items: IdentityMedia[]) => items.map(t => `${t.disc_number || 1}:${t.track_number || 0}`);
  const left = positions(a); const right = positions(b);
  if (a.some(t => !t.track_number) || b.some(t => !t.track_number) || new Set(left).size !== a.length || new Set(right).size !== b.length) return false;
  const other = new Map(b.map((t, i) => [right[i], t]));
  return a.every((track, i) => {
    const candidate = other.get(left[i]);
    if (!candidate) return false;
    return sameCatalogueItem('track', track, candidate);
  });
}

/** Bounded read-only enrichment. No library writes or provider matching mutations. */
export async function matchCatalogue<T extends IdentityMedia>(kind: Kind, items: T[],
  load: (kind: 'artist' | 'album', item: IdentityMedia) => Promise<IdentityMedia[]>, maximum = 8): Promise<T[][]> {
  let reads = 0;
  let comparisons = 0;
  const requests = new Map<string, Promise<IdentityMedia[]>>();
  const get = (kind: 'artist' | 'album', item: IdentityMedia) => {
    const id = `${kind}:${key(item)}`;
    let result = requests.get(id);
    if (!result) {
      result = reads++ < maximum ? load(kind, item).catch(() => []) : Promise.resolve([]);
      requests.set(id, result);
    }
    return result;
  };
  const equivalent = async (a: T, b: T): Promise<boolean> => {
    if (++comparisons > 20_000) return false;
    if (sameCatalogueItem(kind, a, b)) return true;
    if (a.provider === b.provider || !sameMetadataPresentation(kind, a, b)) return false;
    if (kind === 'track') return false; // Presentation alone never authorizes playback substitution.
    const [left, right] = await Promise.all([get(kind, a), get(kind, b)]);
    if (kind === 'album') return sameTracklist(left, right);
    const ownRelease = (album: IdentityMedia, artist: IdentityMedia) => album.artists?.length === 1 && name(album.artists[0]!.name) === name(artist.name);
    for (const album of left.filter(album => ownRelease(album, a))) for (const other of right.filter(album => ownRelease(album, b))) {
      if (++comparisons > 20_000) return false;
      if (sameCatalogueItem('album', album, other)) return true;
      if (!sameMetadataPresentation('album', album, other)) continue;
      const [tracks, otherTracks] = await Promise.all([get('album', album), get('album', other)]);
      if (sameTracklist(tracks, otherTracks)) return true;
    }
    return false;
  };
  const groups: T[][] = [];
  for (const candidate of presentCatalogueItems(kind, items)) {
    if (candidate.matchKind === 'identity') { groups.push(candidate.items); continue; }
    const confirmed: T[][] = [];
    for (const item of candidate.items) {
      let joined = false;
      for (const group of confirmed) {
        let matches = true;
        for (const member of group) if (!await equivalent(member, item)) { matches = false; break; }
        if (matches) { group.push(item); joined = true; break; }
      }
      if (!joined) confirmed.push([item]);
    }
    groups.push(...confirmed);
  }
  return groups;
}
