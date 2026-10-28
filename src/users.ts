import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { AppError, type UserDirectory, type UserProfile } from './model.js';
import type { Engine } from './engine.js';
import { PreparationManager, PreparationFileStore } from './preparations.js';
import { PreparationIdentity } from './preparation-identity.js';
import { SerialQueue } from './serial.js';
import { writePrivateJson, removePrivateFile } from './store.js';
import { maOperation, maRemaining } from './ma-operation.js';

const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const uuid = z.string().uuid();
export const pinSchema = z.string().regex(/^[0-9]{4}$/, 'Enter a four-digit PIN.');
const pinRecord = z.object({ algorithm: z.literal('scrypt-v1'), salt: z.string().regex(/^[a-f0-9]{32}$/), hash });
const userSchema = z.object({ id: uuid, nickname: z.string().min(1).max(40), ownerId: uuid.optional(), listPending: z.boolean().optional(),
  deleting: z.boolean().optional(),
  pin: pinRecord.nullable(), version: z.number().int().nonnegative(), registration: uuid.optional(),
  sessions: z.array(z.object({ hash, preparationHash: hash.optional(), expires: z.number() })).max(100),
  legacyListHashes: z.array(hash).max(1024), failures: z.number().int().nonnegative(), blockedUntil: z.number(),
});
const schema = z.object({ schema: z.literal(1), users: z.array(userSchema).max(1000),
  deleted: z.array(z.object({ id: uuid, ownerId: uuid.optional(), registration: uuid.optional() }).strict()).default([]),
}).strict().refine(state =>
  new Set(state.users.map(user => user.id)).size === state.users.length &&
  new Set(state.users.flatMap(user => user.ownerId ? [user.ownerId] : [])).size === state.users.filter(user => user.ownerId).length &&
  new Set(state.users.flatMap(user => user.sessions.map(session => session.hash))).size === state.users.reduce((sum, user) => sum + user.sessions.length, 0), 'Duplicate user identity.');
type User = z.infer<typeof userSchema>;
const lifetime = 365 * 24 * 60 * 60_000;
const profile = (user: User): UserProfile => ({ id: user.id, nickname: user.nickname, pinRequired: !user.pin });
const preparationCredential = (ownerId: string, session: string) => `${ownerId}.${createHash('sha256').update(`aoty-selections:${session}`).digest('base64url')}`;

/** Stable users and independently revocable browser sessions. PIN work never occupies the audio lane. */
export class UserManager {
  private state: z.infer<typeof schema> = { schema: 1, users: [], deleted: [] };
  private queue = new SerialQueue();
  private hashes = 0;
  private hashWaiters: (() => void)[] = [];
  private pending = new Set<Promise<unknown>>();
  private healthy = true;
  private legacy: PreparationIdentity;
  readonly ready: Promise<void>;
  constructor(private directory: string, private preparations: PreparationManager, private engine: Engine, private now = Date.now) {
    this.legacy = new PreparationIdentity(preparations, directory);
    this.ready = this.load(); void this.ready.catch(() => {});
    engine.attachUsers(token => this.current(token));
    preparations.setCredentialPolicy((ownerId, hash) => this.listCredentialAllowed(ownerId, hash));
  }
  private async load() {
    try {
      const path = join(this.directory, 'users.json');
      if ((await stat(path)).size > 8 * 1024 * 1024) throw Error();
      this.state = schema.parse(JSON.parse(await readFile(path, 'utf8')));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') { this.healthy = false; throw new AppError(503, 'User profiles could not be loaded. Nothing was reset.'); }
    }
  }
  private session(token: string) {
    if (!this.healthy || !/^[A-Za-z0-9_-]{43}$/.test(token)) return undefined;
    const key = digest(token);
    return this.state.users.find(user => !user.deleting && user.sessions.some(session => session.hash === key && session.expires > this.now()));
  }
  current(token: string) { const user = this.session(token); return user && profile(user); }
  directoryView(token = '', host = false): UserDirectory {
    this.check(); return { users: this.state.users.filter(user => host || !user.deleting).map(user => ({ ...profile(user), ...(user.deleting ? { deletionPending: true } : {}) })), current: this.current(token) ?? null };
  }
  ownerAvailable(ownerId: string) { return this.healthy && !this.state.deleted.some(user => user.ownerId === ownerId) && !this.state.users.some(user => user.ownerId === ownerId && user.deleting); }
  private check() { if (!this.healthy) throw new AppError(503, 'User storage is unavailable. Restart after checking the data directory.'); }
  private work<T>(action: string, work: () => Promise<T>): Promise<T> {
    const result = maOperation(action, work); this.pending.add(result);
    void result.then(() => this.pending.delete(result), () => this.pending.delete(result)); return result;
  }
  register(nickname: string, pin: string, registration?: string, previous = '') {
    return this.work('user-registration', () => this.registerUser(nickname, pin, registration, previous));
  }
  login(id: string, pin: string) { return this.work('user-login', () => this.loginUser(id, pin)); }
  ensureList(token: string, previous: string) { return this.work('user-playlist', () => this.ensureUserList(token, previous)); }
  setPin(id: string, pin: string, token?: string) { return this.work('user-pin', () => this.setUserPin(id, pin, token)); }
  logout(token: string) { return this.work('user-logout', () => this.logoutUser(token)); }
  migrate() { return this.work('user-migration', () => this.migrateUsers()); }
  deleteUser(id: string, removeUploads: (ownerId: string) => Promise<void>) { return this.work('user-delete', () => this.deleteUserData(id, removeUploads)); }
  private async save(state: typeof this.state) {
    this.check();
    try { await writePrivateJson(this.directory, 'users.json', schema.parse(state), 8 * 1024 * 1024); this.state = state; }
    catch { this.healthy = false; this.engine.emit('change'); throw new AppError(503, 'The user change could not be confirmed. Restart after checking the data directory.'); }
  }
  private listCredentialAllowed(ownerId: string, hash: string) {
    if (!this.ownerAvailable(ownerId)) return false;
    const user = this.state.users.find(user => user.ownerId === ownerId);
    return !user || (!user.pin && user.legacyListHashes.includes(hash)) || user.sessions.some(session => session.expires > this.now() && session.preparationHash === hash);
  }
  /** Upgrade persisted membership by its private binding, never by display name. Idempotent after a crash. */
  private async migrateUsers() {
    await this.ready;
    if (!this.engine.identityParticipants().some(person => !person.userId)) return;
    await this.queue.run(async () => {
      this.check(); const state = structuredClone(this.state); const links: { participantId: string; userId: string }[] = [];
      for (const person of this.engine.identityParticipants().filter(person => !person.userId)) {
        let user = state.users.find(user => user.id === person.id);
        if (!user) {
          let ownerId: string | undefined;
          try {
            const path = join(this.directory, 'preparations', 'bindings', `${person.credentialHash}.json`);
            if ((await stat(path)).size > 512) throw Error();
            ownerId = z.object({ schema: z.literal(1), ownerId: uuid }).strict().parse(JSON.parse(await readFile(path, 'utf8'))).ownerId;
          } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new AppError(503, 'Existing user binding could not be loaded. Nothing was reset.'); }
          if (this.state.deleted.some(user => user.id === person.id || ownerId && user.ownerId === ownerId)) throw new AppError(409, 'This legacy participant belongs to a deleted user. Remove their listening-order seat.');
          user = ownerId ? state.users.find(user => user.ownerId === ownerId) : undefined;
          if (!user) {
            const list = ownerId ? await new PreparationFileStore(this.directory).load(ownerId) : null;
            if (ownerId && !list) throw new AppError(503, 'An existing playlist is missing. Restore its data before continuing.');
            user = { id: person.id, nickname: person.nickname, ownerId, pin: null, version: 0,
              sessions: [{ hash: person.credentialHash, expires: this.now() + lifetime }],
              legacyListHashes: list?.credentials.map(item => item.hash) ?? [], failures: 0, blockedUntil: 0 };
            state.users.push(user);
          } else if (!user.pin && !user.sessions.some(session => session.hash === person.credentialHash)) {
            user.sessions.push({ hash: person.credentialHash, expires: this.now() + lifetime });
          }
        }
        links.push({ participantId: person.id, userId: user.id });
      }
      if (links.length) { await this.save(state); await this.engine.linkUsers(links); }
    });
  }
  private async derive(pin: string, salt: string): Promise<Buffer> {
    pinSchema.parse(pin);
    if (this.hashes >= 2) {
      if (this.hashWaiters.length >= 12) throw new AppError(503, 'Sign-in is busy. Try again in a moment.');
      await new Promise<void>(resolve => this.hashWaiters.push(resolve));
    } else this.hashes++;
    try {
      maRemaining(Infinity);
      return await new Promise<Buffer>((resolve, reject) => scrypt(pin, Buffer.from(salt, 'hex'), 32,
        { N: 16384, r: 8, p: 5, maxmem: 32 * 1024 * 1024 }, (error, key) => error ? reject(error) : resolve(key)));
    } finally { const next = this.hashWaiters.shift(); if (next) next(); else this.hashes--; }
  }
  private async makePin(pin: string): Promise<z.infer<typeof pinRecord>> {
    const salt = randomBytes(16).toString('hex'); return { algorithm: 'scrypt-v1', salt, hash: (await this.derive(pin, salt)).toString('hex') };
  }
  private addSession(user: User) {
    const token = randomBytes(32).toString('base64url');
    user.sessions = user.sessions.filter(session => session.expires > this.now()).slice(-99);
    user.sessions.push({ hash: digest(token), expires: this.now() + lifetime,
      ...(user.ownerId ? { preparationHash: digest(preparationCredential(user.ownerId, token)) } : {}) });
    return token;
  }
  private async registerUser(nickname: string, pin: string, registration?: string, previous = '') {
    await this.ready;
    if (this.state.deleted.some(user => user.registration && user.registration === registration)) throw new AppError(401, 'This user was deleted. Start a new user registration.');
    // A fresh registration may reuse any display name. A deleted browser's old list
    // cookie is neither an adoption candidate nor a reason to block a new identity.
    if (previous && !this.ownerAvailable(previous.split('.')[0]!)) previous = '';
    const name = z.string().trim().min(1).max(40).regex(/^[^\x00-\x1f\x7f]+$/).parse(nickname);
    const previousOwner = previous ? await this.preparations.ownerForBinding(previous) : undefined;
    const previousUser = previousOwner && this.state.users.find(user => user.ownerId === previousOwner);
    if (previousUser) {
      if (!previousUser.pin) await this.setUserPin(previousUser.id, pin, undefined, { hash: digest(previous), version: previousUser.version });
      return this.login(previousUser.id, pin);
    }
    if (registration) {
      uuid.parse(registration);
      const existing = this.state.users.find(user => user.registration === registration);
      if (existing) {
        if (existing.nickname !== name) throw new AppError(409, 'This registration was already used. Refresh before creating another user.');
        return this.login(existing.id, pin);
      }
    }
    const verifier = await this.makePin(pin);
    return this.queue.run(async () => {
      this.check(); const state = structuredClone(this.state);
      if (registration && (state.users.some(user => user.registration === registration) || state.deleted.some(user => user.registration === registration))) throw new AppError(409, 'Registration already completed. Select your name or start a new registration.');
      if (previousOwner && !this.ownerAvailable(previousOwner)) throw new AppError(401, 'This user was deleted. Start a new user registration.');
      if (state.users.length >= 1000) throw new AppError(409, 'The user directory is full.');
      if (previousOwner && state.users.some(user => user.ownerId === previousOwner)) throw new AppError(409, 'This user was already restored. Select your name and enter your PIN.');
      const id = randomUUID(); const ownerId = previousOwner ?? randomUUID();
      const user: User = { id, ownerId, listPending: !previousOwner, nickname: name, pin: verifier, version: 1, registration,
        sessions: [], legacyListHashes: [], failures: 0, blockedUntil: 0 };
      const token = this.addSession(user); state.users.push(user); await this.save(state);
      await this.preparations.bindParticipant(ownerId, preparationCredential(ownerId, token), !previousOwner);
      const completed = structuredClone(this.state); completed.users.find(user => user.id === id)!.listPending = false; await this.save(completed);
      return { user: profile(user), token };
    });
  }
  private async loginUser(id: string, pin: string) {
    await this.ready; this.check(); uuid.parse(id); pinSchema.parse(pin);
    const snapshot = this.state.users.find(user => user.id === id);
    if (!snapshot?.pin || snapshot.deleting) throw new AppError(401, 'This user needs to choose a PIN on their remembered device, or ask the host to set one.');
    if (snapshot.blockedUntil > this.now()) throw new AppError(429, 'Too many incorrect PINs. Wait a minute and try again.');
    const matches = timingSafeEqual(await this.derive(pin, snapshot.pin.salt), Buffer.from(snapshot.pin.hash, 'hex'));
    return this.queue.run(async () => {
      const state = structuredClone(this.state); const user = state.users.find(user => user.id === id);
      if (!user || user.deleting) throw new AppError(401, 'This user is no longer available.');
      if (user.version !== snapshot.version) throw new AppError(409, 'The PIN changed. Enter the current PIN.');
      if (user.blockedUntil > this.now()) throw new AppError(429, 'Too many incorrect PINs. Wait a minute and try again.');
      if (!matches) {
        user.failures++;
        if (user.failures >= 5) user.blockedUntil = this.now() + Math.min(5, Math.floor(user.failures / 5)) * 60_000;
        await this.save(state); throw new AppError(401, 'Incorrect PIN. Try again.');
      }
      user.failures = 0; user.blockedUntil = 0;
      const token = this.addSession(user); await this.save(state); return { user: profile(user), token };
    });
  }
  private async ensureUserList(token: string, previous: string) {
    await this.ready;
    return this.queue.run(async () => {
      const current = this.session(token); if (!current) throw new AppError(401, 'Select your name and enter your PIN.');
      const state = structuredClone(this.state); const user = state.users.find(user => user.id === current.id)!;
      let credential: string;
      if (!user.ownerId) {
        const owner = await this.legacy.ensure(token, previous); user.ownerId = owner.view.ownerId; credential = owner.credential;
        if (state.users.some(other => other.id !== user.id && other.ownerId === user.ownerId)) throw new AppError(409, 'This playlist already belongs to an existing user. Select that user to continue.');
      } else credential = preparationCredential(user.ownerId, token);
      const session = user.sessions.find(session => session.hash === digest(token))!;
      if (session.preparationHash !== digest(credential) || current.ownerId !== user.ownerId) {
        session.preparationHash = digest(credential); await this.save(state);
      }
      const result = await this.preparations.bindParticipant(user.ownerId!, credential, user.listPending === true);
      if (user.listPending) { const completed = structuredClone(this.state); completed.users.find(item => item.id === user.id)!.listPending = false; await this.save(completed); }
      return result;
    });
  }
  private async setUserPin(id: string, pin: string, token?: string, legacy?: { hash: string; version: number }) {
    await this.ready; uuid.parse(id);
    const snapshot = this.state.users.find(user => user.id === id); if (!snapshot || snapshot.deleting) throw new AppError(404, 'User not found.');
    if (token && (this.session(token)?.id !== id || snapshot.pin)) throw new AppError(403, 'Ask the host to reset your PIN.');
    const verifier = await this.makePin(pin);
    await this.queue.run(async () => {
      const current = this.state.users.find(user => user.id === id);
      if (!current || current.deleting) throw new AppError(404, 'User not found.');
      const ownerId = current.ownerId;
      const apply = async () => {
        const state = structuredClone(this.state); const user = state.users.find(user => user.id === id)!;
        if (user.version !== snapshot.version || token && (this.session(token)?.id !== id || user.pin)) throw new AppError(409, 'User access changed. Refresh and try again.');
        if (legacy && (user.pin || user.version !== legacy.version || !user.ownerId || !this.listCredentialAllowed(user.ownerId, legacy.hash))) throw new AppError(401, 'Select your name and enter your current PIN.');
        user.pin = verifier; user.version++; user.failures = 0; user.blockedUntil = 0; user.legacyListHashes = [];
        user.sessions = token ? user.sessions.filter(session => session.hash === digest(token)) : [];
        await this.save(state);
      };
      if (ownerId) await this.preparations.withOwner(ownerId, apply); else await apply();
      this.engine.emit('change'); if (ownerId) await this.preparations.notifyIdentity(ownerId);
    });
  }
  private async logoutUser(token: string) {
    await this.ready;
    await this.queue.run(async () => {
      const current = this.session(token); if (!current) return;
      const apply = async () => {
        const state = structuredClone(this.state); const user = state.users.find(user => user.id === current.id)!;
        user.sessions = user.sessions.filter(session => session.hash !== digest(token));
        // Legacy aliases must not keep a switched-away user's private list accessible.
        if (!user.pin) user.legacyListHashes = [];
        await this.save(state);
      };
      if (current.ownerId) await this.preparations.withOwner(current.ownerId, apply); else await apply();
      this.engine.emit('change'); if (current.ownerId) await this.preparations.notifyIdentity(current.ownerId);
    });
  }
  private async deleteUserData(id: string, removeUploads: (ownerId: string) => Promise<void>) {
    await this.ready; uuid.parse(id);
    await this.queue.run(async () => {
      this.check(); const user = this.state.users.find(user => user.id === id);
      if (!user) { if (this.state.deleted.some(user => user.id === id)) return; throw new AppError(404, 'User not found.'); }
      const revoke = async () => {
        const state = structuredClone(this.state); const target = state.users.find(user => user.id === id)!;
        target.deleting = true; target.version++; target.pin = null; target.sessions = []; target.legacyListHashes = [];
        await this.save(state);
      };
      if (!user.deleting) { if (user.ownerId) await this.preparations.withOwner(user.ownerId, revoke); else await revoke(); }
      this.engine.emit('change');
      if (user.ownerId) await this.preparations.notifyIdentity(user.ownerId);
      // Each step is idempotent. A failed cleanup remains visible to the host for an explicit retry.
      await this.engine.removeUser(id);
      if (user.ownerId) {
        await removeUploads(user.ownerId);
        await this.preparations.deleteOwner(user.ownerId);
        const directory = join(this.directory, 'preparations', 'bindings');
        const names = await readdir(directory).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
        for (const name of names.filter(name => /^[a-f0-9]{64}\.json$/.test(name))) {
          const path = join(directory, name); if ((await stat(path)).size > 512) throw new AppError(503, 'A legacy user binding could not be read. Retry deletion after checking storage.');
          const binding = z.object({ schema: z.literal(1), ownerId: uuid }).strict().parse(JSON.parse(await readFile(path, 'utf8')));
          if (binding.ownerId === user.ownerId) await removePrivateFile(directory, name);
        }
      }
      const state = structuredClone(this.state); state.users = state.users.filter(user => user.id !== id);
      // Only opaque IDs remain, preventing old cookies, bindings or lost-response retries from restoring deleted data.
      state.deleted.push({ id, ownerId: user.ownerId, registration: user.registration }); await this.save(state);
    });
  }
  async drain() { await this.ready; while (this.pending.size) await Promise.allSettled([...this.pending]); await this.queue.drain(); }
}
