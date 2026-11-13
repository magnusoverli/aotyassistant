import type { CatalogueAlbum, CatalogueTrack } from '../src/model';
import type { PreparationView, PreparationResult, PreparationOperation, PreparedEntryView } from '../src/preparations';
import { requestJson, RequestError } from './request';
import { participantEvents } from './participant-events';
import { storageKey } from './paths';

const prefix = '/api/participant/preparations';
type Path = 'add' | 'add-album' | 'add-upload' | 'replace-upload' | 'purge-upload' | 'clear' | 'replace' | 'move' | 'remove' | 'restore' | 'review';
const paths: readonly string[] = ['add', 'add-album', 'add-upload', 'replace-upload', 'purge-upload', 'clear', 'replace', 'move', 'remove', 'restore', 'review'];
type Edit = { trackId?: string; albumId?: string; trackIds?: string[]; entryId?: string; beforeId?: string | null; uploadId?: string; text?: { title: string; artist: string; album: string } };
/** One list change waiting for the server's confirmation. */
type Pending = { ownerId: string; path: Path; body: Edit & { operation: PreparationOperation }; title: string };
// randomUUID is secure-context-only; guest phones also join over plain HTTP on a trusted LAN.
export const operationId = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(16)); bytes[6] = (bytes[6]! & 15) | 64; bytes[8] = (bytes[8]! & 63) | 128;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};
export async function preparationRequest<T>(path: string, data?: unknown): Promise<T> {
  return requestJson<T>(prefix + path, data, path === '/add-album' ? 95_000 : 15_000);
}
/** A reply that cannot confirm its change: kept for an explicit retry rather than resent automatically. */
class IncompleteReceipt extends Error {}
/** A lost reply, a timeout or a server that is briefly unavailable: the same change is resent. Its operation
 * id makes a resend that reaches the server twice a replay, never a second change. */
const transient = (error: unknown) => !(error instanceof IncompleteReceipt) &&
  (!(error instanceof RequestError) || error.status < 400 || error.status === 408 || error.status === 429 || error.status >= 500);
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** A separate save lane: never replays transport, reveal, or volume commands.
 *
 * Edits never wait for each other. Each one shows on the list at once, joins an ordered queue kept in this
 * browser, and is sent in order, one at a time; the server checks each change against the list as it is
 * then. The list shown is the server's latest, with the changes not yet confirmed applied on top. Only a
 * change that could not be confirmed stops the queue, until it is retried or discarded. */
export class PreparationController {
  loading = false;
  /** Changes are being sent. */
  saving = false;
  error = '';
  warning = '';
  /** The queue stopped at its first change: it failed, or was restored after a reload, and waits for Retry or Discard. */
  stalled = false;
  conflict = false;
  lastSavedUploadId?: string;
  readonly added = new Set<string>();
  private addedEntries = new Map<string, string>();
  private server?: PreparationView;
  private queue: Pending[] = [];
  /** Callers awaiting a change's outcome, by operation id. */
  private waiters = new Map<string, (saved: boolean) => void>();
  private idle: (() => void)[] = [];
  private projection?: { server: PreparationView; queue: readonly Pending[]; view: PreparationView };
  private stopStream?: () => void;
  private initializing?: Promise<void>;
  private epoch = 0;
  private loadSequence = 0;
  /** The running sender, if any: a stop or a new owner ends it. */
  private sender?: number;
  private senders = 0;
  constructor(private changed: () => void, private isMember: () => boolean, private request = preparationRequest,
    /** Waits before each automatic resend of a change whose reply was lost. */
    private retryDelays: readonly number[] = [500, 1500, 4000]) {}
  /** The first change not yet confirmed. */
  get pending(): Pending | undefined { return this.queue[0]; }
  /** Every change not yet confirmed, oldest first. */
  get queued(): readonly Pending[] { return this.queue; }
  /** Edits wait only for connectivity, a play review, or a change that needs Retry or Discard. */
  get locked() { return !navigator.onLine || this.stalled || Boolean(this.server?.reviewEntryId); }
  /** The latest saved list with the queued moves, removals and restores shown on top. */
  get view(): PreparationView | undefined {
    const server = this.server; if (!server || !this.queue.some(item => projected(item.path))) return server;
    if (this.projection?.server === server && this.projection.queue === this.queue) return this.projection.view;
    const view = project(server, this.queue); this.projection = { server, queue: this.queue, view }; return view;
  }
  private storageKey(ownerId: string) { return storageKey(`doom-room.preparation-queue.v2.${ownerId}`); }
  private legacyKey(ownerId: string) { return storageKey(`doom-room.preparation-pending.v1.${ownerId}`); }
  private persist(ownerId = this.server?.ownerId) {
    if (!ownerId) return;
    try {
      const queue = this.queue.filter(item => item.ownerId === ownerId);
      if (queue.length) localStorage.setItem(this.storageKey(ownerId), JSON.stringify(queue)); else localStorage.removeItem(this.storageKey(ownerId));
      localStorage.removeItem(this.legacyKey(ownerId));
    } catch { this.warning = 'This browser cannot retain an unsaved draft after closing. Wait for Saved before leaving.'; }
  }
  private restoreQueue(ownerId: string) {
    if (this.queue[0]?.ownerId === ownerId) return;
    this.settle(false); this.queue = []; this.stalled = false;
    try {
      const raw = localStorage.getItem(this.storageKey(ownerId)) ?? localStorage.getItem(this.legacyKey(ownerId));
      if (!raw || raw.length > 2 * 1024 * 1024) return;
      const saved = JSON.parse(raw) as Pending | Pending[];
      // A list saved by 2.1.7 or earlier held a single change.
      const queue = (Array.isArray(saved) ? saved : [saved]).filter(item => valid(item, ownerId)).slice(0, 200);
      if (!queue.length) return;
      this.queue = queue; this.stalled = true;
      this.error = 'A previous list change needs confirmation. Retry it to check whether it was saved.';
    } catch { /* The server list is still authoritative if local draft storage is unavailable. */ }
  }
  accept(view: PreparationView) {
    if (this.server?.ownerId === view.ownerId && this.server.revision > view.revision) return;
    if (this.server && JSON.stringify(this.server) === JSON.stringify(view)) return;
    if (this.server?.ownerId !== view.ownerId) {
      this.epoch++; this.sender = undefined; this.saving = false; this.warning = ''; this.conflict = false;
      this.added.clear(); this.addedEntries.clear(); this.lastSavedUploadId = undefined; this.restoreQueue(view.ownerId);
    }
    for (const [reference, entryId] of this.addedEntries) if (!view.upcoming.some(entry => entry.id === entryId)) { this.added.delete(reference); this.addedEntries.delete(reference); }
    this.server = view; this.changed();
  }
  start(): Promise<void> {
    if (this.initializing) return this.initializing;
    if (!navigator.onLine || !this.isMember()) return Promise.resolve();
    const work = this.load(); this.initializing = work;
    void work.finally(() => { if (this.initializing === work) this.initializing = undefined; });
    return work;
  }
  private async load() {
    const epoch = this.epoch; const sequence = ++this.loadSequence; this.loading = true; this.changed();
    try {
      const view = await this.request<PreparationView>('/init', {}); if (epoch !== this.epoch) return;
      if (!this.stalled) this.error = '';
      const ownerId = this.server?.ownerId; this.accept(view);
      if (!this.stopStream || ownerId !== view.ownerId) this.listen();
      // Changes interrupted by a stop (the page was hidden) are resent with their own operation ids.
      void this.send();
    }
    catch (error) {
      if (epoch !== this.epoch) return;
      this.error = error instanceof Error ? error.message : 'Your selections could not be loaded.';
      if (error instanceof RequestError && error.status === 401) { this.stop(); this.server = undefined; }
    } finally {
      if (sequence === this.loadSequence) {
        this.loading = false;
      }
      this.changed();
    }
  }
  async refresh() {
    if (!this.server || !navigator.onLine) return;
    const epoch = this.epoch;
    try { const view = await this.request<PreparationView>('/state'); if (epoch === this.epoch) this.accept(view); }
    catch (error) {
      if (epoch !== this.epoch) return;
      if (error instanceof RequestError && error.status === 401) { this.stop(); this.server = undefined; }
      this.error = error instanceof Error ? error.message : 'Your saved list could not be refreshed.'; this.changed();
    }
  }
  private listen() {
    this.stopStream?.();
    this.stopStream = participantEvents.subscribe('library', {
      state: event => this.accept(JSON.parse(event.data)),
      revoked: () => { this.stop(); this.server = undefined; this.error = 'Your selections could not be read. Reload the participant page.'; this.changed(); },
    });
  }
  stop() {
    this.epoch++; this.loadSequence++; this.sender = undefined;
    this.stopStream?.(); this.stopStream = undefined;
    this.loading = false; this.saving = false; this.initializing = undefined;
    this.notifyIdle();
  }
  clearIdentity() {
    this.stop(); this.server = undefined; this.settle(false); this.queue = []; this.stalled = false; this.error = ''; this.warning = ''; this.conflict = false;
    this.added.clear(); this.addedEntries.clear(); this.lastSavedUploadId = undefined;
  }
  async ensureOwner() {
    if (!this.isMember()) throw new Error('Join the room before adding tracks.');
    if (this.server) return;
    await this.start();
    if (!this.server) throw new Error(this.error || 'Your selections are not ready. Try again.');
  }
  async add(track: CatalogueTrack) {
    try { await this.ensureOwner(); await this.edit('add', { trackId: track.id }, track.title); }
    catch (error) { this.error = error instanceof Error ? error.message : 'The choice was not saved.'; this.changed(); }
  }
  async addAlbum(album: CatalogueAlbum, tracks: CatalogueTrack[]) {
    if (!tracks.length || this.locked || this.loading) return;
    // Snapshot this album before awaiting: browsing elsewhere must not change a queued addition.
    const trackIds = tracks.map(track => track.id); const albumId = album.id; const title = album.name;
    try { await this.ensureOwner(); await this.edit('add-album', { albumId, trackIds }, title); }
    catch (error) { this.error = error instanceof Error ? error.message : 'The album was not saved.'; this.changed(); }
  }
  /** Whether a change like this one is waiting to be saved (the add buttons show it as saving). */
  isQueued(path: Path, match: (body: Edit) => boolean) { return this.queue.some(item => item.path === path && match(item.body)); }
  /** Queues one change and resolves once it is saved (true), or failed, was discarded or the list was left (false). */
  edit(path: Path, payload: Edit, title = ''): Promise<boolean> {
    const server = this.server;
    if (!server || this.stalled) return Promise.resolve(false);
    if (!navigator.onLine) { this.error = 'Reconnect before editing. Your saved list is kept.'; this.changed(); return Promise.resolve(false); }
    // The same request twice (a double tap) is one change.
    const same = path !== 'move' && this.queue.find(item => item.path === path && JSON.stringify({ ...item.body, operation: undefined }) === JSON.stringify({ ...payload, operation: undefined }));
    if (same) return this.outcome(same.body.operation.id);
    const operation = { id: operationId(), revision: server.revision, issuedAt: Date.now() };
    const item: Pending = { ownerId: server.ownerId, path, body: { operation, ...payload }, title };
    this.queue = [...this.queue, item]; this.persist(); this.changed();
    const outcome = this.outcome(operation.id); void this.send(); return outcome;
  }
  /** Resolves when every queued change is saved (true), or the queue stopped at one that needs attention (false). */
  settled(): Promise<boolean> {
    if (!this.queue.length) return Promise.resolve(true);
    if (this.stalled || this.sender === undefined) return Promise.resolve(false);
    return new Promise(resolve => this.idle.push(() => resolve(!this.queue.length)));
  }
  private outcome(id: string) {
    return new Promise<boolean>(resolve => {
      const previous = this.waiters.get(id);
      this.waiters.set(id, saved => { previous?.(saved); resolve(saved); });
    });
  }
  private resolve(id: string, saved: boolean) { const waiter = this.waiters.get(id); this.waiters.delete(id); waiter?.(saved); }
  /** Every caller still waiting learns that its change is not saved (yet). */
  private settle(saved: boolean) { const waiters = [...this.waiters.values()]; this.waiters.clear(); for (const waiter of waiters) waiter(saved); }
  private notifyIdle() { const idle = this.idle; this.idle = []; for (const done of idle) done(); }
  async retry(rebase = false) {
    if (!this.queue.length || !this.server || this.sender !== undefined) return;
    if (rebase) {
      const [head, ...rest] = this.queue;
      this.queue = [{ ...head!, body: { ...head!.body, operation: { id: operationId(), revision: this.server.revision, issuedAt: Date.now() } } }, ...rest];
      this.persist();
    }
    this.stalled = false; await this.send();
  }
  /** Sends the queue in order, one change at a time, until it is empty or a change needs attention. */
  private async send() {
    if (this.sender !== undefined || this.stalled || !this.queue.length || !this.server || !navigator.onLine) return;
    const epoch = this.epoch; const token = ++this.senders; this.sender = token;
    const current = () => this.epoch === epoch && this.sender === token;
    this.saving = true; this.error = ''; this.conflict = false; this.changed();
    try {
      let attempt = 0;
      while (current() && this.queue.length && !this.stalled && navigator.onLine) {
        const item = this.queue[0]!;
        try {
          const result = await this.request<PreparationResult>(`/${item.path}`, item.body);
          if (!current()) return;
          this.confirm(item, result); attempt = 0;
        } catch (error) {
          if (!current()) return;
          if (transient(error) && attempt < this.retryDelays.length) { await wait(this.retryDelays[attempt++]!); continue; }
          // Held, not dropped: Retry resends it, Discard drops it, and every later change waits behind it.
          this.stalled = true;
          this.error = error instanceof Error ? error.message : 'The save could not be confirmed. Your draft was retained.';
          this.conflict = error instanceof RequestError && error.status === 409;
          this.settle(false); this.sender = undefined; this.saving = false;
          await this.refresh();
          return;
        }
      }
    } finally {
      if (this.sender === token) { this.sender = undefined; this.saving = false; }
      if (this.epoch === epoch) this.changed();
      this.notifyIdle();
    }
  }
  private confirm(item: Pending, result: PreparationResult) {
    const references = item.path === 'add-album' ? item.body.trackIds! : item.path === 'add' ? [item.body.trackId!] : [];
    const entryIds = item.path === 'add-album' ? result.entryIds : [result.entryId];
    if (references.length && (!Array.isArray(entryIds) || entryIds.length !== references.length || entryIds.some(id => typeof id !== 'string' || !id))) {
      throw new IncompleteReceipt('The save response was incomplete. Refresh the list before retrying.');
    }
    // A receipt may be older than an event already received (a song was played/removed on another
    // device). A replay confirms that original save, never marks the removed song as still queued.
    const latest = this.server && this.server.revision > result.view.revision ? this.server : result.view;
    for (const [index, reference] of references.entries()) {
      const entryId = entryIds![index]!;
      if (latest.upcoming.some(entry => entry.id === entryId)) { this.added.add(reference); this.addedEntries.set(reference, entryId); }
      else { this.added.delete(reference); this.addedEntries.delete(reference); }
    }
    this.queue = this.queue.filter(other => other !== item); this.persist(item.ownerId);
    if (item.path === 'add-upload' || item.path === 'replace-upload') this.lastSavedUploadId = item.body.uploadId;
    if (result.warning) this.warning = result.warning;
    this.accept(result.view); this.changed();
    this.resolve(item.body.operation.id, true);
  }
  /** Drops the change that needs attention; the changes queued after it are sent next. */
  async discardDraft() {
    const item = this.queue[0];
    if (!item || this.sender !== undefined) return;
    const epoch = this.epoch;
    await this.refresh();
    if (epoch !== this.epoch || this.queue[0] !== item) return;
    this.queue = this.queue.slice(1); this.persist(item.ownerId); this.resolve(item.body.operation.id, false);
    this.stalled = false; this.error = ''; this.conflict = false; this.changed();
    void this.send();
  }
}

/** Changes that show on the list before they are saved. Additions and replacements show once saved. */
const projected = (path: Path) => path === 'move' || path === 'remove' || path === 'restore';

function valid(item: Pending, ownerId: string) {
  if (item?.ownerId !== ownerId || !paths.includes(item.path) || typeof item.body?.operation?.id !== 'string' || typeof item.title !== 'string') return false;
  const ids = item.body.trackIds;
  return item.path !== 'add-album' || (typeof item.body.albumId === 'string' && Array.isArray(ids) && ids.length > 0 && ids.length <= 2000 &&
    ids.every(id => typeof id === 'string' && id.length > 0 && id.length <= 1000));
}

/** The saved list as it will be once the queued changes are saved. A change that no longer fits (its song
 * left the list meanwhile) is skipped here; the server decides. */
export function project(server: PreparationView, queue: readonly Pending[]): PreparationView {
  const upcoming = [...server.upcoming]; let played = server.played; let removed = server.removed;
  const at = (id: string | null | undefined) => id == null ? upcoming.length : upcoming.findIndex(entry => entry.id === id);
  for (const { path, body: { entryId, beforeId } } of queue) {
    const index = upcoming.findIndex(entry => entry.id === entryId);
    if (path === 'move') {
      if (index < 0 || entryId === beforeId || (beforeId != null && at(beforeId) < 0)) continue;
      const [entry] = upcoming.splice(index, 1); upcoming.splice(at(beforeId), 0, entry!);
    } else if (path === 'remove') {
      if (index < 0) continue;
      const [entry] = upcoming.splice(index, 1); removed = [entry!, ...removed];
    } else if (path === 'restore') {
      const entry: PreparedEntryView | undefined = removed.find(item => item.id === entryId) ?? played.find(item => item.id === entryId);
      if (index >= 0 || !entry || (beforeId != null && at(beforeId) < 0)) continue;
      removed = removed.filter(item => item.id !== entryId); played = played.filter(item => item.id !== entryId);
      upcoming.splice(at(beforeId), 0, entry);
    }
  }
  return { ...server, upcoming, played, removed };
}
