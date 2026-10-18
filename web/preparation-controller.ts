import type { CatalogueTrack } from '../src/model';
import type { PreparationView, PreparationResult, PreparationOperation } from '../src/preparations';
import { requestJson, RequestError } from './request';

const prefix = '/api/participant/preparations';
const accessNoticeKey = 'aoty.preparation-access-changed.v1';
type Path = 'add' | 'add-upload' | 'purge-upload' | 'move' | 'remove' | 'restore' | 'review';
type Edit = { trackId?: string; entryId?: string; beforeId?: string | null; uploadId?: string; text?: { title: string; artist: string; album: string } };
type Pending = { ownerId: string; path: Path; body: Edit & { operation: PreparationOperation }; title: string };
// randomUUID is secure-context-only; guest phones also join over plain HTTP on a trusted LAN.
export const operationId = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(16)); bytes[6] = (bytes[6]! & 15) | 64; bytes[8] = (bytes[8]! & 63) | 128;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};
export async function preparationRequest<T>(path: string, data?: unknown): Promise<T> {
  return requestJson<T>(prefix + path, data);
}

/** A separate save lane: never replays transport, reveal, or volume commands. */
export class PreparationController {
  view?: PreparationView;
  missing = false;
  loading = false;
  saving = false;
  error = '';
  warning = '';
  pending?: Pending;
  conflict = false;
  recoveryKey = '';
  recovered = false;
  undoId?: string;
  lastSavedUploadId?: string;
  readonly added = new Set<string>();
  private addedEntries = new Map<string, string>();
  private stream?: EventSource;
  private initializing?: Promise<void>;
  private epoch = 0;
  private loadSequence = 0;
  private saveSequence = 0;
  private accessChangedWhileLoading = false;
  constructor(private changed: () => void, private isMember: () => boolean, private request = preparationRequest) {}
  private storageKey(ownerId: string) { return `aoty.preparation-pending.v1.${ownerId}`; }
  private persist() {
    if (!this.pending) return;
    try { localStorage.setItem(this.storageKey(this.pending.ownerId), JSON.stringify(this.pending)); }
    catch { this.warning = 'This browser cannot retain an unsaved draft after closing. Wait for Saved before leaving.'; }
  }
  private restoreDraft(ownerId: string) {
    if (this.pending?.ownerId === ownerId) return;
    this.pending = undefined;
    try {
      const raw = localStorage.getItem(this.storageKey(ownerId)); if (!raw || raw.length > 20_000) return;
      const saved = JSON.parse(raw) as Pending;
      if (saved.ownerId === ownerId && ['add', 'add-upload', 'purge-upload', 'move', 'remove', 'restore', 'review'].includes(saved.path) && saved.body?.operation?.id && typeof saved.title === 'string') {
        this.pending = saved; this.error = 'A previous list change needs confirmation. Retry it to check whether it was saved.';
      }
    } catch { /* The server list is still authoritative if local draft storage is unavailable. */ }
  }
  accept(view: PreparationView) {
    if (this.view?.ownerId === view.ownerId && this.view.revision > view.revision) return;
    if (this.view && JSON.stringify(this.view) === JSON.stringify(view)) return;
    if (this.view?.ownerId !== view.ownerId) {
      this.epoch++; this.recoveryKey = ''; this.warning = ''; this.conflict = false;
      this.added.clear(); this.addedEntries.clear(); this.undoId = undefined; this.lastSavedUploadId = undefined; this.restoreDraft(view.ownerId);
    }
    for (const [reference, entryId] of this.addedEntries) if (!view.upcoming.some(entry => entry.id === entryId)) { this.added.delete(reference); this.addedEntries.delete(reference); }
    this.view = view; this.missing = false; this.changed();
  }
  async start() {
    if (!navigator.onLine || this.loading) return;
    if (typeof window !== 'undefined') {
      window.addEventListener('storage', this.accessChanged);
      window.addEventListener('focus', this.checkMissingAccess);
    }
    const epoch = this.epoch; const sequence = ++this.loadSequence; this.loading = true; this.changed();
    try { const view = await this.request<PreparationView>('/state'); if (epoch !== this.epoch) return; if (!this.pending) this.error = ''; this.accept(view); this.listen(); }
    catch (error) {
      if (epoch !== this.epoch) return;
      this.missing = error instanceof RequestError && error.code === 'missing-library';
      if (!this.missing) this.error = error instanceof Error ? error.message : 'Your private list could not be loaded.';
      if (error instanceof RequestError && error.status === 401) { if (!this.missing) this.stop(); this.view = undefined; }
    } finally {
      if (sequence === this.loadSequence) {
        this.loading = false;
        if (this.accessChangedWhileLoading) { this.accessChangedWhileLoading = false; this.checkMissingAccess(); }
      }
      this.changed();
    }
  }
  // Notify other tabs to read the shared HttpOnly cookie; never broadcast list data or credentials.
  private notifyAccessChanged() {
    try { localStorage.setItem(accessNoticeKey, operationId()); } catch { /* Focus rechecks missing access when storage is unavailable. */ }
  }
  private accessChanged = (event: StorageEvent) => {
    if (event.key !== accessNoticeKey || this.view) return;
    if (this.loading) this.accessChangedWhileLoading = true;
    else this.checkMissingAccess();
  };
  private checkMissingAccess = () => { if (this.missing && !this.view) void this.start(); };
  async refresh() {
    if (!this.view || !navigator.onLine) return;
    const epoch = this.epoch;
    try { const view = await this.request<PreparationView>('/state'); if (epoch === this.epoch) this.accept(view); }
    catch (error) {
      if (epoch !== this.epoch) return;
      if (error instanceof RequestError && error.status === 401) { this.stop(); this.view = undefined; this.missing = false; }
      this.error = error instanceof Error ? error.message : 'Your saved list could not be refreshed.'; this.changed();
    }
  }
  private listen() {
    this.stream?.close(); const stream = new EventSource(prefix + '/events'); this.stream = stream;
    stream.addEventListener('state', event => { if (this.stream === stream) this.accept(JSON.parse((event as MessageEvent).data)); });
    stream.addEventListener('revoked', () => {
      if (this.stream !== stream) return;
      this.stop(); this.view = undefined; this.missing = false; this.error = 'This device’s list access ended. Recover it with your private key.'; this.changed();
    });
  }
  stop() {
    this.epoch++; this.loadSequence++; this.saveSequence++;
    this.stream?.close(); this.stream = undefined; this.recoveryKey = '';
    this.loading = false; this.saving = false; this.initializing = undefined;
    this.recovered = false; this.accessChangedWhileLoading = false;
    if (typeof window !== 'undefined') {
      window.removeEventListener('storage', this.accessChanged); window.removeEventListener('focus', this.checkMissingAccess);
    }
  }
  async ensureOwner() {
    if (this.view) return;
    if (!this.missing || !this.isMember()) throw new Error('Join the room or recover your private list before adding tracks.');
    if (!this.initializing) {
      const epoch = this.epoch;
      const pending = this.request<PreparationView>('/init', {}).then(view => {
        if (epoch !== this.epoch) throw new Error('Private-list access changed. Refresh before adding a track.');
        this.accept(view); this.listen(); this.notifyAccessChanged();
      }).finally(() => { if (this.initializing === pending) this.initializing = undefined; });
      this.initializing = pending;
    }
    await this.initializing;
  }
  async add(track: CatalogueTrack) {
    try { await this.ensureOwner(); await this.edit('add', { trackId: track.id }, track.title); }
    catch (error) { this.error = error instanceof Error ? error.message : 'The choice was not saved.'; this.changed(); }
  }
  async edit(path: Path, payload: Edit, title = '') {
    if (!this.view || this.saving || this.pending) return;
    if (!navigator.onLine) { this.error = 'Reconnect before editing. Your saved list is kept.'; this.changed(); return; }
    const operation = { id: operationId(), revision: this.view.revision, issuedAt: Date.now() };
    this.pending = { ownerId: this.view.ownerId, path, body: { operation, ...payload }, title };
    this.persist(); await this.sendPending();
  }
  async retry(rebase = false) {
    if (!this.pending || !this.view || this.saving) return;
    if (rebase) {
      this.pending.body.operation = { id: operationId(), revision: this.view.revision, issuedAt: Date.now() }; this.persist();
    }
    await this.sendPending();
  }
  private async sendPending() {
    const pending = this.pending; if (!pending || !this.view || pending.ownerId !== this.view.ownerId || !navigator.onLine) return;
    const epoch = this.epoch; const sequence = ++this.saveSequence; this.saving = true; this.error = ''; this.conflict = false; this.changed();
    try {
      const result = await this.request<PreparationResult>(`/${pending.path}`, pending.body);
      if (epoch !== this.epoch) return;
      this.pending = undefined;
      try { localStorage.removeItem(this.storageKey(pending.ownerId)); } catch { /* A server receipt still prevents a duplicate if a stale local draft remains. */ }
      if (pending.path === 'add' && pending.body.trackId) { this.added.add(pending.body.trackId); this.addedEntries.set(pending.body.trackId, result.entryId); }
      if (pending.path === 'remove') this.undoId = result.entryId;
      if (pending.path === 'add-upload') this.lastSavedUploadId = pending.body.uploadId;
      if (result.warning) this.warning = result.warning;
      this.accept(result.view);
    } catch (error) {
      if (epoch !== this.epoch) return;
      this.error = error instanceof Error ? error.message : 'The save could not be confirmed. Your draft was retained.';
      this.conflict = error instanceof RequestError && error.status === 409;
      await this.refresh();
    } finally { if (sequence === this.saveSequence) { this.saving = false; this.changed(); } }
  }
  async discardDraft() {
    if (!this.pending || this.saving) return;
    const pending = this.pending; const epoch = this.epoch;
    await this.refresh();
    if (epoch !== this.epoch || this.pending !== pending) return;
    try { localStorage.removeItem(this.storageKey(pending.ownerId)); } catch { /* Keep server data untouched. */ }
    this.pending = undefined; this.error = ''; this.conflict = false; this.changed();
  }
  async createRecoveryKey() {
    if (!this.view || this.saving || this.pending) return;
    const revision = this.view.revision;
    await this.identityChange(async current => {
      const result = await this.request<{ recoveryKey: string; view: PreparationView }>('/recovery-key', { revision });
      if (current()) { this.accept(result.view); this.recoveryKey = result.recoveryKey; }
    });
  }
  async recover(recoveryKey: string, replace = false) {
    if (this.saving) return;
    this.stop();
    await this.identityChange(async current => {
      const view = await this.request<PreparationView>('/recover', { recoveryKey, replace });
      if (!current()) return;
      this.error = this.pending?.ownerId === view.ownerId ? 'A previous list change needs confirmation. Retry it to check whether it was saved.' : '';
      this.accept(view); this.listen(); this.recovered = true; this.notifyAccessChanged();
    });
  }
  async revokeOtherDevices() {
    if (!this.view || this.saving || this.pending) return;
    const revision = this.view.revision;
    await this.identityChange(async current => {
      const view = await this.request<PreparationView>('/revoke-devices', { revision });
      if (current()) this.accept(view);
    });
  }
  private async identityChange(work: (current: () => boolean) => Promise<void>) {
    const epoch = this.epoch; const sequence = ++this.saveSequence;
    this.saving = true; this.error = ''; this.changed();
    try { await work(() => epoch === this.epoch); }
    catch (error) {
      if (epoch !== this.epoch) return;
      this.error = error instanceof Error ? error.message : 'Private-list access could not be updated.';
      await this.refresh();
      if (sequence === this.saveSequence && this.view) this.listen();
    } finally { if (sequence === this.saveSequence) { this.saving = false; this.changed(); } }
  }
  hideRecoveryKey() { this.recoveryKey = ''; this.changed(); }
}
