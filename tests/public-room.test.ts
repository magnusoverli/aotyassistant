import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { View } from '../src/model.js';
import { publicPlaybackState } from '../web/public-room.js';

const view: View = { mode: 'demo', connected: true, roomId: 'room', revision: 1, turnId: 'turn', current: null, next: null };

test('the public room is idle without active playback, including a stopped or stale revealed selection', () => {
  assert.equal(publicPlaybackState(view, true), 'idle');
  const revealed = { revealed: true as const, track: { id: 'track', title: 'Old track', artist: 'Artist', album: 'Album', duration: 60 } };
  assert.equal(publicPlaybackState({ ...view, nowPlaying: revealed }, true), 'idle');
  assert.equal(publicPlaybackState({ ...view, nowPlaying: revealed, progress: { id: 'track', status: 'stopped', fraction: .2 } }, true), 'idle');
  assert.equal(publicPlaybackState(view, true), 'idle');
});

test('public playback motion depends on authoritative transport state, never reveal or track metadata', () => {
  for (const status of ['playing', 'paused'] as const) {
    const active = { ...view, progress: { id: 'playback', status, fraction: null }, nowPlaying: { revealed: false as const } };
    assert.equal(publicPlaybackState(active, true), status);
    assert.equal(publicPlaybackState({ ...active, nowPlaying: { revealed: true, track: { id: 'track', title: 'Track', artist: 'Artist', album: 'Album', duration: 60 } } }, true), status);
  }
});

test('disconnection or uncertainty is unavailable, not falsely idle or playing', () => {
  const active = { ...view, progress: { id: 'playback', status: 'playing' as const, fraction: .2 } };
  assert.equal(publicPlaybackState(active, false), 'unavailable');
  assert.equal(publicPlaybackState({ ...active, connected: false }, true), 'unavailable');
  assert.equal(publicPlaybackState(view, false), 'unavailable');
});
