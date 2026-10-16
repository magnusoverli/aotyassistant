import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { open } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { AppError } from './model.js';
import { writePrivateJson } from './store.js';
import { KeyedSerialQueue } from './serial.js';

export const preparationLimits = {
  upcoming: 200, entries: 1000, devices: 10, receipts: 5000,
  operationLifetime: 7 * 24 * 60 * 60_000, futureClockTolerance: 5 * 60_000,
} as const;
const id = z.string().uuid().regex(/^[a-f0-9-]+$/);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const timestamp = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const image = z.string().regex(/^image:[a-f0-9]{64}$/);
const maxPreparationBytes = 32 * 1024 * 1024;
const metadata = z.object({
  title: z.string().min(1).max(1000), artist: z.string().max(1000), album: z.string().max(1000),
  version: z.string().max(500), provider: z.string().max(200), duration: z.number().finite().nonnegative().nullable(),
  artworkId: image.or(z.literal('demo-cover')).optional(), artistArtworkId: image.optional(),
}).strict();

/** Server-owned descriptors, not expiring browse references or arbitrary browser-provided media objects. */
export const savedSelectionSchema = z.discriminatedUnion('source', [
  z.object({ source: z.literal('demo'), trackId: z.string().regex(/^demo:[a-z0-9-]+$/).max(200), metadata }).strict(),
  z.object({ source: z.literal('music-assistant'), sourceBindingId: id,
    recording: z.object({ provider: z.string().min(1).max(200), itemId: z.string().min(1).max(2048),
      uri: z.string().min(1).max(4096).regex(/^[^\x00-\x1f\x7f]+$/), version: z.string().max(500) }).strict(), metadata,
  }).strict(),
  // Only owner-authorized server assets, never browser file paths or media URLs.
  z.object({ source: z.literal('upload'), assetId: id, artworkAssetId: id.optional(), sha256: digest.optional(), metadata }).strict(),
]).refine(selection => selection.source !== 'music-assistant' || selection.recording.version === selection.metadata.version);
export type SavedSelection = z.infer<typeof savedSelectionSchema>;
const entry = z.object({
  id, selection: savedSelectionSchema, state: z.enum(['upcoming', 'played', 'removed']), addedAt: timestamp,
  playedAt: timestamp.optional(), removedAt: timestamp.optional(), playbackIds: z.array(id).max(1000),
}).strict();
export const preparationOperationSchema = z.object({ id, revision: z.number().int().nonnegative(), issuedAt: timestamp }).strict();
export type PreparationOperation = z.infer<typeof preparationOperationSchema>;
const receipt = z.object({ id, intent: digest, issuedAt: timestamp, revision: z.number().int().nonnegative(), entryId: id }).strict();
export const preparationStateSchema = z.object({
  schema: z.literal(1), ownerId: id, revision: z.number().int().nonnegative(),
  credentials: z.array(z.object({ hash: digest, createdAt: timestamp }).strict()).min(1).max(preparationLimits.devices),
  recoveryHash: digest.nullable(), entries: z.array(entry).max(preparationLimits.entries),
  order: z.array(id).max(preparationLimits.upcoming), receipts: z.array(receipt).max(preparationLimits.receipts),
  pendingPlay: z.object({ entryId: id, startedAt: timestamp }).strict().optional(),
  deletedUploads: z.array(id).optional(), // Durable deletion intents/tombstones; never exposed in private views.
}).strict().superRefine((state, context) => {
  const unique = (values: string[]) => new Set(values).size === values.length;
  const upcoming = state.entries.filter(item => item.state === 'upcoming').map(item => item.id);
  if (!unique(state.entries.map(item => item.id)) || !unique(state.order) || state.order.length !== upcoming.length || state.order.some(key => !upcoming.includes(key)) ||
    !unique(state.credentials.map(item => item.hash)) || !unique(state.receipts.map(item => item.id)) ||
    !unique(state.entries.flatMap(item => item.playbackIds)) || !unique(state.deletedUploads ?? []) || state.receipts.some(item => item.revision > state.revision) ||
    state.entries.some(item => item.selection.source === 'upload' && state.deletedUploads?.includes(item.selection.assetId)) ||
    (state.pendingPlay && !upcoming.includes(state.pendingPlay.entryId)) ||
    state.entries.some(item => (item.state === 'played' && (item.playedAt === undefined || !item.playbackIds.length)) || (item.state === 'removed' && item.removedAt === undefined))) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid preparation state.' });
  }
});
export type PreparationState = z.infer<typeof preparationStateSchema>;
type Entry = PreparationState['entries'][number];

export interface PreparationStore {
  load(ownerId: string): Promise<PreparationState | null>;
  save(state: PreparationState): Promise<void>;
}
export class PreparationFileStore implements PreparationStore {
  private directory: string;
  constructor(dataDirectory: string) { this.directory = join(dataDirectory, 'preparations'); }
  async load(ownerId: string): Promise<PreparationState | null> {
    ownerId = input(id, ownerId);
    try {
      const file = await open(join(this.directory, `${ownerId}.json`), 'r');
      try {
        if ((await file.stat()).size > maxPreparationBytes) throw new Error('Oversized preparation state.');
        const state = preparationStateSchema.parse(JSON.parse(await file.readFile('utf8')));
        if (state.ownerId !== ownerId) throw new Error('Mismatching owner.');
        return state;
      } finally { await file.close(); }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw new AppError(503, 'Saved preparation could not be read. Nothing was reset. Check the data directory or restore its backup.');
    }
  }
  async save(state: PreparationState): Promise<void> {
    try {
      const checked = preparationStateSchema.parse(state);
      await writePrivateJson(this.directory, `${checked.ownerId}.json`, checked, maxPreparationBytes);
    } catch { throw new AppError(503, 'The preparation save could not be confirmed. Refresh your list before retrying.'); }
  }
}

export type PreparedEntryView = {
  id: string; source: SavedSelection['source']; title: string; artist: string; album: string;
  version: string; provider: string; duration: number | null; addedAt: number; playedAt?: number; playCount: number;
  artwork?: string; artistArtwork?: string; sourceAvailable?: boolean;
};
export type PreparationView = {
  ownerId: string; revision: number; capacity: { upcoming: number; entries: number };
  upcoming: PreparedEntryView[]; played: PreparedEntryView[]; removed: PreparedEntryView[];
  reviewEntryId?: string;
};
export type PreparationResult = { view: PreparationView; entryId: string; replayed: boolean; warning?: string };
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const sameHash = (a: string, b: string) => timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
function input<T extends z.ZodTypeAny>(schema: T, value: unknown): z.infer<T> {
  const parsed = schema.safeParse(value); if (!parsed.success) throw new AppError(400, 'Invalid preparation request.'); return parsed.data;
}
function identity(credential: string) {
  if (typeof credential !== 'string' || credential.length > 100) throw new AppError(401, 'Private preparation access is unavailable. Use your original browser or private recovery key.');
  const [ownerId, secret, extra] = credential.split('.');
  if (extra !== undefined || !id.safeParse(ownerId).success || !secret || !/^[A-Za-z0-9_-]{43}$/.test(secret)) throw new AppError(401, 'Private preparation access is unavailable. Use your original browser or private recovery key.');
  return { ownerId: ownerId!, secretHash: hash(credential) };
}
const newCredential = (ownerId: string) => `${ownerId}.${randomBytes(32).toString('base64url')}`;
const fingerprint = (selection: SavedSelection) => hash(JSON.stringify(selection.source === 'demo'
  ? ['demo', selection.trackId] : selection.source === 'upload' ? ['upload', selection.sha256 ?? selection.assetId] : ['music-assistant', selection.sourceBindingId, selection.recording]));

/** Independent private persistence. Never touches Engine transactions, playback readiness, or speaker commands. */
export class PreparationManager {
  private queue = new KeyedSerialQueue();
  private events = new EventEmitter();
  constructor(private store: PreparationStore, private now = Date.now, private sourceAvailable?: (selection: SavedSelection) => boolean) { this.events.setMaxListeners(0); }
  private serial<T>(ownerId: string, work: () => Promise<T>): Promise<T> {
    return this.queue.run(ownerId, work);
  }
  private async authorize(ownerId: string, secretHash: string) {
    const state = await this.store.load(ownerId);
    if (!state || !state.credentials.some(credential => sameHash(credential.hash, secretHash))) throw new AppError(401, 'Private preparation access is unavailable. Use your original browser or private recovery key.');
    return state;
  }
  private view(state: PreparationState): PreparationView {
    const entry = (item: Entry): PreparedEntryView => ({ id: item.id, source: item.selection.source,
      title: item.selection.metadata.title, artist: item.selection.metadata.artist, album: item.selection.metadata.album,
      version: item.selection.metadata.version, provider: item.selection.metadata.provider, duration: item.selection.metadata.duration,
      addedAt: item.addedAt, ...(item.playedAt === undefined ? {} : { playedAt: item.playedAt }), playCount: item.playbackIds.length,
      ...(item.selection.metadata.artworkId || (item.selection.source === 'upload' && item.selection.artworkAssetId)
        ? { artwork: item.selection.metadata.artworkId === 'demo-cover' ? '/demo-cover.svg' : `/api/participant/preparations/artwork/${item.id}/artwork` } : {}),
      ...(item.selection.metadata.artistArtworkId ? { artistArtwork: `/api/participant/preparations/artwork/${item.id}/artistArtwork` } : {}),
      ...(this.sourceAvailable ? { sourceAvailable: this.sourceAvailable(item.selection) } : {}) });
    return { ownerId: state.ownerId, revision: state.revision, capacity: { upcoming: preparationLimits.upcoming, entries: preparationLimits.entries },
      upcoming: state.order.map(key => entry(state.entries.find(item => item.id === key)!)),
      played: state.entries.filter(item => item.state === 'played').sort((a, b) => b.playedAt! - a.playedAt!).map(entry),
      removed: state.entries.filter(item => item.state === 'removed').sort((a, b) => b.removedAt! - a.removedAt!).map(entry),
      ...(state.pendingPlay ? { reviewEntryId: state.pendingPlay.entryId } : {}) };
  }
  private async save(state: PreparationState) {
    try { await this.store.save(state); }
    catch { throw new AppError(503, 'The preparation save could not be confirmed. Refresh your list before retrying.'); }
    this.events.emit(state.ownerId, state);
  }
  async createOwner() {
    const ownerId = randomUUID(); const credential = newCredential(ownerId);
    const state: PreparationState = { schema: 1, ownerId, revision: 0,
      credentials: [{ hash: hash(credential), createdAt: this.now() }], recoveryHash: null, entries: [], order: [], receipts: [] };
    await this.save(state); return { credential, view: this.view(state) };
  }
  async read(credential: string): Promise<PreparationView> {
    const access = identity(credential); return this.serial(access.ownerId, async () => this.view(await this.authorize(access.ownerId, access.secretHash)));
  }
  /** Owner-targeted events only. A null snapshot revokes a device; no global engine event is emitted. */
  async subscribe(credential: string, listener: (view: PreparationView | null) => void) {
    const access = identity(credential);
    return this.serial(access.ownerId, async () => {
      await this.authorize(access.ownerId, access.secretHash);
      const send = (state: PreparationState) => {
        try { listener(state.credentials.some(item => sameHash(item.hash, access.secretHash)) ? this.view(state) : null); }
        catch { /* A disconnected subscriber must not turn a committed save into an error. */ }
      };
      this.events.on(access.ownerId, send); return () => { this.events.off(access.ownerId, send); };
    });
  }
  private find(state: PreparationState, entryId: string) {
    const entry = state.entries.find(item => item.id === entryId); if (!entry) throw new AppError(404, 'Saved track not found.'); return entry;
  }
  private async mutate(credential: string, operation: PreparationOperation, kind: string, payload: unknown, change: (state: PreparationState) => string | Promise<string>, afterSave?: (state: PreparationState) => Promise<void>): Promise<PreparationResult> {
    const access = identity(credential); operation = input(preparationOperationSchema, operation);
    const intent = hash(JSON.stringify([kind, operation.revision, operation.issuedAt, payload]));
    return this.serial(access.ownerId, async () => {
      const state = await this.authorize(access.ownerId, access.secretHash);
      const previous = state.receipts.find(receipt => receipt.id === operation.id);
      if (previous) {
        if (previous.intent !== intent) throw new AppError(409, 'This preparation operation was already used for a different change.');
        let warning: string | undefined;
        try { await afterSave?.(state); } catch { warning = 'The list change was saved, but file deletion needs another attempt. Retry the same operation or refresh your list.'; }
        return { view: this.view(state), entryId: previous.entryId, replayed: true, ...(warning ? { warning } : {}) };
      }
      const now = this.now();
      if (now - operation.issuedAt > preparationLimits.operationLifetime || operation.issuedAt - now > preparationLimits.futureClockTolerance) throw new AppError(409, 'This preparation change expired. Refresh your list before trying again.');
      if (operation.revision !== state.revision) throw new AppError(409, 'Your preparation list changed in another page. Refresh it before trying again.');
      if (state.pendingPlay && kind !== 'review') throw new AppError(409, 'A previous play attempt needs review. Your saved entry was kept.');
      state.receipts = state.receipts.filter(receipt => now - receipt.issuedAt <= preparationLimits.operationLifetime);
      if (state.receipts.length >= preparationLimits.receipts) throw new AppError(409, 'Preparation edit capacity is temporarily full. Your saved entries were kept.');
      const entryId = await change(state); state.revision++;
      state.receipts.push({ id: operation.id, intent, issuedAt: operation.issuedAt, revision: state.revision, entryId });
      await this.save(state);
      let warning: string | undefined;
      try { await afterSave?.(state); } catch { warning = 'The list change was saved, but file deletion needs another attempt. Refresh your list to retry cleanup.'; }
      return { view: this.view(state), entryId, replayed: false, ...(warning ? { warning } : {}) };
    });
  }
  /** Accept descriptors captured/validated by the backend, never raw request bodies from a browser. */
  async add(credential: string, operation: PreparationOperation, selection: SavedSelection) {
    selection = input(savedSelectionSchema, selection);
    return this.mutate(credential, operation, 'add', selection, state => this.appendSelection(state, selection));
  }
  /** Capture runs only for a new operation: lost acknowledgements remain retryable even after browse references expire. */
  async addCaptured(credential: string, operation: PreparationOperation, reference: string, capture: () => Promise<SavedSelection>) {
    return this.mutate(credential, operation, 'capture', hash(reference), async state => {
      return this.appendSelection(state, input(savedSelectionSchema, await capture()));
    });
  }
  private appendSelection(state: PreparationState, selection: SavedSelection) {
    if (selection.source === 'upload' && state.deletedUploads?.includes(selection.assetId)) throw new AppError(410, 'This uploaded file was permanently deleted. Select the file again.');
    const key = fingerprint(selection);
    const existing = state.entries.find(item => item.state === 'upcoming' && fingerprint(item.selection) === key);
    if (existing) return existing.id;
    if (state.order.length >= preparationLimits.upcoming || state.entries.length >= preparationLimits.entries) throw new AppError(409, 'Your preparation list is full. No saved entries or history were removed.');
    const entryId = randomUUID();
    state.entries.push({ id: entryId, selection, state: 'upcoming', addedAt: this.now(), playbackIds: [] });
    state.order.push(entryId); return entryId;
  }
  /** Internal descriptor access for authorized artwork adapters. Never return this object as HTTP JSON. */
  async selection(credential: string, entryId: string): Promise<SavedSelection> {
    const access = identity(credential); entryId = input(id, entryId);
    return this.serial(access.ownerId, async () => structuredClone(this.find(await this.authorize(access.ownerId, access.secretHash), entryId).selection));
  }
  async acknowledgeReview(credential: string, operation: PreparationOperation, entryId: string) {
    entryId = input(id, entryId);
    return this.mutate(credential, operation, 'review', { entryId }, state => {
      if (state.pendingPlay?.entryId !== entryId) throw new AppError(409, 'The playback review changed. Refresh your list.');
      delete state.pendingPlay; return entryId;
    });
  }
  /** Discard only unreferenced staging files, serialized against attachment and playback. */
  async discardUpload(credential: string, assetId: string, discard: (ownerId: string, assetId: string) => Promise<void>) {
    assetId = input(id, assetId); const access = identity(credential);
    return this.serial(access.ownerId, async () => {
      const state = await this.authorize(access.ownerId, access.secretHash);
      if (state.entries.some(entry => entry.selection.source === 'upload' && entry.selection.assetId === assetId)) return false;
      await discard(state.ownerId, assetId); return true;
    });
  }
  async purgeUpload(credential: string, operation: PreparationOperation, entryId: string, busy: (assetId: string) => boolean, remove: (ownerId: string, assetId: string) => Promise<void>) {
    entryId = input(id, entryId);
    return this.mutate(credential, operation, 'purge-upload', { entryId }, state => {
      const selected = this.find(state, entryId);
      if (selected.selection.source !== 'upload' || selected.state !== 'removed') throw new AppError(409, 'Remove an uploaded file before permanently deleting it.');
      const assetId = selected.selection.assetId;
      if (busy(assetId)) throw new AppError(409, 'Stop or finish this file before permanently deleting it.');
      const deleted = new Set(state.entries.filter(item => item.selection.source === 'upload' && item.selection.assetId === assetId).map(item => item.id));
      state.entries = state.entries.filter(item => !deleted.has(item.id)); state.order = state.order.filter(key => !deleted.has(key));
      state.deletedUploads = [...new Set([...(state.deletedUploads ?? []), assetId])];
      // Old receipts intentionally outlive purged entries so lost acknowledgements remain idempotent.
      return entryId;
    }, async state => { for (const assetId of state.deletedUploads ?? []) await remove(state.ownerId, assetId); });
  }
  async cleanupDeletedUploads(credential: string, remove: (ownerId: string, assetId: string) => Promise<void>) {
    const access = identity(credential);
    await this.serial(access.ownerId, async () => {
      const state = await this.authorize(access.ownerId, access.secretHash);
      for (const assetId of state.deletedUploads ?? []) await remove(state.ownerId, assetId);
    });
  }
  /** Hold only this owner's list while resolving/starting its exact head. Never retry the work callback. */
  async playHead<T>(credential: string, entryId: string, expectedRevision: number, work: (selection: SavedSelection) => Promise<{ playbackId: string; value: T }>) {
    const access = identity(credential); entryId = input(id, entryId);
    return this.serial(access.ownerId, async () => {
      const state = await this.authorize(access.ownerId, access.secretHash);
      if (state.revision !== expectedRevision || state.order[0] !== entryId) throw new AppError(409, 'The next prepared track changed. Review your list.');
      if (state.pendingPlay) throw new AppError(409, 'Review the previous play attempt before playing again.');
      const entry = this.find(state, entryId);
      if (entry.playbackIds.length >= 1000) throw new AppError(409, 'Playback history is full. The saved entry was kept.');
      state.pendingPlay = { entryId, startedAt: this.now() }; state.revision++; await this.save(state);
      // A failed acknowledgement does not prove no audio started: leave the durable
      // marker for explicit review if work throws or the process exits here.
      const result = await work(structuredClone(entry.selection));
      entry.state = 'played'; entry.playedAt = this.now(); entry.playbackIds.push(input(id, result.playbackId));
      state.order = state.order.filter(key => key !== entryId); delete state.pendingPlay; state.revision++;
      try { await this.save(state); return { value: result.value, preparation: this.view(state), warning: undefined }; }
      catch {
        let preparation: PreparationView | undefined;
        try { preparation = this.view(await this.authorize(access.ownerId, access.secretHash)); } catch { /* Audio succeeded; report bookkeeping uncertainty separately. */ }
        return { value: result.value, preparation, warning: 'Playback started, but the saved-list update could not be confirmed. Check your list and player before trying again; never retry Play automatically.' };
      }
    });
  }
  async move(credential: string, operation: PreparationOperation, entryId: string, beforeId: string | null) {
    entryId = input(id, entryId); beforeId = input(id.nullable(), beforeId);
    return this.mutate(credential, operation, 'move', { entryId, beforeId }, state => {
      if (this.find(state, entryId).state !== 'upcoming' || (beforeId !== null && this.find(state, beforeId).state !== 'upcoming')) throw new AppError(409, 'Only upcoming entries can be reordered.');
      if (entryId !== beforeId) {
        state.order = state.order.filter(key => key !== entryId);
        state.order.splice(beforeId === null ? state.order.length : state.order.indexOf(beforeId), 0, entryId);
      }
      return entryId;
    });
  }
  async remove(credential: string, operation: PreparationOperation, entryId: string) {
    entryId = input(id, entryId);
    return this.mutate(credential, operation, 'remove', { entryId }, state => {
      const entry = this.find(state, entryId);
      if (entry.state !== 'removed') { entry.state = 'removed'; entry.removedAt = this.now(); state.order = state.order.filter(key => key !== entryId); }
      return entryId;
    });
  }
  async restore(credential: string, operation: PreparationOperation, entryId: string, beforeId: string | null = null) {
    entryId = input(id, entryId); beforeId = input(id.nullable(), beforeId);
    return this.mutate(credential, operation, 'restore', { entryId, beforeId }, state => {
      const entry = this.find(state, entryId); if (entry.state === 'upcoming') return entryId;
      if (beforeId !== null && this.find(state, beforeId).state !== 'upcoming') throw new AppError(409, 'Choose an upcoming entry as the new position.');
      if (state.order.length >= preparationLimits.upcoming) throw new AppError(409, 'Your upcoming list is full. The saved entry was kept.');
      if (state.entries.some(other => other.state === 'upcoming' && fingerprint(other.selection) === fingerprint(entry.selection))) throw new AppError(409, 'This recording is already in your upcoming list.');
      entry.state = 'upcoming'; delete entry.removedAt;
      state.order.splice(beforeId === null ? state.order.length : state.order.indexOf(beforeId), 0, entryId); return entryId;
    });
  }
  /** Explicitly replaces the previous recovery key; the raw new key is returned once, never stored. */
  async issueRecoveryKey(credential: string, expectedRevision: number) {
    const access = identity(credential);
    return this.serial(access.ownerId, async () => {
      const state = await this.authorize(access.ownerId, access.secretHash);
      if (state.revision !== expectedRevision) throw new AppError(409, 'Your preparation list changed. Refresh before creating a recovery key.');
      const recoveryKey = newCredential(state.ownerId); state.recoveryHash = hash(recoveryKey); state.revision++;
      await this.save(state); return { recoveryKey, view: this.view(state) };
    });
  }
  async recover(recoveryKey: string) {
    const access = identity(recoveryKey);
    return this.serial(access.ownerId, async () => {
      const state = await this.store.load(access.ownerId);
      if (!state?.recoveryHash || !sameHash(state.recoveryHash, access.secretHash)) throw new AppError(401, 'The private preparation recovery key is invalid or unavailable.');
      if (state.credentials.length >= preparationLimits.devices) throw new AppError(409, 'Preparation device capacity is full. Use an existing device to revoke other device access first.');
      const credential = newCredential(state.ownerId); state.credentials.push({ hash: hash(credential), createdAt: this.now() }); state.revision++;
      await this.save(state); return { credential, view: this.view(state) };
    });
  }
  async revokeOtherDevices(credential: string, expectedRevision: number) {
    const access = identity(credential);
    return this.serial(access.ownerId, async () => {
      const state = await this.authorize(access.ownerId, access.secretHash);
      if (state.revision !== expectedRevision) throw new AppError(409, 'Your preparation list changed. Refresh before changing device access.');
      state.credentials = state.credentials.filter(item => sameHash(item.hash, access.secretHash)); state.revision++;
      await this.save(state); return this.view(state);
    });
  }
}
