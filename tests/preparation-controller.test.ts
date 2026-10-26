import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { PreparationController, type preparationRequest } from '../web/preparation-controller.js';
import type { PreparationView } from '../src/preparations.js';

class Stream extends EventTarget {
  static all: Stream[] = [];
  closed = false;
  constructor(_url: string) { super(); Stream.all.push(this); }
  close() { this.closed = true; }
  send(type: string, value: unknown = {}) { this.dispatchEvent(new MessageEvent(type, { data: JSON.stringify(value) })); }
}

const view = (ownerId = 'owner-a', revision = 0): PreparationView => ({ ownerId, revision,
  capacity: { upcoming: 200, entries: 1000 }, upcoming: [], played: [], removed: [] });

function fixture(t: TestContext) {
  const storage = new Map<string, string>(); Stream.all = [];
  const globals = { navigator: { onLine: true }, EventSource: Stream, localStorage: {
    getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key),
  } };
  for (const [key, value] of Object.entries(globals)) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { value, configurable: true });
    t.after(() => { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); });
  }
  const calls: { path: string; resolve(value: unknown): void; reject(error: Error): void }[] = [];
  const request: typeof preparationRequest = <T>(path: string) => new Promise<T>((resolve, reject) => calls.push({ path, resolve: value => resolve(value as T), reject }));
  const controller = new PreparationController(() => {}, () => true, request);
  t.after(() => controller.stop());
  return { controller, calls, async start() { const pending = controller.start(); calls.at(-1)!.resolve(view()); await pending; return Stream.all.at(-1)!; } };
}

test('a stopped private-list load cannot overwrite a restarted load or clear its loading state', async t => {
  const f = fixture(t); const old = f.controller.start(); f.controller.stop(); const fresh = f.controller.start();
  f.calls[0]!.resolve(view('old-owner')); await old;
  assert.equal(Boolean(f.controller.view), false); assert.equal(f.controller.loading, true);
  f.calls[1]!.resolve(view('new-owner')); await fresh;
  assert.equal(f.controller.view?.ownerId, 'new-owner'); assert.equal(f.controller.loading, false);
});

test('an ended authorization fences delayed reads without offering list recovery', async t => {
  const f = fixture(t); const stream = await f.start();
  const refresh = f.controller.refresh();
  stream.send('revoked');
  f.calls[1]!.resolve(view('owner-a', 1)); await refresh;
  assert.equal(f.controller.view, undefined); assert.doesNotMatch(f.controller.error, /recover/i);
  assert.equal(f.controller.saving, false); assert.equal(stream.closed, true);
});

test('automatic startup and the first add share one list initialization', async t => {
  const f = fixture(t); const first = f.controller.start(); const second = f.controller.ensureOwner();
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0]!.path, '/init');
  f.calls[0]!.resolve(view()); await Promise.all([first, second]);
  assert.equal(f.controller.view?.ownerId, 'owner-a'); assert.equal(f.controller.loading, false);
});
