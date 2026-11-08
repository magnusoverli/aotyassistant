import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { AppError } from './model.js';
import { BoundedCache } from './bounded-cache.js';

/** Participant-authorized artwork route; the segment after it is a sealed catalogue reference. */
export const artworkPath = '/api/participant/artwork/';
export const artworkReference = (url: string | undefined) => url?.startsWith(artworkPath) ? decodeURIComponent(url.slice(artworkPath.length)) : undefined;

/** Opaque, owner-scoped catalogue capabilities. Routing never changes their identity. */
export class CatalogueReferences {
  private key = randomBytes(32);
  readonly revision = randomBytes(16).toString('base64url');
  private images = new BoundedCache<{ reference: string; expires: number }>(2048);
  seal(id: string, kind: string, context: string): string {
    // Reuse only image capabilities, within the same owner/catalogue context.
    // Stable URLs let browsers revalidate pixels instead of transferring them
    // again. Encryption still uses a fresh random nonce for every new token.
    const imageKey = kind === 'image' || kind === 'upload-image' ? JSON.stringify([kind, id, context]) : undefined;
    const cached = imageKey ? this.images.get(imageKey) : undefined;
    if (cached && cached.expires > Date.now() + 60_000) return cached.reference;
    const expires = kind === 'upload-image' ? Number.MAX_SAFE_INTEGER : Date.now() + 12 * 60 * 60_000;
    const nonce = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', this.key, nonce);
    // Kind, owner context and revision are authenticated but not carried, which
    // halves every reference in catalogue responses. A mismatch fails decryption.
    cipher.setAAD(this.scope(kind, context));
    const data = Buffer.concat([cipher.update(JSON.stringify([id, expires])), cipher.final()]);
    const reference = `ref:${Buffer.concat([nonce, cipher.getAuthTag(), data]).toString('base64url')}`;
    if (imageKey) this.images.set(imageKey, { reference, expires }, { expires });
    return reference;
  }
  unseal(value: string, kind: string, context: string): string {
    try {
      if (!value.startsWith('ref:') || value.length > 1000) throw new Error();
      const raw = Buffer.from(value.slice(4), 'base64url');
      const decipher = createDecipheriv('aes-256-gcm', this.key, raw.subarray(0, 12)); decipher.setAuthTag(raw.subarray(12, 28));
      decipher.setAAD(this.scope(kind, context));
      const [id, expires] = JSON.parse(Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8'));
      if (typeof id !== 'string' || typeof expires !== 'number' || expires < Date.now()) throw new Error();
      return id;
    } catch { throw new AppError(409, 'This catalogue selection expired or belongs to another participant. Browse again.'); }
  }
  private scope(kind: string, context: string) { return Buffer.from(JSON.stringify([kind, context, this.revision])); }
}
