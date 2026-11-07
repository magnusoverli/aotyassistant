import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reportedStreamInfoSchema } from '../src/stream-info.js';
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
    streamInfo: { format: 'MP3', bitRate: 320, sampleRate: 44100 } };
  assert.equal(publicStreamDetails(view, true), 'MP3 · 320 kbps · 44.1 kHz');
  assert.equal(publicStreamDetails({ ...view, nowPlaying: { revealed: true, track: { id: 'track', title: 'Title', artist: 'Artist', album: 'Album', duration: 60 } } }, true), 'MP3 · 320 kbps · 44.1 kHz');
  assert.equal(publicStreamDetails({ ...view, streamInfo: { sampleRate: 96000 }, progress: { ...view.progress!, status: 'paused' } }, true), '96 kHz');
  assert.equal(publicStreamDetails({ ...view, streamInfo: undefined }, true), '');
  assert.equal(publicStreamDetails({ ...view, progress: undefined }, true), '');
  assert.equal(publicStreamDetails({ ...view, progress: { ...view.progress!, status: 'stopped' } }, true), '');
  assert.equal(publicStreamDetails({ ...view, connected: false }, true), '');
  assert.equal(publicStreamDetails(view, false), '');
});
