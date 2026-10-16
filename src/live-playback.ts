import { setTimeout as delay } from 'node:timers/promises';
import { AppError, type Track, type VolumeState } from './model.js';
import { DemoAdapter, type PlaybackAdapter } from './playback.js';
import { type IntegrationManager, type PlaybackController } from './integrations.js';
import type { MusicAssistantApi, QueueSnapshot } from './music-assistant.js';
import type { SavedSelection } from './preparations.js';

type Selection = Awaited<ReturnType<IntegrationManager['resolve']>> & { release?: () => void; suspend?: () => void; uploaded?: boolean };
type PlaybackApi = Pick<MusicAssistantApi, 'playbackCapability' | 'queue' | 'queueItems' | 'configureSingle' | 'playSingle' | 'controlQueue' | 'volume' | 'setVolume' | 'pausedDestination'>;
type Ownership = Selection & { appId: string; api: PlaybackApi; destination: string; queueId: string; queueItemId: string | null; status: 'playing' | 'paused'; seenPlaying: boolean;
  position?: { elapsed: number; duration: number; at: number } };

/** Single-destination controller. Never sends a stop to a queue it does not own. */
export class ManagedPlayback implements PlaybackAdapter, PlaybackController {
  issue = '';
  private closed = false;
  private capabilityRevision?: string;
  private failed = false;
  private own?: Ownership;
  private pending?: Selection;
  private timer?: NodeJS.Timeout;
  private demoId?: string;
  private demoSelections = new WeakMap<Track, string>();
  onComplete: (id: string) => void = () => {};
  onInvalidated: (id: string, message: string) => void = () => {};
  onStatus: (id: string, status: 'playing' | 'paused') => void = () => {};
  onProgress: () => void = () => {};
  private volumeState: VolumeState = { available: false, level: null };
  private volumeTimer?: NodeJS.Timeout;
  private volumeRead?: { revision: string; promise: Promise<void> };
  private volumeEpoch = 0;
  private volumeGeneration = 0;
  private volumeConfirmation?: NodeJS.Timeout;
  private volumeTarget?: { level: number; requestedAt: number; mismatches: number };
  get volume(): VolumeState {
    if (!this.integrations.configured) return this.demo.volume;
    return { ...(this.available && !this.failed ? this.volumeState : { available: false, level: null }), revision: this.integrations.configurationRevision, generation: this.volumeGeneration };
  }
  progress(id: string) {
    if (!this.integrations.configured) return this.demo.progress(id);
    const own = this.own; if (!own || own.appId !== id || !own.position || this.failed) return null;
    const { elapsed, duration, at } = own.position;
    return { elapsed: Math.min(duration || Infinity, elapsed + (own.status === 'playing' ? Math.max(0, Math.min(3, (Date.now() - at) / 1000)) : 0)), duration };
  }
  private observe(own: Ownership, queue: QueueSnapshot) {
    if (queue.elapsed_time === undefined) { own.position = undefined; return; }
    const correction = queue.state === 'playing' && queue.elapsed_time_last_updated ? Math.max(0, Math.min(5, Date.now() / 1000 - queue.elapsed_time_last_updated)) : 0;
    own.position = { elapsed: queue.elapsed_time + correction, duration: own.track.duration, at: Date.now() };
  }
  private get available() { return !this.closed && this.integrations.playbackAvailable; }
  private async verifyCapability(api: PlaybackApi, destination: string) {
    const revision = this.integrations.configurationRevision;
    if (this.capabilityRevision === revision) return;
    await api.playbackCapability(destination);
    if (!this.available || revision !== this.integrations.configurationRevision) throw new AppError(409, 'The playback destination changed. Refresh before trying again.');
    this.capabilityRevision = revision;
  }
  private refreshVolume(api: PlaybackApi, destination: string): Promise<void> {
    if (!this.available || this.failed) return Promise.resolve();
    const revision = this.integrations.configurationRevision; const epoch = this.volumeEpoch;
    if (this.volumeRead?.revision === revision) return this.volumeRead.promise;
    const promise: Promise<void> = (async () => {
      let state: VolumeState;
      try { await this.verifyCapability(api, destination); state = await api.volume(destination); }
      catch { state = { available: false, level: null }; }
      if (this.available && !this.failed && revision === this.integrations.configurationRevision && epoch === this.volumeEpoch) {
        const target = this.volumeTarget;
        if (target && state.available && state.level !== target.level && (target.mismatches++ === 0 || Date.now() - target.requestedAt < 1200)) {
          this.scheduleVolumeConfirmation(api, destination); return; // Allow propagation, without retrying the write.
        }
        this.volumeTarget = undefined; this.volumeState = state; this.volumeGeneration++; this.onProgress();
      }
    })().finally(() => { if (this.volumeRead?.promise === promise) this.volumeRead = undefined; });
    this.volumeRead = { revision, promise }; return promise;
  }
  /** Optional read-only setup/volume refresh; never hold the command lock while reading volume. */
  async refresh(): Promise<void> {
    if (!this.available || this.failed) return;
    try {
      const setup = await this.integrations.withPlayback(async (api, destination) => ({ api, destination, revision: this.integrations.configurationRevision }));
      if (setup.revision === this.integrations.configurationRevision) await this.refreshVolume(setup.api, setup.destination);
    } catch { /* Missing/changed setup leaves volume unavailable; explicit Play still validates capability. */ }
  }
  private scheduleVolumeConfirmation(api: PlaybackApi, destination: string) {
    clearTimeout(this.volumeConfirmation);
    this.volumeConfirmation = setTimeout(() => { void this.refreshVolume(api, destination); }, 300); this.volumeConfirmation.unref();
  }
  async setVolume(level: number, playbackId?: string) {
    if (!this.integrations.configured) { await this.demo.setVolume(level); return; }
    if (!this.available || this.failed) throw new AppError(409, 'Choose a playback destination and recover connectivity before changing volume.');
    this.volumeEpoch++;
    const revision = this.integrations.configurationRevision;
    await this.integrations.withPlayback(async (api, destination) => {
      if (!this.available || this.failed || revision !== this.integrations.configurationRevision) throw new AppError(409, 'The volume destination changed. Refresh before trying again.');
      await this.verifyCapability(api, destination);
      if (playbackId) {
        const own = this.own;
        if (!own || own.appId !== playbackId) throw new AppError(409, 'The application no longer owns this playback.');
        const queue = await api.queue(destination);
        const activeOwned = this.isOwned(queue, own) && !(own.status === 'paused' && queue.state === 'idle');
        if ((!activeOwned && !await this.isParkedPause(queue, own)) || !this.safeQueue(queue) || queue.ended) {
          this.invalidate('Playback changed outside this app. Its audio was left untouched.', false);
          throw new AppError(409, 'The application no longer owns this playback.');
        }
      }
      try {
        this.volumeState = await api.setVolume(destination, level, false);
        this.volumeEpoch++; this.volumeGeneration++;
        this.volumeTarget = { level, requestedAt: Date.now(), mismatches: 0 };
        this.scheduleVolumeConfirmation(api, destination);
      } catch (error) {
        this.volumeEpoch++; this.volumeTarget = undefined; this.volumeGeneration++;
        this.volumeState = { available: false, level: null };
        this.scheduleVolumeConfirmation(api, destination); this.onProgress(); throw error;
      }
    });
    this.onProgress();
  }
  get mode() { return this.integrations.configured ? 'music-assistant' as const : 'demo' as const; }
  get connected() { return !this.closed && !this.failed; }
  get ownsPlayback() { return Boolean(this.own || this.demoId); }

  constructor(private demo: DemoAdapter, private integrations: IntegrationManager, private pollMs = 1500) {
    integrations.attachPlayback(this);
    demo.onComplete = id => { if (this.demoId === id) { this.demoId = undefined; this.onComplete(id); } };
    demo.onProgress = () => this.onProgress();
    this.configurationChanged();
  }
  search(query: string) { return this.demo.search(query); }
  configurationChanged(): void {
    this.demoSelections = new WeakMap();
    this.pending?.release?.(); this.pending = undefined; this.failed = false; this.issue = ''; this.capabilityRevision = undefined;
    this.volumeEpoch++; this.volumeGeneration++; this.volumeTarget = undefined; clearTimeout(this.volumeConfirmation); clearInterval(this.volumeTimer);
    this.volumeState = { available: false, level: null };
    if (this.available) {
      void this.refresh();
      this.volumeTimer = setInterval(() => { if (!this.own) void this.refresh(); }, 5000); this.volumeTimer.unref();
    }
    this.onProgress();
  }
  async resolve(id: string, context = ''): Promise<Track> {
    if (!this.integrations.configured) return this.resolveDemo(() => this.demo.resolve(id));
    if (!this.available) throw new AppError(409, 'Choose a playback destination in host settings first.');
    this.pending?.release?.(); this.pending = undefined;
    return this.resolveLive(this.integrations.resolve(id, context));
  }
  async resolveSaved(selection: SavedSelection, context: string, trackId: string): Promise<Track> {
    this.pending?.release?.(); this.pending = undefined;
    if (selection.source === 'upload') return this.resolveLive(this.integrations.resolveUpload(selection, context, trackId));
    if (selection.source === 'demo') {
      if (this.integrations.configured) throw new AppError(409, 'Demo selections cannot play through the connected catalogue. Your saved entry was kept.');
      return this.resolveDemo(() => this.demo.resolveSaved(selection, context, trackId));
    }
    if (!this.available) throw new AppError(409, 'Choose a playback destination in host settings first.');
    return this.resolveLive(this.integrations.resolveSaved(selection, context, trackId));
  }
  private async resolveLive(result: Promise<Selection>) {
    const selection = await result;
    if (this.closed) { selection.release?.(); throw new AppError(503, 'Playback is shutting down.'); }
    this.pending = selection; return selection.track;
  }
  private async resolveDemo(resolve: () => Promise<Track>) {
    const revision = this.integrations.configurationRevision;
    const track = await resolve();
    if (this.closed || this.integrations.configured || revision !== this.integrations.configurationRevision) throw new AppError(409, 'The music connection changed. Select the recording again.');
    this.demoSelections.set(track, revision); return track;
  }
  private isOwned(q: QueueSnapshot, own: Ownership): boolean {
    return (q.active || (q.ended && q.state === 'idle')) && this.sameQueueItem(q, own);
  }
  private sameQueueItem(q: QueueSnapshot, own: Ownership): boolean {
    return q.queue_id === own.queueId && Boolean(q.current_item) &&
      (!own.queueItemId || q.current_item!.queue_item_id === own.queueItemId) &&
      this.sameRecording(q.current_item?.media_item, own);
  }
  private async isParkedPause(q: QueueSnapshot, own: Ownership): Promise<boolean> {
    if (own.status !== 'paused' || q.ended || !['paused', 'idle'].includes(q.state) || !this.sameQueueItem(q, own) || !this.safeQueue(q)) return false;
    if (q.active && q.state === 'paused') return true;
    return own.api.pausedDestination(own.destination, own.queueId);
  }
  private sameRecording(media: NonNullable<QueueSnapshot['current_item']>['media_item'], own: Selection): boolean {
    if (!media || media.version !== own.version) return false;
    if (own.uploaded) return media.provider === own.provider && media.item_id === own.itemId && media.uri === own.uri;
    return Boolean(((media.item_id === own.itemId && media.provider === own.provider && (!media.uri || media.uri === own.uri)) ||
      media.provider_mappings.some(p => p.item_id === own.itemId && (p.provider_domain === own.provider || p.provider_instance === own.provider))));
  }
  private safeQueue(q: QueueSnapshot): boolean {
    return q.items === 1 && q.next_item === null && q.repeat_mode === 'off' && !q.autoplay_enabled && !q.shuffle_enabled;
  }
  /** Command acceptance is not a transport acknowledgement. Read back, never retry the write. */
  private async confirmTransport(own: Ownership, action: 'pause' | 'resume' | 'stop') {
    for (let attempt = 0; attempt < 20; attempt++) {
      if (this.closed) throw new Error('Playback controller closed.');
      const queue = await own.api.queue(own.destination);
      if (action === 'stop' && queue.queue_id === own.queueId && queue.state === 'idle' &&
        (!queue.current_item || this.sameQueueItem(queue, own))) return queue;
      if (!this.sameQueueItem(queue, own)) {
        this.invalidate('Another source changed playback. Its audio was left untouched.', false);
        throw new AppError(409, this.issue);
      }
      if (action !== 'stop' && (!this.safeQueue(queue) || queue.ended)) throw new Error('Unsafe queue state.');
      if (action === 'pause' && await this.isParkedPause(queue, { ...own, status: 'paused' })) return queue;
      if (action === 'resume' && queue.active && queue.state === 'playing') return queue;
      if (attempt < 19) await delay(250);
    }
    throw new Error('Transport change was not confirmed.');
  }
  private invalidate(message: string, fatal: boolean): void {
    const id = this.own?.appId;
    this.issue = message; this.failed = fatal; clearTimeout(this.timer);
    if (fatal && this.own?.suspend) this.own.suspend(); else this.own?.release?.();
    if (!fatal) this.own = undefined;
    if (id) this.onInvalidated(id, message);
  }
  async play(track: Track, appId: string): Promise<void> {
    if (this.closed) throw new AppError(503, 'Playback is shutting down.');
    if (!this.integrations.configured) {
      await this.integrations.withDemoPlayback(async () => {
        if (this.closed || this.demoSelections.get(track) !== this.integrations.configurationRevision) throw new AppError(409, 'The music connection changed. Select the recording again.');
        this.demoSelections.delete(track); this.demoId = appId; await this.demo.play(track, appId);
      });
      return;
    }
    await this.integrations.withPlayback(async (api, destination, revision) => {
      const pending = this.pending; this.pending = undefined;
      if (!this.available || this.failed || !pending || pending.revision !== revision || pending.track.id !== track.id) { pending?.release?.(); throw new AppError(409, 'Playback setup changed. Select the recording again.'); }
      let initial: QueueSnapshot;
      try {
        await api.playbackCapability(destination); initial = await api.queue(destination);
        if (this.closed) throw new AppError(503, 'Playback is shutting down.');
      }
      catch (error) { pending.release?.(); throw error; }
      clearTimeout(this.timer);
      this.own?.release?.();
      this.own = { ...pending, api, destination, queueId: initial.queue_id, queueItemId: null, appId, status: 'playing', seenPlaying: false };
      try {
        await api.configureSingle(initial.queue_id);
        const configured = await api.queue(destination);
        if (this.closed || configured.queue_id !== initial.queue_id || configured.autoplay_enabled || configured.repeat_mode !== 'off' || configured.shuffle_enabled) throw new Error();
        await api.playSingle(initial.queue_id, pending.uri);
        // Verify the exact queue item and observed PLAYING state, not just command acceptance.
        let verified = false;
        for (let attempt = 0; attempt < 20; attempt++) {
          const q = await api.queue(destination);
          if (this.closed || !this.own) throw new Error();
          if (this.isOwned(q, this.own) && this.safeQueue(q) && q.state === 'playing' && !q.ended) {
            const items = await api.queueItems(q.queue_id);
            if (!this.closed && this.own && items.length === 1 && items[0]!.queue_item_id === q.current_item!.queue_item_id &&
              this.sameRecording(items[0]!.media_item, pending)) {
              this.own.queueItemId = q.current_item!.queue_item_id; this.own.seenPlaying = true; this.observe(this.own, q); verified = true; break;
            }
          }
          await delay(250);
        }
        if (!verified) throw new Error();
        this.issue = ''; this.schedule();
      } catch {
        // A timed-out command may already have started audio. Stop only an exact owned item.
        try { const q = await api.queue(destination); if (this.own && q.active && this.isOwned(q, this.own)) await api.controlQueue(q.queue_id, 'stop'); } catch { /* Ownership/connectivity uncertain; retain the guard for host recovery. */ }
        this.invalidate('Playback could not be verified. Host recovery is required; no alternative recording was substituted.', true);
        throw new AppError(502, this.issue);
      }
    });
  }
  async control(action: 'pause' | 'resume' | 'stop'): Promise<void> {
    if (this.closed) throw new AppError(503, 'Playback is shutting down.');
    if (this.demoId || !this.integrations.configured) {
      if (action === 'stop') this.demoId = undefined;
      await this.demo.control(action); return;
    }
    if (!this.own) { if (action === 'stop') return; throw new AppError(409, 'There is no application-owned playback to control.'); }
    await this.integrations.withPlayback(async () => {
      const own = this.own; if (!own) return;
      try {
        const q = await own.api.queue(own.destination);
        if (this.closed) throw new Error();
        const parked = await this.isParkedPause(q, own);
        const activeOwned = this.isOwned(q, own) && !(own.status === 'paused' && q.state === 'idle');
        if (!activeOwned && !parked) { this.invalidate('Another source changed playback. Its audio was left untouched.', false); throw new AppError(409, this.issue); }
        if (action !== 'stop' && (!this.safeQueue(q) || q.ended || (!q.active && !parked))) throw new Error();
        if (action === 'resume' && parked) {
          const items = await own.api.queueItems(own.queueId);
          if (this.closed || items.length !== 1 || items[0]!.queue_item_id !== own.queueItemId || !this.sameRecording(items[0]!.media_item, own)) throw new Error();
          await own.api.controlQueue(own.queueId, 'resume');
          this.observe(own, await this.confirmTransport(own, 'resume'));
        } else {
          if (q.active && (action !== 'stop' || q.state !== 'idle') && !(action === 'pause' && parked)) {
            await own.api.controlQueue(own.queueId, action);
            const confirmed = await this.confirmTransport(own, action);
            // A released paused stream may report zero; retain its last confirmed position.
            this.observe(own, action === 'pause' && confirmed.state === 'idle' ? q : confirmed);
          } else if (!parked) this.observe(own, q);
        }
        if (action === 'stop') { clearTimeout(this.timer); own.release?.(); this.own = undefined; }
        else own.status = action === 'pause' ? 'paused' : 'playing';
      } catch (error) {
        if (error instanceof AppError && error.status === 409) throw error;
        this.invalidate('Playback connectivity or queue state is uncertain. The host must recover playback controls.', true);
        throw new AppError(503, this.issue);
      }
    });
  }
  private schedule(): void {
    clearTimeout(this.timer);
    if (this.closed) return;
    this.timer = setTimeout(() => { void this.poll(); }, this.pollMs); this.timer.unref();
  }
  private async poll(): Promise<void> {
    try {
      await this.integrations.withPlayback(async () => {
        const own = this.own; if (!own || this.failed || this.closed) return;
        const q = await own.api.queue(own.destination);
        if (this.closed) return;
        if (await this.isParkedPause(q, own)) {
          // MA releases paused streams after ~30s. Retain the exact selection and frozen position, with no pause expiry and no auto-resume.
          void this.refreshVolume(own.api, own.destination); this.onProgress(); return;
        }
        if (!this.isOwned(q, own)) { this.invalidate('Playback changed outside this app. Its audio was left untouched.', false); return; }
        if (!this.safeQueue(q)) {
          await own.api.controlQueue(own.queueId, 'stop');
          this.invalidate('The single-track queue policy changed. Playback was stopped; host recovery is required.', true); return;
        }
        if (q.ended && q.state === 'idle' && own.seenPlaying && own.status === 'playing') {
          own.release?.(); this.own = undefined; this.onComplete(own.appId); return;
        }
        if (q.state === 'idle' || q.state === 'unknown') { this.invalidate('Playback stopped outside the app without a verified natural end. The turn was not advanced.', false); return; }
        if (q.state !== own.status) { own.status = q.state; this.onStatus(own.appId, own.status); }
        this.observe(own, q);
        void this.refreshVolume(own.api, own.destination); // Optional volume reads cannot delay queue-ownership polling.
        this.onProgress();
      });
    } catch { this.invalidate('Playback connection was lost. Controls are disabled until host recovery.', true); }
    if (this.own && !this.failed) this.schedule();
  }
  async recover(): Promise<void> {
    const own = this.own;
    if (own) {
      const q = await own.api.queue(own.destination);
      if (q.active && this.isOwned(q, own)) {
        try { await own.api.controlQueue(own.queueId, 'stop'); await this.confirmTransport(own, 'stop'); }
        catch (error) {
          if (error instanceof AppError && error.status === 409) throw error;
          this.invalidate('Playback recovery could not confirm that the owned track stopped. Try recovery again after checking connectivity.', true);
          throw new AppError(503, this.issue);
        }
      }
      this.onInvalidated(own.appId, 'Playback controls recovered. Select a track to start again.');
    }
    this.own?.release?.(); this.pending?.release?.(); this.own = undefined; this.pending = undefined; this.failed = false; this.issue = ''; clearTimeout(this.timer);
  }
  close(): void { this.closed = true; clearTimeout(this.timer); clearTimeout(this.volumeConfirmation); clearInterval(this.volumeTimer); this.volumeEpoch++; this.volumeTarget = undefined; this.demo.close(); this.own?.release?.(); this.pending?.release?.(); this.own = undefined; this.pending = undefined; this.demoId = undefined; }
}
