import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { stateSchema, type State } from './model.js';
import { durability } from './backup.js';
import { stage } from './operation.js';

export class PersistenceError extends Error {
  constructor(readonly outcome: 'not-committed' | 'uncertain') { super('Persistent save could not be confirmed.'); }
}

export interface Store { load(): Promise<State>; save(state: State): Promise<void> }

/** Single-process store. Each commit is an atomic, fsynced replacement, never a partial JSON write. */
export class FileStore implements Store {
  constructor(private directory: string) {}
  async load(): Promise<State> {
    try {
      const value = JSON.parse(await readFile(join(this.directory, 'state.json'), 'utf8'));
      // Development-only lifecycle replacement: discard old event state, not private libraries or settings.
      if (value?.schema === 1 || value?.schema === 2) return { schema: 3, room: null };
      return stateSchema.parse(value);
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { schema: 3, room: null };
      throw new Error('Persistent state could not be loaded. Check the data directory; it was not overwritten.');
    }
  }
  async save(state: State): Promise<void> {
    await writePrivateJson(this.directory, 'state.json', stateSchema.parse(state));
  }
}

/** Shared atomic persistence for application-owned files, including integration secrets. */
export async function writePrivateJson(directory: string, filename: string, data: unknown, maxBytes = Infinity): Promise<void> {
  try { return await stage('persistence', () => durability.run(() => commitPrivateJson(directory, filename, data, maxBytes))); }
  catch (error) { throw error instanceof PersistenceError ? error : new PersistenceError('not-committed'); }
}
async function commitPrivateJson(directory: string, filename: string, data: unknown, maxBytes: number): Promise<void> {
  const json = JSON.stringify(data);
  if (Buffer.byteLength(json) > maxBytes) throw new Error('Persistent record exceeds its readable size limit.');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporary = join(directory, `.${filename}-${randomUUID()}.tmp`);
  const handle = await open(temporary, 'wx', 0o600);
  try {
    try {
      await handle.writeFile(json);
      await handle.sync();
    } finally { await handle.close(); }
    await rename(temporary, join(directory, filename));
    try {
      const directoryHandle = await open(directory, 'r');
      try { await directoryHandle.sync(); } finally { await directoryHandle.close(); }
    } catch { throw new PersistenceError('uncertain'); }
  } finally { await unlink(temporary).catch(() => {}); }
}
