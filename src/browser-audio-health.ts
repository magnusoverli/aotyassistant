import { z } from 'zod';

const count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
export const browserAudioHealth = z.object({
  codec: z.enum(['opus', 'flac', 'pcm']).optional(),
  sampleRate: z.number().int().min(8000).max(192000).optional(),
  channels: z.number().int().min(1).max(8).optional(),
  bitDepth: z.number().int().min(8).max(32).optional(),
  decodedChunks: count, decodeFailures: count, recoveries: count, lateChunks: count,
  minBufferMs: z.number().int().min(500).max(2000),
}).strict();
export type AudioHealth = z.infer<typeof browserAudioHealth>;
