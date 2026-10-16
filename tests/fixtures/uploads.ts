import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { AppError } from '../../src/model.js';
import type { UploadAnalysis } from '../../src/uploads.js';

export const coverPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZXkAAAAASUVORK5CYII=', 'base64');
export const uploadBytes = Buffer.from('SYNTHETIC AUDIO FIXTURE ONLY');
/** Transport/UI fixture only. Real format validation is exercised separately in the unprivileged container smoke. */
export async function fixtureUploadAnalysis(directory: string, _filename: string): Promise<UploadAnalysis> {
  const data = await readFile(join(directory, 'audio'));
  if (data.toString().startsWith('invalid')) throw new AppError(422, 'This is not supported audio.');
  await writeFile(join(directory, 'cover.png'), coverPng, { mode: 0o600 });
  return { extension: 'mp3', contentType: 'audio/mpeg', artwork: true,
    metadata: { title: 'Uploaded song', artist: 'Local artist', album: 'Local album', provider: 'Uploaded file', version: '', duration: 180 } };
}
