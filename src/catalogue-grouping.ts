/** Private MA identity evidence. Nothing from this module is serialized to participants. */
export type IdentityMedia = {
  item_id: string; provider: string; name: string; version: string;
  external_ids?: [string, string][];
  provider_mappings?: { item_id?: string; provider_instance?: string; provider_domain?: string }[];
  year?: number | null; album_type?: string; duration?: number;
  disc_number?: number; track_number?: number;
  artists?: { name: string; external_ids?: [string, string][] }[];
  album?: { name: string; version?: string; year?: number | null; external_ids?: [string, string][] } | null;
  metadata?: { explicit?: boolean | null };
};
type Kind = 'artist' | 'album' | 'track';
const text = (value: string) => value.normalize('NFC').trim().toLowerCase();
function ids(media: { external_ids?: [string, string][] }, type: string) {
  return new Set((media.external_ids ?? []).filter(([key, value]) => key === type &&
    (type.startsWith('musicbrainz_') ? /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(value)
      : type === 'isrc' && /^[a-z]{2}[a-z0-9]{3}\d{7}$/i.test(value))).map(([, value]) => value.toLowerCase()));
}
function overlap(a: Set<string>, b: Set<string>) { return [...a].some(id => b.has(id)); }
function conflicts(a: IdentityMedia, b: IdentityMedia, types: string[]) {
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
        (a.album.year && b.album.year && a.album.year !== b.album.year) || conflicts(
          { ...a.album, item_id: '', provider: '', version: '' }, { ...b.album, item_id: '', provider: '', version: '' }, ['musicbrainz_albumid']))) return false;
    }
  }
  return overlap(mappings(a), mappings(b)) || unique.some(type => overlap(ids(a, type), ids(b, type)));
}

/** Complete-link grouping: an ambiguous bridge cannot join two conflicting identities. */
export function groupCatalogueItems<T extends IdentityMedia>(kind: Kind, items: T[]): T[][] {
  const groups: T[][] = [];
  const index = new Map<string, Set<T[]>>();
  const order = new Map<T[], number>();
  const types = kind === 'artist' ? ['musicbrainz_artistid'] : kind === 'album' ? ['musicbrainz_albumid'] : ['musicbrainz_recordingid', 'isrc'];
  for (const item of items) {
    const keys = [...mappings(item)].map(key => `mapping:${key}`);
    for (const type of types) for (const id of ids(item, type)) keys.push(`${type}:${id}`);
    const candidates = new Set<T[]>();
    for (const key of keys) for (const candidate of index.get(key) ?? []) candidates.add(candidate);
    // Only compare groups sharing authoritative evidence; name collisions do not cause quadratic scans.
    let group = [...candidates].sort((a, b) => order.get(a)! - order.get(b)!)
      .find(members => members.every(member => sameCatalogueItem(kind, member, item)));
    if (group) group.push(item);
    else { group = [item]; order.set(group, groups.length); groups.push(group); }
    for (const key of keys) { if (!index.has(key)) index.set(key, new Set()); index.get(key)!.add(group); }
  }
  return groups;
}
