import type { AudioHealth } from './browser-audio-health.js';

/** Evidence labels, not guesses about a remote server's encoder settings. */
export function codecSelection(audio?: AudioHealth, preferredFormat?: string) {
  if (!audio?.codec) return 'awaiting-stream';
  if (audio.codec === 'opus') return 'opus';
  if (audio.opusSupport === 'decoder-failed') return 'decoder-fallback';
  if (audio.opusSupport === 'browser-excluded' || audio.opusSupport === 'probe-failed' || audio.opusSupport === 'sdk-excluded') return audio.opusSupport;
  if (!audio.advertisedCodecs?.includes('opus')) return 'unknown';
  if (preferredFormat?.startsWith(`${audio.codec}:`)) return 'ma-format-override';
  return 'server-selected-fallback';
}
