import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { AppError } from './model.js';

/** Opaque, owner-scoped catalogue capabilities. Routing never changes their identity. */
export class CatalogueReferences {
  private key = randomBytes(32);
  readonly revision = randomBytes(16).toString('base64url');
  seal(id: string, kind: string, context: string): string {
    const nonce = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', this.key, nonce);
    const data = Buffer.concat([cipher.update(JSON.stringify({ id, kind, context, revision: this.revision,
      expires: kind === 'upload-image' ? Number.MAX_SAFE_INTEGER : Date.now() + 12 * 60 * 60_000 })), cipher.final()]);
    return `ref:${Buffer.concat([nonce, cipher.getAuthTag(), data]).toString('base64url')}`;
  }
  unseal(value: string, kind: string, context: string): string {
    try {
      if (!value.startsWith('ref:') || value.length > 1000) throw new Error();
      const raw = Buffer.from(value.slice(4), 'base64url');
      const decipher = createDecipheriv('aes-256-gcm', this.key, raw.subarray(0, 12)); decipher.setAuthTag(raw.subarray(12, 28));
      const ref = JSON.parse(Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8'));
      if (ref.context !== context || ref.kind !== kind || ref.revision !== this.revision || ref.expires < Date.now() || typeof ref.id !== 'string') throw new Error();
      return ref.id;
    } catch { throw new AppError(409, 'This catalogue selection expired or belongs to another participant. Browse again.'); }
  }
}
