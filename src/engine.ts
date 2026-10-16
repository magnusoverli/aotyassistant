import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { AppError, roomSchema, catalogueSearchNotice, type Role, type Room, type State, type View, type CatalogueProvider, type CatalogueSearch, type CatalogueBrowse, type PlaybackProgress, type Track } from './model.js';
import type { Store } from './store.js';
import type { PlaybackAdapter } from './playback.js';
import type { SavedSelection } from './preparations.js';
import { SerialQueue } from './serial.js';

const secret = () => randomBytes(32).toString('base64url');
const hash = (value: string) => createHash('sha256').update(value).digest('hex');

export class Engine extends EventEmitter {
  private state: State = { schema: 3, room: null };
  private queue = new SerialQueue();
  private storageHealthy = true;
  private concealPlayback = false;
  private controlEpoch = 0;
  private invalidationEpoch = 0;
  private startingPlayback?: { id: string; previousId: string | null; turnId: string };

  constructor(private store: Store, readonly adapter: PlaybackAdapter, private guestUrl: string, private catalogue?: CatalogueProvider) {
    super();
    this.setMaxListeners(0); // Multiple phones/displays subscribe; HTTP caps the actual stream count.
    adapter.onComplete = id => { void this.complete(id).catch(() => { this.emit('change'); }); };
    adapter.onProgress = () => this.emit('change');
    adapter.onInvalidated = id => {
      if (id !== this.startingPlayback?.id && id !== this.state.room?.playback?.id) return;
      this.invalidationEpoch++;
      const affectedId = this.startingPlayback?.id === id ? this.startingPlayback.previousId : id;
      const affectedTurn = this.startingPlayback?.id === id ? this.startingPlayback.turnId : this.state.room?.turnId;
      this.concealPlayback = true; this.emit('change');
      void this.serial(async () => {
        if (!affectedId || this.state.room?.playback?.id !== affectedId || this.state.room.turnId !== affectedTurn) return;
        const next = structuredClone(this.state); next.room!.playback = null; next.room!.revision++;
        try { await this.store.save(next); this.state = next; } catch { this.storageHealthy = false; }
        this.emit('change');
      });
    };
    adapter.onStatus = (id, status) => {
      const epoch = this.controlEpoch;
      void this.serial(async () => {
        if (this.state.room?.playback?.id !== id || this.state.room.playback.status === 'stopped' ||
          this.state.room.playback.status === status || epoch !== this.controlEpoch) return;
        const next = structuredClone(this.state); next.room!.playback!.status = status; next.room!.revision++;
        try { await this.store.save(next); this.state = next; }
        catch { this.storageHealthy = false; this.concealPlayback = true; await this.adapter.control('stop').catch(() => {}); }
        this.emit('change');
      });
    };
  }
  get ready(): boolean { return this.adapter.connected && this.storageHealthy; }
  setGuestOrigin(origin: string) { this.guestUrl = origin; this.emit('change'); }
  private get catalogueState() {
    return this.catalogue?.configured ? { source: 'music-assistant' as const, playbackAvailable: this.catalogue.playbackAvailable ?? false, revision: this.catalogue.catalogueRevision ?? this.catalogue.configurationRevision ?? 0 }
      : { source: 'demo' as const, playbackAvailable: true };
  }
  async init(): Promise<void> {
    this.state = await this.store.load();
    this.state.room ??= { id: randomUUID(), revision: 0, turnId: randomUUID(), participants: [], active: [], currentId: null, playback: null };
    roomSchema.parse(this.state.room);
    // Keep the room and memberships, but invalidate pending playback actions on restart.
    this.state.room.turnId = randomUUID(); this.state.room.playback = null; this.state.room.revision++;
    await this.store.save(this.state);
  }
  private serial<T>(work: () => Promise<T>): Promise<T> {
    return this.queue.run(work);
  }
  private async transaction<T>(work: (state: State) => Promise<T>): Promise<T> {
    return this.serial(async () => {
      if (!this.ready) throw new AppError(503, 'Playback or storage connectivity is uncertain. Controls are disabled.');
      const state = structuredClone(this.state); const result = await work(state);
      const room = this.room(state); room.revision++; roomSchema.parse(room);
      try { await this.store.save(state); }
      catch {
        this.storageHealthy = false; await this.adapter.control('stop').catch(() => {}); this.emit('change');
        throw new AppError(503, 'State could not be saved. Controls are disabled; restart after fixing storage.');
      }
      this.state = state; this.emit('change'); return result;
    });
  }
  private room(state = this.state): Room {
    if (!state.room) throw new AppError(503, 'The listening room is not ready.');
    return state.room;
  }
  private participant(credential: string, room = this.room()) {
    const participant = room.participants.find(p => p.credentialHash === hash(credential));
    if (!participant) throw new AppError(401, 'Join the listening room to continue.');
    return participant;
  }
  private current(credential: string, turnId: string, room: Room) {
    const participant = this.participant(credential, room);
    if (room.turnId !== turnId) throw new AppError(409, 'The turn changed. Refresh your view and try again.');
    if (room.currentId !== participant.id) throw new AppError(403, 'Only the current participant can do that.');
    return participant;
  }
  private expected(room: Room, revision: number): void {
    if (room.revision !== revision) throw new AppError(409, 'The room changed. Review the updated view and try again.');
  }
  private expectedPlayback(room: Room, id: string | null): void {
    if ((room.playback?.id ?? null) !== id) throw new AppError(409, 'The playback changed. Review the current track and try again.');
  }
  private async stopAndRotate(room: Room): Promise<void> {
    await this.adapter.control('stop');
    const index = room.currentId ? room.active.indexOf(room.currentId) : -1;
    room.currentId = room.active.length ? room.active[(index + 1) % room.active.length]! : null;
    room.turnId = randomUUID(); room.playback = null;
  }
  view(role: Role): View {
    const room = this.room();
    if (role.kind === 'participant') this.participant(role.credential, room);
    const person = (id: string | null) => {
      const p = room.participants.find(p => p.id === id); return p ? { id: p.id, nickname: p.nickname } : null;
    };
    const base: View = { mode: this.adapter.mode, connected: this.ready, roomId: room.id,
      revision: room.revision, turnId: room.turnId, current: person(room.currentId),
      next: room.currentId && room.active.length ? person(room.active[(room.active.indexOf(room.currentId) + 1) % room.active.length]!) : null,
      rotation: room.active.map(id => person(id)!), // Names/order only, never selections or credentials.
      ...(role.kind !== 'display' && this.adapter.issue ? { playbackIssue: this.adapter.issue } : {}) };
    const joinUrl = `${this.guestUrl}/join`;
    if (role.kind === 'host') return { ...base, active: room.active.map(id => person(id)!), volume: this.adapter.volume,
      joinUrl, displayUrl: `${this.guestUrl}/display` };
    if (role.kind === 'display') {
      const revealed = Boolean(room.playback?.revealed && !this.concealPlayback && this.ready);
      const track = room.playback ? structuredClone(room.playback.track) : undefined;
      if (track && room.playback) {
        for (const kind of ['artwork', 'artistArtwork'] as const) if (track[kind]?.startsWith('/api/participant/artwork/')) track[kind] = `/api/display/artwork/${room.playback.id}/${kind}`;
      }
      return { ...base, joinUrl, progress: this.progress(room, revealed), nowPlaying: revealed && track
        ? { revealed: true, track } : { revealed: false } };
    }
    const me = this.participant(role.credential, room); const myTurn = room.currentId === me.id;
    const seat = room.active.indexOf(me.id); const currentSeat = room.active.indexOf(room.currentId ?? '');
    return { ...base, me: { id: me.id, nickname: me.nickname }, myTurn, catalogue: this.catalogueState,
      position: { seat: seat + 1, total: room.active.length, turnsUntil: (seat - currentSeat + room.active.length) % room.active.length },
      ...(myTurn ? { ownPlayback: structuredClone(room.playback), progress: this.progress(room, true), volume: this.adapter.volume } : {}) };
  }
  private progress(room: Room, times: boolean): PlaybackProgress | undefined {
    const playback = room.playback; if (!playback || !this.ready || this.concealPlayback) return;
    const sample = this.adapter.progress?.(playback.id); const duration = sample?.duration || playback.track.duration;
    const fraction = sample && duration > 0 ? Math.round(Math.max(0, Math.min(1, sample.elapsed / duration)) * 1000) / 1000 : null;
    return { id: playback.id, status: playback.status, fraction,
      ...(times ? { ...(sample ? { elapsed: Math.min(duration || Infinity, Math.max(0, sample.elapsed)) } : {}), duration } : {}) };
  }
  catalogueContext(credential: string): string {
    const room = this.room(); const member = this.participant(credential, room); return `${room.id}:${member.id}`;
  }
  async captureDemo(credential: string, trackId: string): Promise<SavedSelection> {
    const context = this.catalogueContext(credential);
    if (this.catalogue?.configured) throw new AppError(409, 'The catalogue changed. Search again.');
    const track = await this.adapter.resolve(trackId, context);
    if (this.catalogueContext(credential) !== context || this.catalogue?.configured) throw new AppError(409, 'The catalogue or membership changed. Search again.');
    return { source: 'demo', trackId, metadata: { title: track.title, artist: track.artist, album: track.album,
      version: '', provider: 'Demo', duration: track.duration, ...(track.artwork === '/demo-cover.svg' ? { artworkId: 'demo-cover' as const } : {}) } };
  }
  displayArtwork(playbackId: string, kind: 'artwork' | 'artistArtwork') {
    const room = this.room();
    if (!this.ready || this.concealPlayback || !room.playback?.revealed || room.playback.id !== playbackId) throw new AppError(403, 'This artwork is not revealed.');
    const url = room.playback.track[kind];
    if (!url?.startsWith('/api/participant/artwork/')) throw new AppError(404, 'Artwork unavailable.');
    return { reference: decodeURIComponent(url.slice('/api/participant/artwork/'.length)), context: `${room.id}:${room.currentId}` };
  }
  async setVolume(level: number, turnId: string | null, credential?: string, playbackId?: string, volumeRevision?: string) {
    return this.serial(async () => {
      if (!this.ready) throw new AppError(503, 'Playback connectivity is uncertain.');
      if (!Number.isInteger(level) || level < 0 || level > 100) throw new AppError(400, 'Choose a volume from 0 to 100.');
      if ((this.state.room?.turnId ?? null) !== turnId) throw new AppError(409, 'The turn changed. Review the current volume.');
      if (volumeRevision !== undefined && volumeRevision !== this.adapter.volume?.revision) throw new AppError(409, 'The volume destination changed. Refresh before trying again.');
      if (credential !== undefined) {
        const room = this.room(); this.current(credential, turnId!, room); this.expectedPlayback(room, playbackId ?? null);
        if (!room.playback || room.playback.status === 'stopped') throw new AppError(409, 'Play a track before changing volume.');
      }
      if (!this.adapter.setVolume || !this.adapter.volume?.available) throw new AppError(422, 'Volume control is unavailable for this destination.');
      await this.adapter.setVolume(level, credential !== undefined ? playbackId : undefined); this.emit('change');
    });
  }
  async join(nickname: string, existingCredential?: string): Promise<string> {
    return this.transaction(async state => {
      const room = this.room(state);
      if (existingCredential && room.participants.some(p => p.credentialHash === hash(existingCredential))) return existingCredential;
      const name = nickname.trim();
      if (!name || name.length > 40 || /[\x00-\x1f\x7f]/.test(name)) throw new AppError(400, 'Use a nickname of 1–40 characters without control characters.');
      if (room.participants.length >= 100) throw new AppError(409, 'This room is full.');
      const credential = secret(); const id = randomUUID();
      room.participants.push({ id, nickname: name, credentialHash: hash(credential) }); room.active.push(id);
      if (!room.currentId) { room.currentId = id; room.turnId = randomUUID(); }
      return credential;
    });
  }
  async reorder(ids: string[], revision: number): Promise<void> {
    return this.transaction(async state => {
      const room = this.room(state); this.expected(room, revision);
      if (ids.length !== room.active.length || new Set(ids).size !== ids.length || ids.some(id => !room.active.includes(id))) throw new AppError(400, 'The order must contain every active participant exactly once.');
      room.active = ids;
    });
  }
  async advance(turnId: string, credential?: string): Promise<void> {
    return this.transaction(async state => {
      const room = this.room(state);
      if (credential !== undefined) this.current(credential, turnId, room);
      if (room.turnId !== turnId) throw new AppError(409, 'The turn changed. Refresh your view and try again.');
      if (!room.currentId) throw new AppError(409, 'No participants have joined yet.');
      await this.stopAndRotate(room);
    });
  }
  async remove(id: string, revision: number): Promise<void> {
    return this.transaction(async state => {
      const room = this.room(state); this.expected(room, revision);
      if (!room.participants.some(p => p.id === id)) throw new AppError(404, 'Participant not found.');
      if (room.currentId === id) { await this.stopAndRotate(room); if (room.currentId === id) room.currentId = null; }
      room.active = room.active.filter(p => p !== id); room.participants = room.participants.filter(p => p.id !== id);
    });
  }
  async search(credential: string, _turnId: string, query: string): Promise<CatalogueSearch> {
    if (!this.ready) throw new AppError(503, 'Playback connectivity is uncertain.');
    const room = this.room(); const participant = this.participant(credential, room); const context = `${room.id}:${participant.id}`;
    const catalogue = this.catalogueState;
    const tracks = catalogue.source === 'music-assistant' ? await this.catalogue!.search(query, context)
      : (await this.adapter.search(query)).map(t => ({ id: t.id, title: t.title, artist: t.artist, album: t.album,
        duration: t.duration, version: '', provider: 'Demo', available: true, artwork: t.artwork, artistArtwork: t.artistArtwork }));
    const latest = this.room(); const member = this.participant(credential, latest);
    if (`${latest.id}:${member.id}` !== context) throw new AppError(401, 'Room membership changed. Join again.');
    const currentCatalogue = this.catalogueState;
    if (catalogue.source !== currentCatalogue.source || catalogue.revision !== currentCatalogue.revision) throw new AppError(409, 'The catalogue connection changed. Search again.');
    return { ...currentCatalogue, tracks, ...(catalogue.source === 'music-assistant' ? { notices: [catalogueSearchNotice] } : {}) };
  }
  async browse(credential: string, kind: 'artists' | 'albums' | 'tracks', value: string): Promise<CatalogueBrowse> {
    if (!this.ready) throw new AppError(503, 'Playback connectivity is uncertain.');
    const room = this.room(); const member = this.participant(credential, room); const context = `${room.id}:${member.id}`;
    const catalogue = this.catalogueState;
    if (!this.catalogue?.configured || !this.catalogue.browse) throw new AppError(422, 'Artist/album browsing requires a Music Assistant connection.');
    const result = await this.catalogue.browse(kind, value, context);
    const latest = this.room(); const currentMember = this.participant(credential, latest);
    if (`${latest.id}:${currentMember.id}` !== context) throw new AppError(401, 'Room membership changed. Join again.');
    if (catalogue.source !== this.catalogueState.source || catalogue.revision !== this.catalogueState.revision) throw new AppError(409, 'The catalogue connection changed. Browse again.');
    return { ...result, playbackAvailable: this.catalogueState.playbackAvailable };
  }
  async play(credential: string, turnId: string, previousPlaybackId: string | null, trackId: string): Promise<void> {
    await this.playSelection(credential, turnId, previousPlaybackId, context => this.adapter.resolve(trackId, context));
  }
  async playPrepared(credential: string, turnId: string, previousPlaybackId: string | null, selection: SavedSelection, entryId: string): Promise<string> {
    if (!this.adapter.resolveSaved) throw new AppError(422, 'Saved-track playback is unavailable.');
    return this.playSelection(credential, turnId, previousPlaybackId, context => this.adapter.resolveSaved!(selection, context, `prepared:${entryId}`));
  }
  private async playSelection(credential: string, turnId: string, previousPlaybackId: string | null, resolve: (context: string) => Promise<Track>): Promise<string> {
    let playbackId = '';
    await this.transaction(async state => {
      const room = this.room(state); this.current(credential, turnId, room); this.expectedPlayback(room, previousPlaybackId);
      if (this.catalogue?.configured && !this.catalogue.playbackAvailable) throw new AppError(422, 'Choose a playback destination in host settings first.');
      const member = this.participant(credential, room); const track = await resolve(`${room.id}:${member.id}`); const id = randomUUID(); playbackId = id;
      this.startingPlayback = { id, previousId: room.playback?.id ?? null, turnId: room.turnId };
      const concealed = this.concealPlayback; const epoch = this.invalidationEpoch;
      this.concealPlayback = true; this.emit('change');
      try { await this.adapter.play(track, id); }
      catch (error) {
        // Rejected preflight leaves the old playback intact. An ownership invalidation
        // or uncertain adapter must keep it concealed, even if the replacement failed.
        if (epoch === this.invalidationEpoch && this.ready) { this.concealPlayback = concealed; this.emit('change'); }
        throw error;
      } finally { this.startingPlayback = undefined; }
      room.playback = { id, turnId, track, status: 'playing', revealed: false };
    });
    this.concealPlayback = false; this.emit('change'); return playbackId;
  }
  async control(credential: string, turnId: string, playbackId: string, action: 'pause' | 'resume' | 'stop'): Promise<void> {
    return this.transaction(async state => {
      const room = this.room(state); this.current(credential, turnId, room); this.expectedPlayback(room, playbackId);
      if (!room.playback || (action !== 'stop' && room.playback.status === 'stopped')) throw new AppError(409, 'Select and play a track first.');
      await this.adapter.control(action); this.controlEpoch++;
      room.playback.status = action === 'pause' ? 'paused' : action === 'resume' ? 'playing' : 'stopped';
    });
  }
  async reveal(credential: string, turnId: string, playbackId: string): Promise<void> {
    return this.transaction(async state => {
      const room = this.room(state); this.current(credential, turnId, room); this.expectedPlayback(room, playbackId);
      if (!room.playback) throw new AppError(409, 'Play a track before revealing.');
      room.playback.revealed = true;
    });
  }
  async complete(playbackId: string): Promise<void> {
    // No-op for stale, duplicated, paused, stopped, or recovered completion events.
    await this.serial(async () => {
      const room = this.state.room;
      if (!this.ready || !room || room.playback?.id !== playbackId || room.playback.turnId !== room.turnId || room.playback.status !== 'playing') return;
      const state = structuredClone(this.state); await this.stopAndRotate(state.room!); state.room!.revision++;
      try { await this.store.save(state); }
      catch { this.storageHealthy = false; this.emit('change'); throw new AppError(503, 'Completion state could not be saved.'); }
      this.state = state; this.emit('change');
    });
  }
}
