import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, open, readFile, readdir, rename, rm, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { Transform, Writable, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { AppError } from './model.js';
import { writePrivateJson } from './store.js';
import { PreparationFileStore, type PreparationStore, type SavedSelection } from './preparations.js';
import { KeyedSerialQueue } from './serial.js';
import { mediaRange } from './http-utils.js';
import { durability } from './backup.js';
import { analyzeUpload, analysisSchema } from './upload-analysis.js';
export { analyzeUpload, type UploadAnalysis } from './upload-analysis.js';

export const uploadExtensions = ['mp3', 'm4a', 'flac', 'wav', 'aif', 'aiff', 'ogg', 'oga', 'opus'] as const;
export const uploadTextSchema = z.object({ title: z.string().trim().min(1).max(1000), artist: z.string().trim().max(1000), album: z.string().trim().max(1000) }).strict()
  .refine(value => Object.values(value).every(text => !/[\x00-\x1f\x7f]/.test(text)), 'Use plain text without control characters.');
const id = z.string().uuid().regex(/^[a-f0-9-]+$/);
const manifestSchema = analysisSchema.extend({ schema: z.literal(1), id, ownerId: id, filename: z.string().min(1).max(1000),
  sha256: z.string().regex(/^[a-f0-9]{64}$/), bytes: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), createdAt: z.number().int().nonnegative(), retained: z.boolean() }).strict();
type Manifest = z.infer<typeof manifestSchema>;
export type UploadPreview = { id: string; filename: string; title: string; artist: string; album: string; duration: number; artwork?: string };
export type UploadSelection = Extract<SavedSelection, { source: 'upload' }>;
type Lease = { assetId: string; origin: string; key: string; active: boolean; observed: boolean; connections: Set<() => void> };

/** Private, immutable media bytes. File size/storage is not quota-limited. Single-process ownership matches the app store. */
export class UploadAssets {
  private directory: string;
  private staging: string;
  private receiving = new Set<string>();
  private queue = new KeyedSerialQueue();
  private leases = new Set<Lease>();
  private closed = false;
  private shutdown = new AbortController();
  constructor(private dataDirectory: string, private analyze = analyzeUpload, private now = Date.now,
    private preparations: Pick<PreparationStore, 'load'> = new PreparationFileStore(dataDirectory)) {
    this.directory = join(dataDirectory, 'uploads'); this.staging = join(dataDirectory, 'upload-staging');
  }
  private path(assetId: string) { return join(this.directory, id.parse(assetId)); }
  private async serial<T>(assetId: string, work: () => Promise<T>) {
    return this.queue.run(assetId, work);
  }
  private async load(assetId: string, ownerId?: string): Promise<Manifest> {
    try {
      const file = await open(join(this.path(assetId), 'manifest.json'), 'r');
      let value;
      try { if ((await file.stat()).size > 32 * 1024) throw new Error(); value = manifestSchema.parse(JSON.parse(await file.readFile('utf8'))); }
      finally { await file.close(); }
      if (value.id !== assetId || (ownerId !== undefined && value.ownerId !== ownerId)) throw new AppError(404, 'Uploaded file not found.');
      return value;
    } catch (error) {
      if (error instanceof AppError) throw error;
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new AppError(404, 'Uploaded file not found. Select the file again if the upload did not finish.');
      throw new AppError(503, 'The uploaded file record could not be read. Nothing was reset.');
    }
  }
  private preview(value: Manifest): UploadPreview {
    return { id: value.id, filename: value.filename, title: value.metadata.title, artist: value.metadata.artist, album: value.metadata.album, duration: value.metadata.duration,
      ...(value.artwork ? { artwork: `/api/participant/preparations/uploads/${value.id}/artwork` } : {}) };
  }
  async inspect(ownerId: string, assetId: string) { return this.preview(await this.load(assetId, id.parse(ownerId))); }
  async receive(ownerId: string, assetId: string, filename: string, input: Readable, signal?: AbortSignal): Promise<UploadPreview> {
    signal = signal ? AbortSignal.any([signal, this.shutdown.signal]) : this.shutdown.signal;
    ownerId = id.parse(ownerId); assetId = id.parse(assetId);
    filename = filename.split(/[\\/]/).pop()!.replace(/[\x00-\x1f\x7f]/g, '').trim();
    if (!filename || filename.length > 1000 || !uploadExtensions.some(extension => filename.toLowerCase().endsWith(`.${extension}`))) throw new AppError(422, 'Choose MP3, M4A, FLAC, WAV, AIFF, Ogg Vorbis or Opus. Standalone AAC is not supported.');
    if (this.closed || this.receiving.size >= 2 || this.receiving.has(ownerId)) throw new AppError(429, 'File uploads are busy. Try again after the current upload finishes.');
    this.receiving.add(ownerId);
    try {
      return await this.serial(assetId, async () => {
        signal.throwIfAborted();
        let previous: Manifest | undefined;
        try { previous = await this.load(assetId); } catch (error) { if (!(error instanceof AppError && error.status === 404)) throw error; }
        if (previous && previous.ownerId !== ownerId) throw new AppError(409, 'This upload identifier is already in use. Select the file again.');
        if (!previous && await stat(this.path(assetId)).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error; })) {
          throw new AppError(409, 'This upload is unfinished or already in progress. Select the file again to start a new upload.');
        }
        // Staging bytes are disposable after restart/restore and never referenced by a
        // list or media lease. Long transfers/analysis do not hold the backup barrier.
        const directory = join(this.staging, assetId);
        let created = false;
        try {
          if (!previous) {
            await mkdir(this.staging, { recursive: true, mode: 0o700 });
            try { await mkdir(directory, { mode: 0o700 }); created = true; }
            catch { throw new AppError(409, 'This upload is unfinished or already in progress. Select the file again to start a new upload.'); }
            await writePrivateJson(directory, 'receiving.json', { id: assetId, ownerId, createdAt: this.now() });
          }
          const hash = createHash('sha256'); let bytes = 0;
          const meter = new Transform({ transform(chunk: Buffer, _encoding, done) { bytes += chunk.length; hash.update(chunk); done(null, chunk); } });
          if (previous) {
            meter.resume(); await pipeline(input, meter, { signal });
          } else {
            const audio = await open(join(directory, 'audio'), 'wx', 0o600);
            const output = new Writable({ highWaterMark: 64 * 1024, write(chunk: Buffer, _encoding, done) { void audio.writeFile(chunk).then(() => done(), error => done(error)); } });
            try { await pipeline(input, meter, output, { signal }); await audio.sync(); }
            finally { await audio.close(); }
          }
          if (!bytes || !Number.isSafeInteger(bytes)) throw new AppError(422, 'The selected file is empty or unreadable.');
          const digest = hash.digest('hex');
          if (previous) {
            if (previous.sha256 !== digest || previous.filename !== filename) throw new AppError(409, 'This upload identifier was already used for a different file. Select the file again.');
            return this.preview(previous);
          }
          signal?.throwIfAborted();
          const analyzed = analysisSchema.parse(await this.analyze(directory, filename, signal));
          signal?.throwIfAborted();
          if (analyzed.artwork) { const image = await open(join(directory, 'cover.png'), 'r+'); try { await image.sync(); } finally { await image.close(); } }
          const manifest: Manifest = { ...analyzed, schema: 1, id: assetId, ownerId, filename, sha256: digest, bytes, createdAt: this.now(), retained: false };
          await writePrivateJson(directory, 'manifest.json', manifest);
          await unlink(join(directory, 'receiving.json'));
          const parent = await open(directory, 'r'); try { await parent.sync(); } finally { await parent.close(); }
          await durability.run(async () => {
            signal.throwIfAborted();
            await mkdir(this.directory, { recursive: true, mode: 0o700 });
            await rename(directory, this.path(assetId));
            for (const path of [this.directory, this.staging, this.dataDirectory]) {
              const parent = await open(path, 'r'); try { await parent.sync(); } finally { await parent.close(); }
            }
          });
          return this.preview(manifest);
        } catch (error) {
          if (created) await rm(directory, { recursive: true, force: true }).catch(() => {}); // Only this attempt's newly created, validated UUID directory.
          if (error instanceof AppError) throw error;
          throw new AppError(503, 'The file upload could not be saved. Check the connection and server disk space; existing files were kept.');
        }
      });
    } finally { this.receiving.delete(ownerId); }
  }
  async capture(ownerId: string, assetId: string, text: z.infer<typeof uploadTextSchema>): Promise<UploadSelection> {
    return this.serial(assetId, async () => {
      const value = await this.load(assetId, ownerId); await this.verify(value);
      value.retained = true; await writePrivateJson(this.path(assetId), 'manifest.json', value);
      return { source: 'upload', assetId, sha256: value.sha256, ...(value.artwork ? { artworkAssetId: assetId } : {}), metadata: { ...value.metadata, ...uploadTextSchema.parse(text) } };
    });
  }
  private async verify(value: Manifest) {
    const file = await open(join(this.path(value.id), 'audio'), 'r').catch(() => { throw new AppError(404, 'The uploaded audio is missing. Your list entry was kept.'); });
    try {
      const info = await file.stat(); if (!info.isFile() || info.size !== value.bytes) throw new AppError(422, 'The uploaded audio changed or is incomplete. Your list entry was kept.');
      const digest = createHash('sha256'); const buffer = Buffer.alloc(64 * 1024);
      for (;;) { const { bytesRead } = await file.read(buffer, 0, buffer.length, null); if (!bytesRead) break; digest.update(buffer.subarray(0, bytesRead)); }
      if (digest.digest('hex') !== value.sha256) throw new AppError(422, 'The uploaded recording failed its integrity check. Your list entry was kept; no substitute was selected.');
    }
    finally { await file.close(); }
  }
  async artwork(assetId: string, ownerId?: string) {
    const value = await this.load(assetId, ownerId); if (!value.artwork) throw new AppError(404, 'Artwork unavailable.');
    const file = await open(join(this.path(assetId), 'cover.png'), 'r');
    try { if ((await file.stat()).size > 2 * 1024 * 1024) throw new AppError(404, 'Artwork unavailable.'); return { body: await file.readFile(), contentType: 'image/png' }; }
    finally { await file.close(); }
  }
  busy(assetId: string) { return [...this.leases].some(lease => lease.assetId === assetId); }
  async remove(ownerId: string, assetId: string) {
    await this.serial(assetId, async () => {
      let value: Manifest | undefined;
      try { value = await this.load(assetId, ownerId); }
      catch (error) {
        if (!(error instanceof AppError && error.status === 404)) throw error;
        // Missing metadata is not proof that bytes were durably deleted.
        const exists = await stat(this.path(assetId)).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error; });
        if (exists) throw new AppError(503, 'Uploaded file deletion could not be confirmed. Check its stored record.');
      }
      if (this.busy(assetId)) throw new AppError(409, 'Stop or finish this file before permanently deleting it.');
      await durability.run(async () => {
        if (value) await rm(this.path(value.id), { recursive: true, force: true });
        const directory = await open(this.directory, 'r').catch(error => { if (error.code === 'ENOENT') return null; throw error; });
        if (directory) { try { await directory.sync(); } finally { await directory.close(); } }
      });
    });
  }
  async lease(assetId: string, origin: string, expectedHash?: string) {
    return this.serial(assetId, async () => {
      const value = await this.load(assetId);
      if (expectedHash !== undefined && value.sha256 !== expectedHash) throw new AppError(422, 'The uploaded recording no longer matches this saved entry. Your list was kept; no substitute was selected.');
      await this.verify(value);
      if (!value.retained || this.closed) throw new AppError(409, 'Save the uploaded file to your list before playing it.');
      const lease: Lease = { assetId, origin, key: randomBytes(32).toString('base64url'), active: true, observed: false, connections: new Set() };
      this.leases.add(lease);
      const suspend = () => { lease.active = false; for (const close of lease.connections) close(); lease.connections.clear(); };
      const revoke = () => { suspend(); this.leases.delete(lease); };
      return { url: `${origin}/api/media/uploads/${assetId}/${lease.key}/track.${value.extension}`, revoke, suspend, get observed() { return lease.observed; } };
    });
  }
  async serve(req: Request, res: Response) {
    const assetId = id.parse(req.params.assetId); const key = String(req.params.key ?? '');
    if (!/^[A-Za-z0-9_-]{43}$/.test(key)) throw new AppError(404, 'Media unavailable.');
    const lease = [...this.leases].find(item => item.active && item.assetId === assetId && key.length === item.key.length && timingSafeEqual(Buffer.from(key), Buffer.from(item.key)) && new URL(item.origin).host === req.headers.host);
    if (!lease) throw new AppError(404, 'Media unavailable.');
    const value = await this.load(assetId); const file = await open(join(this.path(assetId), 'audio'), 'r');
    let handedOff = false;
    try {
      if (!lease.active || req.params.filename !== `track.${value.extension}`) throw new AppError(404, 'Media unavailable.');
      const info = await file.stat(); if (!info.isFile() || info.size !== value.bytes) throw new AppError(404, 'Media unavailable.');
      const range = mediaRange(req, res, info.size, value.contentType); if (!range) return;
      if (req.method === 'HEAD') { res.end(); return; }
      lease.observed = true;
      const stream = file.createReadStream({ start: range.start, end: range.end }); handedOff = true;
      const stop = () => { stream.destroy(); res.destroy(); }; lease.connections.add(stop);
      res.once('close', () => { lease.connections.delete(stop); stream.destroy(); });
      stream.once('error', () => res.destroy()); stream.pipe(res);
    } finally { if (!handedOff) await file.close(); }
  }
  /** Only incomplete/staged assets expire; retained originals never do. Called off the player lane. */
  async cleanup() {
    // Unpublished bytes are never restored as usable assets. Active receivers own
    // their asset lane, including while final publication waits for a backup.
    const staged = await readdir(this.staging).catch(() => [] as string[]);
    for (const name of staged) {
      if (this.closed) return;
      if (id.safeParse(name).success && !this.queue.has(name)) await this.serial(name, () => rm(join(this.staging, name), { recursive: true, force: true })).catch(() => {});
    }
    let names: string[]; try { names = await readdir(this.directory); } catch { return; }
    for (const name of names) {
      if (this.closed) return;
      if (!id.safeParse(name).success || this.queue.has(name)) continue;
      await this.serial(name, async () => {
        try {
          let manifest;
          try { manifest = await this.load(name); }
          catch (error) { if (!(error instanceof AppError && error.status === 404)) return; }
          if (manifest?.retained || this.busy(name)) return;
          // A missing/corrupt manifest is not proof of an abandoned upload. Only a durable receiving marker establishes that.
          const receiving = manifest ? undefined : z.object({ id, ownerId: id, createdAt: z.number().int().nonnegative() }).strict()
            .parse(JSON.parse(await readFile(join(this.path(name), 'receiving.json'), 'utf8')));
          if (receiving && receiving.id !== name) return;
          const createdAt = manifest?.createdAt ?? receiving!.createdAt;
          const ownerId = manifest?.ownerId ?? receiving!.ownerId;
          if (this.now() - createdAt <= 7 * 24 * 60 * 60_000) return;
          // Fail closed on inconsistent/partial backups: never delete bytes referenced by an acknowledged list.
          const owner = await this.preparations.load(ownerId);
          if (owner?.entries.some(entry => entry.selection.source === 'upload' && entry.selection.assetId === name)) return;
          await durability.run(() => rm(this.path(name), { recursive: true, force: true }));
        } catch { /* Cleanup failure must never affect playback or acknowledged assets. */ }
      });
    }
  }
  stopReceiving() { this.closed = true; this.shutdown.abort(); }
  drain() { return this.queue.drain(); }
  close() { this.stopReceiving(); for (const lease of this.leases) { lease.active = false; for (const stop of lease.connections) stop(); } this.leases.clear(); }
}
