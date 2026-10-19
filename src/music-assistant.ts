import { createHash } from 'node:crypto';
import { z } from 'zod';
import { AppError, catalogueSearchNotice, type CatalogueTrack, type CatalogueArtist, type CatalogueAlbum, type CataloguePage, type Track, type VolumeState } from './model.js';
import { presentCatalogueItems } from './catalogue-grouping.js';
import type { SavedSelection } from './preparations.js';
import { MusicAssistantTransport, type ArtworkData, type ArtworkSize } from './music-assistant-transport.js';
import { MusicAssistantEvents, type PlaybackEvent } from './music-assistant-events.js';
import { verifiedPlaybackSchema, supportsReadOnlySchema } from './music-assistant-policy.js';
export { musicAssistantUrl, maToken, isAllowedAddress, type ArtworkData, type ArtworkSize } from './music-assistant-transport.js';

export type Destination = { id: string; name: string; available: boolean };
export type ConnectionReport = {
  checkedAt: number; serverVersion: string; schemaVersion: number;
  docsAvailable: boolean; players: Destination[]; serverId?: string;
};
export interface InventoryReader {
  inspect(options?: { documentation?: boolean }): Promise<ConnectionReport>;
  close?(): void;
  subscribePlayback?(listener: (event: PlaybackEvent) => void): () => void;
  activeQueue(playerId: string): Promise<string>;
}
export interface CatalogueReader {
  search(query: string): Promise<CatalogueTrack[]>;
}
export interface MusicAssistantReader extends InventoryReader, CatalogueReader {}

const imageSchema = z.object({ proxy_id: z.string().regex(/^[a-f0-9]{64}$/).nullable().optional(), type: z.string().optional() });
const imageFields = { image: imageSchema.nullable().optional().catch(undefined),
  metadata: z.object({ images: z.array(imageSchema).max(50).default([]), explicit: z.boolean().nullable().optional() }).optional().catch(undefined) };
const externalIds = z.array(z.tuple([z.string().max(100), z.string().max(500)])).max(100).default([]).catch([]);
const providerMappings = z.array(z.object({ available: z.boolean().default(true), item_id: z.string().min(1).max(2048).optional(),
  provider_domain: z.string().min(1).max(200).optional(), provider_instance: z.string().min(1).max(200).optional() })).max(100).default([]);
const identityFields = { external_ids: externalIds, provider_mappings: providerMappings };
const artistSchema = z.object({ name: z.string().max(500), external_ids: externalIds, ...imageFields });
const searchTrackSchema = z.object({
  item_id: z.string().min(1).max(2048), provider: z.string().min(1).max(200),
  name: z.string().min(1).max(1000), uri: z.string().max(4096).nullable().optional(),
  version: z.string().max(500).default(''), media_type: z.literal('track').default('track'),
  duration: z.number().finite().nonnegative().optional(), is_playable: z.boolean().default(true),
  artists: z.array(artistSchema).max(100).default([]),
  album: z.object({ name: z.string().max(1000), version: z.string().max(500).optional(), year: z.number().int().nullable().optional(), external_ids: externalIds, ...imageFields }).nullable().optional(), ...imageFields, ...identityFields,
  disc_number: z.number().int().nonnegative().optional(), track_number: z.number().int().nonnegative().optional(),
});
const mediaSchema = z.object({ item_id: z.string().min(1).max(2048), provider: z.string().min(1).max(200),
  name: z.string().min(1).max(1000), uri: z.string().max(4096).nullable().optional(), version: z.string().max(500).default(''), artist_type: z.string().max(100).optional(), ...imageFields, ...identityFields });
const albumSchema = mediaSchema.extend({ year: z.number().int().nullable().optional(), artists: searchTrackSchema.shape.artists, album_type: z.string().max(100).optional() });
type MediaRef = { kind: 'artist' | 'album' | 'track'; itemId: string; provider: string; sourceLabel: string; uri: string; version: string; expires: number; artwork?: string; artistArtwork?: string };
type BrowseGroup = { kind: MediaRef['kind']; sources: string[]; expires: number };
type Media = z.infer<typeof mediaSchema>;
const maxVariants = 1000;
const maxBrowseSources = 8;
export const queueSchema = z.object({
  queue_id: z.string(), available: z.boolean(), items: z.number().int(), active: z.boolean(),
  state: z.enum(['playing', 'paused', 'idle', 'unknown']), ended: z.boolean(),
  repeat_mode: z.string(), autoplay_enabled: z.boolean(), shuffle_enabled: z.boolean(),
  current_item: z.object({ queue_item_id: z.string(), media_item: searchTrackSchema.nullable().optional() }).nullable(),
  next_item: z.unknown().nullable(),
  elapsed_time: z.number().finite().nonnegative().optional(), elapsed_time_last_updated: z.number().finite().optional(),
});
export type QueueSnapshot = z.infer<typeof queueSchema>;
type Command = 'players/all' | 'player_queues/get_active_queue' | 'music/search' | 'music/artists/artist_albums'
  | 'music/albums/album_tracks' | 'music/item_by_uri' | 'player_queues/items' | 'player_queues/autoplay'
  | 'player_queues/repeat' | 'player_queues/shuffle' | 'player_queues/play_media' | 'player_queues/stop'
  | 'player_queues/pause' | 'player_queues/resume' | 'players/get' | 'players/cmd/volume_set' | 'players/cmd/group_volume';
const volumePlayerSchema = z.object({ player_id: z.string(), available: z.boolean(), type: z.string().default('player'),
  supported_features: z.array(z.string()).default([]), volume_control: z.string().default('none'),
  volume_level: z.number().int().min(0).max(100).nullable().default(null), group_volume: z.number().int().min(0).max(100).nullable().default(null),
  group_members: z.array(z.string()).default([]) });

/** Music Assistant domain mapping. Network policy is owned by the transport. */
export class MusicAssistantClient implements MusicAssistantReader {
  private events: MusicAssistantEvents;
  private references = new Map<string, MediaRef>();
  private groups = new Map<string, BrowseGroup>();
  private groupedReferences = 0;
  private imageCache = new Map<string, { data: ArtworkData; expires: number }>();
  private imageRequests = new Map<string, Promise<ArtworkData>>();
  constructor(origin: string, private token: string, timeoutMs = 8000,
    private transport: Pick<MusicAssistantTransport, 'read'> & Partial<Pick<MusicAssistantTransport, 'close'>> = new MusicAssistantTransport(origin, token, timeoutMs)) {
    this.events = new MusicAssistantEvents(origin, token);
  }

  close() { this.events.close(); this.transport.close?.(); }
  subscribePlayback(listener: (event: PlaybackEvent) => void) { return this.events.subscribe(listener); }
  private read(path: Parameters<MusicAssistantTransport['read']>[0], command?: Command, args = {}, binary = false) {
    return this.transport.read(path, command, args, binary);
  }
  private redact(value: string): string { return value.replaceAll(this.token, '[redacted]'); }
  private image(media: { image?: z.infer<typeof imageSchema> | null; metadata?: { images: z.infer<typeof imageSchema>[] } } | null | undefined): string | undefined {
    const images = [media?.image, ...(media?.metadata?.images ?? [])].filter(i => i?.proxy_id);
    const id = (images.find(i => i?.type === 'thumb') ?? images[0])?.proxy_id;
    return id && !id.includes(this.token) ? `image:${id}` : undefined;
  }
  async artwork(id: string, size: ArtworkSize = 512): Promise<ArtworkData> {
    if (!/^image:[a-f0-9]{64}$/.test(id)) throw new AppError(404, 'Artwork unavailable.');
    const key = `${id}:${size}`;
    const cached = this.imageCache.get(key);
    if (cached && cached.expires > Date.now()) { this.imageCache.delete(key); this.imageCache.set(key, cached); return cached.data; }
    const pending = this.imageRequests.get(key); if (pending) return pending;
    if (this.imageRequests.size >= 16) throw new AppError(503, 'Artwork is busy.');
    const request = (async () => {
      // MA's high-quality JPEG keeps large TV covers below the bounded response/cache budgets.
      const format = size === 1024 ? 'jpeg' : 'png';
      const data = await this.read(`/imageproxy/${id.slice(6)}?size=${size}&fmt=${format}`, undefined, {}, true) as ArtworkData;
      this.imageCache.set(key, { data, expires: Date.now() + 5 * 60_000 });
      let bytes = [...this.imageCache.values()].reduce((sum, item) => sum + item.data.body.length, 0);
      while (this.imageCache.size > 64 || bytes > 20 * 1024 * 1024) {
        const key = this.imageCache.keys().next().value!; bytes -= this.imageCache.get(key)!.data.body.length; this.imageCache.delete(key);
      }
      return data;
    })();
    this.imageRequests.set(key, request); try { return await request; } finally { this.imageRequests.delete(key); }
  }
  private remember(kind: MediaRef['kind'], media: z.infer<typeof mediaSchema>, artistArtwork?: string): string {
    const uri = media.uri || `${media.provider}://${kind}/${media.item_id}`;
    const id = `ma:${createHash('sha256').update(JSON.stringify([kind, media.provider, media.item_id, uri, media.version])).digest('hex')}`;
    const previous = this.references.get(id); this.references.delete(id);
    this.references.set(id, { kind, itemId: media.item_id, provider: media.provider, sourceLabel: this.sourceName(media), uri, version: media.version, expires: Date.now() + 12 * 60 * 60_000,
      artwork: this.image(media) ?? previous?.artwork, artistArtwork: artistArtwork ?? previous?.artistArtwork });
    while (this.references.size > 5000) this.references.delete(this.references.keys().next().value!);
    return id;
  }
  private reference(id: string, kind: MediaRef['kind']): MediaRef {
    if (kind === 'track' && (id.startsWith('group:') || id.startsWith('display:'))) throw new AppError(422, 'Choose an exact music source before saving or playing this track.');
    const ref = this.references.get(id);
    if (!ref || ref.kind !== kind || ref.expires < Date.now()) throw new AppError(409, 'This catalogue result expired. Search or browse again.');
    return ref;
  }
  private rememberGroup(kind: MediaRef['kind'], sourceIds: string[]): string {
    const id = `group:${createHash('sha256').update(JSON.stringify([kind, [...sourceIds].sort()])).digest('hex')}`;
    if (kind === 'track') return id; // Display-only: no playback reference or catalogue fanout is retained.
    this.groupedReferences -= this.groups.get(id)?.sources.length ?? 0;
    this.groups.delete(id); this.groups.set(id, { kind, sources: sourceIds, expires: Date.now() + 12 * 60 * 60_000 });
    this.groupedReferences += sourceIds.length;
    while (this.groups.size > 1000 || this.groupedReferences > 5000) {
      const first = this.groups.keys().next().value!; this.groupedReferences -= this.groups.get(first)!.sources.length; this.groups.delete(first);
    }
    return id;
  }
  private browseSources(id: string, kind: 'artist' | 'album'): MediaRef[] {
    if (id.startsWith('display:')) throw new AppError(422, 'These are metadata-only matches, not a verified identity. Choose an exact source before browsing.');
    if (!id.startsWith('group:')) return [this.reference(id, kind)];
    const group = this.groups.get(id);
    if (!group || group.kind !== kind || group.expires < Date.now()) throw new AppError(409, 'This catalogue result expired. Search or browse again.');
    return group.sources.map(source => this.reference(source, kind));
  }
  private sourceName(media: Media): string {
    const mapped = media.provider_mappings.find(p => p.item_id === media.item_id &&
      (p.provider_instance === media.provider || p.provider_domain === media.provider))?.provider_domain;
    const publicDomains = ['spotify', 'tidal', 'filesystem', 'filesystem_local', 'filesystem_smb', 'qobuz', 'deezer',
      'apple_music', 'ytmusic', 'youtube_music', 'plex', 'subsonic', 'jellyfin', 'builtin', 'library'];
    const domain = mapped ?? (publicDomains.includes(media.provider) ? media.provider : '');
    // Domains are public service labels; instance IDs/account names/URIs are not.
    return /^[a-z][a-z0-9_]{0,39}$/.test(domain) ? this.redact(domain) : 'Music source';
  }
  private variants<T extends Media>(media: T): T[] {
    const own = media.provider_mappings.find(p => p.item_id === media.item_id &&
      (p.provider_instance === media.provider || p.provider_domain === media.provider));
    const others = media.provider_mappings.filter(p => p !== own && p.item_id && (p.provider_instance || p.provider_domain));
    // A library row can choose any mapping upstream. Only exact mapped sources are selectable.
    const result = media.provider === 'library' && others.length ? [] : [media];
    for (const mapping of others) {
      const provider = mapping.provider_instance ?? mapping.provider_domain!;
      result.push({ ...media, provider, item_id: mapping.item_id!, uri: undefined, provider_mappings: [mapping] });
    }
    return result;
  }
  private grouped<T extends Media, R extends { id: string; provider: string }>(kind: MediaRef['kind'], items: T[], convert: (item: T) => R): R[] {
    let count = 0;
    return presentCatalogueItems(kind, items).map(({ items: group, matchKind }) => {
      const variants = new Map<string, R>();
      // Prefer real provider rows to metadata inherited from a library mapping.
      const real = new Map<string, T>();
      const key = (provider: string, itemId: string) => JSON.stringify([provider, itemId]);
      for (const item of group.filter(item => item.provider !== 'library' && item.uri)) {
        real.set(key(item.provider, item.item_id), item);
        for (const mapping of item.provider_mappings) if (mapping.item_id === item.item_id && mapping.provider_instance &&
          (mapping.provider_instance === item.provider || mapping.provider_domain === item.provider)) real.set(key(mapping.provider_instance, item.item_id), item);
      }
      const candidates = new Map<string, T>();
      for (const original of group) for (const variant of this.variants(original)) {
        const item = variant.uri ? variant : real.get(key(variant.provider, variant.item_id)) ?? variant;
        candidates.set(JSON.stringify([item.provider, item.item_id, item.uri ?? `${item.provider}://${kind}/${item.item_id}`, item.version]), item);
      }
      const raw = [...candidates.values()].sort((a, b) => a.provider.localeCompare(b.provider) || a.item_id.localeCompare(b.item_id));
      for (const item of raw) {
        const source = convert(item);
        if (!variants.has(source.id)) {
          if (++count > maxVariants) throw new AppError(502, 'Music Assistant returned too many source choices. Narrow your search or browse a single source.');
          variants.set(source.id, source);
        }
      }
      const sources = [...variants.values()].sort((a, b) => a.provider.localeCompare(b.provider) || a.id.localeCompare(b.id));
      const first = sources[0]!;
      const sourceIds = sources.map(x => x.id);
      return sources.length === 1 ? first : { ...first, id: matchKind === 'metadata'
        ? `display:${createHash('sha256').update(JSON.stringify([kind, [...sourceIds].sort()])).digest('hex')}` : this.rememberGroup(kind, sourceIds),
        provider: [...new Set(sources.map(x => x.provider))].join(' + '), sources, matchKind,
        ...('available' in first ? { available: sources.some(source => 'available' in source && source.available === true) } : {}) };
    });
  }
  private async browseMany<T>(id: string, kind: 'artist' | 'album', load: (ref: MediaRef) => Promise<T[]>): Promise<CataloguePage<T>> {
    const sources = this.browseSources(id, kind); const selected = sources.slice(0, maxBrowseSources);
    const items: T[] = []; const failures: string[] = []; let succeeded = 0;
    // At most two upstream requests at once, eight total; no retries or recursive matching.
    const results: PromiseSettledResult<T[]>[] = []; let next = 0;
    await Promise.all([0, 1].map(async () => {
      while (next < selected.length) {
        const index = next++;
        try { results[index] = { status: 'fulfilled', value: await load(selected[index]!) }; }
        catch (reason) { results[index] = { status: 'rejected', reason }; }
      }
    }));
    // Preserve source/album order even when a later provider finishes first.
    for (let i = 0; i < results.length; i++) {
      const result = results[i]!;
      if (result.status === 'fulfilled') { succeeded++; items.push(...result.value); }
      else failures.push(selected[i]!.sourceLabel);
    }
    if (!succeeded) throw new AppError(502, `None of the selected music sources could be loaded. ${sources.length > selected.length
      ? `Only the first ${maxBrowseSources} sources were attempted; remaining sources were not checked. ` : ''}Try a source separately or check Music Assistant.`);
    const notices: string[] = [];
    if (failures.length) notices.push(`Could not load ${[...new Set(failures)].join(', ')} (${failures.length} source${failures.length === 1 ? '' : 's'}). Results are incomplete; try each source separately.`);
    if (sources.length > selected.length) notices.push(`Only the first ${maxBrowseSources} sources were loaded. Choose a source separately to browse the remaining catalogues.`);
    return { items, ...(notices.length ? { notices } : {}) };
  }
  private track(media: z.infer<typeof searchTrackSchema>): CatalogueTrack {
    const artistArtwork = this.image(media.artists[0]);
    const id = this.remember('track', media, artistArtwork); const ref = this.references.get(id)!;
    ref.artwork = this.image(media) ?? this.image(media.album) ?? ref.artwork;
    const ownMapping = media.provider_mappings.filter(p => p.item_id === media.item_id && (p.provider_instance === media.provider || p.provider_domain === media.provider));
    return { id, title: this.redact(media.name),
      artist: this.redact(media.artists.map(a => a.name).filter(Boolean).join(', ') || 'Unknown artist'),
      album: this.redact(media.album?.name ?? ''), version: this.redact(media.version), provider: this.sourceName(media),
      duration: media.duration && media.duration > 0 ? media.duration : null,
      available: media.is_playable && (ownMapping.length ? ownMapping : media.provider_mappings).some(p => p.available), artwork: ref.artwork, artistArtwork: ref.artistArtwork };
  }
  async inspect(options: { documentation?: boolean } = {}): Promise<ConnectionReport> {
    try {
      const info = z.object({ server_id: z.string().min(1).max(200).optional(), server_version: z.string().max(80), schema_version: z.number().int(), min_supported_schema_version: z.number().int() }).parse(await this.read('/info'));
      if (!supportsReadOnlySchema(info.schema_version, info.min_supported_schema_version)) throw new AppError(422, 'This Music Assistant API schema is not supported by the read-only setup check. Update the app or server.');
      // HTTP /api returns the command result directly, not the WebSocket result envelope.
      const players = z.array(z.object({ player_id: z.string().min(1).max(500), name: z.string().min(1).max(200), available: z.boolean() })).max(500)
        .parse(await this.read('/api', 'players/all'))
        .map(p => {
          if (p.player_id.includes(this.token)) throw new AppError(502, 'Music Assistant returned an invalid destination identifier.');
          return { id: p.player_id, name: p.name.replaceAll(this.token, '[redacted]'), available: p.available };
        });
      let docsAvailable = false;
      if (options.documentation !== false) {
        try { await this.read('/api-docs'); docsAvailable = true; } catch { /* Read-only authentication still succeeded. */ }
      }
      return { checkedAt: Date.now(), serverVersion: info.server_version.replaceAll(this.token, '[redacted]'), schemaVersion: info.schema_version, docsAvailable, players,
        ...(info.server_id && !info.server_id.includes(this.token) ? { serverId: info.server_id } : {}) };
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(502, 'Music Assistant returned an incompatible API response. Review the deployed API documentation.');
    }
  }
  async activeQueue(playerId: string): Promise<string> {
    try {
      const result = await this.read('/api', 'player_queues/get_active_queue', { player_id: playerId });
      if (!result) throw new AppError(422, 'This destination has no active Music Assistant queue. Configure it in Music Assistant and check again.');
      const queue = z.object({ queue_id: z.string().min(1).max(500), available: z.boolean().optional() }).parse(result);
      if (queue.available === false) throw new AppError(422, 'The speaker’s Music Assistant queue is unavailable. Check that speaker and try again.');
      return queue.queue_id;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(502, 'The destination queue response is incompatible. Review the deployed API documentation.');
    }
  }
  async search(query: string): Promise<CatalogueTrack[]> {
    try {
      // Verified against the deployment's generated music/search documentation.
      // Omitting providers searches the library and all connected sources, not playlists.
      const result = z.object({ tracks: z.array(searchTrackSchema).max(500) }).parse(await this.read('/api', 'music/search', {
        search_query: query, media_types: ['track'], limit: 20,
      }));
      return this.grouped('track', result.tracks, track => this.track(track));
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(502, 'Music Assistant returned an incompatible search response. Check the connected sources and deployed API documentation.');
    }
  }
  async artists(query: string): Promise<CataloguePage<CatalogueArtist>> {
    try {
      const result = z.object({ artists: z.array(mediaSchema).max(500) }).parse(await this.read('/api', 'music/search', {
        search_query: query, media_types: ['artist'], limit: 20,
      }));
      return { notices: [catalogueSearchNotice], items: this.grouped('artist', result.artists, a => {
        const artwork = this.image(a);
        return { id: this.remember('artist', a), name: this.redact(a.name), provider: this.sourceName(a), artwork };
      }) };
    } catch (error) { throw error instanceof AppError ? error : new AppError(502, 'Music Assistant returned an incompatible artist response.'); }
  }
  async albums(artistId: string): Promise<CataloguePage<CatalogueAlbum>> {
    try {
      let possiblyLimited = false;
      const page = await this.browseMany(artistId, 'artist', async ref => {
        const items = z.array(albumSchema).max(500).parse(await this.read('/api', 'music/artists/artist_albums', {
          item_id: ref.itemId, provider_instance_id_or_domain: ref.provider,
        }));
        possiblyLimited ||= items.length === 500; return items;
      });
      if (page.items.length > 2000) throw new AppError(502, 'Too many albums returned. Browse one source separately.');
      if (possiblyLimited) (page.notices ??= []).push('Large catalogue: this listing may be limited by Music Assistant. Try track search for releases not shown.');
      return { ...page, items: this.grouped('album', page.items, a => ({ id: this.remember('album', a, this.image(a.artists[0])), name: this.redact(a.name),
        artist: this.redact(a.artists.map(x => x.name).join(', ')), provider: this.sourceName(a), version: this.redact(a.version), year: a.year ?? null,
        artwork: this.image(a), artistArtwork: this.image(a.artists[0]) })) };
    } catch (error) { throw error instanceof AppError ? error : new AppError(502, 'Music Assistant returned an incompatible album response.'); }
  }
  async tracks(albumId: string): Promise<CataloguePage<CatalogueTrack>> {
    try {
      const page = await this.browseMany(albumId, 'album', async ref => {
        const result = z.array(searchTrackSchema).max(500).parse(await this.read('/api', 'music/albums/album_tracks', {
        item_id: ref.itemId, provider_instance_id_or_domain: ref.provider, in_library_only: false,
        }));
        return result.map(t => {
          const item = this.track(t); const trackRef = this.references.get(item.id)!;
          trackRef.artwork ??= ref.artwork; trackRef.artistArtwork ??= ref.artistArtwork;
          return t;
        });
      });
      if (page.items.length > 2000) throw new AppError(502, 'Too many tracks returned. Browse one source separately.');
      return { ...page, items: this.grouped('track', page.items, t => this.track(t)) }; // First source order, including discs; unmatched tracks follow.
    } catch (error) { throw error instanceof AppError ? error : new AppError(502, 'Music Assistant returned an incompatible album-track response.'); }
  }
  async resolveTrack(id: string) {
    const ref = this.reference(id, 'track');
    return this.resolveRecording(ref);
  }
  private async exactRecording(ref: { itemId: string; provider: string; uri: string; version: string; artwork?: string; artistArtwork?: string }, requireAvailable: boolean) {
    if (ref.provider === 'library') throw new AppError(422, 'This library result has no exact source selection. Choose a connected source instead. Your saved entry, if any, was kept.');
    const raw = searchTrackSchema.safeParse(await this.read('/api', 'music/item_by_uri', { uri: ref.uri, allow_update_metadata: false }));
    if (!raw.success || raw.data.item_id !== ref.itemId || raw.data.provider !== ref.provider || raw.data.version !== ref.version || (raw.data.uri && raw.data.uri !== ref.uri)) {
      throw new AppError(422, 'The selected recording could not be resolved exactly. No alternative recording was substituted.');
    }
    const item = this.track(raw.data);
    item.artwork ??= ref.artwork; item.artistArtwork ??= ref.artistArtwork;
    if (requireAvailable && !item.available) throw new AppError(422, 'This recording is unavailable through its connected source.');
    return item;
  }
  async captureTrack(id: string): Promise<Omit<Extract<SavedSelection, { source: 'music-assistant' }>, 'source' | 'sourceBindingId'>> {
    const ref = this.reference(id, 'track'); const item = await this.exactRecording(ref, false);
    if ([ref.uri, ref.itemId, ref.provider, ref.version].some(value => value.includes(this.token))) throw new AppError(502, 'The source returned an invalid recording identity.');
    return { recording: { itemId: ref.itemId, provider: ref.provider, uri: ref.uri, version: ref.version },
      metadata: { title: item.title, artist: item.artist, album: item.album, version: item.version, provider: item.provider, duration: item.duration,
        artworkId: item.artwork, artistArtworkId: item.artistArtwork } };
  }
  async resolveRecording(ref: { itemId: string; provider: string; uri: string; version: string; artwork?: string; artistArtwork?: string }): Promise<{ track: Track; uri: string; itemId: string; provider: string; version: string }> {
    const item = await this.exactRecording(ref, true);
    return { track: { id: item.id, title: item.version ? `${item.title} (${item.version})` : item.title,
       artist: item.artist, album: item.album, duration: item.duration ?? 0, artwork: item.artwork, artistArtwork: item.artistArtwork }, uri: ref.uri, itemId: ref.itemId, provider: ref.provider, version: ref.version };
  }
  /** Backend-generated URL only. Never feed upstream URL-derived names/artwork into a private/public track view. */
  async resolveUploaded(url: string, duration: number) {
    const uri = `builtin://track/${url}`;
    const result = searchTrackSchema.safeParse(await this.read('/api', 'music/item_by_uri', { uri, allow_update_metadata: false }));
    if (!result.success || result.data.provider !== 'builtin' || result.data.item_id !== url || result.data.uri !== uri || !result.data.is_playable ||
      !result.data.provider_mappings.some(mapping => mapping.available) || !result.data.duration || Math.abs(result.data.duration - duration) > Math.max(2, duration * 0.01)) {
      throw new AppError(422, 'Music Assistant could not verify this exact uploaded audio as a finite track. Your file was kept.');
    }
    return { uri, itemId: url, provider: 'builtin', version: result.data.version };
  }
  async playbackCapability(playerId: string): Promise<QueueSnapshot> {
    const info = z.object({ schema_version: z.number() }).parse(await this.read('/info'));
    if (info.schema_version !== verifiedPlaybackSchema) throw new AppError(422, `Live playback currently requires the verified Music Assistant API schema ${verifiedPlaybackSchema}. Browsing remains available.`);
    return this.queue(playerId);
  }
  async queue(playerId: string): Promise<QueueSnapshot> {
    const result = queueSchema.safeParse(await this.read('/api', 'player_queues/get_active_queue', { player_id: playerId }));
    if (!result.success || !result.data.available) throw new AppError(502, 'The playback destination is unavailable or its queue response is unsupported.');
    return result.data;
  }
  async queueItems(queueId: string): Promise<{ queue_item_id: string; media_item?: z.infer<typeof searchTrackSchema> | null }[]> {
    const result = z.array(z.object({ queue_item_id: z.string(), media_item: searchTrackSchema.nullable().optional() })).max(2)
      .safeParse(await this.read('/api', 'player_queues/items', { queue_id: queueId, limit: 2, offset: 0 }));
    if (!result.success) throw new AppError(502, 'The destination queue could not be verified.'); return result.data;
  }
  async configureSingle(queue: QueueSnapshot): Promise<boolean> {
    const queue_id = queue.queue_id;
    if (queue.autoplay_enabled) await this.read('/api', 'player_queues/autoplay', { queue_id, autoplay_enabled: false });
    if (queue.repeat_mode !== 'off') await this.read('/api', 'player_queues/repeat', { queue_id, repeat_mode: 'off' });
    if (queue.shuffle_enabled) await this.read('/api', 'player_queues/shuffle', { queue_id, shuffle_enabled: false });
    return queue.autoplay_enabled || queue.repeat_mode !== 'off' || queue.shuffle_enabled;
  }
  async playSingle(queueId: string, uri: string): Promise<void> {
    await this.read('/api', 'player_queues/play_media', { queue_id: queueId, media: [uri], option: 'replace', radio_mode: false, shuffle: false });
  }
  async controlQueue(queueId: string, action: 'pause' | 'resume' | 'stop'): Promise<void> {
    await this.read('/api', `player_queues/${action}`, { queue_id: queueId });
  }
  private async volumePlayer(playerId: string) {
    const result = volumePlayerSchema.safeParse(await this.read('/api', 'players/get', { player_id: playerId }));
    if (!result.success || result.data.player_id !== playerId || !result.data.available) throw new AppError(502, 'Destination volume is unavailable.');
    return result.data;
  }
  private volumeState(player: z.infer<typeof volumePlayerSchema>): VolumeState {
    const group = player.type === 'group' || player.group_members.length > 1;
    const level = group ? player.group_volume : player.volume_level;
    return { available: level !== null && (player.supported_features.includes('volume_set') || player.volume_control !== 'none'), level };
  }
  async volume(playerId: string): Promise<VolumeState> { return this.volumeState(await this.volumePlayer(playerId)); }
  async pausedDestination(playerId: string, queueId: string): Promise<boolean> {
    const result = z.object({ player_id: z.string(), available: z.boolean(), playback_state: z.enum(['idle', 'paused', 'playing', 'unknown']),
      active_source: z.string().nullable(), active_group: z.string().nullable().optional(), synced_to: z.string().nullable().optional() })
      .safeParse(await this.read('/api', 'players/get', { player_id: playerId }));
    if (!result.success || result.data.player_id !== playerId || !result.data.available) throw new AppError(502, 'The paused destination could not be verified.');
    const player = result.data;
    return ['idle', 'paused'].includes(player.playback_state) && (!player.active_source || [playerId, queueId].includes(player.active_source)) &&
      (!player.active_group || [playerId, queueId].includes(player.active_group)) && (!player.synced_to || [playerId, queueId].includes(player.synced_to));
  }
  async setVolume(playerId: string, level: number, readBack = true): Promise<VolumeState> {
    if (!Number.isInteger(level) || level < 0 || level > 100) throw new AppError(400, 'Choose a volume from 0 to 100.');
    const player = await this.volumePlayer(playerId);
    if (!this.volumeState(player).available) throw new AppError(422, 'This destination does not support volume control.');
    await this.read('/api', player.type === 'group' || player.group_members.length > 1 ? 'players/cmd/group_volume' : 'players/cmd/volume_set', { player_id: playerId, volume_level: level });
    return readBack ? this.volume(playerId) : { available: true, level, pending: true };
  }
}

const apiMethods = ['inspect', 'activeQueue', 'search', 'artwork', 'artists', 'albums', 'tracks', 'resolveTrack',
  'captureTrack', 'resolveRecording', 'resolveUploaded', 'playbackCapability', 'queue', 'queueItems', 'configureSingle',
  'playSingle', 'controlQueue', 'volume', 'pausedDestination', 'setVolume', 'subscribePlayback'] as const satisfies readonly (keyof MusicAssistantClient)[];

/** Structural port: integrations depend on capabilities, not one concrete client's prototype. */
export type MusicAssistantApi = Pick<MusicAssistantClient, typeof apiMethods[number]>;
export function isMusicAssistantApi(reader: MusicAssistantReader): reader is MusicAssistantApi {
  return apiMethods.every(method => typeof Reflect.get(reader, method) === 'function');
}
