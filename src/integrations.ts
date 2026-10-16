import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AppError, type CatalogueProvider, type CatalogueTrack, type CatalogueBrowse } from './model.js';
import { writePrivateJson } from './store.js';
import { MusicAssistantClient, musicAssistantUrl, maToken, isMusicAssistantApi, type MusicAssistantApi, type MusicAssistantReader, type ConnectionReport } from './music-assistant.js';
import type { SavedSelection } from './preparations.js';
import type { UploadAssets, UploadSelection } from './uploads.js';
import { applicationOrigin, diagnosticDuration, type AddressingView, type MediaCheck, type MediaChecks } from './addressing.js';
import { SerialQueue } from './serial.js';

export const integrationSchema = z.object({
  schema: z.literal(1), revision: z.number().int().nonnegative(),
  mediaOrigin: applicationOrigin.nullable().optional(),
  guestOrigin: applicationOrigin.optional(), automaticMediaOrigin: applicationOrigin.optional(),
  musicAssistant: z.object({ url: musicAssistantUrl, accessToken: maToken,
    sourceBindingId: z.string().uuid().optional(),
    serverId: z.string().min(1).max(200).optional(), browserUrl: musicAssistantUrl.optional(), tokenExpiresAt: z.number().int().positive().optional(),
    destination: z.object({ id: z.string(), name: z.string() }).strict().nullable(),
  }).strict().nullable(),
}).strict();
type IntegrationState = z.infer<typeof integrationSchema>;
export type IntegrationView = {
  revision: number; url: string | null; tokenConfigured: boolean;
  destination: { id: string; name: string } | null;
  status: 'not-configured' | 'not-checked' | 'checked' | 'error';
  message: string; report: ConnectionReport | null; playbackAvailable: boolean; playbackIssue: string;
  mediaOrigin?: string | null;
  browserUrl?: string; tokenExpiresAt?: number;
};
export interface PlaybackController {
  readonly ownsPlayback: boolean; readonly issue: string;
  configurationChanged(): void;
  recover(): Promise<void>;
}
export interface IntegrationStore { load(): Promise<IntegrationState>; save(state: IntegrationState): Promise<void> }
export class IntegrationFileStore implements IntegrationStore {
  constructor(private directory: string) {}
  async load(): Promise<IntegrationState> {
    try { return integrationSchema.parse(JSON.parse(await readFile(join(this.directory, 'integrations.json'), 'utf8'))); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { schema: 1, revision: 0, musicAssistant: null };
      throw new Error('Integration settings could not be loaded. Check the application data directory; nothing was overwritten.');
    }
  }
  async save(state: IntegrationState): Promise<void> { await writePrivateJson(this.directory, 'integrations.json', state); }
}

export class IntegrationManager implements CatalogueProvider {
  private state: IntegrationState = { schema: 1, revision: 0, musicAssistant: null };
  private report: ConnectionReport | null = null;
  private failure = '';
  private queue = new SerialQueue();
  private cachedReader?: MusicAssistantReader;
  private referenceKey = randomBytes(32);
  private catalogueEpoch = randomBytes(16).toString('base64url');
  private runtimeId = randomBytes(16).toString('base64url');
  private playback?: PlaybackController;
  private uploads?: UploadAssets;
  private defaultMediaOrigin = '';
  private checks?: MediaChecks;
  private environmentMediaOrigins: string[] = [];
  private checking = false;
  private inspection?: { revision: number; pending: Promise<IntegrationView> };
  private mediaCheck: MediaCheck = { status: 'unchecked', origin: null, checkedAt: null, message: 'Not checked since startup. No audio has been started.' };
  constructor(private store: IntegrationStore, private reader = (url: string, token: string): MusicAssistantReader => new MusicAssistantClient(url, token)) {}
  async init(): Promise<void> {
    this.state = await this.store.load();
    if (this.state.musicAssistant && !this.state.musicAssistant.sourceBindingId) {
      const next = structuredClone(this.state); next.musicAssistant!.sourceBindingId = randomUUID();
      await this.store.save(next); this.state = next; // Private startup migration; no audio, discovery, or revision change.
    }
  }
  get configured(): boolean { return this.state.musicAssistant !== null; }
  get configurationRevision(): string { return `${this.state.revision}:${this.runtimeId}`; }
  /** Catalogue identity changes only with credentials/origin (or a new process), never with speaker routing. */
  get catalogueRevision(): string { return this.catalogueEpoch; }
  get sourceBindingId(): string | null { return this.state.musicAssistant?.sourceBindingId ?? null; }
  get serverId(): string | undefined { return this.state.musicAssistant?.serverId; }
  assertSetupRevision(revision: number) {
    this.expected(revision);
    if (this.playback?.ownsPlayback) throw new AppError(409, 'Stop or finish the current track before changing connection settings.');
  }
  get playbackAvailable(): boolean { return Boolean(this.state.musicAssistant?.destination && this.playback); }
  get uploadPlaybackAvailable(): boolean { return Boolean(this.uploads && this.playbackAvailable); }
  attachUploads(uploads: UploadAssets, guestUrl: string) { this.uploads = uploads; this.defaultMediaOrigin = guestUrl; }
  attachMediaChecks(checks: MediaChecks) { this.checks = checks; }
  get guestOrigin() { return this.state.guestOrigin || this.defaultMediaOrigin; }
  setEnvironmentMediaOrigins(origins: string[]) { this.environmentMediaOrigins = origins.map(value => applicationOrigin.parse(value)).slice(0, 4); }
  async initializeGuestOrigin(origin: string) {
    return this.serial(async () => {
      if (!this.state.guestOrigin && !this.playback?.ownsPlayback) await this.commit({ ...this.state, guestOrigin: applicationOrigin.parse(origin), revision: this.state.revision + 1 });
      return this.guestOrigin;
    });
  }
  mediaCandidates(browserOrigin?: string): string[] {
    if (this.state.mediaOrigin) return [this.state.mediaOrigin];
    return [...new Set([...this.environmentMediaOrigins, browserOrigin, this.state.automaticMediaOrigin, this.guestOrigin].filter((value): value is string => Boolean(value)))].slice(0, 6);
  }
  private get effectiveMediaOrigin() { return this.state.mediaOrigin || this.state.automaticMediaOrigin || this.guestOrigin; }
  mediaHostAllowed(host: string) { const origin = this.effectiveMediaOrigin; return Boolean(origin && new URL(origin).host === host); }
  addressing(): AddressingView {
    const check = this.mediaCheck.status === 'verified' && this.mediaCheck.checkedAt! + 5 * 60_000 <= Date.now()
      ? { ...this.mediaCheck, status: 'expired' as const, message: 'The last check is over five minutes old. Check again if the network changed.' } : this.mediaCheck;
    return { revision: this.state.revision, guestOrigin: this.guestOrigin, mediaOrigin: this.state.mediaOrigin ?? null,
      automaticMediaOrigin: this.state.automaticMediaOrigin ?? null, effectiveMediaOrigin: this.effectiveMediaOrigin, configured: this.configured, mediaCheck: { ...check } };
  }
  async saveGuestOrigin(origin: string, revision: number) {
    return this.serial(async () => {
      this.expected(revision); origin = applicationOrigin.parse(origin);
      await this.commit({ ...this.state, guestOrigin: origin, revision: revision + 1 }); return this.addressing();
    });
  }
  /** Separate diagnostic lane: never holds the player/volume serializer during network I/O. */
  async checkMediaOrigins(origins: string[], revision: number, automatic = false): Promise<AddressingView> {
    this.expected(revision);
    if (!this.configured || !this.checks) throw new AppError(409, 'Save a Music Assistant connection before testing file access.');
    if (this.checking) throw new AppError(429, 'A file connection check is already running.');
    const supplied = z.array(applicationOrigin).min(1).max(6).parse(origins);
    const candidates = automatic ? this.state.mediaOrigin ? [this.state.mediaOrigin] : [...new Set([...this.environmentMediaOrigins, ...supplied])].slice(0, 6) : supplied;
    const setup = this.configurationRevision; const api = this.getApi(); this.checking = true;
    this.mediaCheck = { status: 'checking', origin: null, checkedAt: null, message: 'Music Assistant is fetching a protected diagnostic file. No audio is played.' };
    try {
      for (const origin of [...new Set(candidates)]) {
        const lease = this.checks.create(origin); let verified = false;
        try { await api.resolveUploaded(lease.url, diagnosticDuration); verified = lease.observed; }
        catch { /* Upstream errors may echo capability URLs; never return or log them. */ }
        finally { lease.revoke(); }
        if (setup !== this.configurationRevision) throw new AppError(409, 'Settings changed during the file connection check. Check again.');
        if (!verified) continue;
        return await this.serial(async () => {
          this.expected(revision);
          if (automatic && !this.state.mediaOrigin && origin !== this.effectiveMediaOrigin && !this.playback?.ownsPlayback) {
            await this.commit({ ...this.state, automaticMediaOrigin: origin, revision: revision + 1 });
          }
          this.mediaCheck = { status: 'verified', origin, checkedAt: Date.now(), message: 'Music Assistant fetched the exact diagnostic file successfully. No audio was played.' };
          return this.addressing();
        });
      }
      this.mediaCheck = { status: 'failed', origin: candidates[0]!, checkedAt: Date.now(), message: 'Music Assistant could not fetch and verify this application’s diagnostic file. Check the app address, DNS, published port, firewall and routing. Saved addresses and files were kept; no audio was played.' };
      return this.addressing();
    } catch (error) {
      if (setup === this.configurationRevision) this.mediaCheck = { status: 'unchecked', origin: null, checkedAt: null, message: 'The check could not finish. Try again.' };
      throw error;
    } finally { this.checking = false; }
  }
  attachPlayback(playback: PlaybackController): void { this.playback = playback; }
  private getReader(): MusicAssistantReader {
    const ma = this.state.musicAssistant;
    if (!ma) throw new AppError(409, 'The catalogue connection changed. Search again.');
    return this.cachedReader ??= this.reader(ma.url, ma.accessToken);
  }
  private getApi(): MusicAssistantApi {
    const api = this.getReader();
    if (!isMusicAssistantApi(api)) throw new AppError(422, 'This connection does not support catalogue browsing/playback.');
    return api;
  }
  private seal(id: string, kind: string, context: string): string {
    const nonce = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', this.referenceKey, nonce);
    const data = Buffer.concat([cipher.update(JSON.stringify({ id, kind, context, revision: this.catalogueRevision, expires: kind === 'upload-image' ? Number.MAX_SAFE_INTEGER : Date.now() + 12 * 60 * 60_000 })), cipher.final()]);
    return `ref:${Buffer.concat([nonce, cipher.getAuthTag(), data]).toString('base64url')}`;
  }
  private unseal(value: string, kind: string, context: string): string {
    try {
      if (!value.startsWith('ref:') || value.length > 1000) throw new Error();
      const raw = Buffer.from(value.slice(4), 'base64url');
      const decipher = createDecipheriv('aes-256-gcm', this.referenceKey, raw.subarray(0, 12)); decipher.setAuthTag(raw.subarray(12, 28));
      const ref = JSON.parse(Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8'));
      if (ref.context !== context || ref.kind !== kind || ref.revision !== this.catalogueRevision || ref.expires < Date.now() || typeof ref.id !== 'string') throw new Error();
      return ref.id;
    } catch { throw new AppError(409, 'This catalogue selection expired or belongs to another participant. Browse again.'); }
  }
  private withArtwork<T extends { artwork?: string; artistArtwork?: string }>(item: T, context: string): T {
    const url = (id?: string) => id && /^image:[a-f0-9]{64}$/.test(id) ? `/api/participant/artwork/${encodeURIComponent(this.seal(id, 'image', context))}` : undefined;
    return { ...item, artwork: url(item.artwork), artistArtwork: url(item.artistArtwork) };
  }
  async artwork(reference: string, context: string) {
    const revision = this.catalogueRevision;
    const data = reference.startsWith('upload:') && this.uploads
      ? await this.uploads.artwork(this.unseal(reference.slice(7), 'upload-image', context))
      : await this.getApi().artwork(this.unseal(reference, 'image', context));
    if (revision !== this.catalogueRevision) throw new AppError(409, 'The artwork connection changed.');
    return data;
  }
  async search(query: string, context = ''): Promise<CatalogueTrack[]> {
    const ma = this.state.musicAssistant; const revision = this.catalogueRevision;
    if (!ma) throw new AppError(409, 'The catalogue connection changed. Search again.');
    const tracks = await this.getReader().search(query);
    if (this.catalogueRevision !== revision) throw new AppError(409, 'The catalogue connection changed during search. Search again.');
    return tracks.map(t => this.withArtwork({ ...t, id: this.seal(t.id, 'track', context) }, context));
  }
  async browse(kind: 'artists' | 'albums' | 'tracks', value: string, context: string): Promise<CatalogueBrowse> {
    const revision = this.catalogueRevision; const api = this.getApi();
    let result: CatalogueBrowse;
    if (kind === 'artists') result = { playbackAvailable: this.playbackAvailable,
      artists: (await api.artists(value)).map(a => this.withArtwork({ ...a, id: this.seal(a.id, 'artist', context) }, context)) };
    else if (kind === 'albums') result = { playbackAvailable: this.playbackAvailable,
      albums: (await api.albums(this.unseal(value, 'artist', context))).map(a => this.withArtwork({ ...a, id: this.seal(a.id, 'album', context) }, context)) };
    else result = { playbackAvailable: this.playbackAvailable,
      tracks: (await api.tracks(this.unseal(value, 'album', context))).map(t => this.withArtwork({ ...t, id: this.seal(t.id, 'track', context) }, context)) };
    if (revision !== this.catalogueRevision) throw new AppError(409, 'The catalogue connection changed. Browse again.');
    return result;
  }
  async resolve(id: string, context: string) {
    const revision = this.state.revision; const catalogueRevision = this.catalogueRevision; const api = this.getApi();
    const result = await api.resolveTrack(this.unseal(id, 'track', context));
    if (catalogueRevision !== this.catalogueRevision) throw new AppError(409, 'The catalogue connection changed. Browse again.');
    if (revision !== this.state.revision) throw new AppError(409, 'Playback setup changed during lookup. Your prepared choice is still available; try playing it again.');
    return { ...result, track: this.withArtwork({ ...result.track, id }, context), revision };
  }
  async captureSaved(id: string, context: string): Promise<SavedSelection> {
    const epoch = this.catalogueRevision; const sourceBindingId = this.sourceBindingId;
    if (!sourceBindingId) throw new AppError(409, 'Save a catalogue connection before adding this selection.');
    const descriptor = await this.getApi().captureTrack(this.unseal(id, 'track', context));
    if (epoch !== this.catalogueRevision || sourceBindingId !== this.sourceBindingId) throw new AppError(409, 'The catalogue changed during capture. Browse again; your saved list was kept.');
    return { source: 'music-assistant', sourceBindingId, ...descriptor };
  }
  private savedSource(selection: SavedSelection) {
    if (selection.source !== 'music-assistant' || selection.sourceBindingId !== this.sourceBindingId) throw new AppError(409, 'This saved track belongs to a different catalogue connection. It was kept in your list.');
    return selection;
  }
  async resolveSaved(selection: SavedSelection, context: string, trackId: string) {
    const saved = this.savedSource(selection); const revision = this.state.revision; const epoch = this.catalogueRevision;
    const result = await this.getApi().resolveRecording({ ...saved.recording, artwork: saved.metadata.artworkId, artistArtwork: saved.metadata.artistArtworkId });
    this.savedSource(saved);
    if (revision !== this.state.revision || epoch !== this.catalogueRevision) throw new AppError(409, 'Playback setup changed during lookup. Your saved list was kept; review the destination and try again.');
    return { ...result, track: this.withArtwork({ ...result.track, id: trackId }, context), revision };
  }
  async savedArtwork(selection: SavedSelection, kind: 'artwork' | 'artistArtwork') {
    const saved = this.savedSource(selection); const epoch = this.catalogueRevision;
    const image = kind === 'artwork' ? saved.metadata.artworkId : saved.metadata.artistArtworkId;
    if (!image) throw new AppError(404, 'Artwork unavailable.');
    const data = await this.getApi().artwork(image); this.savedSource(saved);
    if (epoch !== this.catalogueRevision) throw new AppError(409, 'The artwork connection changed.'); return data;
  }
  async resolveUpload(selection: UploadSelection, context: string, trackId: string) {
    if (!this.uploads || !this.playbackAvailable) throw new AppError(409, 'Configure Music Assistant and a speaker before playing an uploaded file.');
    const revision = this.state.revision; const epoch = this.catalogueRevision;
    const lease = await this.uploads.lease(selection.assetId, this.effectiveMediaOrigin, selection.sha256);
    try {
      let resolved;
      try { resolved = await this.getApi().resolveUploaded(lease.url, selection.metadata.duration ?? 0); }
      catch { throw new AppError(422, 'Music Assistant could not read this uploaded track. Check the Uploaded file playback address in host settings and allow Music Assistant to reach it. Your file and list entry were kept.'); }
      if (revision !== this.state.revision || epoch !== this.catalogueRevision) throw new AppError(409, 'Playback settings changed during file lookup. Try again after reviewing the destination.');
      if (!lease.observed) throw new AppError(422, 'Music Assistant did not reach this application’s uploaded file. Check the uploaded-file playback address. No audio was started.');
      return { ...resolved, revision, uploaded: true, release: lease.revoke, suspend: lease.suspend,
        track: { id: trackId, title: selection.metadata.title, artist: selection.metadata.artist, album: selection.metadata.album, duration: selection.metadata.duration ?? 0,
          ...(selection.artworkAssetId ? { artwork: `/api/participant/artwork/upload:${this.seal(selection.assetId, 'upload-image', context)}` } : {}) } };
    } catch (error) { lease.revoke(); throw error; }
  }
  async saveMediaOrigin(origin: string | null, revision: number) {
    if (this.playback?.ownsPlayback) throw new AppError(409, 'Stop or finish the current track before changing connection settings.');
    let verified: MediaCheck | undefined;
    if (origin) {
      origin = applicationOrigin.parse(origin);
      const checked = await this.checkMediaOrigins([origin], revision);
      if (checked.mediaCheck.status !== 'verified') throw new AppError(422, checked.mediaCheck.message);
      verified = checked.mediaCheck;
    }
    return this.serial(async () => {
      this.expected(revision);
      await this.commit({ ...this.state, revision: this.state.revision + 1, mediaOrigin: origin || null });
      if (origin && verified) this.mediaCheck = verified;
      return this.view();
    });
  }
  async withPlayback<T>(work: (api: MusicAssistantApi, destination: string, revision: number) => Promise<T>): Promise<T> {
    return this.serial(async () => {
      const destination = this.state.musicAssistant?.destination;
      if (!destination) throw new AppError(409, 'The host must configure a playback destination first.');
      return work(this.getApi(), destination.id, this.state.revision);
    });
  }
  async withDemoPlayback<T>(work: () => Promise<T>): Promise<T> {
    return this.serial(async () => {
      if (this.configured) throw new AppError(409, 'The music connection changed. Select the recording again.');
      return work();
    });
  }
  async recoverPlayback(revision: number): Promise<IntegrationView> {
    return this.withPlayback(async () => { this.expected(revision); await this.playback?.recover(); return this.view(); });
  }
  private serial<T>(work: () => Promise<T>): Promise<T> {
    return this.queue.run(work);
  }
  private expected(revision: number) {
    if (revision !== this.state.revision) throw new AppError(409, 'Integration settings changed in another browser. Reload them before trying again.');
  }
  private async commit(next: IntegrationState) {
    if (this.playback?.ownsPlayback) throw new AppError(409, 'Stop or finish the current track before changing connection settings.');
    const connectionChanged = this.state.musicAssistant?.url !== next.musicAssistant?.url || this.state.musicAssistant?.accessToken !== next.musicAssistant?.accessToken;
    try { await this.store.save(next); } catch { throw new AppError(503, 'Integration settings could not be saved. Check the application data directory.'); }
    this.state = next; this.report = null; this.failure = '';
    this.mediaCheck = { status: 'unchecked', origin: null, checkedAt: null, message: 'Addresses or settings changed. Check file access again; no audio has been started.' };
    if (connectionChanged) {
      this.cachedReader = undefined;
      this.catalogueEpoch = randomBytes(16).toString('base64url');
      this.referenceKey = randomBytes(32);
    }
    // Configuration writes invalidate pending routing/volume intents, never start audio.
    this.playback?.configurationChanged();
  }
  /** Explicit allowlist. Tokens, queue payloads, and internal exceptions never enter the view. */
  view(): IntegrationView {
    const ma = this.state.musicAssistant;
    return { revision: this.state.revision, url: ma?.url ?? null, tokenConfigured: Boolean(ma?.accessToken),
      destination: ma?.destination ? { id: ma.destination.id, name: ma.destination.name } : null,
      status: !ma ? 'not-configured' : this.failure ? 'error' : this.report ? 'checked' : 'not-checked',
      message: !ma ? 'Music Assistant is not configured. You can keep using the demo.' : this.failure || (this.report
        ? 'Music Assistant is configured. Music starts only when the current participant presses Play.'
        : 'Music Assistant is configured. Speakers are discovered automatically when settings open.'),
      report: structuredClone(this.report), playbackAvailable: this.playbackAvailable, playbackIssue: this.playback?.issue ?? '', mediaOrigin: this.state.mediaOrigin ?? null,
      ...(ma?.browserUrl ? { browserUrl: ma.browserUrl } : {}), ...(ma?.tokenExpiresAt ? { tokenExpiresAt: ma.tokenExpiresAt } : {}) };
  }
  async save(url: string, accessToken: string | undefined, revision: number): Promise<IntegrationView> {
    return this.serial(async () => {
      this.expected(revision); url = musicAssistantUrl.parse(url);
      const previous = this.state.musicAssistant;
      // Never forward a retained secret to a newly supplied origin.
      if (previous?.url !== url && !accessToken) throw new AppError(400, 'Enter a token for the new server URL. The old token cannot be reused automatically.');
      const nextToken = accessToken ? maToken.parse(accessToken) : previous?.accessToken;
      if (!nextToken) throw new AppError(400, 'Enter a Music Assistant access token.');
      await this.commit({ ...this.state, schema: 1, revision: this.state.revision + 1, musicAssistant: {
        url, accessToken: nextToken, destination: previous?.url === url ? previous.destination : null,
        sourceBindingId: previous?.url === url ? previous.sourceBindingId ?? randomUUID() : randomUUID(),
        ...(previous?.url === url && previous.serverId ? { serverId: previous.serverId } : {}),
      } });
      return this.view();
    });
  }
  /** Authorization validated the new endpoint/token. Identity, not IP, preserves preparations. */
  async saveAuthorized(url: string, accessToken: string, serverId: string, browserUrl: string, revision: number, tokenExpiresAt?: number) {
    return this.serial(async () => {
      this.assertSetupRevision(revision); url = musicAssistantUrl.parse(url); accessToken = maToken.parse(accessToken);
      const previous = this.state.musicAssistant;
      const same = previous && (previous.serverId ? previous.serverId === serverId : previous.url === url);
      if (previous && !same) throw new AppError(409, 'This is a different Music Assistant server. Disconnect explicitly before replacing the catalogue. Your saved lists were kept.');
      await this.commit({ ...this.state, revision: revision + 1, musicAssistant: { url, accessToken, serverId,
        browserUrl: musicAssistantUrl.parse(browserUrl), ...(tokenExpiresAt ? { tokenExpiresAt } : {}),
        sourceBindingId: same ? previous.sourceBindingId ?? randomUUID() : randomUUID(), destination: same ? previous.destination : null } });
      return this.view();
    });
  }
  /** Only Supervisor/mDNS-verified candidates matching a persisted server ID reach here. */
  async relocate(url: string, serverId: string, revision: number) {
    this.assertSetupRevision(revision); const previous = this.state.musicAssistant;
    if (!previous?.serverId || previous.serverId !== serverId || previous.url === url) return;
    url = musicAssistantUrl.parse(url);
    const report = await this.reader(url, previous.accessToken).inspect();
    if (report.serverId !== serverId) throw new AppError(409, 'The discovered Music Assistant identity changed.');
    return this.serial(async () => {
      this.assertSetupRevision(revision);
      await this.commit({ ...this.state, revision: revision + 1, musicAssistant: { ...previous, url } });
    });
  }
  async clear(revision: number): Promise<IntegrationView> {
    return this.serial(async () => {
      this.expected(revision); await this.commit({ ...this.state, schema: 1, revision: this.state.revision + 1, musicAssistant: null }); return this.view();
    });
  }
  async check(revision: number): Promise<IntegrationView> {
    this.expected(revision);
    if (this.inspection?.revision === revision) return this.inspection.pending;
    const pending = this.inspectSettings(revision);
    this.inspection = { revision, pending };
    try { return await pending; }
    finally { if (this.inspection?.pending === pending) this.inspection = undefined; }
  }
  private async inspectSettings(revision: number): Promise<IntegrationView> {
    const ma = this.state.musicAssistant;
    if (!ma) throw new AppError(400, 'Save a Music Assistant connection first.');
    let report: ConnectionReport | null = null; let failure = '';
    try {
      const reader = this.reader(ma.url, ma.accessToken); report = await reader.inspect();
      if (ma.serverId && report.serverId !== ma.serverId) { report = null; throw new AppError(409, 'Music Assistant server identity changed. Disconnect explicitly before replacing the catalogue.'); }
      if (ma.destination) {
        if (!report.players.some(p => p.id === ma.destination!.id && p.available)) throw new AppError(422, 'The saved destination is unavailable. Check Music Assistant and select an available destination.');
        await reader.activeQueue(ma.destination.id);
      }
    } catch (error) {
      failure = error instanceof AppError ? error.message : 'Could not load Music Assistant speakers. Reload saved settings or reconnect Music Assistant.';
    }
    // Discovery is read-only and may be slow. Only publication shares the playback
    // lane; a stale inspection cannot overwrite a newly saved connection's status.
    return this.serial(async () => {
      this.expected(revision);
      if (!ma.serverId && report?.serverId) {
        const next = { ...this.state, musicAssistant: { ...ma, serverId: report.serverId } };
        await this.store.save(next); this.state = next; // Identity enrichment does not alter routing/revision.
      }
      this.report = report; this.failure = failure; return this.view();
    });
  }
  async selectDestination(id: string, revision: number): Promise<IntegrationView> {
    this.expected(revision); const ma = this.state.musicAssistant;
    if (!ma) throw new AppError(409, 'Reload saved settings and select an available destination.');
    // Discovery must not delay Stop or other playback controls. Revalidate settings
    // and playback ownership only when committing the selected destination.
    const reader = this.reader(ma.url, ma.accessToken); const report = await reader.inspect();
    const player = report.players.find(p => p.id === id && p.available);
    if (!player) throw new AppError(409, 'Reload saved settings and select an available destination.');
    try { await reader.activeQueue(id); }
    catch (error) {
      return this.serial(async () => {
        this.expected(revision); this.report = report;
        this.failure = error instanceof AppError ? error.message : 'The destination could not be loaded. Reload saved settings to try again.';
        throw new AppError(502, this.failure);
      });
    }
    return this.serial(async () => {
      this.expected(revision);
      await this.commit({ ...this.state, schema: 1, revision: this.state.revision + 1, musicAssistant: { ...ma, destination: { id: player.id, name: player.name } } });
      this.report = report; return this.view();
    });
  }
}
