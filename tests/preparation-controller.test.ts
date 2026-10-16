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

test('device revocation fences delayed reads and recovery-key replies', async t => {
  const f = fixture(t); const stream = await f.start();
  const refresh = f.controller.refresh(); const key = f.controller.createRecoveryKey();
  assert.equal(f.controller.saving, true);
  await f.controller.createRecoveryKey(); assert.equal(f.calls.length, 3, 'Only one identity write can be pending.');
  stream.send('revoked');
  f.calls[1]!.resolve(view('owner-a', 1)); f.calls[2]!.resolve({ view: view('owner-a', 2), recoveryKey: 'private-new-key' });
  await Promise.all([refresh, key]);
  assert.equal(f.controller.view, undefined); assert.equal(f.controller.recoveryKey, '');
  assert.equal(f.controller.saving, false); assert.equal(stream.closed, true);
});

test('recovery switches one owner once and ignores the previous stream and delayed requests', async t => {
  const f = fixture(t); const stream = await f.start();
  const refresh = f.controller.refresh(); const recovery = f.controller.recover('owner-b.key', true);
  await f.controller.recover('owner-c.key', true); assert.equal(f.calls.length, 3);
  assert.equal(stream.closed, true);
  f.calls[2]!.resolve(view('owner-b')); await recovery;
  stream.send('state', view('owner-a', 99)); f.calls[1]!.resolve(view('owner-a', 100)); await refresh;
  assert.equal(f.controller.view?.ownerId, 'owner-b'); assert.equal(f.controller.view?.revision, 0);
  assert.equal(f.controller.saving, false); assert.equal(Stream.all.length, 2);
});
