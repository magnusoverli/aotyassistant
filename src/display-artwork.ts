import { createCipheriv, randomBytes, randomUUID } from 'node:crypto';
import { AppError, type View } from './model.js';
import { artworkKinds, packDisplayImages, type DisplayImages } from './display-artwork-format.js';
import type { ArtworkData, ArtworkSize } from './music-assistant-transport.js';

export type DisplayArtworkTarget = { playbackId: string; context: string; references: Partial<Record<typeof artworkKinds[number], string>> };
type Prepared = { id: string; signature: string; target: DisplayArtworkTarget; key: Buffer; data?: Promise<Buffer> };

/** At most one current playback's encrypted bundle is retained. Its random key
 * is delivered only in the already-revealed display projection. */
export class DisplayArtwork {
  private current?: Prepared;
  private closed = false;
  constructor(private target: () => DisplayArtworkTarget | undefined,
    private load: (reference: string, context: string, size: ArtworkSize) => Promise<ArtworkData>) {}
  close() { this.closed = true; this.current = undefined; }
  refresh() {
    const target = this.closed ? undefined : this.target();
    if (!target || !artworkKinds.some(kind => target.references[kind])) { this.current = undefined; return; }
    const signature = JSON.stringify(target);
    if (signature !== this.current?.signature) this.current = { id: randomUUID(), signature, target, key: randomBytes(32) };
    return this.current;
  }
  project(view: View): View {
    const current = this.refresh();
    if (!current || view.progress?.id !== current.target.playbackId || !view.connected) return view;
    return { ...view, preparedArtwork: { id: current.id,
      ...(view.nowPlaying?.revealed ? { key: current.key.toString('base64url') } : {}) } };
  }
  async read(id: string) {
    const current = this.refresh();
    if (!current || current.id !== id) throw new AppError(403, 'Artwork preparation expired.');
    current.data ??= (async () => {
      const images: DisplayImages = {};
      await Promise.all(artworkKinds.map(async kind => {
        const reference = current.target.references[kind]; if (!reference) return;
        try { images[kind] = await this.load(reference, current.target.context, kind === 'artwork' ? 1024 : 160); }
        catch { /* Optional images do not delay or prevent reveal. */ }
      }));
      if (this.refresh() !== current) throw new AppError(403, 'Artwork preparation expired.');
      if (!Object.keys(images).length) throw new AppError(404, 'Artwork unavailable.');
      const nonce = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', current.key, nonce);
      return Buffer.concat([nonce, cipher.update(packDisplayImages(images)), cipher.final(), cipher.getAuthTag()]);
    })();
    const data = await current.data;
    if (this.refresh() !== current) throw new AppError(403, 'Artwork preparation expired.');
    return data;
  }
}
