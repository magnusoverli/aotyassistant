import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { IntegrationView } from '../src/integrations.js';
import { SpeakerFreshness } from '../web/speaker-freshness.js';

function view(checkedAt = 100_000, asOf = checkedAt): IntegrationView {
  return { revision: 1, url: 'http://fixture.local', tokenConfigured: true, destination: { id: 'one', name: 'Speaker' },
    status: 'checked', destinationStatus: 'checked', destinationMessage: '', message: '', report: null,
    playbackAvailable: true, playbackIssue: '', output: { name: 'Speaker', state: 'ready', checkedAt },
    speakerInventory: { state: 'verified', checkedAt, expiresAt: checkedAt + 45_000, asOf, players: [{ id: 'one', name: 'Speaker', available: true }] } };
}

test('browser freshness expires without a snapshot and does not require synchronized clocks', () => {
  let now = 0; let wall = 9_000_000;
  const clock = new SpeakerFreshness(() => now, () => wall); clock.accept(view());
  assert.equal(clock.ready, true); assert.equal(clock.remaining(true), 45_000);
  now = 45_001; wall += 45_001;
  assert.equal(clock.fresh, false); assert.equal(clock.ready, false); assert.equal(clock.state, 'stale');
  clock.accept(view()); assert.equal(clock.ready, false, 'Replaying the same certificate must not renew it.');
  clock.accept(view(146_000)); assert.equal(clock.ready, true);
});

test('queued snapshots and delayed older snapshots cannot renew a freshness lease', () => {
  let now = 0; const clock = new SpeakerFreshness(() => now, () => now);
  const queued = view(); clock.receive(queued); now = 46_000; clock.accept(queued);
  assert.equal(clock.ready, false);
  clock.accept(view(150_000, 160_000)); assert.equal(clock.remaining(true), 35_000);
  now += 10_000; clock.accept(view(150_000, 150_000));
  assert.equal(clock.remaining(true), 25_000);
});

test('selected queue verification can expire before inventory, while refreshing does not disable fresh readiness', () => {
  let now = 0; const clock = new SpeakerFreshness(() => now, () => now); const snapshot = view();
  snapshot.output.checkedAt = 70_000; snapshot.speakerInventory!.state = 'refreshing'; clock.accept(snapshot);
  assert.equal(clock.ready, true); assert.equal(clock.state, 'refreshing');
  now = 15_001; assert.equal(clock.ready, false); assert.equal(clock.fresh, true);
  assert.equal(clock.remaining(false), 29_999);
  const failed = view(); failed.speakerInventory!.state = 'failed'; clock.accept(failed);
  assert.equal(clock.ready, false); assert.equal(clock.state, 'failed');
});

test('sleep or wall-clock changes cannot extend readiness and older snapshot formats remain supported', () => {
  let now = 0; let wall = 0; const clock = new SpeakerFreshness(() => now, () => wall); clock.accept(view());
  wall = 46_000; assert.equal(clock.ready, false);
  wall = -100_000; now = 46_000; assert.equal(clock.ready, false);
  const legacy = view(); delete legacy.speakerInventory; clock.accept(legacy);
  assert.equal(clock.state, undefined); assert.equal(clock.ready, true); assert.equal(clock.remaining(true), undefined);
});
