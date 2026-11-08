// Local parser microbenchmark, not an HTTP throughput or physical-device claim.
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { jsonBody } from '../src/http-utils.js';

const make = () => z.strictObject({ turnId: z.uuid(), previousPlaybackId: z.uuid().nullable(), trackId: z.string().min(1).max(1000) });
const input = { turnId: '11111111-1111-4111-8111-111111111111', previousPlaybackId: null, trackId: 'demo:aurora' };
const reused = make(); const req = { body: input } as Request; const res = {} as Response;
let result: unknown;
const route = jsonBody(make(), value => { result = value; });
const samples = 5; const iterations = 10_000;
const rows = [
  { name: 'Schema rebuilt per request', work: () => { result = make().parse(input); } },
  { name: 'Reused runtime schema', work: () => { result = reused.parse(input); } },
  { name: 'Reused compiled JSON route', work: () => { route(req, res, () => {}); } },
];
for (const row of rows) {
  for (let i = 0; i < 1000; i++) row.work();
  const times: number[] = [];
  for (let pass = 0; pass < samples; pass++) {
    const started = performance.now();
    for (let i = 0; i < iterations; i++) row.work();
    times.push((performance.now() - started) * 1000 / iterations);
  }
  assert.deepEqual(result, input);
  times.sort((a, b) => a - b);
  console.log(JSON.stringify({ name: row.name, medianMicrosecondsPerCall: Number(times[Math.floor(samples / 2)]!.toFixed(3)), samples, iterations }));
}
