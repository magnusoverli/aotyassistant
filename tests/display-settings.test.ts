import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { DisplaySettingsStore, displaySettingsSchema } from '../src/display-settings.js';
import { defaultDisplaySettings, viewingDistance, viewingDistances, type DisplaySnapshot } from '../src/viewing-distance.js';
import { AppError, type State, type View } from '../src/model.js';
import { Engine } from '../src/engine.js';
import { DemoAdapter } from '../src/playback.js';
import { createApp } from '../src/http.js';

async function directory(t: TestContext) {
  const path = await mkdtemp(join(tmpdir(), 'doom-room-display-settings-'));
  t.after(() => rm(path, { recursive: true, force: true })); return path;
}
const defaults = (): DisplaySnapshot => ({ revision: 0, settings: { ...defaultDisplaySettings } });

test('viewing distances grow in order from one default, and unknown values are rejected', () => {
  assert.deepEqual(viewingDistances.map(distance => distance.scale), [.85, 1, 1.25, 1.5]);
  assert.equal(viewingDistance(undefined).id, 'sofa'); assert.equal(viewingDistance(undefined).scale, 1);
  assert.equal(viewingDistance('back').scale, 1.5);
  for (const distance of viewingDistances) assert.equal(displaySettingsSchema.safeParse({ distance: distance.id }).success, true);
  for (const settings of [{ distance: 'huge' }, { distance: 1.5 }, { distance: null }, {}, { distance: 'sofa', scale: 2 }]) {
    assert.equal(displaySettingsSchema.safeParse(settings).success, false);
  }
});

test('a room without a saved size uses the sofa distance without writing; callers cannot mutate saved state', async t => {
  const path = await directory(t); const store = new DisplaySettingsStore(path, () => {});
  const read = await store.read(); assert.deepEqual(read, defaults());
  read.settings.distance = 'back';
  assert.deepEqual(store.view(), defaults());
  await assert.rejects(readFile(join(path, 'display-settings.json')), { code: 'ENOENT' });
});

test('an unreadable display record stays unavailable and is never overwritten by a save', async t => {
  const path = await directory(t); const file = join(path, 'display-settings.json');
  await writeFile(file, '{broken');
  const store = new DisplaySettingsStore(path, () => {}); await store.ready;
  assert.equal(store.view(), null);
  await assert.rejects(store.save(defaults()), (error: AppError) => error.status === 503);
  assert.equal(await readFile(file, 'utf8'), '{broken');
});

test('a saved viewing distance survives restart, broadcasts only committed changes and rejects stale edits', async t => {
  const path = await directory(t); let changes = 0;
  const store = new DisplaySettingsStore(path, () => changes++);
  const saved = await store.save({ revision: 0, settings: { distance: 'back' } });
  assert.deepEqual(saved, { revision: 1, settings: { distance: 'back' } }); assert.equal(changes, 1);
  assert.deepEqual(await new DisplaySettingsStore(path, () => {}).read(), saved);
  await assert.rejects(store.save({ revision: 0, settings: { distance: 'close' } }), (error: AppError) => error.status === 409);
  assert.equal(changes, 1); assert.deepEqual(await store.read(), saved);
});

test('the display API projects the room size to displays only and rejects invalid, cross-origin and stale writes', async t => {
  const dataDir = await directory(t); const saved: DisplaySnapshot = { revision: 3, settings: { distance: 'room' } };
  await writeFile(join(dataDir, 'display-settings.json'), JSON.stringify(saved));
  const server = createServer(); const adapter = new DemoAdapter(3600);
  let closeApp = () => {};
  t.after(() => { closeApp(); adapter.close(); server.closeAllConnections(); server.close(); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const port = (server.address() as AddressInfo).port; const base = `http://127.0.0.1:${port}`;
  let state: State = { schema: 3, room: null };
  const engine = new Engine({ load: async () => structuredClone(state), save: async next => { state = structuredClone(next); } }, adapter, base);
  await engine.init();
  const { app, close } = createApp(engine, { port, listenHost: '127.0.0.1', guestUrl: base, dataDir, demoSeconds: 3600 }, 'web');
  closeApp = close; server.on('request', app);
  const post = (body: unknown, origin = base) => fetch(`${base}/api/host/display-settings`, {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  assert.deepEqual(await (await fetch(`${base}/api/host/display-settings`)).json(), saved);
  assert.deepEqual((await (await fetch(`${base}/api/display/state`)).json() as View).displaySettings, saved);
  assert.equal('displaySettings' in (await (await fetch(`${base}/api/host/state`)).json() as View), false);
  assert.equal((await post(saved, 'https://other.example')).status, 403);
  assert.equal((await post({ ...saved, settings: { distance: 'huge' } })).status, 400);
  assert.equal((await post({ ...saved, settings: { distance: 'back', extra: true } })).status, 400);
  assert.equal((await post({ ...saved, revision: 2 })).status, 409);
  assert.deepEqual(JSON.parse(await readFile(join(dataDir, 'display-settings.json'), 'utf8')), saved);
});
