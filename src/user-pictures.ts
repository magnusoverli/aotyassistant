import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, rename, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import sharp from 'sharp';
import { z } from 'zod';
import { AppError } from './model.js';
import { durability } from './backup.js';
import { operation, stage } from './operation.js';
import { listDirectory, removePrivateFile, syncDirectory } from './store.js';
import { SerialQueue } from './serial.js';
import { maxUserPictureBytes, maxUserPicturePixels, userPictureSize } from './user-picture-format.js';
import { nativeWork } from './native-work.js';

const idSchema = z.uuid();
const maxStoredBytes = 1024 * 1024;
const version = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex').slice(0, 32);
let processing = 0;

export async function prepareUserPicture(input: Buffer): Promise<Buffer> {
  if (!input.length) throw new AppError(400, 'Choose or take a photo first.');
  if (input.length > maxUserPictureBytes) throw new AppError(413, 'Choose a picture smaller than 10 MB.');
  if (processing >= 2) throw new AppError(429, 'Other pictures are being processed. Try again shortly.');
  processing++;
  try { return await nativeWork(async () => {
    const metadata = await sharp(input, { limitInputPixels: maxUserPicturePixels }).metadata();
    if (!['jpeg', 'png', 'webp'].includes(metadata.format ?? '') || (metadata.pages ?? 1) > 1) throw new Error();
    // Decode and re-encode even browser-cropped pictures. Originals and EXIF/GPS never enter storage.
    return await sharp(input, { limitInputPixels: maxUserPicturePixels, animated: false }).rotate()
      .resize(userPictureSize, userPictureSize, { fit: 'cover' }).webp({ quality: 85 }).timeout({ seconds: 15 }).toBuffer();
  }); } catch (error) { if (error instanceof AppError) throw error; throw new AppError(415, 'Use a still JPEG, PNG or WebP picture.'); }
  finally { processing--; }
}

export interface PictureFiles {
  ids(): Promise<string[]>;
  read(id: string): Promise<Buffer | undefined>;
  write(id: string, bytes: Buffer): Promise<void>;
  remove(id: string): Promise<void>;
}

/** One atomic file per stable user; no profile/session record is rewritten by a photo change. */
export class UserPictureFiles implements PictureFiles {
  private directory: string;
  constructor(dataDirectory: string) { this.directory = join(dataDirectory, 'user-pictures'); }
  async ids() {
    return (await listDirectory(this.directory)).filter(name => /^[a-f0-9-]{36}\.webp$/.test(name))
      .map(name => name.slice(0, -5)).filter(id => idSchema.safeParse(id).success);
  }
  async read(id: string) {
    const file = await open(join(this.directory, `${idSchema.parse(id)}.webp`), 'r').catch(error => {
      if (error.code === 'ENOENT') return undefined; throw error;
    });
    if (!file) return undefined;
    try {
      if ((await file.stat()).size > maxStoredBytes) throw new Error('Picture exceeds the stored size limit.');
      return await file.readFile();
    } finally { await file.close(); }
  }
  async write(id: string, bytes: Buffer) {
    idSchema.parse(id);
    await stage('persistence', () => durability.run(async () => {
      const created = await mkdir(this.directory, { recursive: true, mode: 0o700 });
      if (created) await syncDirectory(dirname(this.directory));
      const temporary = join(this.directory, `.${id}-${randomUUID()}.tmp`);
      const handle = await open(temporary, 'wx', 0o600);
      try {
        try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
        await rename(temporary, join(this.directory, `${id}.webp`));
        await syncDirectory(this.directory);
      } finally { await unlink(temporary).catch(() => {}); }
    }));
  }
  remove(id: string) { return removePrivateFile(this.directory, `${idSchema.parse(id)}.webp`); }
}

export class UserPictures {
  readonly ready: Promise<void>;
  private versions = new Map<string, string>();
  private uncertain = new Set<string>();
  private available = true;
  private queue = new SerialQueue();
  onChange = () => {};
  constructor(private files: PictureFiles) { this.ready = this.load(); }
  url(id: string) {
    const current = this.versions.get(id);
    return this.available && current && !this.uncertain.has(id) ? `/api/user-pictures/${id}/${current}.webp` : undefined;
  }
  private async load() {
    try {
      // Keep only tiny hashes in memory, rather than all saved users' image buffers.
      const ids = (await this.files.ids())[Symbol.iterator]();
      await Promise.all(Array.from({ length: 2 }, async () => {
        for (const id of ids) {
          try {
            const bytes = await this.files.read(id); if (!bytes) continue;
            const metadata = await nativeWork(() => sharp(bytes).metadata());
            if (metadata.format === 'webp' && metadata.width === userPictureSize && metadata.height === userPictureSize) this.versions.set(id, version(bytes));
          } catch { /* An unreadable photo falls back to the initial; an explicit replacement can repair it. */ }
        }
      }));
    } catch { this.available = false; }
  }
  async image(id: string, requested: string) {
    await this.ready;
    if (!this.available || this.uncertain.has(id)) throw new AppError(503, 'Pictures are temporarily unavailable.');
    if (this.versions.get(id) !== requested) throw new AppError(404, 'This picture is no longer in use.');
    const bytes = await this.files.read(id);
    if (!bytes || this.versions.get(id) !== requested || version(bytes) !== requested) throw new AppError(404, 'This picture is no longer in use.');
    return bytes;
  }
  /** Call under the user's identity lock, after decoding, so deletion cannot race the commit. */
  set(id: string, bytes: Buffer, expected: string) {
    return this.change(id, expected, async () => {
      if (bytes.length > maxStoredBytes) throw new AppError(413, 'The processed picture is too large.');
      await this.files.write(id, bytes); this.versions.set(id, version(bytes));
    });
  }
  /** An omitted expected version is reserved for idempotent account-deletion cleanup. */
  remove(id: string, expected?: string) {
    return this.change(id, expected, async () => { await this.files.remove(id); this.versions.delete(id); });
  }
  private change(id: string, expected: string | undefined, commit: () => Promise<void>) {
    return operation('user-picture', () => this.queue.run(async () => {
      await this.ready; idSchema.parse(id);
      if (!this.available || this.uncertain.has(id) && expected !== undefined) throw new AppError(503, 'Picture storage needs checking. Restart the app before trying again.');
      if (expected !== undefined && expected !== (this.versions.get(id) ?? 'none')) throw new AppError(409, 'This picture changed on another device. Close and reopen the picture editor.');
      try { await commit(); this.uncertain.delete(id); }
      catch {
        // A rename may have succeeded before its directory sync failed. Do not claim success or retry blindly.
        this.uncertain.add(id); this.onChange();
        throw new AppError(503, 'The picture change could not be confirmed. Check storage and restart the app.');
      }
      this.onChange(); return this.url(id);
    }));
  }
}
