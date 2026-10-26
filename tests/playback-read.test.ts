import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AppError } from '../src/model.js';
import { maOperation, maRemaining } from '../src/ma-operation.js';
import { playbackRead, StalePlaybackRead } from '../src/playback-read.js';
import { UpstreamError } from '../src/upstream-error.js';
import { playbackFailure, playbackProblem } from '../src/playback-problem.js';

test('read reconciliation retries transient failures with a fixed attempt limit', async () => {
  let reads = 0;
  assert.equal(await playbackRead(async () => {
    if (++reads < 3) throw new UpstreamError('connection', 502, 'Synthetic interrupted connection');
    return 'confirmed';
  }), 'confirmed');
  assert.equal(reads, 3);
  reads = 0;
  await assert.rejects(playbackRead(async () => { reads++; throw new UpstreamError('unavailable', 502, 'Synthetic outage'); }));
  assert.equal(reads, 3);
});

test('authorization, schema, policy, closure and cancellation failures are not retried', async () => {
  for (const error of [new UpstreamError('authorization', 502, 'Synthetic token failure'),
    new UpstreamError('unsupported-response', 502, 'Synthetic schema failure'), new UpstreamError('closed', 503, 'Closed'),
    new UpstreamError('rejected', 502, 'Redirect'), new AppError(422, 'Blocked address'), new AppError(499, 'Cancelled')]) {
    let reads = 0;
    await assert.rejects(playbackRead(async () => { reads++; throw error; }), value => value === error);
    assert.equal(reads, 1);
  }
});

test('stale observations stop before another read and read retries cannot extend the caller deadline', async () => {
  let current = true; let reads = 0;
  await assert.rejects(playbackRead(async () => {
    reads++; current = false; throw new UpstreamError('connection', 502, 'Old failure');
  }, () => current), StalePlaybackRead);
  assert.equal(reads, 1);
  reads = 0;
  await assert.rejects(maOperation('short-read', () => playbackRead(async () => {
    maRemaining(Infinity); reads++; throw new UpstreamError('timeout', 504, 'Synthetic timeout');
  }), 20));
  assert.equal(reads, 1);
});

test('structured playback problems distinguish recovery from external changes without exposing exception details', () => {
  const privateFailure = new UpstreamError('authorization', 502, 'PRIVATE token and recording URL');
  const problem = playbackProblem(playbackFailure(privateFailure, 'connection-lost'));
  assert.equal(problem.code, 'authorization'); assert.equal(problem.recoveryRequired, true);
  assert.ok(!JSON.stringify(problem).includes('PRIVATE'));
  assert.equal(playbackProblem('external-playback').recoveryRequired, false);
  assert.equal(playbackProblem('external-stop').recoveryRequired, false);
  assert.equal(playbackProblem('queue-policy-stopped').recoveryRequired, false);
  assert.equal(playbackProblem('queue-policy').recoveryRequired, true);
});
