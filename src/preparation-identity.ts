import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { z } from 'zod';
import { AppError } from './model.js';
import type { PreparationManager } from './preparations.js';
import { readPrivateJson, writePrivateJson } from './store.js';

const bindingSchema = z.object({ schema: z.literal(1), ownerId: z.string().uuid() }).strict();
export const bindingDirectory = (dataDirectory: string) => join(dataDirectory, 'preparations', 'bindings');
/** A legacy participant binding's owner, keyed by the credential's SHA-256 hex digest. */
export async function readBinding(dataDirectory: string, key: string): Promise<string | undefined> {
  return (await readPrivateJson(join(bindingDirectory(dataDirectory), `${key}.json`), bindingSchema, 512))?.ownerId;
}
/** Private-list credential derived from a browser session; never stored or sent in clear. */
export const selectionCredential = (ownerId: string, session: string) =>
  `${ownerId}.${createHash('sha256').update(`doom-room-selections:${session}`).digest('base64url')}`;

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
    let ownerId: string | undefined;
    try { ownerId = await readBinding(this.directory, key); }
    catch { throw new AppError(503, 'Your selections could not be loaded. Nothing was reset.'); }
    if (ownerId) return this.manager.bindParticipant(ownerId, selectionCredential(ownerId, member));

    // Adopt only a list proved by its existing private cookie, never by nickname.
    if (previous) ownerId = await this.manager.ownerForBinding(previous);
    if (!ownerId) {
      const bytes = createHash('sha256').update(`doom-room-selections-owner:${member}`).digest().subarray(0, 16);
      bytes[6] = (bytes[6]! & 15) | 64; bytes[8] = (bytes[8]! & 63) | 128;
      const hex = bytes.toString('hex'); ownerId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
      // Deterministic creation makes retries safe even if the binding write fails.
      await this.manager.bindParticipant(ownerId, selectionCredential(ownerId, member), true);
    }
    await writePrivateJson(bindingDirectory(this.directory), `${key}.json`, { schema: 1, ownerId });
    return this.manager.bindParticipant(ownerId, selectionCredential(ownerId, member));
  }
}
