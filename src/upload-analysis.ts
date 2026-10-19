import { fork } from 'node:child_process';
import { z } from 'zod';
import { AppError } from './model.js';

const metadata = z.object({ title: z.string().min(1).max(1000), artist: z.string().max(1000), album: z.string().max(1000),
  version: z.string().max(500), provider: z.literal('Uploaded file'), duration: z.number().finite().positive() }).strict();
export const analysisSchema = z.object({ extension: z.enum(['mp3', 'm4a', 'flac', 'wav', 'aiff', 'ogg', 'opus']),
  contentType: z.enum(['audio/mpeg', 'audio/mp4', 'audio/flac', 'audio/wav', 'audio/aiff', 'audio/ogg']), artwork: z.boolean(), metadata }).strict();
export type UploadAnalysis = z.infer<typeof analysisSchema>;

/** Disposable process boundary for untrusted media analysis, independent of asset persistence. */
export async function analyzeUpload(directory: string, filename: string, signal?: AbortSignal): Promise<UploadAnalysis> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new AppError(400, 'File analysis was canceled.')); return; }
    const worker = fork(new URL(import.meta.url.endsWith('.ts') ? './upload-worker.ts' : './upload-worker.js', import.meta.url), [], {
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'], detached: process.platform !== 'win32', env: { PATH: process.env.PATH, NODE_ENV: process.env.NODE_ENV },
      execArgv: [...process.execArgv, '--max-old-space-size=128'],
    });
    let settled = false;
    const finish = (error?: AppError, value?: UploadAnalysis) => {
      if (settled) return; settled = true; clearTimeout(timer); signal?.removeEventListener('abort', aborted);
      try { if (process.platform !== 'win32' && worker.pid) process.kill(-worker.pid, 'SIGKILL'); else worker.kill('SIGKILL'); } catch { /* Already exited. */ }
      if (error) reject(error); else resolve(value!);
    };
    const timer = setTimeout(() => finish(new AppError(422, 'Audio analysis took too long. Try a different copy of this file.')), 60_000); timer.unref();
    const aborted = () => finish(new AppError(400, 'File analysis was canceled.'));
    signal?.addEventListener('abort', aborted, { once: true });
    worker.once('message', (message: { ok?: boolean; error?: string; value?: unknown }) => {
      const checked = analysisSchema.safeParse(message.value);
      if (message.ok && checked.success) finish(undefined, checked.data);
      else finish(new AppError(message.error === 'missing-probe' ? 503 : 422, message.error === 'missing-probe'
        ? 'File analysis needs FFprobe on the application server. Ask the host to check the installation.'
        : 'This is not a supported, readable audio file. Use MP3, M4A, FLAC, WAV, AIFF, Ogg Vorbis or Opus. Standalone AAC is not supported.'));
    });
    worker.once('error', () => finish(new AppError(503, 'File analysis is temporarily unavailable.')));
    worker.once('exit', () => finish(new AppError(422, 'This file could not be analyzed safely.')));
    worker.send({ directory, filename });
  });
}
