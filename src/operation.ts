import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { AppError } from './model.js';
import { diagnostics } from './diagnostics.js';

type Timing = { stage: string; ms: number };
type Operation = { id: string; action: string; deadline: number; timings: Timing[]; active: boolean; logging: boolean; signal?: AbortSignal };
const operations = new AsyncLocalStorage<Operation>();
const priorities = new AsyncLocalStorage<'playback' | 'bulk'>();
const pending = new Set<Promise<unknown>>();

export const requestPriority = () => priorities.getStore();
export const playbackResolution = <T>(work: () => T): T => priorities.run('playback', work);
/** Many catalogue reads in a row (importing a list): they may wait in Music Assistant's per-service
 * queue, so they get a longer time limit and their own connections, leaving browsing responsive. */
export const bulkCatalogue = <T>(work: () => T): T => priorities.run('bulk', work);
export function operationWait() {
  const current = operations.getStore();
  return current?.active ? { deadline: current.deadline, signal: current.signal } : {};
}
/** Bound one caller's wait for shared read-only work, without cancelling other callers. */
export function waitForRead<T>(read: Promise<T>): Promise<T> {
  const { deadline, signal } = operationWait();
  return new Promise<T>((resolve, reject) => {
    let timer: NodeJS.Timeout | undefined;
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', aborted); };
    const aborted = () => { cleanup(); reject(new AppError(499, 'Request cancelled.')); };
    const expired = () => { cleanup(); reject(new AppError(504, 'Operation timed out. Refresh the current state before trying again.')); };
    // Always observe the shared promise, including when this caller has already left.
    void read.then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
    if (signal?.aborted) { aborted(); return; }
    if (deadline !== undefined && deadline <= performance.now()) { expired(); return; }
    signal?.addEventListener('abort', aborted, { once: true });
    if (deadline !== undefined) timer = setTimeout(expired, Math.max(1, deadline - performance.now()));
  });
}
export async function drainOperations() {
  while (pending.size) await Promise.allSettled([...pending]);
}

/** One elapsed-time budget across queue waits, DNS, commands and confirmation. No write retries. */
export async function operation<T>(action: string, work: () => Promise<T>, budgetMs = 45_000, signal?: AbortSignal): Promise<T> {
  if (operations.getStore()?.active) return work();
  const start = performance.now();
  const operation: Operation = { id: randomUUID(), action, deadline: start + budgetMs, timings: [], active: true, logging: process.env.DOOM_ROOM_TIMINGS === '1' || process.env.DOOM_ROOM_MA_TIMINGS === '1', signal };
  const result = operations.run(operation, async () => {
    let ok = false; let status: number | undefined;
    try { const result = await work(); ok = true; return result; }
    catch (error) { status = error instanceof AppError ? error.status : 500; throw error; }
    finally {
      operation.active = false;
      diagnostics.record('operation', performance.now() - start);
      if (operation.logging) console.info(JSON.stringify({ type: 'ma-timing', id: operation.id, action, ok, ...(status ? { status } : {}),
        ms: Math.round(performance.now() - start), stages: operation.timings }));
    }
  });
  pending.add(result);
  try { return await result; } finally { pending.delete(result); }
}

export function remaining(maximum: number): number {
  const operation = operations.getStore();
  if (operation?.active && operation.signal?.aborted) throw new AppError(499, 'Request cancelled.');
  const remaining = operation?.active ? Math.min(maximum, operation.deadline - performance.now()) : maximum;
  if (remaining <= 0) throw new AppError(504, 'Operation timed out. Refresh the current state before trying again.');
  return remaining;
}

export function operationSignal(): AbortSignal | undefined { const operation = operations.getStore(); return operation?.active ? operation.signal : undefined; }

/** A child budget shares correlation/timings, but cannot extend the parent's deadline. */
export async function budget<T>(ms: number, work: () => Promise<T>): Promise<T> {
  const parent = operations.getStore();
  if (!parent?.active) return operation('confirmation', work, ms);
  const child = { ...parent, deadline: Math.min(parent.deadline, performance.now() + ms) };
  try { return await operations.run(child, work); } finally { child.active = false; }
}

export function background<T>(work: () => T): T { return operations.exit(work); }

/** Stage labels are constants/command names only; never payloads, URLs or media identifiers. */
export function timing(stage: string, started: number) {
  if (stage.endsWith('-wait')) diagnostics.record('queue-wait', performance.now() - started);
  const operation = operations.getStore();
  if (operation?.active && operation.logging && operation.timings.length < 256) operation.timings.push({ stage, ms: Math.round(performance.now() - started) });
}

export async function stage<T>(stage: string, work: () => Promise<T>): Promise<T> {
  const start = performance.now();
  try { return await work(); }
  catch (error) {
    if (stage === 'persistence') diagnostics.failure('STORAGE');
    throw error;
  } finally {
    if (stage === 'persistence' || stage.startsWith('music/') || stage.startsWith('player') || stage === '/info') {
      diagnostics.record(stage === 'persistence' ? 'persistence' : 'upstream', performance.now() - start);
    }
    timing(stage, start);
  }
}
