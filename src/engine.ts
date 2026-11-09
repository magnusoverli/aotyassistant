import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { AppError, AUTO_REVEAL_FRACTION, roomSchema, type Role, type Room, type State, type View, type CatalogueProvider, type CatalogueSearch, type CatalogueBrowse, type PlaybackProgress, type PlaybackSettings, type Track, type ListeningOrderView, type UserProfile, type AutoplayTarget } from './model.js';
import type { Store } from './store.js';
import type { PlaybackAdapter } from './playback.js';
import type { SavedSelection } from './preparations.js';
import { SerialQueue } from './serial.js';
import { background, operation, playbackResolution, remaining, stage } from './operation.js';
import { artworkPath, artworkReference } from './catalogue-references.js';

const secret = () => randomBytes(32).toString('base64url');
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const defaultAutoReveal = { enabled: true, revision: 0 };
const defaultAutoplay = { enabled: false, revision: 0 };
const defaultSecretPlayback = { enabled: true, revision: 0 };
export type EngineChange = 'room' | 'playback' | 'output';
type PlayActor = { kind: 'participant'; credential: string } | { kind: 'autoplay'; target: AutoplayTarget };

export class Engine extends EventEmitter {
  private state: State = { schema: 3, room: null };
  private queue = new SerialQueue();
  private audioQueue = new SerialQueue();
  private storageHealthy = true;
  private initialized = false;
  private stopping = false;
  private concealPlayback = false;
  private controlEpoch = 0;
  private invalidationEpoch = 0;
  private startingPlayback?: { id: string; previousId: string | null; turnId: string };
  private revealCheckPending = false;
  private userForSession?: (credential: string) => UserProfile | undefined;
  private autoplayNext?: (target: AutoplayTarget) => Promise<unknown>;
  private autoplayRuns = new Set<Promise<unknown>>();

  attachUsers(resolve: (credential: string) => UserProfile | undefined) { this.userForSession = resolve; }
  /** Called after a song ends naturally and the turn passes, while automatic play is on. */
  attachAutoplay(handler: (target: AutoplayTarget) => Promise<unknown>) { this.autoplayNext = handler; }
  identityParticipants() { return structuredClone(this.room().participants); }
  hasLegacyParticipants() { return this.room().participants.some(person => !person.userId); }
  async linkUsers(links: { participantId: string; userId: string }[]) {
    if (!links.length) return;
    await this.transaction(async state => {
      for (const link of links) {
        const person = state.room!.participants.find(p => p.id === link.participantId);
        if (person) person.userId = link.userId;
      }
      const room = state.room!;
      const keep = new Map<string, string>();
      for (const person of [...room.participants].sort((a, b) => Number(b.id === room.currentId) - Number(a.id === room.currentId))) {
        if (person.userId && !keep.has(person.userId)) keep.set(person.userId, person.id);
      }
      room.participants = room.participants.filter(person => !person.userId || keep.get(person.userId) === person.id);
      room.active = room.active.filter(id => room.participants.some(person => person.id === id));
    });
  }
  async joinUser(userId: string, credential: string) {
    return this.transaction(async state => {
      const user = this.userForSession?.(credential);
      if (!user || user.id !== userId) throw new AppError(401, 'Select your name and enter your PIN.');
      const room = state.room!;
      if (room.participants.some(p => p.userId === userId)) return;
      if (room.participants.length >= 100) throw new AppError(409, 'This room is full.');
      room.participants.push({ id: userId, userId, nickname: user.nickname, credentialHash: '' }); room.active.push(userId);
      if (!room.currentId) { room.currentId = userId; room.turnId = randomUUID(); }
    });
  }

  constructor(private store: Store, readonly adapter: PlaybackAdapter, private guestUrl: string, private catalogue?: CatalogueProvider) {
    super();
    this.setMaxListeners(0); // Multiple phones/displays subscribe; HTTP caps the actual stream count.
    adapter.onComplete = id => { void this.complete(id).catch(() => { this.emit('change'); }); };
    adapter.onProgress = () => { this.emit('change', 'playback'); this.scheduleAutoReveal(); };
    adapter.onInvalidated = id => {
      if (id !== this.startingPlayback?.id && id !== this.state.room?.playback?.id) return;
      this.invalidationEpoch++;
      const affectedId = this.startingPlayback?.id === id ? this.startingPlayback.previousId : id;
      const affectedTurn = this.startingPlayback?.id === id ? this.startingPlayback.turnId : this.state.room?.turnId;
      this.concealPlayback = true; this.emit('change');
      // The app already lost this playback; a failed save must not touch other audio.
      void this.commitInBackground(room => {
        if (!affectedId || room.playback?.id !== affectedId || room.turnId !== affectedTurn) return false;
        room.playback = null;
      }, { stopOnFailure: false }).catch(this.failClosed);
    };
    adapter.onStatus = (id, status) => {
      const epoch = this.controlEpoch;
      void this.commitInBackground(room => {
        if (room.playback?.id !== id || room.playback.status === 'stopped' || room.playback.status === status || epoch !== this.controlEpoch) return false;
        room.playback.status = status;
      }).catch(this.failClosed);
    };
  }
  /** A playback change that could not even be queued leaves saved state uncertain. */
  private failClosed = () => { this.storageHealthy = false; this.emit('change'); };
  /** Saves a background room change; `apply` returns false to skip. */
  private commitInBackground(apply: (room: Room) => boolean | void, options?: { stopOnFailure: boolean }): Promise<boolean> {
    return background(() => this.serial(async () => {
      const next = structuredClone(this.state);
      if (apply(next.room!) === false) return false;
      next.room!.revision++;
      return this.commit(next, options);
    }));
  }
  /** The only place room state is persisted. A failed save disables controls and, unless
   * the caller opts out, stops the app-owned song so it cannot continue unrecorded. */
  private async commit(next: State, { stopOnFailure = true } = {}): Promise<boolean> {
    try { await this.store.save(next); this.state = next; return true; }
    catch { this.storageHealthy = false; if (stopOnFailure) await this.adapter.control('stop').catch(() => {}); return false; }
    finally { this.emit('change'); }
  }
  get ready(): boolean { return this.adapter.connected && this.storageHealthy; }
  get playbackAvailable(): boolean { return this.ready && this.catalogueState.playbackAvailable; }
  get live(): boolean { return this.initialized && !this.stopping; }
  get storageAvailable(): boolean { return this.storageHealthy; }
  beginShutdown() { this.stopping = true; }
  async drain() {
    do { await Promise.allSettled([...this.autoplayRuns]); await this.audioQueue.drain(); await this.queue.drain(); } while (this.autoplayRuns.size);
  }
  setGuestOrigin(origin: string) { this.guestUrl = origin; this.emit('change'); }
  playbackSettings(): PlaybackSettings { return { ...(this.room().autoReveal ?? defaultAutoReveal) }; }
  async setAutoReveal(enabled: boolean, revision: number): Promise<PlaybackSettings> {
    await this.transaction(async state => {
      const room = this.room(state); const current = room.autoReveal ?? defaultAutoReveal;
      if (current.revision !== revision) throw new AppError(409, 'Playback settings changed. Refresh them before trying again.');
      room.autoReveal = { enabled, revision: current.revision + 1 };
    });
    this.scheduleAutoReveal();
    return this.playbackSettings();
  }
  autoplaySettings(): PlaybackSettings { return { ...(this.room().autoplay ?? defaultAutoplay) }; }
  /** Switching it on never starts music; it applies from the next song that ends. */
  async setAutoplay(enabled: boolean, revision: number): Promise<PlaybackSettings> {
    await this.transaction(async state => {
      const room = this.room(state); const current = room.autoplay ?? defaultAutoplay;
      if (current.revision !== revision) throw new AppError(409, 'Playback settings changed. Refresh them before trying again.');
      room.autoplay = { enabled, revision: current.revision + 1 };
    });
    return this.autoplaySettings();
  }
  secretPlaybackSettings(): PlaybackSettings { return { ...(this.room().secretPlayback ?? defaultSecretPlayback) }; }
  /** Switching it off reveals the current song in the same save. Switching it on never hides a song
   * already shown; the next song starts hidden. */
  async setSecretPlayback(enabled: boolean, revision: number): Promise<PlaybackSettings> {
    await this.transaction(async state => {
      const room = this.room(state); const current = room.secretPlayback ?? defaultSecretPlayback;
      if (current.revision !== revision) throw new AppError(409, 'Playback settings changed. Refresh them before trying again.');
      room.secretPlayback = { enabled, revision: current.revision + 1 };
      if (!enabled && room.playback) room.playback.revealed = true;
    });
    return this.secretPlaybackSettings();
  }
  /** Automatic reveal only means something while songs start hidden. */
  private autoRevealOn(room: Room) { return room.autoReveal?.enabled !== false && room.secretPlayback?.enabled !== false; }
  /** The same turn, the same seat still held by the same user, and the setting still on. */
  private autoplayAllowed(room: Room, target: AutoplayTarget) {
    return room.autoplay?.enabled === true && room.turnId === target.turnId && room.currentId === target.participantId &&
      room.participants.some(person => person.id === target.participantId && person.userId === target.userId);
  }
  /** A cheap check before reserving a saved song; `autoplay` checks again inside the audio lane. */
  autoplayReady(target: AutoplayTarget) {
    const room = this.state.room;
    return Boolean(this.live && this.playbackAvailable && !this.concealPlayback && !this.startingPlayback && room && !room.playback && this.autoplayAllowed(room, target));
  }
  private autoplayTarget(room: Room): AutoplayTarget | undefined {
    if (room.autoplay?.enabled !== true || !room.currentId || room.playback) return;
    const userId = room.participants.find(person => person.id === room.currentId)?.userId;
    return userId ? { turnId: room.turnId, participantId: room.currentId, userId } : undefined;
  }
  private startAutoplay(target: AutoplayTarget) {
    const next = this.autoplayNext; if (!next || !this.live) return;
    // Outside any request or monitoring deadline: it gets its own operation budget.
    const run = background(() => next(target)).catch(() => {});
    this.autoplayRuns.add(run); void run.finally(() => this.autoplayRuns.delete(run));
  }
  private autoRevealEligible(id?: string) {
    const room = this.state.room; const playback = room?.playback;
    if (!this.live || !this.playbackAvailable || this.concealPlayback || this.startingPlayback || !room || !this.autoRevealOn(room) || !playback || playback.revealed || playback.status === 'stopped' || playback.turnId !== room.turnId || (id !== undefined && playback.id !== id)) return false;
    const sample = this.adapter.progress?.(playback.id);
    const duration = sample?.duration || playback.track.duration;
    return Boolean(sample && Number.isFinite(sample.elapsed) && Number.isFinite(duration) && duration > 0 && sample.elapsed / duration >= AUTO_REVEAL_FRACTION);
  }
  private scheduleAutoReveal() {
    if (this.revealCheckPending || !this.autoRevealEligible()) return;
    const id = this.state.room!.playback!.id;
    this.revealCheckPending = true;
    // Recheck identity, setting, ownership and progress after any queued work. A failed
    // reveal keeps the song playing; one that cannot be queued retries on the next sample.
    void this.commitInBackground(room => {
      if (!this.autoRevealEligible(id)) return false;
      room.playback!.revealed = true;
    }, { stopOnFailure: false }).catch(() => {}).finally(() => { this.revealCheckPending = false; });
  }
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
    this.initialized = true;
  }
  private serial<T>(work: () => Promise<T>): Promise<T> {
    return this.queue.run(work, 'engine');
  }
  private audio<T>(work: () => Promise<T>) {
    return this.audioQueue.run(() => { remaining(Infinity); return work(); }, 'engine-playback');
  }
  private inspect<T>(work: (room: Room) => T) {
    return this.serial(async () => {
      remaining(Infinity);
      if (!this.ready) throw new AppError(503, 'Playback or storage connectivity is uncertain. Controls are disabled.');
      return work(this.room());
    });
  }
  /** Commits a changed room. An unchanged room (e.g. an existing member rejoining) is neither saved nor re-versioned. */
  private async transaction<T>(work: (state: State) => Promise<T>, playback = false): Promise<T> {
    return this.serial(async () => {
      remaining(Infinity);
      if (!this.storageHealthy || playback && !this.adapter.connected) throw new AppError(503, 'Playback or storage connectivity is uncertain. Controls are disabled.');
      const before = JSON.stringify(this.state.room);
      const state = structuredClone(this.state); const result = await work(state);
      const room = this.room(state);
      if (JSON.stringify(room) === before) return result;
      room.revision++; roomSchema.parse(room);
      if (!await this.commit(state)) throw new AppError(503, 'State could not be saved. Controls are disabled; restart after fixing storage.');
      return result;
    });
  }
  private room(state = this.state): Room {
    if (!state.room) throw new AppError(503, 'The Doom Room is not ready.');
    return state.room;
  }
  private participant(credential: string, room = this.room()) {
    const user = this.userForSession?.(credential);
    const digest = hash(credential); const participant = room.participants.find(p => p.userId ? p.userId === user?.id : p.credentialHash === digest);
    if (!participant) throw new AppError(401, 'Join the Doom Room to continue.');
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
  private rotate(room: Room): void {
    const index = room.currentId ? room.active.indexOf(room.currentId) : -1;
    room.currentId = room.active.length ? room.active[(index + 1) % room.active.length]! : null;
    room.turnId = randomUUID(); room.playback = null;
  }
  /** Public names by participant ID; never credentials or selections. */
  private people(room: Room) {
    const people = new Map(room.participants.map(({ id, nickname }) => [id, { id, nickname }]));
    return (id: string | null) => id ? people.get(id) ?? null : null;
  }
  private nextId(room: Room) {
    return room.currentId && room.active.length ? room.active[(room.active.indexOf(room.currentId) + 1) % room.active.length]! : null;
  }
  listeningOrder(): ListeningOrderView {
    const room = this.room(); const person = this.people(room);
    return { roomId: room.id, revision: room.revision, current: person(room.currentId), next: person(this.nextId(room)),
      rotation: room.active.map(id => person(id)!), playbackStatus: this.playbackStatus(room) };
  }
  private onlineSharing?: () => { guestAccess: NonNullable<View['guestAccess']>; joinUrl?: string; displayUrl?: string } | undefined;
  setOnlineSharing(provider: NonNullable<Engine['onlineSharing']>) { this.onlineSharing = provider; }
  view(role: Role): View {
    const room = this.room();
    if (role.kind === 'participant') this.participant(role.credential, room);
    const person = this.people(room);
    const base: View = { mode: this.adapter.mode, connected: this.ready, roomId: room.id,
      playbackAvailable: this.playbackAvailable, playbackStatus: this.playbackStatus(room),
      ...(role.kind !== 'display' && this.catalogue?.configured ? { output: this.catalogue.output } : {}),
      revision: room.revision, turnId: room.turnId, current: person(room.currentId), next: person(this.nextId(room)),
      rotation: room.active.map(id => person(id)!), // Names/order only, never selections or credentials.
      ...(role.kind !== 'display' && this.adapter.issue ? { playbackIssue: this.adapter.issue,
        ...(this.adapter.problem ? { playbackProblem: { ...this.adapter.problem } } : {}) } : {}) };
    const guestUrl = this.catalogue?.guestOrigin || this.guestUrl;
    const online = this.onlineSharing?.();
    const guestAccess = online?.guestAccess ?? this.catalogue?.guestAccess;
    const joinUrl = online ? online.joinUrl : guestAccess && guestAccess.status !== 'ready' ? undefined : `${guestUrl}/join`;
    if (role.kind === 'host') {
      const playback = base.playbackStatus !== 'unavailable' ? room.playback : null;
      return { ...base, active: room.active.map(id => person(id)!), volume: this.adapter.volume,
        hostPlayback: playback ? { id: playback.id, status: playback.status, revealed: playback.revealed } : null,
        progress: playback && playback.status !== 'stopped' ? this.progress(room, playback.revealed) : undefined,
        guestAccess, joinUrl, displayUrl: online ? online.displayUrl : joinUrl ? `${guestUrl}/display` : undefined };
    }
    if (role.kind === 'display') {
      const revealed = Boolean(room.playback?.revealed && !this.concealPlayback && this.ready);
      const track = room.playback ? structuredClone(room.playback.track) : undefined;
      if (track && room.playback) {
        delete track.artworkIdentity; delete track.artistArtworkIdentity;
        for (const kind of ['artwork', 'artistArtwork'] as const) if (track[kind]?.startsWith(artworkPath)) track[kind] = `/api/display/artwork/${room.playback.id}/${kind}`;
      }
      const streamInfo = room.playback && this.ready && !this.concealPlayback && (base.playbackStatus === 'playing' || base.playbackStatus === 'paused')
        ? this.adapter.streamInfo?.(room.playback.id) : undefined;
      return { ...base, guestAccess, joinUrl, progress: this.progress(room, revealed), streamInfo, nowPlaying: revealed && track
        ? { revealed: true, track } : { revealed: false } };
    }
    const me = this.participant(role.credential, room); const myTurn = room.currentId === me.id;
    const seat = room.active.indexOf(me.id); const currentSeat = room.active.indexOf(room.currentId ?? '');
    return { ...base, me: { id: me.id, nickname: me.nickname }, myTurn, catalogue: this.catalogueState, secretPlayback: room.secretPlayback?.enabled !== false,
      ...(this.userForSession ? { user: this.userForSession(role.credential) } : {}),
      position: { seat: seat + 1, total: room.active.length, turnsUntil: (seat - currentSeat + room.active.length) % room.active.length },
      ...(myTurn ? { ownPlayback: structuredClone(room.playback), progress: this.progress(room, true), volume: this.adapter.volume } : {}) };
  }
  private playbackStatus(room: Room): NonNullable<View['playbackStatus']> {
    return !this.playbackAvailable || this.concealPlayback && Boolean(room.playback) ? 'unavailable' : room.playback?.status === 'playing' ? 'playing' : room.playback?.status === 'paused' ? 'paused' : 'idle';
  }
  private progress(room: Room, times: boolean): PlaybackProgress | undefined {
    const playback = room.playback; if (!playback || !this.ready || this.concealPlayback) return;
    const sample = this.adapter.progress?.(playback.id); const duration = sample?.duration || playback.track.duration;
    const fraction = sample && duration > 0 ? Math.round(Math.max(0, Math.min(1, sample.elapsed / duration)) * 1000) / 1000 : null;
    return { id: playback.id, status: playback.status, fraction,
      ...(this.autoRevealOn(room) && !playback.revealed && playback.status !== 'stopped' && Number.isFinite(duration) && duration > 0 && sample && Number.isFinite(sample.elapsed) ? { autoRevealAt: AUTO_REVEAL_FRACTION } : {}),
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
    const reference = artworkReference(room.playback.track[kind]);
    if (!reference) throw new AppError(404, 'Artwork unavailable.');
    return { reference, context: `${room.id}:${room.currentId}` };
  }
  /** Backend-only input for encrypted prefetch; never exposes clear images early. */
  displayArtworkTarget() {
    const room = this.state.room; const playback = room?.playback;
    if (!room || !this.ready || this.concealPlayback || !playback || playback.status === 'stopped') return;
    const references: Partial<Record<'artwork' | 'artistArtwork', string>> = {};
    for (const kind of ['artwork', 'artistArtwork'] as const) {
      const reference = artworkReference(playback.track[kind]);
      if (reference) references[kind] = reference;
    }
    return { playbackId: playback.id, context: `${room.id}:${room.currentId}`, references };
  }
  async setVolume(level: number, turnId: string | null, credential?: string, playbackId?: string, volumeRevision?: string) {
    return operation('volume', () => this.audio(async () => {
      await this.inspect(() => {
        if (!Number.isInteger(level) || level < 0 || level > 100) throw new AppError(400, 'Choose a volume from 0 to 100.');
        if ((this.state.room?.turnId ?? null) !== turnId) throw new AppError(409, 'The turn changed. Review the current volume.');
        if (volumeRevision !== undefined && volumeRevision !== this.adapter.volume?.revision) throw new AppError(409, 'The volume destination changed. Refresh before trying again.');
        if (credential !== undefined) {
          const room = this.room(); this.current(credential, turnId!, room); this.expectedPlayback(room, playbackId ?? null);
          if (!room.playback || room.playback.status === 'stopped') throw new AppError(409, 'Play a track before changing volume.');
        }
        if (!this.adapter.setVolume || !this.adapter.volume?.available) throw new AppError(422, 'Volume control is unavailable for this destination.');
      });
      await this.adapter.setVolume!(level, credential !== undefined ? playbackId : undefined); this.emit('change');
    }));
  }
  async join(nickname: string, existingCredential?: string): Promise<string> {
    return this.transaction(async state => {
      const room = this.room(state);
      if (existingCredential && room.participants.some(p => p.credentialHash === hash(existingCredential))) return existingCredential;
      const name = nickname.trim();
      if (!name || name.length > 40 || /[\x00-\x1f\x7f]/.test(name)) throw new AppError(400, 'Enter a display name of 1–40 characters without control characters.');
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
    return operation('finish', () => this.audio(async () => {
      const check = (room: Room) => {
        if (credential !== undefined) this.current(credential, turnId, room);
        if (room.turnId !== turnId) throw new AppError(409, 'The turn changed. Refresh your view and try again.');
        if (!room.currentId) throw new AppError(409, 'No participants have joined yet.');
      };
      await this.inspect(check);
      await this.adapter.control('stop');
      await this.transaction(async state => { const room = this.room(state); check(room); this.rotate(room); });
    }));
  }
  async remove(id: string, revision: number): Promise<void> {
    const remove = (room: Room) => {
      room.active = room.active.filter(p => p !== id); room.participants = room.participants.filter(p => p.id !== id);
    };
    return operation('remove', () => this.room().currentId !== id ? this.transaction(async state => {
      const room = this.room(state); this.expected(room, revision);
      if (!room.participants.some(p => p.id === id)) throw new AppError(404, 'Participant not found.');
      if (room.currentId === id) throw new AppError(409, 'The current participant changed. Review the listening order.');
      remove(room);
    }) : this.audio(async () => {
      const turnId = await this.inspect(room => {
        this.expected(room, revision);
        if (room.currentId !== id) throw new AppError(409, 'The current participant changed. Review the listening order.');
        return room.turnId;
      });
      await this.adapter.control('stop');
      await this.transaction(async state => {
        const room = this.room(state);
        if (room.turnId !== turnId || room.currentId !== id) throw new AppError(409, 'The turn changed. Review the listening order.');
        this.rotate(room); if (room.currentId === id) room.currentId = null; remove(room);
      });
    }));
  }
  /** User access is revoked first; fence any join already committing before removing its seat.
   * Only removing the current seat needs playback connectivity (to stop its song). */
  async removeUser(userId: string) {
    const seat = await this.serial(async () => {
      const room = this.room(); return { person: room.participants.find(person => person.userId === userId), revision: room.revision };
    });
    if (seat.person) await this.remove(seat.person.id, seat.revision);
  }
  async search(credential: string, _turnId: string, query: string): Promise<CatalogueSearch> {
    if (!this.storageHealthy) throw new AppError(503, 'Room storage is unavailable.');
    const room = this.room(); const participant = this.participant(credential, room); const context = `${room.id}:${participant.id}`;
    const catalogue = this.catalogueState;
    const tracks = catalogue.source === 'music-assistant' ? await this.catalogue!.search(query, context)
      : (await this.adapter.search(query)).map(t => ({ id: t.id, title: t.title, artist: t.artist, album: t.album,
        duration: t.duration, version: '', provider: 'Demo', available: true, artwork: t.artwork, artistArtwork: t.artistArtwork }));
    const latest = this.room(); const member = this.participant(credential, latest);
    if (`${latest.id}:${member.id}` !== context) throw new AppError(401, 'Room membership changed. Join again.');
    const currentCatalogue = this.catalogueState;
    if (catalogue.source !== currentCatalogue.source || catalogue.revision !== currentCatalogue.revision) throw new AppError(409, 'The catalogue connection changed. Search again.');
    return { ...currentCatalogue, tracks };
  }
  async browse(credential: string, kind: 'artists' | 'albums' | 'tracks', value: string): Promise<CatalogueBrowse> {
    if (!this.storageHealthy) throw new AppError(503, 'Room storage is unavailable.');
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
    await operation('play', () => this.playSelection({ kind: 'participant', credential }, turnId, previousPlaybackId, context => this.adapter.resolve(trackId, context)));
  }
  async playPrepared(credential: string, turnId: string, previousPlaybackId: string | null, selection: SavedSelection, entryId: string): Promise<string> {
    if (!this.adapter.resolveSaved) throw new AppError(422, 'Saved-track playback is unavailable.');
    return operation('prepared-play', () => this.playSelection({ kind: 'participant', credential }, turnId, previousPlaybackId, context => this.adapter.resolveSaved!(selection, context, `prepared:${entryId}`)));
  }
  /** Automatic play: the first saved song of the person whose turn began when a song ended. The same
   * checks as Play run inside the audio lane. Returns null when no audio command was sent, so the
   * saved song can stay first in their list; a failure after that keeps the usual review. */
  async autoplay(target: AutoplayTarget, selection: SavedSelection, entryId: string): Promise<string | null> {
    if (!this.adapter.resolveSaved) return null;
    const attempt = { audio: false };
    try {
      return await operation('autoplay', () => this.playSelection({ kind: 'autoplay', target }, target.turnId, null,
        context => this.adapter.resolveSaved!(selection, context, `prepared:${entryId}`), attempt));
    } catch (error) { if (attempt.audio) throw error; return null; }
  }
  private async playSelection(actor: PlayActor, turnId: string, previousPlaybackId: string | null, resolve: (context: string) => Promise<Track>, attempt?: { audio: boolean }): Promise<string> {
    return this.audio(async () => {
      const member = (room: Room) => actor.kind === 'participant' ? this.participant(actor.credential, room).id : actor.target.participantId;
      const check = (room: Room) => {
        if (actor.kind === 'participant') this.current(actor.credential, turnId, room);
        else if (!this.autoplayAllowed(room, actor.target)) throw new AppError(409, 'The turn or the automatic play setting changed.');
        this.expectedPlayback(room, previousPlaybackId);
      };
      const context = await this.inspect(room => {
        check(room);
        if (this.catalogue?.configured && !this.catalogue.playbackAvailable) {
          if (this.catalogue.output?.name) throw new AppError(409, 'The selected speaker is not ready. Check its status in host settings and try again.');
          throw new AppError(422, 'Choose a speaker or group in Settings before playing.');
        }
        return `${room.id}:${member(room)}`;
      });
      const track = await stage('resolve', () => playbackResolution(() => resolve(context))); const id = randomUUID();
      const concealed = this.concealPlayback; const epoch = this.invalidationEpoch;
      try {
        await this.inspect(room => {
          check(room);
          if (`${room.id}:${member(room)}` !== context) throw new AppError(409, 'Room membership changed during lookup.');
          this.startingPlayback = { id, previousId: previousPlaybackId, turnId }; this.concealPlayback = true; this.emit('change');
        });
      } catch (error) { this.adapter.discardSelection?.(track); throw error; }
      let started = false;
      try {
        if (attempt) attempt.audio = true;
        await this.adapter.play(track, id); started = true;
        await this.transaction(async state => {
          const room = this.room(state); check(room);
          if (epoch !== this.invalidationEpoch) throw new AppError(409, 'Playback changed while the track was starting.');
          room.playback = { id, turnId, track, status: 'playing', revealed: room.secretPlayback?.enabled === false };
        }, true);
      }
      catch (error) {
        if (started) await this.adapter.control('stop').catch(() => {});
        // Rejected preflight leaves the old playback intact. An ownership invalidation
        // or uncertain adapter must keep it concealed, even if the replacement failed.
        if (epoch === this.invalidationEpoch && this.ready) { this.concealPlayback = concealed; this.emit('change'); }
        throw error;
      } finally { this.startingPlayback = undefined; }
      this.concealPlayback = false; this.emit('change'); return id;
    });
  }
  async control(credential: string, turnId: string, playbackId: string, action: 'pause' | 'resume' | 'stop'): Promise<void> {
    return this.controlPlayback({ kind: 'participant', credential }, turnId, playbackId, action);
  }
  async stopForHost(turnId: string, playbackId: string): Promise<void> {
    return this.controlPlayback({ kind: 'host' }, turnId, playbackId, 'stop');
  }
  /** Speaker routing shares the audio lane, not the room persistence lane during network I/O. */
  async changeSpeaker<T>(playbackId: string | null, work: () => Promise<T>): Promise<T> {
    return this.audio(async () => {
      await this.inspect(room => {
        if (!this.live || this.concealPlayback) throw new AppError(409, 'Playback cannot be confirmed. Review its status before changing speakers.');
        const current = room.playback && room.playback.status !== 'stopped' ? room.playback.id : null;
        if (current !== playbackId) throw new AppError(409, 'The current song changed. Review playback before changing speakers.');
      });
      return work();
    });
  }
  async controlForHost(turnId: string, playbackId: string, action: 'pause' | 'resume'): Promise<void> {
    return this.controlPlayback({ kind: 'host' }, turnId, playbackId, action);
  }
  private async controlPlayback(actor: Exclude<Role, { kind: 'display' }>, turnId: string, playbackId: string, action: 'pause' | 'resume' | 'stop'): Promise<void> {
    return operation(action, () => this.audio(async () => {
      const check = (room: Room) => {
        if (actor.kind === 'participant') this.current(actor.credential, turnId, room);
        else {
          if (room.turnId !== turnId) throw new AppError(409, 'The turn changed. Review the current participant.');
          if (this.concealPlayback) throw new AppError(409, 'Playback cannot be confirmed. Review its status before controlling it.');
        }
        this.expectedPlayback(room, playbackId);
        if (!room.playback || (action !== 'stop' && room.playback.status === 'stopped')) throw new AppError(409, 'Select and play a track first.');
      };
      const alreadyStopped = await this.inspect(room => { check(room); return room.playback!.status === 'stopped'; });
      if (actor.kind === 'host' && alreadyStopped) return;
      await this.adapter.control(action); this.controlEpoch++;
      await this.transaction(async state => {
        const room = this.room(state); check(room);
        room.playback!.status = action === 'pause' ? 'paused' : action === 'resume' ? 'playing' : 'stopped';
      });
    }));
  }
  async reveal(credential: string, turnId: string, playbackId: string): Promise<void> {
    return this.transaction(async state => {
      const room = this.room(state); this.current(credential, turnId, room); this.expectedPlayback(room, playbackId);
      if (!room.playback) throw new AppError(409, 'Play a track before revealing.');
      room.playback.revealed = true;
    }, true);
  }
  async complete(playbackId: string): Promise<void> {
    // No-op for stale, duplicated, paused, stopped, or recovered completion events.
    const next = await this.audio(async () => {
      const eligible = () => {
        const room = this.state.room;
        return this.ready && room && room.playback?.id === playbackId && room.playback.turnId === room.turnId && room.playback.status === 'playing';
      };
      if (!await this.serial(async () => eligible())) return;
      await this.adapter.control('stop');
      return this.serial(async () => {
        if (!eligible()) return;
        const state = structuredClone(this.state); this.rotate(state.room!); state.room!.revision++;
        // The song was already stopped above.
        if (!await this.commit(state, { stopOnFailure: false })) throw new AppError(503, 'Completion state could not be saved.');
        return this.autoplayTarget(state.room!);
      });
    });
    // Only a natural ending passes the turn this way; Finish, Skip and Pass never start the next song.
    if (next) this.startAutoplay(next);
  }
}
