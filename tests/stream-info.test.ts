import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reportedStreamInfoSchema, sourceStreamInfo } from '../src/stream-info.js';
import { publicStreamDetails } from '../web/public-room.js';
import type { View } from '../src/model.js';

test('reported stream metadata uses MA units and exposes only fixed technical fields', () => {
  assert.deepEqual(reportedStreamInfoSchema.parse({ content_type: 'ogg', codec_type: 'opus', sample_rate: 48000, bit_rate: 192,
    title: 'PRIVATE title', path: 'PRIVATE path', output_format_str: 'PRIVATE data' }), { format: 'Opus', bitRate: 192, sampleRate: 48000 });
  assert.deepEqual(reportedStreamInfoSchema.parse({ content_type: 'flac', codec_type: '?', sample_rate: 96000, bit_rate: 0 }), { format: 'FLAC', sampleRate: 96000 });
  assert.deepEqual(reportedStreamInfoSchema.parse({ bit_rate: 320 }), { bitRate: 320 });
  assert.deepEqual(reportedStreamInfoSchema.parse({ sample_rate: 44100 }), { sampleRate: 44100 });
});

test('missing or malformed optional metadata never invents details or rejects a queue', () => {
  for (const value of [undefined, null, {}, 'PRIVATE text', { content_type: '?', codec_type: 'PRIVATE', bit_rate: null, sample_rate: 0 },
    { content_type: 'PRIVATE title', sample_rate: -1, bit_rate: Infinity }, { bit_rate: '320', sample_rate: NaN }]) {
    assert.equal(reportedStreamInfoSchema.parse(value), undefined);
  }
  assert.deepEqual(reportedStreamInfoSchema.parse({ content_type: 'mp3', sample_rate: null, bit_rate: -1 }), { format: 'MP3' });
});

test('the subtle public technical line is reveal-independent and disappears when inactive or unavailable', () => {
  const view: View = { mode: 'music-assistant', connected: true, roomId: 'room', turnId: 'turn', revision: 1, current: null, next: null,
    progress: { id: 'playback', status: 'playing', fraction: null }, nowPlaying: { revealed: false },
    streamInfo: { source: 'Spotify', format: 'MP3', bitRate: 320, sampleRate: 44100 } };
  assert.equal(publicStreamDetails(view, true), 'Spotify · MP3 · 320 kbps · 44.1 kHz');
  assert.equal(publicStreamDetails({ ...view, nowPlaying: { revealed: true, track: { id: 'track', title: 'Title', artist: 'Artist', album: 'Album', duration: 60 } } }, true), 'Spotify · MP3 · 320 kbps · 44.1 kHz');
  assert.equal(publicStreamDetails({ ...view, streamInfo: { source: 'Tidal' } }, true), 'Tidal');
  assert.equal(publicStreamDetails({ ...view, streamInfo: { sampleRate: 96000 }, progress: { ...view.progress!, status: 'paused' } }, true), '96 kHz');
  assert.equal(publicStreamDetails({ ...view, streamInfo: undefined }, true), '');
  assert.equal(publicStreamDetails({ ...view, progress: undefined }, true), '');
  assert.equal(publicStreamDetails({ ...view, progress: { ...view.progress!, status: 'stopped' } }, true), '');
  assert.equal(publicStreamDetails({ ...view, connected: false }, true), '');
  assert.equal(publicStreamDetails(view, false), '');
});

test('source follows the actual Spotify or Tidal stream, including opaque account instances and library mappings', () => {
  const mappings = [
    { item_id: 'spotify-track', provider_instance: 'PRIVATE Spotify account', provider_domain: 'spotify' },
    { item_id: 'tidal-track', provider_instance: 'PRIVATE Tidal account', provider_domain: 'tidal' },
  ];
  const audio_format = { format: 'FLAC', sampleRate: 44100 };
  assert.deepEqual(sourceStreamInfo({ provider: 'PRIVATE Tidal account', item_id: 'tidal-track', audio_format }, mappings),
    { source: 'Tidal', ...audio_format });
  assert.deepEqual(sourceStreamInfo({ provider: 'PRIVATE Spotify account', item_id: 'spotify-track' }, mappings), { source: 'Spotify' });
  assert.deepEqual(sourceStreamInfo({ provider: 'spotify', item_id: 'spotify-track' }), { source: 'Spotify' });
  assert.deepEqual(sourceStreamInfo({ provider: 'tidal', item_id: 'tidal-track' }), { source: 'Tidal' });
  assert.equal(sourceStreamInfo(undefined, mappings), undefined);
  assert.equal(sourceStreamInfo({ provider: 'library', item_id: 'library-track' }, mappings), undefined);
  assert.equal(sourceStreamInfo({ provider: 'PRIVATE Tidal account', item_id: 'wrong-track' }, mappings), undefined);
  assert.deepEqual(sourceStreamInfo({ provider: 'unknown', item_id: 'track', audio_format }, mappings), audio_format);
  assert.equal(sourceStreamInfo({ provider: 'constructor', item_id: 'track' }), undefined);
  assert.equal(sourceStreamInfo({ provider: 'PRIVATE Tidal account', item_id: 'tidal-track' },
    [...mappings, { item_id: 'tidal-track', provider_instance: 'PRIVATE Tidal account', provider_domain: 'spotify' }]), undefined);
});
