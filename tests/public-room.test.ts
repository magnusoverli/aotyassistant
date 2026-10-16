import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { View } from '../src/model.js';
import { publicPlaybackState } from '../web/public-room.js';
import { publicTurnOrder } from '../web/public-turn-order.js';

const view: View = { mode: 'demo', connected: true, roomId: 'room', revision: 1, turnId: 'turn', current: null, next: null };

test('the public turn strip starts at the current person, wraps the real order, and never duplicates a single listener', () => {
  const people = ['Alex', 'Sam', 'Jordan', 'Riley'].map((nickname, index) => ({ id: String(index), nickname }));
  const ordered = { ...view, current: people[2]!, next: people[3]!, rotation: people };
  assert.deepEqual(publicTurnOrder(ordered).visible.map(person => person.nickname), ['Jordan', 'Riley', 'Alex', 'Sam']);
  assert.equal(publicTurnOrder(ordered).remaining, 0);
  assert.deepEqual(publicTurnOrder(ordered, 2).visible.map(person => person.id), ['2', '3']);
  assert.equal(publicTurnOrder(ordered, 2).remaining, 2);
  assert.equal(publicTurnOrder({ ...view, current: people[0]!, next: people[0]!, rotation: [people[0]!] }).visible.length, 1);
  assert.deepEqual(publicTurnOrder(view), { visible: [], remaining: 0 });
});

test('the public turn strip bounds large groups without losing current/next, even with matching names', () => {
  const people = Array.from({ length: 12 }, (_, index) => ({ id: String(index), nickname: 'Same name' }));
  const ordered = { ...view, current: people[11]!, next: people[0]!, rotation: people };
  assert.deepEqual(publicTurnOrder(ordered).visible.map(person => person.id), ['11', '0', '1', '2', '3', '4', '5']);
  assert.equal(publicTurnOrder(ordered).remaining, 5);
  assert.equal(publicTurnOrder(ordered, 200).visible.length, 7);
  assert.equal(publicTurnOrder(ordered, 1).visible.length, 2);
});

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
