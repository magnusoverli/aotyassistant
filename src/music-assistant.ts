import { createHash } from 'node:crypto';
import { z } from 'zod';
import { AppError, type CatalogueTrack, type CatalogueArtist, type CatalogueAlbum, type CataloguePage, type Track, type VolumeState } from './model.js';
import { browseCatalogueItems, groupCatalogueItems, sameCatalogueItem, type IdentityMedia } from './catalogue-grouping.js';
import { matchesReference, recordingEvidenceSchema, sameRecordingEvidence, type RecordingDescriptor, type RecordingReference } from './recording-identity.js';
import type { SavedSelection } from './preparations.js';
import { MusicAssistantTransport, type ArtworkData, type ArtworkSize } from './music-assistant-transport.js';
import { MusicAssistantEvents, type PlaybackEvent } from './music-assistant-events.js';
import { verifiedPlaybackSchemas, supportsPlaybackSchema, supportsReadOnlySchema } from './music-assistant-policy.js';
import { UpstreamError } from './upstream-error.js';
import { background, budget, operationSignal } from './operation.js';
import { BoundedCache } from './bounded-cache.js';
import { WorkQueue } from './serial.js';
import { reportedStreamInfoSchema } from './stream-info.js';
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

const imageSchema = z.object({ proxy_id: z.string().regex(/^[a-f0-9]{64}$/).nullable().optional().catch(undefined), type: z.string().optional() });
const imageFields = { image: imageSchema.nullable().optional().catch(undefined),
  metadata: z.object({ images: z.array(imageSchema.nullable().catch(null)).max(50).nullish().transform(images => images?.filter(image => image !== null) ?? []), explicit: z.boolean().nullable().optional() }).optional().catch(undefined) };
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
type MediaRef = { kind: 'artist' | 'album' | 'track'; itemId: string; provider: string; sourceLabel: string; uri: string; version: string; artwork?: string; artistArtwork?: string; available?: boolean; identity?: z.infer<typeof recordingEvidenceSchema> };
type BrowseGroup = { kind: MediaRef['kind']; sources: string[] };
const referenceLifetime = 12 * 60 * 60_000;
type Media = z.infer<typeof mediaSchema>;
const maxVariants = 1000;
const maxBrowseSources = 8;
const queueItemSchema = z.object({ queue_item_id: z.string(), media_item: z.union([searchTrackSchema,
  z.object({ media_type: z.enum(['radio', 'podcast_episode', 'audiobook', 'audio_source', 'sound_effect']) }).transform(() => null)]).nullable().optional(),
  streamdetails: z.object({ provider: z.string(), item_id: z.string(), audio_format: reportedStreamInfoSchema }).nullish() });
export const queueSchema = z.object({
  queue_id: z.string(), available: z.boolean(), items: z.number().int(), active: z.boolean(),
  state: z.enum(['playing', 'paused', 'idle', 'unknown']), ended: z.boolean(),
  repeat_mode: z.string(), autoplay_enabled: z.boolean(), shuffle_enabled: z.boolean(),
  is_dynamic: z.boolean().optional(),
  current_item: queueItemSchema.nullable(),
  next_item: z.unknown().nullable(),
  elapsed_time: z.number().finite().nonnegative().optional(), elapsed_time_last_updated: z.number().finite().optional(),
});
export type QueueSnapshot = z.infer<typeof queueSchema>;
type Command = 'players/all' | 'player_queues/get_active_queue' | 'music/search' | 'music/artists/artist_albums'
  | 'music/albums/album_tracks' | 'music/item_by_uri' | 'player_queues/items' | 'player_queues/autoplay'
  | 'player_queues/repeat' | 'player_queues/shuffle' | 'player_queues/play_media' | 'player_queues/stop'
  | 'player_queues/pause' | 'player_queues/resume' | 'player_queues/clear' | 'players/get' | 'players/cmd/volume_set' | 'players/cmd/group_volume';
const volumePlayerSchema = z.object({ player_id: z.string(), available: z.boolean(), type: z.string().default('player'),
  supported_features: z.array(z.string()).default([]), volume_control: z.string().default('none'),
  volume_level: z.number().int().min(0).max(100).nullable().default(null), group_volume: z.number().int().min(0).max(100).nullable().default(null),
  group_members: z.array(z.string()).default([]) });

/** Music Assistant domain mapping. Network policy is owned by the transport. */
export class MusicAssistantClient implements MusicAssistantReader {
  private events: MusicAssistantEvents;
  private references = new BoundedCache<MediaRef>(5000);
  /** Sized by member count: at most 5000 grouped references in 1000 groups. */
  private groups = new BoundedCache<BrowseGroup>(1000, 5000);
  private imageCache = new BoundedCache<ArtworkData>(512, 20 * 1024 * 1024);
  private imageRequests = new Map<string, Promise<ArtworkData>>();
  /** Matches the transport's four artwork sockets, so a fetch's deadline starts when it is sent. */
  private imageLine = new WorkQueue(256, 4);
  private browseImages = new BoundedCache<{ image?: z.infer<typeof imageSchema> }>(128);
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
    for (;;) {
      const cached = this.imageCache.get(key); if (cached) return cached;
      let request = this.imageRequests.get(key);
      if (!request) {
        // HTTP/2 browsers ask for a whole page of thumbnails at once. They wait in
        // line; a waiting fetch is dropped when the browser that queued it leaves.
        // A started fetch finishes outside that request, so its result is shared and cached.
        const queued = this.imageLine.run(() => background(async () => {
          // Photographic artwork is much smaller as JPEG, including list thumbnails.
          const data = await this.read(`/imageproxy/${id.slice(6)}?size=${size}&fmt=jpeg`, undefined, {}, true) as ArtworkData;
          this.imageCache.set(key, data, { expires: Date.now() + 60 * 60_000, size: data.body.length });
          return data;
        }), 'artwork');
        request = queued; this.imageRequests.set(key, queued);
        const clear = () => { if (this.imageRequests.get(key) === queued) this.imageRequests.delete(key); };
        void queued.then(clear, clear);
      }
      try { return await request; }
      catch (error) {
        // Another viewer left before this shared fetch started; queue it again for this one.
        if (error instanceof AppError && error.status === 499 && !operationSignal()?.aborted) continue;
        throw error;
      }
    }
  }
  private remember(kind: MediaRef['kind'], media: z.infer<typeof mediaSchema>, artistArtwork?: string): string {
    const uri = media.uri || `${media.provider}://${kind}/${media.item_id}`;
    const id = `ma:${createHash('sha256').update(JSON.stringify([kind, media.provider, media.item_id, uri, media.version])).digest('hex')}`;
    const previous = this.references.get(id);
    this.references.set(id, { kind, itemId: media.item_id, provider: media.provider, sourceLabel: this.sourceName(media), uri, version: media.version,
      artwork: this.image(media) ?? previous?.artwork, artistArtwork: artistArtwork ?? previous?.artistArtwork,
      ...(kind === 'track' ? { identity: recordingEvidenceSchema.parse(media) } : {}) }, { expires: Date.now() + referenceLifetime });
    return id;
  }
  private reference(id: string, kind: MediaRef['kind']): MediaRef {
    if (kind === 'track' && (id.startsWith('group:') || id.startsWith('display:'))) throw new AppError(422, 'Choose an exact music source before saving or playing this track.');
    const ref = this.references.get(id);
    if (!ref || ref.kind !== kind) throw new AppError(409, 'This catalogue result expired. Search or browse again.');
    return ref;
  }
  private rememberGroup(kind: MediaRef['kind'], sourceIds: string[]): string {
    const id = `group:${createHash('sha256').update(JSON.stringify([kind, [...sourceIds].sort()])).digest('hex')}`;
    this.groups.set(id, { kind, sources: sourceIds }, { expires: Date.now() + referenceLifetime, size: sourceIds.length });
    return id;
  }
  private group(id: string, kind: MediaRef['kind'], expired: string): MediaRef[] {
    const group = this.groups.get(id);
    if (!group || group.kind !== kind) throw new AppError(409, expired);
    return group.sources.map(source => this.reference(source, kind));
  }
  private browseSources(id: string, kind: 'artist' | 'album'): MediaRef[] {
    if (id.startsWith('display:')) throw new AppError(422, 'These results may represent different versions. Choose a source before browsing.');
    if (!id.startsWith('group:')) return [this.reference(id, kind)];
    return this.group(id, kind, 'This catalogue result expired. Search or browse again.');
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
    // Retain concrete mappings for transparent resolution, including saved selections.
    const result = media.provider === 'library' && others.length ? [] : [media];
    for (const mapping of others) {
      const provider = mapping.provider_instance ?? mapping.provider_domain!;
      result.push({ ...media, provider, item_id: mapping.item_id!, uri: undefined, provider_mappings: [mapping] });
    }
    return result;
  }
  private async enrichArtwork<T extends Media>(kind: 'artist' | 'album', groups: T[][]) {
    // Search and browse can return lightweight items. Read full metadata only for
    // rows still missing artwork, without delaying an entire catalogue indefinitely.
    const deadline = Date.now() + 1500;
    let reads = 0; let next = 0;
    await Promise.all([0, 1].map(async () => {
      while (next < groups.length) {
        const group = groups[next++]!;
        if (group.some(item => this.image(item))) continue;
        for (const item of group) {
          const uri = item.uri || `${item.provider}://${kind}/${item.item_id}`;
          let cached = this.browseImages.get(uri);
          if (!cached) {
            if (reads >= 8 || Date.now() >= deadline) break;
            reads++;
            let image: z.infer<typeof imageSchema> | undefined;
            try {
              const raw = await budget(deadline - Date.now(), () => this.read('/api', 'music/item_by_uri', { uri, allow_update_metadata: false }));
              const full = kind === 'artist' ? mediaSchema.extend({ media_type: z.literal('artist') }).parse(raw)
                : albumSchema.extend({ media_type: z.literal('album') }).parse(raw);
              if (sameCatalogueItem(kind, item, full)) {
                const id = this.image(full);
                if (id) image = { proxy_id: id.slice(6), type: 'thumb' };
              }
            } catch { /* Optional metadata must not hide usable search results. */ }
            cached = { image }; this.browseImages.set(uri, cached, { expires: Date.now() + 60_000 });
          }
          if (cached.image) { item.image = cached.image; break; }
        }
      }
    }));
  }
  private async grouped<T extends Media, R extends { id: string; provider: string; artwork?: string; artistArtwork?: string }>(kind: MediaRef['kind'], items: T[], convert: (item: T) => R): Promise<R[]> {
    let count = 0;
    const groups = kind === 'track' ? groupCatalogueItems(kind, items).map(items => ({ items, matchKind: 'identity' as const }))
      : browseCatalogueItems(kind, items);
    if (kind !== 'track') await this.enrichArtwork(kind, groups.map(group => group.items));
    return groups.map(({ items: group, matchKind }) => {
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
          if (++count > maxVariants) throw new AppError(502, 'Music Assistant returned too many source choices. Narrow your search.');
          variants.set(source.id, source);
        }
      }
      const sources = [...variants.values()].sort((a, b) => a.provider.localeCompare(b.provider) || a.id.localeCompare(b.id));
      const first = { ...sources[0]!, artwork: sources.find(source => source.artwork)?.artwork ?? group.map(item => this.image(item)).find(Boolean),
        artistArtwork: sources.find(source => source.artistArtwork)?.artistArtwork };
      const sourceIds = sources.map(x => x.id);
      return sources.length === 1 ? first : { ...first, id: this.rememberGroup(kind, sourceIds),
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
      ? `Only the first ${maxBrowseSources} sources were attempted; remaining sources were not checked. ` : ''}Try again or check Music Assistant.`);
    const notices: string[] = [];
    if (failures.length) notices.push(`Could not load ${[...new Set(failures)].join(', ')} (${failures.length} source${failures.length === 1 ? '' : 's'}). Results are incomplete; try again later.`);
    if (sources.length > selected.length) notices.push(`Only the first ${maxBrowseSources} sources were loaded.`);
    return { items, ...(notices.length ? { notices } : {}) };
  }
  private track(media: z.infer<typeof searchTrackSchema>): CatalogueTrack {
    const artistArtwork = this.image(media.artists[0]);
    const id = this.remember('track', media, artistArtwork); const ref = this.references.get(id)!;
    ref.artwork = this.image(media) ?? this.image(media.album) ?? ref.artwork;
    const ownMapping = media.provider_mappings.filter(p => p.item_id === media.item_id && (p.provider_instance === media.provider || p.provider_domain === media.provider));
    ref.available = media.is_playable && (ownMapping.length ? ownMapping : media.provider_mappings).some(p => p.available);
    return { id, title: this.redact(media.name),
      artist: this.redact(media.artists.map(a => a.name).filter(Boolean).join(', ') || 'Unknown artist'),
      album: this.redact(media.album?.name ?? ''), version: this.redact(media.version), provider: this.sourceName(media),
      duration: media.duration && media.duration > 0 ? media.duration : null,
      available: ref.available, artwork: ref.artwork, artistArtwork: ref.artistArtwork };
  }
  /** Unexpected response shapes become one sanitized, version-compatibility error. */
  private async compatible<T>(message: string, work: () => Promise<T>): Promise<T> {
    try { return await work(); }
    catch (error) { throw error instanceof AppError ? error : new AppError(502, message); }
  }
  async inspect(options: { documentation?: boolean } = {}): Promise<ConnectionReport> {
    return this.compatible('Music Assistant returned an incompatible response. Check for app updates; if the problem persists, report the app and Music Assistant versions.', async () => {
      const info = z.object({ server_id: z.string().min(1).max(200).optional(), server_version: z.string().max(80), schema_version: z.number().int(), min_supported_schema_version: z.number().int() }).parse(await this.read('/info'));
      if (!supportsReadOnlySchema(info.schema_version, info.min_supported_schema_version)) throw new AppError(422, 'This Music Assistant API schema is not supported by the read-only setup check. Update the app or server.');
      // HTTP /api returns the command result directly, not the WebSocket result envelope.
      const players = z.array(z.object({ player_id: z.string().min(1).max(500), name: z.string().min(1).max(200), available: z.boolean() })).max(500)
        .parse(await this.read('/api', 'players/all'))
        .map(p => {
          if (p.player_id.includes(this.token)) throw new AppError(502, 'Music Assistant returned an invalid destination identifier.');
          return { id: p.player_id, name: this.redact(p.name), available: p.available };
        });
      let docsAvailable = false;
      if (options.documentation !== false) {
        try { await this.read('/api-docs'); docsAvailable = true; } catch { /* Read-only authentication still succeeded. */ }
      }
      return { checkedAt: Date.now(), serverVersion: this.redact(info.server_version), schemaVersion: info.schema_version, docsAvailable, players,
        ...(info.server_id && !info.server_id.includes(this.token) ? { serverId: info.server_id } : {}) };
    });
  }
  async activeQueue(playerId: string): Promise<string> {
    return this.compatible('The speaker’s queue could not be read. Check Music Assistant and the app’s version compatibility.', async () => {
      const result = await this.read('/api', 'player_queues/get_active_queue', { player_id: playerId });
      if (!result) throw new AppError(422, 'This destination has no active Music Assistant queue. Configure it in Music Assistant and check again.');
      const queue = z.object({ queue_id: z.string().min(1).max(500), available: z.boolean().optional() }).parse(result);
      if (queue.available === false) throw new AppError(422, 'The speaker’s Music Assistant queue is unavailable. Check that speaker and try again.');
      return queue.queue_id;
    });
  }
  async search(query: string): Promise<CatalogueTrack[]> {
    return this.compatible('Music Assistant returned an incompatible search response. Check its music sources and version compatibility.', async () => {
      // Verified against the deployment's generated music/search documentation.
      // Omitting providers searches the library and all connected sources, not playlists.
      const result = z.object({ tracks: z.array(searchTrackSchema).max(500) }).parse(await this.read('/api', 'music/search', {
        search_query: query, media_types: ['track'], limit: 20,
      }));
      return this.grouped('track', result.tracks, track => this.track(track));
    });
  }
  async artists(query: string): Promise<CataloguePage<CatalogueArtist>> {
    return this.compatible('Music Assistant returned an incompatible artist response.', async () => {
      const result = z.object({ artists: z.array(mediaSchema).max(500) }).parse(await this.read('/api', 'music/search', {
        search_query: query, media_types: ['artist'], limit: 20,
      }));
      return { items: await this.grouped('artist', result.artists, a => ({
        id: this.remember('artist', a), name: this.redact(a.name), provider: this.sourceName(a), artwork: this.image(a),
      })) };
    });
  }
  async albums(artistId: string): Promise<CataloguePage<CatalogueAlbum>> {
    return this.compatible('Music Assistant returned an incompatible album response.', async () => {
      let possiblyLimited = false;
      const page = await this.browseMany(artistId, 'artist', async ref => {
        const items = z.array(albumSchema).max(500).parse(await this.read('/api', 'music/artists/artist_albums', {
          item_id: ref.itemId, provider_instance_id_or_domain: ref.provider,
        }));
        possiblyLimited ||= items.length === 500; return items;
      });
      if (page.items.length > 2000) throw new AppError(502, 'Too many albums returned. Try a more specific search.');
      if (possiblyLimited) (page.notices ??= []).push('Large catalogue: this listing may be limited by Music Assistant.');
      const items: CatalogueAlbum[] = await this.grouped('album', page.items, a => ({ id: this.remember('album', a, this.image(a.artists[0])), name: this.redact(a.name),
        artist: this.redact(a.artists.map(x => x.name).join(', ')), provider: this.sourceName(a), version: this.redact(a.version), year: a.year ?? null,
        artwork: this.image(a), artistArtwork: this.image(a.artists[0]) }));
      // A merged release can have a year on only one provider copy. Unknown years
      // come last; equal years retain their stable catalogue order.
      for (const item of items) item.year = [item, ...(item.sources ?? [])].find(source => source.year !== null && source.year > 0)?.year ?? null;
      items.sort((a, b) => (b.year ?? 0) - (a.year ?? 0));
      return { ...page, items };
    });
  }
  async tracks(albumId: string): Promise<CataloguePage<CatalogueTrack>> {
    return this.compatible('Music Assistant returned an incompatible album-track response.', async () => {
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
      if (page.items.length > 2000) throw new AppError(502, 'Too many tracks returned. Try a more specific search.');
      return { ...page, items: await this.grouped('track', page.items, t => this.track(t)) }; // First source order, including discs; unmatched tracks follow.
    });
  }
  async resolveTrack(id: string) {
    const ref = this.recording(id);
    return this.resolveRecording(ref);
  }
  private recording(id: string): RecordingDescriptor & { artwork?: string; artistArtwork?: string } {
    if (!id.startsWith('group:')) return this.reference(id, 'track');
    const refs = this.group(id, 'track', 'This catalogue result expired. Search again.').sort((a, b) => Number(b.available) - Number(a.available));
    const first = refs[0]!;
    return { ...first, equivalents: refs.slice(1, 9).map(({ itemId, provider, uri, version }) => ({ itemId, provider, uri, version })) };
  }
  private async exactRecording(ref: RecordingDescriptor & { artwork?: string; artistArtwork?: string }, requireAvailable: boolean) {
    if (ref.provider === 'library' && !ref.identity) throw new AppError(422, 'This library result has no exact source selection. Search for the recording again.');
    let last: unknown;
    for (const candidate of [ref, ...(ref.equivalents ?? [])]) {
      let value: unknown;
      try { value = await this.read('/api', 'music/item_by_uri', { uri: candidate.uri, allow_update_metadata: false }); }
      catch (error) {
        if (error instanceof UpstreamError && ['authorization', 'closed', 'unsupported-response'].includes(error.kind) || error instanceof AppError && error.status === 499) throw error;
        last = error; continue; // Read-only source resolution; never retry a Play command.
      }
      const raw = searchTrackSchema.safeParse(value);
      if (!raw.success || !matchesReference(raw.data, candidate) || (ref.identity && !sameRecordingEvidence(ref.identity, raw.data))) {
        last = new AppError(422, 'The selected recording could not be resolved exactly. No alternative recording was substituted.'); continue;
      }
      const item = this.track(raw.data);
      item.artwork ??= ref.artwork; item.artistArtwork ??= ref.artistArtwork;
      if (requireAvailable && !item.available) { last = new AppError(422, 'This recording is unavailable through the connected music sources.'); continue; }
      // Canonical library mappings are MA's identity evidence; retain their concrete
      // stream identities before Play so newly substituted mappings are not trusted.
      const allowedSources: RecordingReference[] = [candidate];
      for (const mapping of raw.data.provider_mappings) if (mapping.item_id) {
        for (const provider of [mapping.provider_instance, mapping.provider_domain]) if (provider) allowedSources.push({
          provider, itemId: mapping.item_id, uri: `${provider}://track/${mapping.item_id}`, version: raw.data.version,
        });
      }
      return { item, media: raw.data, allowedSources, candidate };
    }
    throw last ?? new AppError(422, 'The selected recording is unavailable.');
  }
  async captureTrack(id: string): Promise<Omit<Extract<SavedSelection, { source: 'music-assistant' }>, 'source' | 'sourceBindingId'>> {
    const ref = this.recording(id); const { item, media } = await this.exactRecording(ref, false);
    if (JSON.stringify([ref, recordingEvidenceSchema.parse(media)]).includes(this.token)) throw new AppError(502, 'The source returned an invalid recording identity.');
    const equivalents = new Map<string, RecordingReference>();
    for (const candidate of [...(ref.equivalents ?? []), ...media.provider_mappings.flatMap(mapping => {
      if (mapping.item_id === ref.itemId && (mapping.provider_instance === ref.provider || mapping.provider_domain === ref.provider)) return [];
      const provider = mapping.provider_instance ?? mapping.provider_domain;
      return provider && mapping.item_id ? [{ provider, itemId: mapping.item_id,
        uri: `${provider}://track/${mapping.item_id}`, version: media.version }] : [];
    })]) {
      if (candidate.provider === ref.provider && candidate.itemId === ref.itemId) continue;
      equivalents.set(JSON.stringify([candidate.provider, candidate.itemId]), candidate);
    }
    return { recording: { itemId: ref.itemId, provider: ref.provider, uri: ref.uri, version: ref.version,
        identity: recordingEvidenceSchema.parse(media), ...(equivalents.size ? { equivalents: [...equivalents.values()].slice(0, 8) } : {}) },
      metadata: { title: item.title, artist: item.artist, album: item.album, version: item.version, provider: item.provider, duration: item.duration,
        artworkId: item.artwork, artistArtworkId: item.artistArtwork } };
  }
  async resolveRecording(ref: RecordingDescriptor & { artwork?: string; artistArtwork?: string }): Promise<{ track: Track; uri: string; itemId: string; provider: string; version: string; allowedSources?: RecordingReference[]; identity?: IdentityMedia }> {
    const { item, media, candidate, allowedSources } = await this.exactRecording(ref, true);
    return { track: { id: item.id, title: item.version ? `${item.title} (${item.version})` : item.title,
       artist: item.artist, album: item.album, duration: item.duration ?? 0, artwork: item.artwork, artistArtwork: item.artistArtwork },
       uri: candidate.uri, itemId: candidate.itemId, provider: candidate.provider, version: candidate.version,
       allowedSources, identity: recordingEvidenceSchema.parse(media) };
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
    if (!supportsPlaybackSchema(info.schema_version)) throw new AppError(422, `Playback requires Music Assistant API schema ${verifiedPlaybackSchemas.join(', ')}. Compatible catalogue browsing remains available.`);
    return this.queue(playerId);
  }
  async queue(playerId: string): Promise<QueueSnapshot> {
    const result = queueSchema.safeParse(await this.read('/api', 'player_queues/get_active_queue', { player_id: playerId }));
    if (!result.success) throw new UpstreamError('unsupported-response', 502, 'The playback queue response is unsupported.');
    if (!result.data.available) throw new UpstreamError('destination-unavailable', 502, 'The playback destination is unavailable.');
    if (result.data.state === 'unknown') throw new UpstreamError('state-unconfirmed', 502, 'Music Assistant could not confirm the speaker’s playback state.');
    return result.data;
  }
  async queueItems(queueId: string): Promise<z.infer<typeof queueItemSchema>[]> {
    const result = z.array(queueItemSchema).max(2)
      .safeParse(await this.read('/api', 'player_queues/items', { queue_id: queueId, limit: 2, offset: 0 }));
    if (!result.success) throw new UpstreamError('unsupported-response', 502, 'The destination queue could not be verified.'); return result.data;
  }
  async configureSingle(queue: QueueSnapshot): Promise<boolean> {
    const queue_id = queue.queue_id;
    const dynamic = queue.is_dynamic === true;
    if (dynamic) {
      // Explicit Play already authorizes replacing this queue. Dynamic queues lock
      // repeat/shuffle: stop first, then clear without scheduling a late stop.
      await this.controlQueue(queue_id, 'stop');
      await this.read('/api', 'player_queues/clear', { queue_id, skip_stop: true });
      queue = await this.queue(queue_id);
      if (queue.queue_id !== queue_id || queue.is_dynamic || queue.items !== 0) throw new AppError(409, 'The speaker queue changed during setup. Try Play again.');
    }
    if (queue.autoplay_enabled) await this.read('/api', 'player_queues/autoplay', { queue_id, autoplay_enabled: false });
    if (queue.repeat_mode !== 'off') await this.read('/api', 'player_queues/repeat', { queue_id, repeat_mode: 'off' });
    if (queue.shuffle_enabled) await this.read('/api', 'player_queues/shuffle', { queue_id, shuffle_enabled: false });
    return dynamic || queue.autoplay_enabled || queue.repeat_mode !== 'off' || queue.shuffle_enabled;
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
  private isGroup(player: z.infer<typeof volumePlayerSchema>) { return player.type === 'group' || player.group_members.length > 1; }
  private volumeState(player: z.infer<typeof volumePlayerSchema>): VolumeState {
    const level = this.isGroup(player) ? player.group_volume : player.volume_level;
    return { available: level !== null && (player.supported_features.includes('volume_set') || player.volume_control !== 'none'), level };
  }
  async volume(playerId: string): Promise<VolumeState> { return this.volumeState(await this.volumePlayer(playerId)); }
  async pausedDestination(playerId: string, queueId: string): Promise<boolean> {
    const result = z.object({ player_id: z.string(), available: z.boolean(), playback_state: z.enum(['idle', 'paused', 'playing', 'unknown']),
      active_source: z.string().nullable(), active_group: z.string().nullable().optional(), synced_to: z.string().nullable().optional() })
      .safeParse(await this.read('/api', 'players/get', { player_id: playerId }));
    if (!result.success || result.data.player_id !== playerId) throw new UpstreamError('unsupported-response', 502, 'The paused destination could not be verified.');
    if (!result.data.available) throw new UpstreamError('destination-unavailable', 502, 'The paused destination is unavailable.');
    const player = result.data;
    return ['idle', 'paused'].includes(player.playback_state) && (!player.active_source || [playerId, queueId].includes(player.active_source)) &&
      (!player.active_group || [playerId, queueId].includes(player.active_group)) && (!player.synced_to || [playerId, queueId].includes(player.synced_to));
  }
  async setVolume(playerId: string, level: number, readBack = true): Promise<VolumeState> {
    if (!Number.isInteger(level) || level < 0 || level > 100) throw new AppError(400, 'Choose a volume from 0 to 100.');
    const player = await this.volumePlayer(playerId);
    if (!this.volumeState(player).available) throw new AppError(422, 'This destination does not support volume control.');
    await this.read('/api', this.isGroup(player) ? 'players/cmd/group_volume' : 'players/cmd/volume_set', { player_id: playerId, volume_level: level });
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
