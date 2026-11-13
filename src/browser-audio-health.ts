import { z } from 'zod';
import { lanAudio, onlineAudio } from './audio-network.js';

const count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const codec = z.enum(['opus', 'flac', 'pcm']);
export const browserAudioHealth = z.object({
  codec: codec.optional(),
  sampleRate: z.number().int().min(8000).max(192000).optional(),
  channels: z.number().int().min(1).max(8).optional(),
  bitDepth: z.number().int().min(8).max(32).optional(),
  decodedChunks: count, decodeFailures: count, recoveries: count, lateChunks: count,
  minBufferMs: z.number().int().min(Math.min(lanAudio.minBufferMs, onlineAudio.minBufferMs)).max(Math.max(lanAudio.maxBufferMs, onlineAudio.maxBufferMs)),
  advertisedCodecs: z.array(codec).max(3).optional(),
  opusSupport: z.enum(['browser-excluded', 'probe-failed', 'native', 'software', 'decoder-failed', 'sdk-excluded']).optional(),
  requestedCodec: codec.optional(),
  formatRequest: z.enum(['pending', 'accepted', 'ignored']).optional(),
}).strict();
export type AudioHealth = z.infer<typeof browserAudioHealth>;
