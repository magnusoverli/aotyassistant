import type { CatalogueTrack, PlaybackProgress, View } from '../src/model';

type Target = string | number;
type Command = { seq: number; target: Target; position?: PlaybackProgress } &
  ({ kind: 'play'; track: CatalogueTrack; previous: string | null; prepared?: { entryId: string; revision: number } } | { kind: 'control'; action: 'pause' | 'resume' | 'stop' } | { kind: 'reveal' });
type VolumeIntent = { seq: number; level: number; ack?: number };
type Options = {
  role: 'host' | 'participant'; getView(): View | undefined; canSend(): boolean;
  request(path: string, data: unknown): Promise<View>; accept(view: View): void; resync(): Promise<void>;
  changed(kind: 'player' | 'volume'): void; failed(message: string): void; played?(track: CatalogueTrack): void;
  position?(progress?: PlaybackProgress): PlaybackProgress | undefined;
};

/** Browser-only intent overlay. Server snapshots and all server permission checks remain authoritative. */
export class PlayerController {
  private identity = '';
  private epoch = 0;
  private seq = 0;
  private commands: Command[] = [];
  private sending = false;
  private current?: Command;
  private confirmed = new Map<number, string>();
  private draft?: VolumeIntent;
  private nextVolume?: VolumeIntent;
  private sendingVolume = false;
  private volumeEpoch = 0;
  private playbackId?: string;
  private volumeTimer?: ReturnType<typeof setTimeout>;
  constructor(private options: Options) {}
  private key(view: View) {
    return JSON.stringify([view.roomId, view.turnId, this.options.role === 'participant' ? view.me?.id : 'host', view.catalogue?.revision, view.volume?.revision]);
  }
  get starting() { return this.commands.some(command => command.kind === 'play'); }
  observe(view: View) {
    const identity = this.key(view);
    if (identity !== this.identity || !view.connected || (this.options.role === 'participant' && !view.myTurn)) this.cancel();
    this.identity = identity;
    if (!view.volume?.available || (this.options.role === 'participant' &&
      (this.playbackId !== view.ownPlayback?.id || !view.ownPlayback || view.ownPlayback.status === 'stopped'))) this.clearVolume();
    this.playbackId = view.ownPlayback?.id;
    if (this.draft?.ack !== undefined && (view.volume?.generation ?? 0) >= this.draft.ack && !view.volume?.pending) this.draft = undefined;
    if (this.options.role === 'participant' && !this.starting && this.commands.some(command => typeof command.target === 'string' && command.target !== view.ownPlayback?.id)) {
      this.commands = []; this.epoch++;
    }
  }
  cancel() {
    this.epoch++; this.commands = []; this.confirmed.clear(); this.clearVolume();
  }
  private clearVolume() { this.volumeEpoch++; clearTimeout(this.volumeTimer); this.draft = undefined; this.nextVolume = undefined; }
  project(base: View): View {
    const view = structuredClone(base); const ids = new Map(this.confirmed);
    for (const command of this.commands) {
      if (command.kind === 'play') {
        if (view.ownPlayback?.track.id !== command.track.id || view.ownPlayback.id === command.previous) {
          const track = command.track;
          view.ownPlayback = { id: `pending-${command.seq}`, turnId: base.turnId!, status: 'playing', revealed: false,
            track: { id: track.id, title: track.version ? `${track.title} (${track.version})` : track.title, artist: track.artist, album: track.album,
              duration: track.duration ?? 0, artwork: track.artwork, artistArtwork: track.artistArtwork } };
          view.progress = { id: view.ownPlayback.id, status: 'playing', fraction: track.duration ? 0 : null, elapsed: 0, duration: track.duration ?? 0 };
        }
        ids.set(command.seq, view.ownPlayback!.id);
      } else {
        const target = typeof command.target === 'number' ? ids.get(command.target) : command.target;
        if (!view.ownPlayback || view.ownPlayback.id !== target) continue;
        if (command.kind === 'reveal') view.ownPlayback.revealed = true; // Private badge only; public reveal still requires server acknowledgement.
        else {
          view.ownPlayback.status = command.action === 'pause' ? 'paused' : command.action === 'resume' ? 'playing' : 'stopped';
          if (view.progress) view.progress = { ...(command.action === 'resume' ? view.progress : command.position ?? view.progress), id: view.ownPlayback.id, status: view.ownPlayback.status };
        }
      }
    }
    if (this.draft && view.volume?.available) view.volume = { ...view.volume, level: this.draft.level, pending: true };
    return view;
  }
  private allowed() { return this.options.canSend() && Boolean(this.options.getView()?.connected); }
  play(track: CatalogueTrack, prepared?: { entryId: string; revision: number }) {
    const view = this.options.getView(); if (!view?.myTurn || !this.allowed() || this.starting) return;
    this.commands.push({ kind: 'play', seq: ++this.seq, target: this.seq, track, previous: view.ownPlayback?.id ?? null, prepared });
    this.options.changed('player'); void this.drain();
  }
  control(action: 'pause' | 'resume' | 'stop') { this.enqueue({ kind: 'control', action }); }
  reveal() { this.enqueue({ kind: 'reveal' }); }
  private enqueue(intent: { kind: 'control'; action: 'pause' | 'resume' | 'stop' } | { kind: 'reveal' }) {
    const base = this.options.getView(); if (!base?.myTurn || !this.allowed()) return;
    const view = this.project(base); if (!view.ownPlayback) return;
    const play = this.commands.findLast(command => command.kind === 'play');
    const target = play?.seq ?? base.ownPlayback?.id; if (target === undefined) return;
    const last = this.commands.at(-1);
    if (intent.kind === 'reveal' && (view.ownPlayback.revealed || this.commands.some(command => command.kind === 'reveal' && command.target === target))) return;
    if (intent.kind === 'control' && view.ownPlayback.status === 'stopped') return;
    const command = { ...intent, seq: ++this.seq, target, position: this.options.position?.(view.progress) ?? view.progress } as Command;
    if (last?.kind === 'control' && intent.kind === 'control' && last.target === target && last !== this.current) this.commands[this.commands.length - 1] = command;
    else this.commands.push(command);
    this.options.changed('player'); void this.drain();
  }
  private async drain() {
    if (this.sending) return;
    this.sending = true;
    try {
      while (this.commands.length && this.allowed()) {
        const command = this.commands[0]!; const epoch = this.epoch; const identity = this.identity;
        this.current = command; const base = this.options.getView()!;
        try {
          const id = typeof command.target === 'number' ? this.confirmed.get(command.target) : command.target;
          if (command.kind !== 'play' && (!id || base.ownPlayback?.id !== id)) throw new Error('Playback changed. The queued player update was cancelled.');
          const data = command.kind === 'play'
            ? command.prepared ? { turnId: base.turnId, previousPlaybackId: command.previous, ...command.prepared } : { turnId: base.turnId, previousPlaybackId: command.previous, trackId: command.track.id }
            : command.kind === 'control' ? { turnId: base.turnId, playbackId: id, action: command.action } : { turnId: base.turnId, playbackId: id };
          const response = await this.options.request(command.kind === 'play' && command.prepared ? '/api/participant/preparations/play' : `/api/participant/${command.kind}`, data);
          if (epoch !== this.epoch || identity !== this.identity) continue;
          if (command.kind === 'play') {
            if (!response.ownPlayback) throw new Error('Playback could not be confirmed.');
            this.confirmed.set(command.seq, response.ownPlayback.id);
            while (this.confirmed.size > 20) this.confirmed.delete(this.confirmed.keys().next().value!);
          }
          this.options.accept(response);
          if (epoch !== this.epoch) continue;
          if (this.commands[0] === command) this.commands.shift();
          if (command.kind === 'play') this.options.played?.(command.track);
          this.options.changed('player');
        } catch (error) {
          if (epoch !== this.epoch) continue;
          this.commands = []; this.confirmed.clear();
          this.options.failed(error instanceof Error ? error.message : 'The player update could not be confirmed.');
          await this.options.resync(); this.options.changed('player');
        }
      }
    } finally { this.current = undefined; this.sending = false; }
  }
  volume(level: number, commit = false) {
    const view = this.options.getView();
    if (!view || !this.allowed() || !view.volume?.available || !Number.isInteger(level) || level < 0 || level > 100) return;
    if (this.options.role === 'participant' && (!view.myTurn || !view.ownPlayback || view.ownPlayback.status === 'stopped' || this.starting)) return;
    if (this.draft?.level !== level) {
      this.draft = { seq: ++this.seq, level }; this.nextVolume = this.draft; this.options.changed('volume');
    }
    clearTimeout(this.volumeTimer);
    if (commit) void this.flushVolume();
    else { this.volumeTimer = setTimeout(() => { void this.flushVolume(); }, 100); }
  }
  private async flushVolume() {
    if (this.sendingVolume || !this.nextVolume || !this.allowed()) return;
    const intent = this.nextVolume; this.nextVolume = undefined; this.sendingVolume = true;
    const epoch = this.epoch; const volumeEpoch = this.volumeEpoch; const identity = this.identity; const view = this.options.getView()!;
    try {
      const response = await this.options.request(`/api/${this.options.role}/volume`, { turnId: view.turnId, level: intent.level, volumeRevision: view.volume?.revision ?? 'demo',
        ...(this.options.role === 'participant' ? { playbackId: view.ownPlayback!.id } : {}) });
      if (epoch !== this.epoch || volumeEpoch !== this.volumeEpoch || identity !== this.identity) return;
      intent.ack = response.volume?.generation ?? 0;
      this.options.accept(response); if (this.options.getView()) this.observe(this.options.getView()!); this.options.changed('volume');
    } catch (error) {
      if (epoch !== this.epoch || volumeEpoch !== this.volumeEpoch) return;
      this.clearVolume(); this.options.failed(error instanceof Error ? error.message : 'Volume could not be confirmed.');
      await this.options.resync(); this.options.changed('volume');
    } finally {
      this.sendingVolume = false;
      if (this.nextVolume) void this.flushVolume();
    }
  }
}
