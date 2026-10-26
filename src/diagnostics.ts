import { monitorEventLoopDelay } from 'node:perf_hooks';

type Metric = 'operation' | 'queue-wait' | 'queue-depth' | 'upstream' | 'persistence' | 'recovery' | 'playback-read-retry' | 'cleanup-backlog' | 'event-loop';
export type FailureCode = 'TIMEOUT' | 'CANCELLED' | 'BUSY' | 'UPSTREAM' | 'STORAGE' | 'INTERNAL';
const metrics = new Map<Metric, { count: number; total: number; max: number }>();
const failures = new Map<FailureCode, number>();

/** Fixed-cardinality aggregates only: no request bodies, URLs, identities or exceptions. */
export const diagnostics = {
  record(name: Metric, value: number) {
    if (!Number.isFinite(value) || value < 0) return;
    const metric = metrics.get(name) ?? { count: 0, total: 0, max: 0 };
    metric.count++; metric.total += value; metric.max = Math.max(metric.max, value); metrics.set(name, metric);
  },
  failure(code: FailureCode) { failures.set(code, (failures.get(code) ?? 0) + 1); },
  snapshot() { return { metrics: Object.fromEntries([...metrics].map(([name, value]) => [name, { ...value }])), failures: Object.fromEntries(failures) }; },
  start() {
    const loop = monitorEventLoopDelay({ resolution: 20 }); loop.enable();
    const timer = setInterval(() => {
      diagnostics.record('event-loop', loop.max / 1e6); loop.reset();
      if (process.env.AOTY_DIAGNOSTICS === '1') console.info(JSON.stringify({ type: 'backend-diagnostics', ...diagnostics.snapshot() }));
    }, 60_000); timer.unref();
    return () => { clearInterval(timer); loop.disable(); };
  },
};
