import { z } from 'zod';
import type { StreamInfo } from './model.js';

const sources: Record<string, string> = {
  spotify: 'Spotify', tidal: 'Tidal', qobuz: 'Qobuz', deezer: 'Deezer', apple_music: 'Apple Music',
  ytmusic: 'YouTube Music', youtube_music: 'YouTube Music', amazon_music: 'Amazon Music',
  filesystem: 'Local files', filesystem_local: 'Local files', filesystem_smb: 'Network files',
  plex: 'Plex', subsonic: 'Subsonic', jellyfin: 'Jellyfin', builtin: 'Direct stream',
  soundcloud: 'SoundCloud', bandcamp: 'Bandcamp', tunein: 'TuneIn', radiobrowser: 'Radio Browser',
};
type SourceMapping = { item_id?: string; provider_instance?: string; provider_domain?: string };

/** Identify the actual stream, not the catalogue service originally selected.
 * Match opaque instances through exact item mappings; publish only fixed service labels. */
export function sourceStreamInfo(stream: { provider: string; item_id: string; audio_format?: StreamInfo } | null | undefined,
  mappings: readonly SourceMapping[] = []): StreamInfo | undefined {
  if (!stream) return;
  const domains = new Set(mappings.filter(mapping => mapping.item_id === stream.item_id &&
    (mapping.provider_instance === stream.provider || mapping.provider_domain === stream.provider))
    .map(mapping => mapping.provider_domain).filter((domain): domain is string => Boolean(domain)));
  const domain = Object.hasOwn(sources, stream.provider) ? stream.provider : domains.size === 1 ? [...domains][0]! : '';
  const source = Object.hasOwn(sources, domain) ? sources[domain] : undefined;
  const info: StreamInfo = { ...(source ? { source } : {}), ...stream.audio_format };
  return Object.keys(info).length ? info : undefined;
}

// MA AudioFormat (schema 65): bit_rate is kbps, sample_rate is Hz.
// Fixed codec labels allow technical data before reveal without exposing free-form metadata.
const formats = {
  flac: 'FLAC', mp3: 'MP3', aac: 'AAC', alac: 'ALAC', opus: 'Opus', vorbis: 'Vorbis',
  ogg: 'Ogg', wav: 'WAV', aiff: 'AIFF', mpeg: 'MPEG', m4a: 'M4A', mp4: 'MP4', mp4a: 'MP4A', m4b: 'M4B', dsf: 'DSF',
  wma: 'WMA', wmav2: 'WMA v2', wmapro: 'WMA Pro', wavpack: 'WavPack', tak: 'TAK', ape: 'APE', mpc: 'Musepack',
  ac3: 'AC-3', eac3: 'E-AC-3', dts: 'DTS', truehd: 'TrueHD', dtshd: 'DTS-HD', dtsx: 'DTS:X',
  cook: 'Cook', ralf: 'RALF', mp2: 'MP2', mp1: 'MP1', dra: 'DRA', atrac3: 'ATRAC3',
  pcm: 'PCM', s16le: 'PCM', s24le: 'PCM', s32le: 'PCM', f32le: 'PCM', f64le: 'PCM',
  s16be: 'PCM', s24be: 'PCM', s32be: 'PCM', pcm_bluray: 'PCM', pcm_dvd: 'PCM',
  adpcm_ima_qt: 'ADPCM', adpcm_ms: 'ADPCM', adpcm_swf: 'ADPCM',
  dsd_lsbf: 'DSD', dsd_msbf: 'DSD', dsd_lsbf_planar: 'DSD', dsd_msbf_planar: 'DSD',
  amr_nb: 'AMR', amr_wb: 'AMR-WB', speex: 'Speex', alaw: 'G.711 A-law', mulaw: 'G.711 µ-law', g722: 'G.722', g726: 'G.726', nut: 'NUT',
} as const;
const format = z.enum(Object.keys(formats) as [keyof typeof formats, ...(keyof typeof formats)[]]).optional().catch(undefined);

/** Only actual reported fields, never calculated bitrate or catalogue quality guesses. */
export const reportedStreamInfoSchema = z.object({
  content_type: format, codec_type: format,
  bit_rate: z.number().int().positive().max(1_000_000).optional().catch(undefined),
  sample_rate: z.number().int().positive().max(100_000_000).optional().catch(undefined),
}).nullish().catch(undefined).transform((audio): StreamInfo | undefined => {
  if (!audio) return;
  const codec = audio.codec_type ?? audio.content_type;
  const info: StreamInfo = {
    ...(codec ? { format: formats[codec] } : {}),
    ...(audio.bit_rate ? { bitRate: audio.bit_rate } : {}),
    ...(audio.sample_rate ? { sampleRate: audio.sample_rate } : {}),
  };
  return Object.keys(info).length ? info : undefined;
});
