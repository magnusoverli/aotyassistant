import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AppError, type CatalogueProvider, type CatalogueTrack, type CatalogueBrowse, type OutputState, type GuestAccess } from './model.js';
import { findSong, ServiceGates, songKey, type SongFinder } from './list-import.js';
import { BoundedCache } from './bounded-cache.js';
import { UpstreamError } from './upstream-error.js';
import type { SharedSong } from './shared-list.js';
import { PersistenceError } from './store.js';
import { MusicAssistantClient, isMusicAssistantApi, type MusicAssistantApi, type MusicAssistantReader, type ConnectionReport, type ArtworkSize } from './music-assistant.js';
import { bareHostname, musicAssistantUrl, maToken } from './lan-network.js';
import type { SavedSelection } from './preparations.js';
import type { UploadAssets, UploadSelection } from './uploads.js';
import { applicationOrigin, shareableOrigin, diagnosticDuration, type AddressingView, type MediaCheck, type MediaChecks } from './addressing.js';
import type { SupervisorHints } from './supervisor.js';
import { SerialQueue } from './serial.js';
import { bulkCatalogue, operation } from './operation.js';
import { CatalogueReferences, artworkPath } from './catalogue-references.js';
import { OutputMonitor } from './output-monitor.js';
import { playbackCompatibility, supportsPlaybackSchema } from './music-assistant-policy.js';
import type { PlaybackProblem } from './playback-problem.js';
import { speakerFreshnessMs, type SpeakerInventory } from './speaker-inventory.js';
import type { IntegrationState, IntegrationStore } from './integration-store.js';
export { integrationSchema, IntegrationFileStore, type IntegrationStore } from './integration-store.js';

export type IntegrationView = {
  revision: number; url: string | null; tokenConfigured: boolean;
  destination: { id: string; name: string } | null;
  status: 'not-configured' | 'not-checked' | 'checked' | 'error';
  destinationStatus: 'not-selected' | 'not-checked' | 'checked' | 'error';
  destinationMessage: string;
  message: string; report: ConnectionReport | null; playbackAvailable: boolean; playbackIssue: string;
  playbackProblem?: PlaybackProblem;
  speakerInventory?: SpeakerInventory;
  mediaOrigin?: string | null;
  browserUrl?: string; tokenExpiresAt?: number;
  settingsChangesBlocked?: boolean;
  output: OutputState;
  sequence?: number;
  instanceId?: string;
  addressing?: AddressingView;
  authorization?: { attemptId: string; revision: number };
  compatibility?: ReturnType<typeof playbackCompatibility> | null;
};
/** Only a definitely-not-written save leaves the previous settings authoritative. */
const uncertainSave = (error: unknown) => !(error instanceof PersistenceError) || error.outcome === 'uncertain';
export interface PlaybackController {
  readonly ownsPlayback: boolean; readonly issue: string;
  readonly problem?: PlaybackProblem;
  readonly requiresRecovery?: boolean;
  configurationChanged(): void;
  recover(): Promise<void>;
}

export class IntegrationManager implements CatalogueProvider {
  private state: IntegrationState = { schema: 1, revision: 0, musicAssistant: null };
  private report: ConnectionReport | null = null;
  private lastInventoryReport: ConnectionReport | null = null;
  private inventoryChecks = new Set<{ revision: number }>();
  private failure = '';
  private destinationFailure: string | null = null;
  private destinationCheckedAt: number | null = null;
  private queue = new SerialQueue();
  private cachedReader?: MusicAssistantReader;
  private references = new CatalogueReferences();
  /** Imports share per-service pacing, the connected-service list, and songs already found (by anyone). */
  private gates = new ServiceGates();
  private services?: { revision: string; domains?: string[]; expires: number };
  private filterless?: string;
  private importedSongs = new BoundedCache<SavedSelection>(4000);
  private runtimeId = randomBytes(16).toString('base64url');
  private playback?: PlaybackController;
  private uploads?: UploadAssets;
  private defaultMediaOrigin = '';
  private addon = false;
  private guestOverride = false;
  private guestHints?: SupervisorHints;
  private pendingGuest?: string;
  private checks?: MediaChecks;
  private environmentMediaOrigins: string[] = [];
  private checking = false;
  private inspection?: { revision: number; pending: Promise<IntegrationView> };
  private observation = 0;
  private listeners = new Set<() => void>();
  private monitor = new OutputMonitor(() => this.configured && !this.settingsUncertain && !this.closed ? this.getReader() : undefined,
    id => this.report?.players.find(player => player.id === id), () => this.configured ? this.check(this.state.revision) : Promise.resolve(), () => this.changed());
  private playbackKey = '';
  private lastView = '';
  private sequence = 0;
  private addressingSequence = 0;
  private lastAddressing = '';
  private authorization?: IntegrationView['authorization'];
  private settingsUncertain = false;
  private closed = false;
  private mediaCheck: MediaCheck = { status: 'unchecked', origin: null, checkedAt: null, message: 'Not checked since startup. No audio has been started.' };
  constructor(private store: IntegrationStore, private reader = (url: string, token: string): MusicAssistantReader => new MusicAssistantClient(url, token)) {}
  async init(): Promise<void> {
    this.state = await this.store.load();
    if (this.state.musicAssistant && !this.state.musicAssistant.sourceBindingId) {
      const next = structuredClone(this.state); next.musicAssistant!.sourceBindingId = randomUUID();
      await this.store.save(next); this.state = next; // Private startup migration; no audio, discovery, or revision change.
    }
  }
  // An ambiguous first save must not silently fall back to demo playback.
  get configured(): boolean { return this.settingsUncertain || this.state.musicAssistant !== null; }
  get configurationRevision(): string { return `${this.state.revision}:${this.runtimeId}`; }
  /** Catalogue identity changes only with credentials/origin (or a new process), never with speaker routing. */
  get catalogueRevision(): string { return this.references.revision; }
  get sourceBindingId(): string | null { return this.state.musicAssistant?.sourceBindingId ?? null; }
  get serverId(): string | undefined { return this.state.musicAssistant?.serverId; }
  /** Server-only transport configuration. Never include this object in an HTTP view. */
  browserSpeakerConnection() {
    const ma = this.state.musicAssistant;
    if (!ma || this.closed || this.settingsUncertain) throw new AppError(409, 'Connect Music Assistant in Settings first.');
    const report = this.report ?? this.lastInventoryReport;
    if (!report || !ma.serverId) throw new AppError(409, 'Waiting for the Music Assistant connection.');
    if (!supportsPlaybackSchema(report.schemaVersion)) throw new AppError(422, playbackCompatibility(report.schemaVersion, report.serverVersion).message);
    return { origin: ma.url, token: ma.accessToken, epoch: this.catalogueRevision,
      scope: createHash('sha256').update(`${ma.sourceBindingId}:${ma.serverId}`).digest('hex'), version: report.serverVersion, serverId: ma.serverId };
  }
  assertSetupRevision(revision: number) {
    this.expected(revision);
    if (this.playback?.ownsPlayback) throw new AppError(409, 'Stop or finish the current track before changing connection settings.');
  }
  get routeConfigured(): boolean { return !this.settingsUncertain && Boolean(this.state.musicAssistant?.destination && this.playback); }
  get playbackAvailable(): boolean { return this.routeConfigured && this.output.state === 'ready'; }
  get uploadPlaybackAvailable(): boolean { return Boolean(this.uploads && this.routeConfigured); }
  private get freshReport() { return this.report && Date.now() - this.report.checkedAt < speakerFreshnessMs ? this.report : null; }
  private get destinationFresh() { return this.destinationCheckedAt !== null && Date.now() - this.destinationCheckedAt < speakerFreshnessMs; }
  private inventory(): SpeakerInventory {
    const asOf = Date.now(); const report = this.lastInventoryReport;
    const expiresAt = report ? report.checkedAt + speakerFreshnessMs : null;
    const pending = [...this.inventoryChecks].some(check => check.revision === this.state.revision);
    const state = !this.configured ? 'not-configured' : pending ? report ? 'refreshing' : 'loading'
      : this.settingsUncertain || this.failure ? 'failed' : !report ? 'loading' : expiresAt! <= asOf ? 'stale' : 'verified';
    return { state, checkedAt: report?.checkedAt ?? null, expiresAt, asOf,
      players: report?.players.map(({ id, name, available }) => ({ id, name, available })) ?? [] };
  }
  get output(): OutputState {
    const selected = this.state.musicAssistant?.destination;
    const report = this.freshReport;
    const player = report?.players.find(player => player.id === selected?.id);
    const state = this.settingsUncertain ? 'unconfirmed' : !selected ? 'none' : this.playback?.requiresRecovery ? 'recovery' : this.failure ? 'unconfirmed'
      : !report ? 'checking' : !player?.available ? 'unavailable' : !this.destinationFresh || this.destinationFailure === null ? 'checking'
      : this.destinationFailure ? 'unavailable' : !supportsPlaybackSchema(report.schemaVersion) ? 'incompatible' : 'ready';
    return { name: player?.name ?? selected?.name ?? null, state, checkedAt: selected ? this.destinationCheckedAt : report?.checkedAt ?? null,
      ...(state === 'incompatible' ? { reason: 'unsupported-schema' as const } : {}) };
  }
  subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private changed() { for (const listener of this.listeners) listener(); }
  startMonitoring(interval = 15_000) { if (!this.closed) this.monitor.start(interval); }
  stopMonitoring() { this.monitor.stop(); }
  refreshOutputSoon() { if (this.configured && !this.closed) this.monitor.refreshSoon(); }
  playbackChanged() {
    const key = JSON.stringify([this.playback?.ownsPlayback, this.playback?.requiresRecovery, this.playback?.issue, this.playback?.problem]);
    if (key !== this.playbackKey) { this.playbackKey = key; this.changed(); }
  }
  attachUploads(uploads: UploadAssets, guestUrl: string) { this.uploads = uploads; this.defaultMediaOrigin = guestUrl; }
  attachMediaChecks(checks: MediaChecks) { this.checks = checks; }
  configureGuestAccess(origin: string, addon = false, override = false) {
    this.defaultMediaOrigin = origin; this.addon = addon; this.guestOverride = override;
  }
  get guestOrigin() { return this.state.guestOrigin || (this.guestOverride ? this.defaultMediaOrigin : this.state.automaticGuestOrigin) || this.defaultMediaOrigin; }
  get guestAccess(): GuestAccess {
    const source = this.state.guestOrigin ? this.state.guestSelection === 'manual' ? 'manual' : 'legacy' : this.guestOverride || !this.addon ? 'configured' : 'automatic';
    const hints = this.guestHints;
    if (hints?.internalHosts?.includes(bareHostname(new URL(this.guestOrigin).hostname)) && !hints.guestOrigins.includes(this.guestOrigin)) return { source, status: 'unavailable', message: 'The saved address belongs to the app’s internal network. Use automatic addressing in Advanced guest settings.' };
    if (source === 'automatic') {
      if (!hints?.available || !hints.networkAvailable) return { source, status: 'checking', message: 'Preparing guest link. Home Assistant network discovery will retry automatically.' };
      if (!hints.guestPort) return { source, status: 'unavailable', message: 'Guest access is disabled. Enable the guest port in the app’s Home Assistant Network settings.' };
      if (!hints.guestOrigins.includes(this.guestOrigin)) {
        const candidates = hints.preferredGuestOrigins ?? hints.guestOrigins;
        if (candidates.length === 1) return { source, status: 'checking', message: 'Updating the guest link. Address changes wait until the current song finishes.' };
        if (candidates.length > 1) return { source, status: 'ambiguous', message: 'Choose the home network your guests use in Advanced guest settings.' };
        return { source, status: 'unavailable', message: 'No guest network address was found. Check Home Assistant networking or choose an address in Advanced guest settings.' };
      }
    }
    if (!shareableOrigin(this.guestOrigin)) return { source, status: this.addon ? 'unavailable' : 'ready', message: 'These links work only on this device. Choose a LAN address in Advanced guest settings to share with other devices.' };
    return { source, status: 'ready', message: source === 'automatic' ? 'Guest link detected automatically. For devices on your home network.' : 'Using the saved guest address. Guest devices must be able to reach it.' };
  }
  setEnvironmentMediaOrigins(origins: string[]) { this.environmentMediaOrigins = origins.map(value => applicationOrigin.parse(value)).slice(0, 4); }
  async updateGuestDiscovery(hints: SupervisorHints) {
    return this.serial(async () => {
      this.guestHints = hints;
      if (!hints.available || !hints.networkAvailable) { this.pendingGuest = undefined; this.changed(); return this.guestOrigin; }
      const previous = this.state.automaticGuestOrigin;
      const candidates = hints.preferredGuestOrigins ?? hints.guestOrigins;
      const candidate = previous && hints.guestOrigins.includes(previous) ? previous : candidates.length === 1 ? candidates[0] : undefined;
      // Initial discovery is immediate; replacing a saved automatic address requires two observations.
      const settled = !previous || this.pendingGuest === candidate;
      this.pendingGuest = candidate;
      if (candidate && candidate !== previous && settled && !this.playback?.ownsPlayback) {
        this.expected(this.state.revision);
        await this.commit({ ...this.state, automaticGuestOrigin: applicationOrigin.parse(candidate), revision: this.state.revision + 1 });
      }
      this.changed();
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
    const result = { revision: this.state.revision, guestOrigin: this.guestOrigin, mediaOrigin: this.state.mediaOrigin ?? null,
      automaticMediaOrigin: this.state.automaticMediaOrigin ?? null, effectiveMediaOrigin: this.effectiveMediaOrigin, configured: this.configured, mediaCheck: { ...check },
      guestAccess: this.guestAccess, automaticGuestOrigin: this.state.automaticGuestOrigin ?? null, guestCandidates: this.guestHints?.guestOrigins ?? [] };
    const key = JSON.stringify(result);
    if (key !== this.lastAddressing) { this.lastAddressing = key; this.addressingSequence++; }
    return { ...result, sequence: this.addressingSequence, instanceId: this.runtimeId };
  }
  async saveGuestOrigin(origin: string | null, revision: number) {
    return this.serial(async () => {
      this.assertSetupRevision(revision);
      await this.commit({ ...this.state, guestOrigin: origin === null ? undefined : applicationOrigin.parse(origin), guestSelection: origin === null ? 'automatic' : 'manual', revision: revision + 1 }); return this.addressing();
    });
  }
  /** Separate diagnostic lane: never holds the player/volume serializer during network I/O. */
  async checkMediaOrigins(origins: string[], revision: number, automatic = false): Promise<AddressingView> {
    return operation('media-check', () => this.inspectMediaOrigins(origins, revision, automatic));
  }
  private async inspectMediaOrigins(origins: string[], revision: number, automatic: boolean): Promise<AddressingView> {
    this.expected(revision);
    if (!this.configured || !this.checks) throw new AppError(409, 'Save a Music Assistant connection before testing file access.');
    if (this.checking) throw new AppError(429, 'A file connection check is already running.');
    const supplied = z.array(applicationOrigin).min(1).max(6).parse(origins);
    const candidates = automatic ? this.state.mediaOrigin ? [this.state.mediaOrigin] : [...new Set([...this.environmentMediaOrigins, ...supplied])].slice(0, 6) : supplied;
    const setup = this.configurationRevision; const api = this.getApi(); this.checking = true;
    this.mediaCheck = { status: 'checking', origin: null, checkedAt: null, message: 'Music Assistant is fetching a protected diagnostic file. No audio is played.' };
    this.changed();
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
    } finally { this.checking = false; this.changed(); }
  }
  attachPlayback(playback: PlaybackController): void { this.playback = playback; }
  close() { this.closed = true; this.stopMonitoring(); this.observation++; this.cachedReader?.close?.(); this.cachedReader = undefined; }
  async drain() { await this.inspection?.pending.catch(() => {}); await this.queue.drain(); }
  private getReader(): MusicAssistantReader {
    if (this.closed) throw new AppError(503, 'The music connection is shutting down.');
    if (this.settingsUncertain) throw new AppError(503, 'Saved settings are uncertain. Refresh speakers to reconcile them before continuing.');
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
    return this.references.seal(id, kind, context);
  }
  private unseal(value: string, kind: string, context: string): string {
    return this.references.unseal(value, kind, context);
  }
  private withArtwork<T extends { artwork?: string; artistArtwork?: string }>(item: T, context: string): T {
    const url = (id?: string) => id && /^image:[a-f0-9]{64}$/.test(id) ? `${artworkPath}${encodeURIComponent(this.seal(id, 'image', context))}` : undefined;
    return { ...item, artwork: url(item.artwork), artistArtwork: url(item.artistArtwork) };
  }
  private catalogueItem<T extends { id: string; artwork?: string; artistArtwork?: string; sources?: T[] }>(item: T, kind: string, context: string): T {
    return this.withArtwork({ ...item, id: this.seal(item.id, kind, context),
      ...(item.sources ? { sources: item.sources.map(source => this.catalogueItem(source, kind, context)) } : {}) }, context);
  }
  /** Names the pixels a reference shows, after the same checks as artwork(), without reading the image. */
  async artworkKey(reference: string, context: string, size: ArtworkSize = 512): Promise<string> {
    return reference.startsWith('upload:') && this.uploads
      ? `upload:${await this.uploads.artworkKey(this.unseal(reference.slice(7), 'upload-image', context), undefined, size)}`
      : `ma:${this.catalogueRevision}:${this.unseal(reference, 'image', context)}:${size}`;
  }
  async artwork(reference: string, context: string, size: ArtworkSize = 512) {
    const revision = this.catalogueRevision;
    try {
      return reference.startsWith('upload:') && this.uploads
        ? await this.uploads.artwork(this.unseal(reference.slice(7), 'upload-image', context), undefined, size)
        : await this.getApi().artwork(this.unseal(reference, 'image', context), size);
    } finally {
      if (revision !== this.catalogueRevision) throw new AppError(409, 'The artwork connection changed.');
    }
  }
  async search(query: string, context = ''): Promise<CatalogueTrack[]> {
    const ma = this.state.musicAssistant; const revision = this.catalogueRevision;
    if (!ma) throw new AppError(409, 'The catalogue connection changed. Search again.');
    const tracks = await this.getReader().search(query);
    if (this.catalogueRevision !== revision) throw new AppError(409, 'The catalogue connection changed during search. Search again.');
    return tracks.map(t => this.catalogueItem(t, 'track', context));
  }
  /** Finds one song from an imported list and returns what to save, or undefined when it isn't found.
   * Server-side only: the descriptor comes from Music Assistant's own answer and goes straight into the list. */
  async importSong(song: SharedSong): Promise<SavedSelection | undefined> {
    const revision = this.catalogueRevision; const sourceBindingId = this.sourceBindingId;
    if (!sourceBindingId) throw new AppError(409, 'Importing a list needs a Music Assistant connection.');
    const key = JSON.stringify([sourceBindingId, songKey(song)]);
    const known = this.importedSongs.get(key);
    if (known) return structuredClone(known);
    const api = this.getApi(); const providers = await this.connectedServices(api);
    let filters = this.filterless !== revision;
    const finder: SongFinder = {
      providers: filters ? providers : undefined,
      serviceAlbumTracks: (provider, itemId) => this.gates.run(provider, () => api.serviceAlbumTracks(provider, itemId)),
      search: async (query, only) => {
        // A Music Assistant without per-source search answers every search unrestricted from then on.
        try { return await this.gates.run(ServiceGates.key(filters ? only : undefined), () => api.search(query, { limit: 10, ...(filters && only ? { providers: only } : {}) })); }
        catch (error) {
          // Slowness, a lost connection or a cancelled import is not a reason to search everything.
          const unrelated = error instanceof UpstreamError && ['timeout', 'connection', 'authorization', 'closed'].includes(error.kind);
          if (!filters || !only || unrelated || (error instanceof AppError && error.status === 499)) throw error;
          this.filterless = revision; filters = false;
          return this.gates.run(ServiceGates.key(undefined), () => api.search(query, { limit: 10 }));
        }
      },
    };
    const track = await bulkCatalogue(() => findSong(finder, song));
    if (revision !== this.catalogueRevision || sourceBindingId !== this.sourceBindingId) throw new AppError(409, 'The music connection changed during the import. Import the list again; songs already added are kept.');
    if (!track) return undefined;
    const selection: SavedSelection = { source: 'music-assistant', sourceBindingId, ...api.listedRecording(track) };
    this.importedSongs.set(key, selection, { expires: Date.now() + 24 * 60 * 60_000 });
    return structuredClone(selection);
  }
  /** Connected music services, asked once every few minutes; undefined when Music Assistant can't say. */
  private async connectedServices(api: MusicAssistantApi) {
    const revision = this.catalogueRevision; const cached = this.services;
    if (cached?.revision === revision && cached.expires > Date.now()) return cached.domains;
    let domains: string[] | undefined;
    try { domains = await bulkCatalogue(() => api.musicProviders()); } catch { domains = undefined; }
    this.services = { revision, domains, expires: Date.now() + 5 * 60_000 };
    return domains;
  }
  async browse(kind: 'artists' | 'albums' | 'tracks', value: string, context: string): Promise<CatalogueBrowse> {
    const revision = this.catalogueRevision; const api = this.getApi();
    let result: CatalogueBrowse;
    if (kind === 'artists') {
      const page = await api.artists(value);
      result = { playbackAvailable: this.playbackAvailable, notices: page.notices, artists: page.items.map(a => this.catalogueItem(a, 'artist', context)) };
    } else if (kind === 'albums') {
      const page = await api.albums(this.unseal(value, 'artist', context));
      result = { playbackAvailable: this.playbackAvailable, notices: page.notices, albums: page.items.map(a => this.catalogueItem(a, 'album', context)) };
    } else {
      const page = await api.tracks(this.unseal(value, 'album', context));
      result = { playbackAvailable: this.playbackAvailable, notices: page.notices, tracks: page.items.map(t => this.catalogueItem(t, 'track', context)) };
    }
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
  /** The album of a saved song, to choose a replacement from. Results are sealed to this member like browsing. */
  async albumForSaved(selection: SavedSelection, context: string) {
    const saved = this.savedSource(selection); const epoch = this.catalogueRevision;
    const result = await this.getApi().albumTracksFor(saved.recording);
    if (epoch !== this.catalogueRevision) throw new AppError(409, 'The catalogue connection changed. Try again.');
    return { ...result, tracks: result.tracks.map(track => this.catalogueItem(track, 'track', context)), playbackAvailable: this.playbackAvailable };
  }
  async resolveSaved(selection: SavedSelection, context: string, trackId: string) {
    const saved = this.savedSource(selection); const revision = this.state.revision; const epoch = this.catalogueRevision;
    const result = await this.getApi().resolveRecording({ ...saved.recording, artwork: saved.metadata.artworkId, artistArtwork: saved.metadata.artistArtworkId });
    this.savedSource(saved);
    if (revision !== this.state.revision || epoch !== this.catalogueRevision) throw new AppError(409, 'Playback setup changed during lookup. Your saved list was kept; review the destination and try again.');
    const track = this.withArtwork({ ...result.track, id: trackId }, context);
    // Only exact image-ID equality permits reuse, not matching track metadata.
    // These hints never authorize a download; the normal playback URL is retained.
    return { ...result, track: { ...track,
      ...(result.track.artwork && result.track.artwork === saved.metadata.artworkId
        ? { artworkIdentity: this.savedImageIdentity(trackId, 'artwork') } : {}),
      ...(result.track.artistArtwork && result.track.artistArtwork === saved.metadata.artistArtworkId
        ? { artistArtworkIdentity: this.savedImageIdentity(trackId, 'artistArtwork') } : {}) }, revision };
  }
  private savedImageIdentity(trackId: string, kind: 'artwork' | 'artistArtwork') {
    const entry = /^prepared:([a-f0-9-]{36})$/.exec(trackId);
    return entry ? `/api/participant/preparations/artwork/${entry[1]}/${kind}` : undefined;
  }
  /** The same pixel name as the catalogue route, so both URLs revalidate against one tag. */
  savedArtworkKey(selection: SavedSelection, kind: 'artwork' | 'artistArtwork', size: ArtworkSize = 512) {
    const saved = this.savedSource(selection);
    const image = kind === 'artwork' ? saved.metadata.artworkId : saved.metadata.artistArtworkId;
    if (!image) throw new AppError(404, 'Artwork unavailable.');
    return `ma:${this.catalogueRevision}:${image}:${size}`;
  }
  async savedArtwork(selection: SavedSelection, kind: 'artwork' | 'artistArtwork', size: ArtworkSize = 512) {
    const saved = this.savedSource(selection); const epoch = this.catalogueRevision;
    const image = kind === 'artwork' ? saved.metadata.artworkId : saved.metadata.artistArtworkId;
    if (!image) throw new AppError(404, 'Artwork unavailable.');
    try { return await this.getApi().artwork(image, size); }
    finally {
      this.savedSource(saved);
      if (epoch !== this.catalogueRevision) throw new AppError(409, 'The artwork connection changed.');
    }
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
          ...(selection.artworkAssetId ? { artwork: `${artworkPath}upload:${this.seal(selection.assetId, 'upload-image', context)}`,
            artworkIdentity: this.savedImageIdentity(trackId, 'artwork') } : {}) } };
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
      if (origin && verified) { this.mediaCheck = verified; this.changed(); }
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
    return operation('recover', async () => {
      await this.withPlayback(async () => { this.expected(revision); await this.playback?.recover(); });
      // Recovery may outlive a failed background inventory read. Publish a fresh
      // observation, not that cached failure, before promising the UI it can play again.
      // Network reads stay outside the command lock; observation/revision checks fence stale results.
      return this.inspectSettings(revision);
    });
  }
  private serial<T>(work: () => Promise<T>): Promise<T> {
    return this.queue.run(work, 'integration');
  }
  private expected(revision: number) {
    if (this.closed) throw new AppError(503, 'The music connection is shutting down.');
    if (this.settingsUncertain) throw new AppError(503, 'Saved settings are uncertain. Refresh speakers to reconcile them before continuing.');
    if (revision !== this.state.revision) throw new AppError(409, 'Integration settings changed in another browser. Reload them before trying again.');
  }
  private async commit(next: IntegrationState) {
    if (this.playback?.ownsPlayback) throw new AppError(409, 'Stop or finish the current track before changing connection settings.');
    try { await this.store.save(next); }
    catch (error) {
      if (uncertainSave(error)) {
        this.markSettingsUncertain('The settings save could not be confirmed. Refresh speakers to reconcile saved settings before playback.', true);
        this.refreshOutputSoon();
      }
      throw new AppError(503, 'Integration settings could not be saved. Check the application data directory.');
    }
    this.installConfiguration(next);
  }
  /** An ambiguous save: playback stays blocked until a durable rewrite reconciles the settings. */
  private markSettingsUncertain(message: string, configurationChanged = false) {
    this.settingsUncertain = true; if (configurationChanged) this.observation++;
    this.report = null; this.lastInventoryReport = null; this.destinationCheckedAt = null; this.failure = message;
    if (configurationChanged) this.playback?.configurationChanged();
    this.changed();
  }
  private installConfiguration(next: IntegrationState) {
    const connectionChanged = this.state.musicAssistant?.url !== next.musicAssistant?.url || this.state.musicAssistant?.accessToken !== next.musicAssistant?.accessToken;
    const destinationChanged = this.state.musicAssistant?.destination?.id !== next.musicAssistant?.destination?.id;
    this.state = next;
    this.observation++;
    if (connectionChanged) { this.report = null; this.lastInventoryReport = null; this.failure = ''; this.authorization = undefined; }
    if (connectionChanged || destinationChanged) { this.destinationFailure = null; this.destinationCheckedAt = null; }
    this.mediaCheck = { status: 'unchecked', origin: null, checkedAt: null, message: 'Addresses or settings changed. Check file access again; no audio has been started.' };
    if (connectionChanged) {
      this.cachedReader?.close?.(); this.cachedReader = undefined;
      this.references = new CatalogueReferences();
    }
    // Configuration writes invalidate pending routing/volume intents, never start audio.
    this.playback?.configurationChanged();
    if (connectionChanged) this.monitor.watch();
    this.changed();
  }
  /** Explicit allowlist. Tokens, queue payloads, and internal exceptions never enter the view. */
  view(): IntegrationView {
    const ma = this.state.musicAssistant;
    const report = this.freshReport;
    const missingSpeaker = ma?.destination && report && !this.failure && !report.players.some(player => player.id === ma.destination!.id && player.available);
    const destinationStatus = !ma?.destination ? 'not-selected' : !report || this.failure ? 'not-checked'
      : missingSpeaker ? 'error' : !this.destinationFresh || this.destinationFailure === null ? 'not-checked' : this.destinationFailure ? 'error' : 'checked';
    const destinationMessage = destinationStatus === 'not-selected' ? 'Choose a speaker or group before playing.'
      : destinationStatus === 'not-checked' ? this.failure ? 'Speaker status cannot be checked until Music Assistant is connected.' : 'Checking the selected speaker…'
      : missingSpeaker ? this.unavailableSpeaker : this.destinationFailure || 'The selected speaker and its queue are available.';
    const result: IntegrationView = { revision: this.state.revision, url: ma?.url ?? null, tokenConfigured: Boolean(ma?.accessToken), output: this.output,
      settingsChangesBlocked: Boolean(this.playback?.ownsPlayback),
      destination: ma?.destination ? { id: ma.destination.id, name: ma.destination.name } : null,
      status: this.settingsUncertain ? 'error' : !ma ? 'not-configured' : this.failure ? 'error' : report ? 'checked' : 'not-checked',
      destinationStatus, destinationMessage,
      message: this.settingsUncertain ? this.failure : !ma ? 'Music Assistant is not configured. Demo mode simulates playback without audio.' : this.failure || (report
        ? 'Music Assistant is connected and authorized.'
        : 'Music Assistant is configured. Its connection has not been checked.'),
      report: structuredClone(report), playbackAvailable: this.playbackAvailable, playbackIssue: this.playback?.issue ?? '', mediaOrigin: this.state.mediaOrigin ?? null,
      speakerInventory: this.inventory(),
      ...(this.playback?.problem ? { playbackProblem: { ...this.playback.problem } } : {}),
      ...(ma?.browserUrl ? { browserUrl: ma.browserUrl } : {}), ...(ma?.tokenExpiresAt ? { tokenExpiresAt: ma.tokenExpiresAt } : {}),
      addressing: this.addressing(), compatibility: report ? playbackCompatibility(report.schemaVersion, report.serverVersion) : null,
      ...(this.authorization ? { authorization: { ...this.authorization } } : {}) };
    const key = JSON.stringify({ ...result, speakerInventory: { ...result.speakerInventory, asOf: undefined } });
    if (key !== this.lastView) { this.lastView = key; this.sequence++; }
    return { ...result, sequence: this.sequence, instanceId: this.runtimeId };
  }
  async save(url: string, accessToken: string | undefined, revision: number): Promise<IntegrationView> {
    this.assertSetupRevision(revision); url = musicAssistantUrl.parse(url);
    const previous = this.state.musicAssistant;
    // Never forward a retained secret to a newly supplied origin.
    if (previous?.url !== url && !accessToken) throw new AppError(400, 'Enter a token for the new server URL. The old token cannot be reused automatically.');
    const nextToken = accessToken ? maToken.parse(accessToken) : previous?.accessToken;
    if (!nextToken) throw new AppError(400, 'Enter a Music Assistant access token.');
    let serverId = previous?.serverId;
    const moved = previous && previous.url !== url;
    if (moved) {
      if (!serverId) throw new AppError(409, 'Check the saved Music Assistant connection before changing its address, or Disconnect explicitly to replace it. Your saved setup was kept.');
      // Validate outside the playback lane. Failed/offline candidates never replace saved setup.
      const candidate = this.reader(url, nextToken);
      try { serverId = (await candidate.inspect({ documentation: false })).serverId; }
      finally { candidate.close?.(); }
      if (!serverId) throw new AppError(422, 'The new address did not provide a Music Assistant server identity. Your saved setup was kept.');
    }
    return this.serial(() => this.installConnection({ url, accessToken: nextToken,
      ...(serverId ? { serverId } : {}), ...(moved ? { browserUrl: url } : previous?.browserUrl ? { browserUrl: previous.browserUrl } : {}),
      ...(previous?.accessToken === nextToken && previous.tokenExpiresAt ? { tokenExpiresAt: previous.tokenExpiresAt } : {}) }, revision));
  }
  private async installConnection(connection: Omit<NonNullable<IntegrationState['musicAssistant']>, 'sourceBindingId' | 'destination'>, revision: number) {
    this.assertSetupRevision(revision);
    const previous = this.state.musicAssistant;
    const same = previous && (previous.serverId ? previous.serverId === connection.serverId : previous.url === connection.url);
    if (previous && !same) throw new AppError(409, 'This is a different Music Assistant server. Disconnect explicitly before replacing the catalogue. Your saved lists were kept.');
    await this.commit({ ...this.state, revision: revision + 1, musicAssistant: { ...connection,
      sourceBindingId: same ? previous.sourceBindingId ?? randomUUID() : randomUUID(), destination: same ? previous.destination : null } });
    return this.view();
  }
  /** Authorization validated the new endpoint/token. Identity, not IP, preserves preparations. */
  async saveAuthorized(url: string, accessToken: string, serverId: string, browserUrl: string, revision: number, tokenExpiresAt?: number, attemptId?: string) {
    return this.serial(async () => {
      await this.installConnection({ url: musicAssistantUrl.parse(url), accessToken: maToken.parse(accessToken), serverId,
        browserUrl: musicAssistantUrl.parse(browserUrl), ...(tokenExpiresAt ? { tokenExpiresAt } : {}) }, revision);
      if (attemptId) { this.authorization = { attemptId, revision: this.state.revision }; this.changed(); }
      return this.view();
    });
  }
  /** Only trusted Supervisor-derived candidates matching a persisted server ID reach here. */
  async relocate(url: string, serverId: string, revision: number, browserUrl?: string | null) {
    return operation('server-relocation', () => this.relocateServer(url, serverId, revision, browserUrl));
  }
  private async relocateServer(url: string, serverId: string, revision: number, browserUrl?: string | null) {
    this.assertSetupRevision(revision); const previous = this.state.musicAssistant;
    if (!previous?.serverId || previous.serverId !== serverId || previous.url === url) return;
    url = musicAssistantUrl.parse(url);
    const reader = this.reader(url, previous.accessToken);
    let report: ConnectionReport;
    try { report = await reader.inspect({ documentation: false }); } finally { reader.close?.(); }
    if (report.serverId !== serverId) throw new AppError(409, 'The discovered Music Assistant identity changed.');
    return this.serial(async () => {
      this.assertSetupRevision(revision);
      await this.installConnection({ ...previous, url, browserUrl: musicAssistantUrl.parse(browserUrl || url) }, revision);
    });
  }
  async clear(revision: number): Promise<IntegrationView> {
    return this.serial(async () => {
      this.expected(revision); await this.commit({ ...this.state, schema: 1, revision: this.state.revision + 1, musicAssistant: null }); return this.view();
    });
  }
  async check(revision: number): Promise<IntegrationView> {
    if (this.settingsUncertain) {
      await this.serial(async () => {
        if (!this.settingsUncertain) return;
        if (this.closed) throw new AppError(503, 'The music connection is shutting down.');
        // A successful durable rewrite, not merely a read, resolves an ambiguous commit.
        const persisted = await this.store.load(); await this.store.save(persisted);
        this.settingsUncertain = false; this.failure = ''; this.destinationFailure = null; this.destinationCheckedAt = null;
        this.installConfiguration(persisted);
      });
      revision = this.state.revision;
      if (!this.configured) return this.view();
    }
    this.expected(revision);
    if (this.inspection?.revision === revision) return this.inspection.pending;
    // Register coalescing before publishing Loading/Refreshing to subscribers.
    const pending = Promise.resolve().then(() => operation('settings-discovery', () => this.inspectSettings(revision)));
    this.inspection = { revision, pending };
    try { return await pending; }
    finally { if (this.inspection?.pending === pending) this.inspection = undefined; }
  }
  private get unavailableSpeaker() { return 'The selected speaker is unavailable in Music Assistant. Check that speaker or choose another destination.'; }
  private connectionFailure(error: unknown) {
    return error instanceof AppError ? error.message : 'Could not connect to Music Assistant. Check the saved server and authorization.';
  }
  private queueFailure(error: unknown) {
    return `The speaker’s queue could not be checked. ${error instanceof AppError ? error.message : 'Check the speaker in Music Assistant and try again.'}`;
  }
  private async inspectConnection(reader: MusicAssistantReader, ma: NonNullable<IntegrationState['musicAssistant']>) {
    const report = await reader.inspect({ documentation: false });
    if (ma.serverId && report.serverId !== ma.serverId) throw new AppError(409, 'Music Assistant server identity changed. Disconnect explicitly before replacing the catalogue.');
    return report;
  }
  private async withInventoryCheck(revision: number, work: () => Promise<unknown>): Promise<IntegrationView> {
    const check = { revision }; this.inventoryChecks.add(check); this.changed();
    try { await work(); }
    finally { this.inventoryChecks.delete(check); this.changed(); }
    return this.view();
  }
  private inspectSettings(revision: number): Promise<IntegrationView> {
    return this.withInventoryCheck(revision, () => this.inspectAndPublishSettings(revision));
  }
  private async inspectAndPublishSettings(revision: number): Promise<IntegrationView> {
    const observation = ++this.observation;
    const ma = this.state.musicAssistant;
    if (!ma) throw new AppError(400, 'Save a Music Assistant connection first.');
    let report: ConnectionReport | null = null; let failure = ''; let destinationFailure: string | null = null;
    let reader: MusicAssistantReader | undefined;
    try {
      reader = this.getReader();
      report = await this.inspectConnection(reader, ma);
    } catch (error) { failure = this.connectionFailure(error); }
    if (report && reader && ma.destination) {
      if (!report.players.some(p => p.id === ma.destination!.id && p.available)) destinationFailure = this.unavailableSpeaker;
      else {
        try { await reader.activeQueue(ma.destination.id); destinationFailure = ''; }
        catch (error) { destinationFailure = this.queueFailure(error); }
      }
    }
    // Discovery is read-only and may be slow. Only publication shares the playback
    // lane; a stale inspection cannot overwrite a newly saved connection's status.
    return this.serial(async () => {
      this.expected(revision);
      if (observation !== this.observation) return this.view();
      if (!ma.serverId && report?.serverId && !this.playback?.ownsPlayback) {
        const next = { ...this.state, musicAssistant: { ...ma, serverId: report.serverId } };
        try { await this.store.save(next); this.state = next; }
        catch (error) {
          if (uncertainSave(error)) this.markSettingsUncertain('Saved settings could not be confirmed. Refresh speakers to reconcile them.');
          throw new AppError(503, 'Integration identity could not be saved. Check the data directory.');
        }
      }
      this.report = report; this.failure = failure; this.destinationFailure = destinationFailure;
      if (report) this.lastInventoryReport = report;
      this.destinationCheckedAt = report && ma.destination ? Date.now() : null; this.changed(); return this.view();
    });
  }
  async selectDestination(id: string, revision: number): Promise<IntegrationView> {
    return operation('speaker-selection', () => this.withInventoryCheck(revision, () => this.validateDestination(id, revision)));
  }
  private async validateDestination(id: string, revision: number): Promise<IntegrationView> {
    this.expected(revision); const ma = this.state.musicAssistant;
    if (!ma) throw new AppError(409, 'Refresh this page and select an available destination.');
    // Discovery must not delay Stop or other playback controls. Revalidate settings
    // and playback ownership only when committing the selected destination.
    const reader = this.getReader(); let report: ConnectionReport;
    try { report = await this.inspectConnection(reader, ma); }
    catch (error) {
      return this.serial(async () => {
        this.expected(revision); this.observation++; this.report = null; this.failure = this.connectionFailure(error); this.destinationFailure = null; this.destinationCheckedAt = null; this.changed();
        throw new AppError(error instanceof AppError ? error.status : 502, this.failure);
      });
    }
    const publish = <T>(work: () => T) => this.serial(async () => {
      this.expected(revision); this.observation++; this.report = report; this.lastInventoryReport = report; this.failure = ''; try { return work(); } finally { this.changed(); }
    });
    const player = report.players.find(p => p.id === id && p.available);
    if (!player) return publish(() => { throw new AppError(409, 'This speaker is unavailable in Music Assistant. Choose an available speaker or group.'); });
    try { await reader.activeQueue(id); }
    catch (error) {
      return publish(() => {
        const message = this.queueFailure(error);
        if (ma.destination?.id === id) { this.destinationFailure = message; this.destinationCheckedAt = Date.now(); }
        throw new AppError(502, message);
      });
    }
    return this.serial(async () => {
      this.expected(revision);
      await this.commit({ ...this.state, schema: 1, revision: this.state.revision + 1, musicAssistant: { ...this.state.musicAssistant!,
        ...(report.serverId ? { serverId: report.serverId } : {}), destination: { id: player.id, name: player.name } } });
      this.report = report; this.lastInventoryReport = report; this.failure = ''; this.destinationFailure = ''; this.destinationCheckedAt = Date.now(); this.changed(); return this.view();
    });
  }
}
