import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { SpectrumBroadcast } from '../src/spectrum-broadcast.js';
import type { SpectrumPacket } from '../src/spectrum.js';

const packet = (active: boolean): SpectrumPacket => ({ epoch: 'e', roomId: 'room', participantId: 'p', active, sensitivity: .9, frames: active ? [{ at: 1, bins: Array(24).fill(10) }] : [] });

test('idle rooms send nothing; while active every stream gets one shared packet per tick, then one inactive packet', async () => {
  let active = false; let computed = 0;
  const broadcast = new SpectrumBroadcast(() => { computed++; return packet(active); }, 10);
  const first: string[] = []; const second: string[] = [];
  const offFirst = broadcast.subscribe(json => first.push(json)); const offSecond = broadcast.subscribe(json => second.push(json));
  try {
    await delay(45);
    assert.deepEqual([first.length, second.length], [0, 0], 'Nothing is sent while the visualizer is idle.');
    const idle = computed; active = true; await delay(45);
    assert.ok(first.length >= 2); assert.deepEqual(second, first, 'Every stream receives the same encoded packets.');
    assert.equal(first.length, computed - idle, 'One packet is computed per tick and shared, not computed per stream.');
    active = false; await delay(45);
    const inactive = first.filter(json => !(JSON.parse(json) as SpectrumPacket).active);
    assert.equal(inactive.length, 1, 'A single inactive packet tells screens to clear.');
    assert.equal((JSON.parse(first.at(-1)!) as SpectrumPacket).active, false);
  } finally { offFirst(); offSecond(); broadcast.close(); }
});

test('the shared tick stops when the last stream leaves', async () => {
  let computed = 0;
  const broadcast = new SpectrumBroadcast(() => { computed++; return packet(true); }, 10);
  const off = broadcast.subscribe(() => {}); await delay(35); off();
  const after = computed; await delay(40);
  assert.equal(computed, after);
  broadcast.close();
});
