import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import type { CatalogueTrack, PlaybackProgress, View } from '../src/model.js';
import { PlayerController } from '../web/player-controller.js';

const track: CatalogueTrack = { id: 'private-track', title: 'My track', artist: 'My artist', album: 'My album', version: '', duration: 180, provider: 'fixture', available: true };
function fixture(role: 'host' | 'participant' = 'participant', position?: (progress?: PlaybackProgress) => PlaybackProgress | undefined) {
  let view: View = { mode: 'music-assistant', connected: true, roomId: 'room', revision: 1, turnId: 'turn', current: { id: 'alex', nickname: 'Alex' }, next: null,
    me: { id: 'alex', nickname: 'Alex' }, myTurn: true, ownPlayback: null, volume: { available: true, level: 30, revision: 'destination', generation: 0 } };
  let online = true; let resyncs = 0;
  const failures: string[] = [];
  const calls: { path: string; data: any; resolve(value: View): void; reject(error: Error): void }[] = [];
  const controller = new PlayerController({ role, getView: () => view, canSend: () => online,
    position,
    request: (path, data) => new Promise<View>((resolve, reject) => calls.push({ path, data, resolve, reject })),
    accept: next => { view = next; controller.observe(next); }, resync: async () => { resyncs++; }, changed: () => {}, failed: message => failures.push(message),
  }); controller.observe(view);
  const observe = (next: View) => { view = next; controller.observe(view); };
  const playing = (): View => ({ ...view, revision: 2, ownPlayback: { id: 'confirmed-playback', turnId: 'turn', track: { ...track, duration: 180 }, status: 'playing', revealed: false },
    progress: { id: 'confirmed-playback', status: 'playing', fraction: .1, elapsed: 18, duration: 180 } });
  return { controller, calls, failures, playing, observe, get view() { return view; }, get resyncs() { return resyncs; }, offline() { online = false; controller.cancel(); } };
}

test('the complete player projects immediately, queues dependent commands behind exact play confirmation, and coalesces transport intent', async () => {
  const f = fixture(); f.controller.play(track);
  assert.equal(f.calls.length, 1); assert.equal(f.controller.project(f.view).ownPlayback!.track.title, 'My track');
  assert.equal(f.view.ownPlayback, null, 'Optimism must not mutate the authoritative snapshot.');
  f.controller.control('pause'); f.controller.control('resume'); f.controller.control('pause'); f.controller.reveal();
  assert.equal(f.calls.length, 1, 'Do not send controls against a provisional playback ID.');
  const preview = f.controller.project(f.view); assert.equal(preview.ownPlayback!.status, 'paused'); assert.equal(preview.ownPlayback!.revealed, true);
  f.calls[0]!.resolve(f.playing()); await delay(0);
  assert.equal(f.calls.length, 2); assert.equal(f.calls[1]!.data.playbackId, 'confirmed-playback'); assert.equal(f.calls[1]!.data.action, 'pause');
  f.calls[1]!.resolve({ ...f.view, revision: 3, ownPlayback: { ...f.view.ownPlayback!, status: 'paused' } }); await delay(0);
  assert.equal(f.calls[2]!.path, '/api/participant/reveal');
  f.calls[2]!.resolve({ ...f.view, revision: 4, ownPlayback: { ...f.view.ownPlayback!, revealed: true } }); await delay(0);
  assert.deepEqual(f.controller.project(f.view), f.view); assert.equal(f.failures.length, 0);
});

test('pending Pause and Resume retain the displayed clock position instead of jumping back to the older server sample', () => {
  const f = fixture('participant', progress => progress && { ...progress, elapsed: 20, fraction: 20 / 180 });
  f.observe(f.playing());
  f.controller.control('pause'); assert.equal(f.controller.project(f.view).progress!.elapsed, 20);
  f.controller.control('resume'); assert.equal(f.controller.project(f.view).progress!.elapsed, 20);
  assert.equal(f.view.progress!.elapsed, 18); f.controller.cancel();
});

test('optimistic pause/resume/stop remain interactive during slow replies and roll back on rejection without replaying writes', async () => {
  const f = fixture(); f.observe(f.playing());
  f.controller.control('pause'); assert.equal(f.controller.project(f.view).ownPlayback!.status, 'paused');
  f.controller.control('resume'); assert.equal(f.controller.project(f.view).ownPlayback!.status, 'playing');
  f.controller.control('stop'); assert.equal(f.controller.project(f.view).ownPlayback!.status, 'stopped');
  f.calls[0]!.reject(new Error('Speaker did not accept pause.')); await delay(0);
  assert.equal(f.calls.length, 1); assert.equal(f.controller.project(f.view).ownPlayback!.status, 'playing');
  assert.equal(f.failures[0], 'Speaker did not accept pause.'); assert.equal(f.resyncs, 1);
});

test('volume updates instantly, keeps only the latest unsent target, ignores stale telemetry, and corrects mismatched readback', async () => {
  const f = fixture('host'); f.controller.volume(80, true); f.controller.volume(80, true);
  assert.equal(f.calls.length, 1); assert.equal(f.controller.project(f.view).volume!.level, 80);
  f.controller.volume(20, true); f.controller.volume(40, true);
  assert.equal(f.calls.length, 1); assert.equal(f.controller.project(f.view).volume!.level, 40);
  f.observe({ ...f.view, volume: { ...f.view.volume!, level: 30, generation: 0 } });
  assert.equal(f.controller.project(f.view).volume!.level, 40);
  f.calls[0]!.resolve({ ...f.view, volume: { ...f.view.volume!, level: 80, generation: 1, pending: true } }); await delay(0);
  assert.equal(f.calls.length, 2); assert.equal(f.calls[1]!.data.level, 40);
  f.calls[1]!.resolve({ ...f.view, volume: { ...f.view.volume!, level: 40, generation: 2, pending: true } }); await delay(0);
  assert.equal(f.controller.project(f.view).volume!.level, 40); assert.equal(f.controller.project(f.view).volume!.pending, true);
  f.observe({ ...f.view, volume: { ...f.view.volume!, level: 35, generation: 3, pending: false } });
  assert.equal(f.controller.project(f.view).volume!.level, 35); assert.equal(f.controller.project(f.view).volume!.pending, false);
});

test('failed volume writes discard unsent follow-ups and restore confirmed state without affecting transport commands', async () => {
  const f = fixture(); f.observe(f.playing());
  f.controller.volume(60, true); f.controller.volume(90, true); f.controller.control('pause');
  assert.equal(f.calls.length, 2);
  f.calls[0]!.reject(new Error('Volume unavailable.')); await delay(0);
  assert.equal(f.controller.project(f.view).volume!.level, 30); assert.equal(f.calls.length, 2);
  assert.equal(f.controller.project(f.view).ownPlayback!.status, 'paused'); assert.equal(f.resyncs, 1);
  f.calls[1]!.resolve({ ...f.view, revision: 3, ownPlayback: { ...f.view.ownPlayback!, status: 'paused' } }); await delay(0);
});

test('turn changes and offline transitions cancel private optimistic state and never replay queued mutations', async () => {
  const f = fixture(); f.controller.play(track); f.controller.control('pause'); f.controller.reveal();
  const response = f.playing();
  f.observe({ ...f.view, revision: 4, turnId: 'next-turn', current: { id: 'sam', nickname: 'Sam' }, myTurn: false, ownPlayback: undefined, volume: undefined });
  f.calls[0]!.resolve(response); await delay(0);
  assert.equal(f.calls.length, 1); assert.deepEqual(f.controller.project(f.view), f.view); assert.equal(f.controller.project(f.view).ownPlayback, undefined);
  const host = fixture('host'); host.controller.volume(20, true); host.controller.volume(70, true); host.offline();
  host.calls[0]!.resolve({ ...host.view, volume: { ...host.view.volume!, level: 20 } }); await delay(0);
  assert.equal(host.calls.length, 1); assert.equal(host.controller.project(host.view).volume!.level, 30);
});

test('routing-only changes cancel queued player/volume work even when catalogue identity stays the same', async () => {
  const f = fixture(); f.observe({ ...f.playing(), catalogue: { source: 'music-assistant', playbackAvailable: true, revision: 'same-catalogue' } });
  f.controller.control('pause'); f.controller.control('resume'); f.controller.volume(60, true); f.controller.volume(80, true);
  const old = structuredClone(f.view);
  f.observe({ ...f.view, volume: { available: false, level: null, revision: 'new-destination' }, catalogue: { ...f.view.catalogue!, playbackAvailable: true } });
  for (const call of f.calls) call.resolve(old); await delay(0);
  assert.equal(f.calls.length, 2); assert.deepEqual(f.controller.project(f.view), f.view); assert.equal(f.controller.project(f.view).volume!.level, null);
  assert.equal(f.view.catalogue!.revision, 'same-catalogue'); assert.equal(f.view.volume!.revision, 'new-destination');
});

test('a playback replacement discards old volume intentions and acknowledgements within the same turn', async () => {
  const f = fixture(); f.observe(f.playing());
  f.controller.volume(60, true); f.controller.volume(80, true);
  const previous = structuredClone(f.view);
  f.observe({ ...f.view, revision: 3, ownPlayback: { ...f.view.ownPlayback!, id: 'replacement' } });
  f.calls[0]!.resolve({ ...previous, volume: { ...previous.volume!, level: 60, generation: 1 } }); await delay(0);
  assert.equal(f.calls.length, 1);
  assert.equal(f.view.ownPlayback!.id, 'replacement');
  assert.equal(f.controller.project(f.view).volume!.level, 30);
});

test('a stopped playback cancels debounced participant volume before it is sent', async () => {
  const f = fixture(); f.observe(f.playing());
  f.controller.volume(70);
  f.observe({ ...f.view, ownPlayback: { ...f.view.ownPlayback!, status: 'stopped' } });
  await delay(120);
  assert.equal(f.calls.length, 0);
});

test('host transport uses the filtered host playback identity and never sends participant-only actions', async () => {
  const f = fixture('host');
  f.observe({ ...f.view, me: undefined, myTurn: undefined, ownPlayback: undefined,
    hostPlayback: { id: 'host-song', status: 'playing', revealed: false }, progress: { id: 'host-song', status: 'playing', fraction: .1 } });
  f.controller.play(track); f.controller.reveal(); f.controller.control('stop'); assert.equal(f.calls.length, 0);
  f.controller.control('pause');
  assert.equal(f.calls[0]!.path, '/api/host/control');
  assert.deepEqual(f.calls[0]!.data, { turnId: 'turn', playbackId: 'host-song', action: 'pause' });
  assert.equal(f.controller.project(f.view).hostPlayback!.status, 'paused');
  assert.equal(f.controller.project(f.view).ownPlayback, undefined);
  assert.equal(f.view.hostPlayback!.status, 'playing');
  f.calls[0]!.resolve({ ...f.view, revision: 2, hostPlayback: { ...f.view.hostPlayback!, status: 'paused' } }); await delay(0);
  f.controller.control('resume'); assert.equal(f.calls[1]!.data.action, 'resume');
  f.calls[1]!.reject(new Error('Resume not confirmed')); await delay(0);
  assert.equal(f.controller.project(f.view).hostPlayback!.status, 'paused'); assert.equal(f.resyncs, 1);
});

test('host queued transport is discarded after replacement, stop or turn change, without replay', async () => {
  for (const change of ['replacement', 'stop', 'turn']) {
    const f = fixture('host'); f.observe({ ...f.view, ownPlayback: undefined, myTurn: undefined,
      hostPlayback: { id: 'host-song', status: 'playing', revealed: false } });
    f.controller.control('pause'); f.controller.control('resume');
    const old = structuredClone(f.view);
    f.observe({ ...f.view, revision: 3, turnId: change === 'turn' ? 'new-turn' : f.view.turnId,
      hostPlayback: change === 'turn' ? null : { ...f.view.hostPlayback!, id: change === 'replacement' ? 'replacement' : 'host-song', status: change === 'stop' ? 'stopped' : 'playing' } });
    f.calls[0]!.resolve(old); await delay(0);
    assert.equal(f.calls.length, 1); assert.deepEqual(f.controller.project(f.view), f.view);
  }
});
