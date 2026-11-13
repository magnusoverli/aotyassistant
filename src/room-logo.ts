import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import sharp, { type Metadata, type OutputInfo } from 'sharp';
import { AppError, type RoomLogoView } from './model.js';
import { removePrivateFile, syncDirectory } from './store.js';
import { durability } from './backup.js';
import { stage } from './operation.js';
import { setImmediate as yieldTurn } from 'node:timers/promises';
import { SerialQueue } from './serial.js';
import { nativeWork } from './native-work.js';

/** Uploaded originals are capped; the stored logo is at most this many pixels on its longest side. */
export const maxLogoBytes = 10 * 1024 * 1024;
const longestSide = 1600;
const maxInputPixels = 40_000_000;
const filename = 'room-logo.png';
const formats = new Set(['png', 'jpeg', 'webp', 'svg']);
const unsupported = 'Use a PNG, JPEG, WebP or SVG image.';

/** SVG is rendered once, here, and never served. Refuse anything that could reach outside the file. */
function checkSvg(input: Buffer) {
  const text = input.toString('utf8');
  if (/<!ENTITY|<script|<foreignObject|<iframe|@import/i.test(text)) throw new AppError(400, 'This SVG contains scripts or embedded documents. Export a plain SVG, or use a PNG.');
  const external = [...text.matchAll(/(?:xlink:)?href\s*=\s*["']\s*([^"']*)/gi)].some(match => !match[1]!.startsWith('#') && !/^data:image\//i.test(match[1]!))
    || /url\(\s*["']?(?!\s*#)(?!\s*data:image\/)/i.test(text);
  if (external) throw new AppError(400, 'This SVG links to other files. Export it with everything embedded, or use a PNG.');
}

/** One shape: white, with the artwork's coverage as alpha. Transparent artwork keeps its own alpha; opaque
 * artwork uses its difference from the background colour along the image edge, so light-on-dark and
 * dark-on-light both work. Empty margins are trimmed. Undefined when nothing stands out. */
export function logoShape(pixels: Buffer, width: number, height: number) {
  const steps = shapeSteps(pixels, width, height);
  let result = steps.next();
  while (!result.done) result = steps.next();
  return result.value;
}
async function cooperativeLogoShape(pixels: Buffer, width: number, height: number) {
  const steps = shapeSteps(pixels, width, height);
  let result = steps.next();
  while (!result.done) { await yieldTurn(); result = steps.next(); }
  return result.value;
}
function* shapeSteps(pixels: Buffer, width: number, height: number) {
  let seeThrough = 0;
  for (let i = 3; i < pixels.length; i += 4) {
    if (pixels[i]! < 250) seeThrough++;
    if ((i & 0x3ffff) === 3) yield;
  }
  const transparent = seeThrough > width * height * .02;
  const lum = (i: number) => .2126 * pixels[i]! + .7152 * pixels[i + 1]! + .0722 * pixels[i + 2]!;
  let ground = 0, spread = 0;
  if (!transparent) {
    let sum = 0, count = 0;
    for (let x = 0; x < width; x++) { sum += lum(x * 4) + lum(((height - 1) * width + x) * 4); count += 2; }
    for (let y = 0; y < height; y++) { sum += lum(y * width * 4) + lum((y * width + width - 1) * 4); count += 2; }
    ground = sum / count;
    for (let i = 0; i < pixels.length; i += 4) {
      spread = Math.max(spread, Math.abs(lum(i) - ground));
      if ((i & 0x3ffff) === 0) yield;
    }
    if (spread < 24) return undefined;
  }
  const shape = Buffer.alloc(pixels.length);
  let left = width, top = height, right = -1, bottom = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const alpha = transparent ? pixels[i + 3]! : Math.min(255, Math.round(Math.abs(lum(i) - ground) / spread * 290));
      shape[i] = shape[i + 1] = shape[i + 2] = 255; shape[i + 3] = alpha;
      if (alpha > 14) { left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y); }
    }
    if (y % 32 === 0) yield;
  }
  if (right < 0) return undefined;
  const pad = Math.round(Math.max(right - left, bottom - top) * .015);
  left = Math.max(0, left - pad); top = Math.max(0, top - pad); right = Math.min(width - 1, right + pad); bottom = Math.min(height - 1, bottom + pad);
  return { pixels: shape, box: { left, top, width: right - left + 1, height: bottom - top + 1 } };
}

/** Decode a PNG, JPEG, WebP or SVG upload into the stored logo PNG. */
export function prepareLogo(input: Buffer): Promise<{ png: Buffer; width: number; height: number }> {
  return nativeWork(() => convertLogo(input));
}
async function convertLogo(input: Buffer): Promise<{ png: Buffer; width: number; height: number }> {
  if (!input.length) throw new AppError(400, 'Choose an image file to upload.');
  if (input.length > maxLogoBytes) throw new AppError(413, 'The logo file is larger than 10 MB. Export a smaller PNG or SVG.');
  const svg = /<svg[\s>]/i.test(input.subarray(0, 65_536).toString('latin1'));
  if (svg) checkSvg(input);
  let metadata: Metadata;
  try { metadata = await sharp(input, { limitInputPixels: maxInputPixels }).metadata(); }
  catch { throw new AppError(415, unsupported); }
  if (!metadata.format || !formats.has(metadata.format) || svg !== (metadata.format === 'svg')) throw new AppError(415, unsupported);
  // Vector logos are drawn at the stored size instead of their nominal 72 dpi size.
  const density = metadata.format === 'svg' && metadata.width && metadata.height
    ? Math.min(2400, Math.max(72, 72 * longestSide / Math.max(metadata.width, metadata.height))) : undefined;
  let decoded: { data: Buffer; info: OutputInfo };
  try {
    decoded = await sharp(input, { limitInputPixels: maxInputPixels, animated: false, ...(density ? { density } : {}) })
      .rotate().resize(longestSide, longestSide, { fit: 'inside', withoutEnlargement: true })
      .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  } catch { throw new AppError(415, 'This image could not be read. Try exporting it again as a PNG.'); }
  const { width, height } = decoded.info;
  const shape = await cooperativeLogoShape(decoded.data, width, height);
  if (!shape) throw new AppError(400, 'This image looks empty. Try a logo with more contrast against its background.');
  const png = await sharp(shape.pixels, { raw: { width, height, channels: 4 } }).extract(shape.box).png({ compressionLevel: 9 }).toBuffer();
  return { png, width: shape.box.width, height: shape.box.height };
}

/** The room's logo: one processed PNG in the data directory, served under a content version. */
export class RoomLogo {
  readonly ready: Promise<void>;
  private current?: { version: string; width: number; height: number; bytes: Buffer };
  private queue = new SerialQueue(4);
  constructor(private directory: string, private changed: () => void = () => {}) {
    this.ready = this.load();
  }
  view(): RoomLogoView | null {
    return this.current ? { url: `/api/logo/${this.current.version}`, width: this.current.width, height: this.current.height } : null;
  }
  image(version: string): Buffer {
    if (!this.current || this.current.version !== version) throw new AppError(404, 'This logo is no longer in use.');
    return this.current.bytes;
  }
  set(input: Buffer): Promise<RoomLogoView> {
    return this.serial(async () => {
      const prepared = await prepareLogo(input);
      await commitFile(this.directory, filename, prepared.png);
      this.current = { version: version(prepared.png), width: prepared.width, height: prepared.height, bytes: prepared.png };
      this.changed();
      return this.view()!;
    });
  }
  remove(): Promise<void> {
    return this.serial(async () => {
      try { await removePrivateFile(this.directory, filename); }
      catch { throw new AppError(503, 'The logo could not be removed. Check the app’s storage and try again.'); }
      if (!this.current) return;
      this.current = undefined; this.changed();
    });
  }
  /** A missing or unreadable file means no logo; it is never overwritten until the host uploads one. */
  private async load() {
    try {
      const bytes = await readFile(join(this.directory, filename));
      const { width, height } = await nativeWork(() => sharp(bytes).metadata());
      if (width && height) this.current = { version: version(bytes), width, height, bytes };
    } catch { /* No logo. */ }
  }
  private serial<T>(work: () => Promise<T>): Promise<T> {
    return this.queue.run(async () => { await this.ready; return work(); }, 'logo');
  }
}

const version = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex').slice(0, 16);

/** Atomic, fsynced replacement with the same backup guarantees as the app's JSON records. */
async function commitFile(directory: string, name: string, bytes: Buffer) {
  try {
    await stage('persistence', () => durability.run(async () => {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const temporary = join(directory, `.${name}-${randomUUID()}.tmp`);
      const handle = await open(temporary, 'wx', 0o600);
      try {
        try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
        await rename(temporary, join(directory, name));
        await syncDirectory(directory);
      } finally { await unlink(temporary).catch(() => {}); }
    }));
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(503, 'The logo could not be saved. Check the app’s storage and try again.');
  }
}
