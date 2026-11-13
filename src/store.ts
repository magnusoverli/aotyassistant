import { mkdir, open, readdir, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { BigIntStats } from 'node:fs';
import type { z } from 'zod';
import { stateSchema, type State } from './model.js';
import { durability } from './backup.js';
import { stage } from './operation.js';

export class PersistenceError extends Error {
  constructor(readonly outcome: 'not-committed' | 'uncertain') { super('Persistent save could not be confirmed.'); }
}

export interface Store { load(): Promise<State>; save(state: State): Promise<void> }

const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT';

/** Bounded, validated read of one application-owned JSON file. Only a missing file returns
 * undefined; oversized, unreadable or invalid records throw and are never replaced. */
export async function readPrivateJson<T extends z.ZodTypeAny>(path: string, schema: T, maxBytes: number): Promise<z.infer<T> | undefined> {
  let file;
  try { file = await open(path, 'r'); }
  catch (error) { if (missing(error)) return undefined; throw error; }
  try {
    if ((await file.stat()).size > maxBytes) throw new Error('Persistent record exceeds its readable size limit.');
    return schema.parse(JSON.parse(await file.readFile('utf8')));
  } finally { await file.close(); }
}

/** fsync a directory so completed renames/deletions survive power loss. */
export async function syncDirectory(path: string, allowMissing = false): Promise<void> {
  const handle = await open(path, 'r').catch(error => { if (allowMissing && missing(error)) return undefined; throw error; });
  if (handle) { try { await handle.sync(); } finally { await handle.close(); } }
}

/** Directory entries, treating a directory that was never created as empty. */
export async function listDirectory(path: string): Promise<string[]> {
  return readdir(path).catch(error => { if (missing(error)) return []; throw error; });
}

/** Single-process store. Each commit is an atomic, fsynced replacement, never a partial JSON write. */
export class FileStore implements Store {
  constructor(private directory: string) {}
  async load(): Promise<State> {
    let state: State | undefined;
    try { state = await readPrivateJson(join(this.directory, 'state.json'), stateSchema, 8 * 1024 * 1024); }
    catch { throw new Error('Persistent state could not be loaded. Check the data directory; it was not overwritten.'); }
    return state ?? { schema: 3, room: null };
  }
  async save(state: State): Promise<void> {
    await writePrivateJson(this.directory, 'state.json', stateSchema.parse(state));
  }
}

/** Metadata identity includes nanosecond change time, not just length/modification time. */
export const fileStamp = (info: BigIntStats) => `${info.dev}:${info.ino}:${info.size}:${info.mtimeNs}:${info.ctimeNs}`;

/** Atomic persistence; optionally return the committed descriptor's identity for a validated cache. */
export async function writePrivateJson(directory: string, filename: string, data: unknown, maxBytes = Infinity, snapshot = false): Promise<BigIntStats | undefined> {
  try { return await stage('persistence', () => durability.run(() => commitPrivateJson(directory, filename, data, maxBytes, snapshot))); }
  catch (error) { throw error instanceof PersistenceError ? error : new PersistenceError('not-committed'); }
}
/** Idempotent deletion with the same backup and durability guarantees as JSON commits. */
export async function removePrivateFile(directory: string, filename: string): Promise<void> {
  await durability.run(async () => {
    await unlink(join(directory, filename)).catch(error => { if (!missing(error)) throw error; });
    await syncDirectory(directory, true);
  });
}
async function commitPrivateJson(directory: string, filename: string, data: unknown, maxBytes: number, snapshot: boolean): Promise<BigIntStats | undefined> {
  const json = JSON.stringify(data);
  if (Buffer.byteLength(json) > maxBytes) throw new Error('Persistent record exceeds its readable size limit.');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporary = join(directory, `.${filename}-${randomUUID()}.tmp`);
  const handle = await open(temporary, 'wx', 0o600);
  let renamed = false;
  try {
    await handle.writeFile(json);
    await handle.sync();
    const before = snapshot ? await handle.stat({ bigint: true }).catch(() => undefined) : undefined;
    await rename(temporary, join(directory, filename));
    renamed = true;
    await syncDirectory(directory).catch(() => { throw new PersistenceError('uncertain'); });
    // Read identity from the descriptor we wrote, never from a pathname that could
    // now name a replacement. Cache failure must not turn a durable save into failure.
    const after = before ? await handle.stat({ bigint: true }).catch(() => undefined) : undefined;
    if (before && after && after.nlink > 0n && before.dev === after.dev && before.ino === after.ino &&
      before.size === after.size && before.mtimeNs === after.mtimeNs) return after;
  } finally {
    try { await handle.close().catch(error => { throw renamed ? new PersistenceError('uncertain') : error; }); }
    finally { await unlink(temporary).catch(() => {}); }
  }
}
