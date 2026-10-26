import { createHash } from 'node:crypto';
import { open } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { AppError } from './model.js';
import type { PreparationManager } from './preparations.js';
import { writePrivateJson } from './store.js';

const bindingSchema = z.object({ schema: z.literal(1), ownerId: z.string().uuid() }).strict();

/** One durable private association per authenticated browser participant.
 * No names, user-selectable IDs, recovery keys, or raw credentials are stored. */
export class PreparationIdentity {
  private pending = new Map<string, Promise<Awaited<ReturnType<PreparationManager['bindParticipant']>>>>();
  constructor(private manager: PreparationManager, private directory: string) {}

  ensure(member: string, previous: string) {
    const key = createHash('sha256').update(member).digest('hex');
    const existing = this.pending.get(key); if (existing) return existing;
    const work = this.resolve(key, member, previous); this.pending.set(key, work);
    const done = () => { if (this.pending.get(key) === work) this.pending.delete(key); };
    void work.then(done, done); return work;
  }

  private async resolve(key: string, member: string, previous: string) {
    const directory = join(this.directory, 'preparations', 'bindings');
    const filename = `${key}.json`;
    let ownerId: string | undefined;
    try {
      const file = await open(join(directory, filename), 'r');
      try {
        if ((await file.stat()).size > 512) throw new Error('Oversized binding.');
        ownerId = bindingSchema.parse(JSON.parse(await file.readFile('utf8'))).ownerId;
      } finally { await file.close(); }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new AppError(503, 'Your selections could not be loaded. Nothing was reset.');
    }
    const secret = createHash('sha256').update(`aoty-selections:${member}`).digest('base64url');
    if (ownerId) return this.manager.bindParticipant(ownerId, `${ownerId}.${secret}`);

    // Adopt only a list proved by its existing private cookie, never by nickname.
    if (previous) ownerId = await this.manager.ownerForBinding(previous);
    if (!ownerId) {
      const bytes = createHash('sha256').update(`aoty-selections-owner:${member}`).digest().subarray(0, 16);
      bytes[6] = (bytes[6]! & 15) | 64; bytes[8] = (bytes[8]! & 63) | 128;
      const hex = bytes.toString('hex'); ownerId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
      // Deterministic creation makes retries safe even if the binding write fails.
      await this.manager.bindParticipant(ownerId, `${ownerId}.${secret}`, true);
    }
    await writePrivateJson(directory, filename, { schema: 1, ownerId });
    return this.manager.bindParticipant(ownerId, `${ownerId}.${secret}`);
  }
}
