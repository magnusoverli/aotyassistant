/** Shared playback limits and telemetry bounds; no browser or server dependencies. */
export type AudioNetwork = { leadTimeMs: number; minBufferMs: number; maxBufferMs: number; bufferCapacity?: number };
export const lanAudio: AudioNetwork = { leadTimeMs: 250, minBufferMs: 500, maxBufferMs: 2000 };
/** Allow 30 s at Opus's maximum bitrate, while bounding lossless stream-ahead bursts. */
export const onlineAudio: AudioNetwork = { leadTimeMs: 1000, minBufferMs: 1500, maxBufferMs: 4000, bufferCapacity: 64_000 * 30 };
