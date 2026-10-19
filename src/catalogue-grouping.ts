/** Private MA identity evidence. Nothing from this module is serialized to participants. */
export type IdentityMedia = {
  item_id: string; provider: string; name: string; version: string;
  external_ids?: [string, string][];
  provider_mappings?: { item_id?: string; provider_instance?: string; provider_domain?: string }[];
  year?: number | null; album_type?: string; artist_type?: string; duration?: number;
  disc_number?: number; track_number?: number;
  artists?: { name: string; external_ids?: [string, string][] }[];
  album?: { name: string; version?: string; year?: number | null; external_ids?: [string, string][] } | null;
  metadata?: { explicit?: boolean | null };
};
type Kind = 'artist' | 'album' | 'track';
const text = (value: string) => value.normalize('NFC').trim().toLowerCase();
function ids(media: { external_ids?: [string, string][] }, type: string) {
  return new Set((media.external_ids ?? []).filter(([key, value]) => key === type &&
    (type.startsWith('musicbrainz_') || type === 'acoustid' ? /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(value)
      : type === 'isrc' ? /^[a-z]{2}[a-z0-9]{3}\d{7}$/i.test(value) : type === 'barcode' && /^\d{12,14}$/.test(value))).map(([, value]) => value.toLowerCase()));
}
function overlap(a: Set<string>, b: Set<string>) { return [...a].some(id => b.has(id)); }
function conflicts(a: { external_ids?: [string, string][] }, b: { external_ids?: [string, string][] }, types: string[]) {
  return types.some(type => { const left = ids(a, type); const right = ids(b, type); return left.size && right.size && !overlap(left, right); });
}
function mappings(media: IdentityMedia) {
  // Instance identity, never a domain-only catalogue guess (local IDs may collide).
  return new Set([JSON.stringify([media.provider, media.item_id]), ...(media.provider_mappings ?? [])
    .filter(p => p.provider_instance && p.item_id).map(p => JSON.stringify([p.provider_instance, p.item_id]))]);
}
export function sameCatalogueItem(kind: Kind, a: IdentityMedia, b: IdentityMedia): boolean {
  const unique = kind === 'artist' ? ['musicbrainz_artistid'] : kind === 'album' ? ['musicbrainz_albumid'] : ['musicbrainz_recordingid', 'isrc'];
  if (conflicts(a, b, unique)) return false;
  if (kind !== 'artist' && !compatibleMetadata(kind, a, b)) return false;
  return overlap(mappings(a), mappings(b)) || unique.some(type => overlap(ids(a, type), ids(b, type)));
}
function compatibleMetadata(kind: Kind, a: IdentityMedia, b: IdentityMedia): boolean {
  if (kind !== 'artist') {
    // Strong IDs do not erase editions, clean/explicit variants or different album appearances.
    if (text(a.name) !== text(b.name) || text(a.version) !== text(b.version)) return false;
    if (a.metadata?.explicit != null && b.metadata?.explicit != null && a.metadata.explicit !== b.metadata.explicit) return false;
    if (kind === 'album' && ((a.year && b.year && a.year !== b.year) ||
      (a.album_type && b.album_type && a.album_type !== 'unknown' && b.album_type !== 'unknown' && a.album_type !== b.album_type))) return false;
    if ((a.artists ?? []).map(x => text(x.name)).join('\0') !== (b.artists ?? []).map(x => text(x.name)).join('\0')) return false;
    for (let i = 0; i < (a.artists?.length ?? 0); i++) {
      const left = ids(a.artists![i]!, 'musicbrainz_artistid'); const right = ids(b.artists![i]!, 'musicbrainz_artistid');
      if (left.size && right.size && !overlap(left, right)) return false;
    }
    if (kind === 'track') {
      if (a.duration && b.duration && a.duration !== b.duration) return false;
      if (a.disc_number && b.disc_number && a.disc_number !== b.disc_number) return false;
      if (a.track_number && b.track_number && a.track_number !== b.track_number) return false;
      if (Boolean(a.album) !== Boolean(b.album)) return false;
      if (a.album && b.album && (text(a.album.name) !== text(b.album.name) || text(a.album.version ?? '') !== text(b.album.version ?? '') ||
        (a.album.year && b.album.year && a.album.year !== b.album.year) || conflicts(a.album, b.album, ['musicbrainz_albumid']))) return false;
    }
  }
  return true;
}

/** Complete-link grouping: an ambiguous bridge cannot join two conflicting identities. */
export function groupCatalogueItems<T extends IdentityMedia>(kind: Kind, items: T[]): T[][] {
  const groups: T[][] = [];
  const index = new Map<string, Set<T[]>>();
  const order = new Map<T[], number>();
  const types = kind === 'artist' ? ['musicbrainz_artistid'] : kind === 'album' ? ['musicbrainz_albumid'] : ['musicbrainz_recordingid', 'isrc'];
  let comparisons = 0;
  for (const item of items) {
    // Splitting choices is safe when evidence work is excessive; guessing a union is not.
    if (comparisons >= 20_000) { groups.push([item]); continue; }
    const keys = [...mappings(item)].map(key => `mapping:${key}`);
    for (const type of types) for (const id of ids(item, type)) keys.push(`${type}:${id}`);
    const candidates = new Set<T[]>();
    for (const key of keys) for (const candidate of index.get(key) ?? []) candidates.add(candidate);
    // Only compare groups sharing authoritative evidence; name collisions do not cause quadratic scans.
    let group = [...candidates].sort((a, b) => order.get(a)! - order.get(b)!)
      .find(members => members.every(member => ++comparisons <= 20_000 && sameCatalogueItem(kind, member, item)));
    if (group) group.push(item);
    else { group = [item]; order.set(group, groups.length); groups.push(group); }
    for (const key of keys) { if (!index.has(key)) index.set(key, new Set()); index.get(key)!.add(group); }
  }
  return groups;
}

/** Presentation compatibility is NOT identity evidence and must never authorize a union browse. */
export function sameMetadataPresentation(kind: Kind, a: IdentityMedia, b: IdentityMedia): boolean {
  if (!text(a.name) || text(a.name) !== text(b.name) || text(a.version) !== text(b.version)) return false;
  // Release-group/barcode/track IDs are vetoes here, never positive evidence of recording equality.
  const unique = kind === 'artist' ? ['musicbrainz_artistid'] : kind === 'album' ? ['musicbrainz_albumid', 'musicbrainz_releasegroupid', 'barcode']
    : ['musicbrainz_recordingid', 'musicbrainz_trackid', 'isrc', 'acoustid'];
  if (conflicts(a, b, unique) || !compatibleMetadata(kind, a, b)) return false;
  if (kind === 'track' && a.album && b.album && conflicts(a.album, b.album, ['musicbrainz_albumid', 'musicbrainz_releasegroupid', 'barcode'])) return false;
  if (kind === 'artist') return !a.artist_type || !b.artist_type || a.artist_type === 'unknown' || b.artist_type === 'unknown' || a.artist_type === b.artist_type;
  if (!a.artists?.length || !b.artists?.length || a.artists.some(artist => !text(artist.name))) return false;
  // Tracks without a meaningful duration/album do not have enough context for this display shortcut.
  return kind !== 'track' || Boolean(a.duration && b.duration && a.album && b.album && text(a.album.name) && text(b.album.name));
}

function metadataKey(kind: Kind, item: IdentityMedia): string {
  return JSON.stringify([text(item.name), text(item.version), kind === 'artist' ? [] : item.artists?.map(a => text(a.name)),
    kind === 'track' ? [item.album && text(item.album.name), text(item.album?.version ?? ''), item.duration] : []]);
}
function evidenceProfile(item: IdentityMedia): string {
  const external = (media: { external_ids?: [string, string][] }) => ['musicbrainz_artistid', 'musicbrainz_albumid', 'musicbrainz_releasegroupid', 'barcode', 'musicbrainz_recordingid', 'musicbrainz_trackid', 'isrc', 'acoustid']
    .map(type => [...ids(media, type)].sort());
  return JSON.stringify([external(item), item.year ?? null, item.album_type ?? 'unknown', item.artist_type ?? 'unknown',
    item.metadata?.explicit ?? null, item.disc_number ?? null, item.track_number ?? null,
    item.artists?.map(external), item.album && [external(item.album), item.album.year ?? null]]);
}

export type CataloguePresentation<T> = { items: T[]; matchKind: 'identity' | 'metadata' };
/** Identity groups first; metadata buckets only flatten choices for a clearly unverified display row. */
export function presentCatalogueItems<T extends IdentityMedia>(kind: Kind, items: T[]): CataloguePresentation<T>[] {
  const identities = groupCatalogueItems(kind, items);
  const order = new Map(items.map((item, index) => [item, index]));
  const buckets = new Map<string, T[][]>();
  for (const group of identities) {
    const mappedUnion = group.some(item => {
      const sources = new Set(item.provider === 'library' ? [] : [JSON.stringify([item.provider, item.item_id])]);
      for (const mapping of item.provider_mappings ?? []) if (mapping.item_id && (mapping.provider_instance || mapping.provider_domain)) {
        const own = mapping.item_id === item.item_id && (mapping.provider_instance === item.provider || mapping.provider_domain === item.provider);
        sources.add(JSON.stringify(own ? [item.provider, item.item_id] : [mapping.provider_instance ?? mapping.provider_domain, mapping.item_id]));
      }
      return sources.size > 1;
    });
    // Do not downgrade a verified multi-source union or an alias group to a metadata-only display bucket.
    const keys = new Set(group.map(item => metadataKey(kind, item)));
    const key = group.length === 1 && !mappedUnion && keys.size === 1 ? [...keys][0]! : `identity:${order.get(group[0]!)}`;
    if (!buckets.has(key)) buckets.set(key, []); buckets.get(key)!.push(group);
  }
  const result: CataloguePresentation<T>[] = [];
  const profiles = new Map(items.map(item => [item, evidenceProfile(item)]));
  let comparisons = 0;
  const complete = (groups: T[][]) => {
    if (groups.length < 2) return true;
    // Multi-group buckets contain only singleton identity groups with the same
    // normalized metadata key. Equal evidence profiles need one comparison, not n².
    const representatives = [...new Map(groups.flat().map(item => [profiles.get(item)!, item])).values()];
    for (let i = 0; i < representatives.length; i++) {
      for (let j = i; j < representatives.length; j++) {
        if (++comparisons > 20_000 || !sameMetadataPresentation(kind, representatives[i]!, representatives[j]!)) return false;
      }
    }
    return true;
  };
  const emit = (groups: T[][], verified = false) => {
    const members = groups.flat();
    if (groups.length > 1 && new Set(members.map(item => item.provider)).size > 1 && (verified || complete(groups))) {
      result.push({ items: members, matchKind: 'metadata' });
    } else for (const group of groups) result.push({ items: group, matchKind: 'identity' });
  };
  for (const groups of buckets.values()) {
    if (complete(groups)) { emit(groups, true); continue; }
    // An unknown bridge must not be assigned arbitrarily to one of two conflicting artists/editions.
    // Keep those known identities separate; only equally evidenced unknown matches may share a display row.
    const byProfile = new Map<string, T[][]>();
    for (const group of groups) {
      const key = JSON.stringify([...new Set(group.map(item => profiles.get(item)))].sort());
      if (!byProfile.has(key)) byProfile.set(key, []); byProfile.get(key)!.push(group);
    }
    for (const profile of byProfile.values()) emit(profile);
  }
  return result.sort((a, b) => Math.min(...a.items.map(item => order.get(item)!)) - Math.min(...b.items.map(item => order.get(item)!)));
}
