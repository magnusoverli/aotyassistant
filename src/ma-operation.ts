import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { AppError } from './model.js';

type Timing = { stage: string; ms: number };
type Operation = { id: string; action: string; deadline: number; timings: Timing[]; active: boolean; logging: boolean; signal?: AbortSignal };
const operations = new AsyncLocalStorage<Operation>();

/** One elapsed-time budget across queue waits, DNS, commands and confirmation. No write retries. */
export async function maOperation<T>(action: string, work: () => Promise<T>, budgetMs = 45_000, signal?: AbortSignal): Promise<T> {
  if (operations.getStore()?.active) return work();
  const start = performance.now();
  const operation: Operation = { id: randomUUID(), action, deadline: start + budgetMs, timings: [], active: true, logging: process.env.AOTY_MA_TIMINGS === '1', signal };
  return operations.run(operation, async () => {
    let ok = false;
    try { const result = await work(); ok = true; return result; }
    finally {
      operation.active = false;
      if (operation.logging) console.info(JSON.stringify({ type: 'ma-timing', id: operation.id, action, ok,
        ms: Math.round(performance.now() - start), stages: operation.timings }));
    }
  });
}

export function maRemaining(maximum: number): number {
  const operation = operations.getStore();
  if (operation?.active && operation.signal?.aborted) throw new AppError(499, 'Catalogue request cancelled.');
  const remaining = operation?.active ? Math.min(maximum, operation.deadline - performance.now()) : maximum;
  if (remaining <= 0) throw new AppError(504, 'Music Assistant action timed out. Refresh playback state before trying again.');
  return remaining;
}

export function maSignal(): AbortSignal | undefined { const operation = operations.getStore(); return operation?.active ? operation.signal : undefined; }

/** A child budget shares correlation/timings, but cannot extend the parent's deadline. */
export async function maBudget<T>(ms: number, work: () => Promise<T>): Promise<T> {
  const parent = operations.getStore();
  if (!parent?.active) return maOperation('confirmation', work, ms);
  const child = { ...parent, deadline: Math.min(parent.deadline, performance.now() + ms) };
  try { return await operations.run(child, work); } finally { child.active = false; }
}

export function maBackground<T>(work: () => T): T { return operations.exit(work); }

/** Stage labels are constants/command names only; never payloads, URLs or media identifiers. */
export function maTiming(stage: string, started: number) {
  const operation = operations.getStore();
  if (operation?.active && operation.logging && operation.timings.length < 256) operation.timings.push({ stage, ms: Math.round(performance.now() - started) });
}

export async function maStage<T>(stage: string, work: () => Promise<T>): Promise<T> {
  const start = performance.now();
  try { return await work(); } finally { maTiming(stage, start); }
}
