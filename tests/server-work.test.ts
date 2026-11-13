import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { nativeWork } from '../src/native-work.js';
import { operation } from '../src/operation.js';
import { ServiceGates } from '../src/list-import.js';
import { SpectrumAnalyser } from '../src/spectrum-analysis.js';
import { ScheduledSpectrumAnalyser } from '../src/scheduled-spectrum.js';
import { PreparationFileStore, preparationStateSchema, type PreparationState } from '../src/preparations.js';
import { fileStamp, writePrivateJson } from '../src/store.js';

test('native work shares bounded admission and cancelled waiters never dispatch', async () => {
  let release!: () => void; let active = 0; let peak = 0;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const jobs = Array.from({ length: 4 }, () => nativeWork(async () => {
    peak = Math.max(peak, ++active); await gate; active--;
  }));
  try {
    await nextTurn(); assert.ok(peak >= 1 && peak <= 2);
    const abort = new AbortController(); let dispatched = false;
    const cancelled = operation('test-native', () => nativeWork(async () => { dispatched = true; }), 45_000, abort.signal);
    abort.abort(); await assert.rejects(cancelled, { status: 499 });
    assert.equal(dispatched, false);
  } finally { release(); await Promise.all(jobs); }
});

test('import admission removes cancelled waiters while preserving dispatched work and FIFO', async () => {
  const gates = new ServiceGates({ provider: 1 }); const order: string[] = [];
  let release!: () => void;
  const active = gates.run('provider', async () => { await new Promise<void>(resolve => { release = resolve; }); order.push('active'); });
  const abort = new AbortController();
  const cancelled = operation('test-import', () => gates.run('provider', async () => { order.push('cancelled'); }), 45_000, abort.signal);
  const next = gates.run('provider', async () => { order.push('next'); });
  try { abort.abort(); await assert.rejects(cancelled, { status: 499 }); }
  finally { release(); await Promise.all([active, next]); }
  assert.deepEqual(order, ['active', 'next']);
});

test('scheduled spectrum yields through bursts without changing bins, order or sample timestamps', async () => {
  for (const rate of [44100, 48000]) {
    const expected: { at: number; bins: number[] }[] = []; const actual: typeof expected = [];
    const direct = new SpectrumAnalyser((at, bins) => expected.push({ at, bins }));
    const scheduled = new ScheduledSpectrumAnalyser((at, bins) => actual.push({ at, bins }));
    try {
      let offset = 0;
      for (const length of [997, 3001, rate * 2, 101, 4801]) {
        const samples = [1, -1].map(sign => Float32Array.from({ length }, (_, i) => sign * .5 * Math.sin((offset + i) * .13)));
        const chunk = { samples, sampleRate: rate, generation: 1, serverTimeUs: 1e6 + offset / rate * 1e6 };
        direct.push(chunk); scheduled.push(chunk); offset += length;
        // The producer may reuse its buffers once the callback returns.
        samples.forEach(channel => channel.fill(0));
      }
      scheduled.end();
      assert.equal(actual.length, 0);
      await nextTurn(); assert.ok(actual.length < expected.length, 'The burst does not run in one event-loop turn.');
      for (let i = 0; i < 100 && actual.length < expected.length; i++) await nextTurn();
      assert.equal(actual.length, expected.length);
      for (let i = 0; i < expected.length; i++) {
        assert.deepEqual(actual[i]!.bins, expected[i]!.bins);
        assert.ok(Math.abs(actual[i]!.at - expected[i]!.at) < .0001);
      }
    } finally { scheduled.clear(); }
  }
});

test('reset discards queued old audio and stream-end drains accepted audio before resetting', async () => {
  const frames: number[][] = [];
  const scheduled = new ScheduledSpectrumAnalyser((_at, bins) => frames.push(bins));
  try {
    scheduled.push({ samples: [Float32Array.from({ length: 48000 }, (_, i) => Math.sin(i))], sampleRate: 48000, generation: 1, serverTimeUs: 1e6 });
    scheduled.clear(); await nextTurn(); assert.equal(frames.length, 0);
    const chunk = { samples: [new Float32Array(2048)], sampleRate: 48000, generation: 2, serverTimeUs: 10e6 };
    scheduled.push(chunk); scheduled.end();
    scheduled.push({ ...chunk, serverTimeUs: 10e6 + 2048 / 48000 * 1e6 }); scheduled.end();
    for (let i = 0; i < 10 && frames.length < 2; i++) await nextTurn();
    assert.equal(frames.length, 2); assert.ok(frames.every(bins => bins.every(value => value === 0)));
  } finally { scheduled.clear(); }
});

test('list commit snapshots retain validated immutable data but external replacement and corruption still invalidate them', async t => {
    const directory = await mkdtemp(join(tmpdir(), 'doom-room-snapshot-')); t.after(() => rm(directory, { recursive: true, force: true }));
    // Exercise cache semantics on real files independently of platform directory fsync.
    // The production writer's durable descriptor receipt is checked separately below.
    let uncertain = false;
    const store = new PreparationFileStore(directory, async (path, filename, data) => {
      await mkdir(path, { recursive: true }); await writeFile(join(path, filename), JSON.stringify(data));
      if (uncertain) throw new Error('Commit acknowledgement lost.');
      return stat(join(path, filename), { bigint: true });
    });
    const state: PreparationState = { schema: 2, ownerId: randomUUID(), revision: 0,
      credentials: [{ hash: 'a'.repeat(64), createdAt: 1 }], entries: [], order: [], receipts: [] };
    const parse = preparationStateSchema.parse.bind(preparationStateSchema); let validations = 0;
    t.mock.method(preparationStateSchema, 'parse', (...args: Parameters<typeof parse>) => { validations++; return parse(...args); });
    await store.save(state);
    const snapshot = await store.snapshot(state.ownerId);
    assert.equal(validations, 1, 'Successful writes are not reparsed on the next read.');
    assert.ok(Object.isFrozen(snapshot) && Object.isFrozen(snapshot!.credentials));
    state.revision = 7; assert.equal((await store.load(state.ownerId))!.revision, 0);
    const file = join(directory, 'preparations', `${state.ownerId}.json`);
    await writeFile(file + '.replacement', JSON.stringify(state)); await rename(file + '.replacement', file);
    assert.equal((await store.snapshot(state.ownerId))!.revision, 7);
    uncertain = true; state.revision = 8;
    await assert.rejects(store.save(state), { status: 503 });
    assert.equal((await store.snapshot(state.ownerId))!.revision, 8, 'An uncertain commit reconciles from storage instead of an old cached snapshot.');
    await writeFile(file, 'corrupt'); await assert.rejects(store.snapshot(state.ownerId), { status: 503 });
    assert.equal(await readFile(file, 'utf8'), 'corrupt');
  });

test('durable JSON commits return the exact saved file identity',
  { skip: process.platform === 'win32' ? 'Requires Linux directory fsync.' : false }, async t => {
    const directory = await mkdtemp(join(tmpdir(), 'doom-room-commit-')); t.after(() => rm(directory, { recursive: true, force: true }));
    const committed = await writePrivateJson(directory, 'record.json', { value: 1 }, 1024, true);
    assert.ok(committed); assert.equal(fileStamp(committed), fileStamp(await stat(join(directory, 'record.json'), { bigint: true })));
    assert.deepEqual(JSON.parse(await readFile(join(directory, 'record.json'), 'utf8')), { value: 1 });
  });
