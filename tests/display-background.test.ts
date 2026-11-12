import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { DisplayBackground, backgroundSettingsSchema } from '../src/display-background.js';
import { defaultBackgroundSettings, type BackgroundSnapshot } from '../src/background-settings.js';
import { AppError, type State, type View } from '../src/model.js';
import { Engine } from '../src/engine.js';
import { FakePlayback } from './fixtures/fake-playback.js';
import { createApp } from '../src/http.js';

async function directory(t: TestContext) {
  const path = await mkdtemp(join(tmpdir(), 'doom-room-background-'));
  t.after(() => rm(path, { recursive: true, force: true })); return path;
}
const defaults = (): BackgroundSnapshot => ({ revision: 0, settings: { ...defaultBackgroundSettings } });

test('background controls reject nonfinite, out-of-range, unknown and malformed values', () => {
  for (const change of [{ jitter: 1.1 }, { duration: 0 }, { duration: 60.1 }, { spread: -1 }, { fade: -1 }, { hold: 31 },
    { sprouts: 2.5 }, { sprouts: 5 }, { seed: Infinity }, { seed: -1 }, { seed: 1.5 },
    { opacity: NaN }, { opacity: 2 }, { width: 80 }, { width: 101 }, { order: 'unknown' }, { loop: 'true' }, { unexpected: true },
    { continuous: 'true' }, { coverage: 0 }, { coverage: 96 }, { cycleDuration: 1 }, { cycleDuration: 121 },
    { qrPlacement: 'unknown' }, { qrPlacement: null }]) {
    assert.equal(backgroundSettingsSchema.safeParse({ ...defaultBackgroundSettings, ...change }).success, false);
  }
  assert.equal(backgroundSettingsSchema.safeParse({ ...defaultBackgroundSettings, seed: 7, loop: false }).success, true);
});

test('existing and slow-growth settings load without losing their saved controls', async t => {
  const path = await directory(t); const file = join(path, 'display-background.json');
  for (const duration of [1.1, 4, 15, 60]) {
    const saved = { revision: 5, settings: { ...defaultBackgroundSettings, duration, seed: 7 } };
    assert.deepEqual(backgroundSettingsSchema.parse(saved.settings), saved.settings);
    await writeFile(file, JSON.stringify(saved));
    const background = new DisplayBackground(path, () => {});
    assert.deepEqual(await background.read(), saved);
  }
});

test('missing background settings use enabled defaults without writing; callers cannot mutate saved state', async t => {
  const path = await directory(t); const background = new DisplayBackground(path, () => {});
  const read = await background.read(); assert.deepEqual(read, defaults());
  read.settings.enabled = false;
  assert.deepEqual(background.view(), defaults());
  await assert.rejects(readFile(join(path, 'display-background.json')), { code: 'ENOENT' });
});

test('pre-continuous saved settings gain defaults without enabling the new mode or rewriting the record', async t => {
  const path = await directory(t); const file = join(path, 'display-background.json');
  const settings: Record<string, unknown> = { ...defaultBackgroundSettings, duration: 30, loop: false, seed: 7 };
  delete settings.continuous; delete settings.coverage; delete settings.cycleDuration;
  const original = JSON.stringify({ revision: 8, settings }); await writeFile(file, original);
  const background = new DisplayBackground(path, () => {});
  assert.deepEqual(await background.read(), { revision: 8, settings: { ...settings, continuous: false, coverage: 40, cycleDuration: 20 } });
  assert.equal(await readFile(file, 'utf8'), original);
});

test('older appearance records keep the bottom-right QR placement without rewriting', async t => {
  const path = await directory(t); const file = join(path, 'display-background.json');
  const { qrPlacement, ...settings } = defaultBackgroundSettings;
  const original = JSON.stringify({ revision: 6, settings }); await writeFile(file, original);
  const background = new DisplayBackground(path, () => {});
  assert.deepEqual(await background.read(), { revision: 6, settings: { ...settings, qrPlacement } });
  assert.equal(await readFile(file, 'utf8'), original);
});

test('saved background widths are retired without losing animation settings or rewriting the file', async t => {
  const path = await directory(t); const file = join(path, 'display-background.json');
  for (const width of [20, 80, 100]) {
    const settings = { ...defaultBackgroundSettings, continuous: true, duration: 30, seed: 7, opacity: .18 };
    const original = JSON.stringify({ revision: 9, settings: { ...settings, width } });
    await writeFile(file, original);
    const background = new DisplayBackground(path, () => {});
    assert.deepEqual(await background.read(), { revision: 9, settings });
    assert.equal('width' in background.view()!.settings, false);
    assert.equal(await readFile(file, 'utf8'), original);
  }
});

test('unreadable background records stay unavailable and are never overwritten by a save', async t => {
  const path = await directory(t); const file = join(path, 'display-background.json');
  await writeFile(file, '{broken');
  const background = new DisplayBackground(path, () => {}); await background.ready;
  assert.equal(background.view(), null);
  await assert.rejects(background.save(defaults()), (error: AppError) => error.status === 503);
  assert.equal(await readFile(file, 'utf8'), '{broken');
});

test('saved background settings survive restart, broadcast only committed changes and reject stale edits', async t => {
  const path = await directory(t); let changes = 0;
  const background = new DisplayBackground(path, () => changes++);
  const input = defaults(); input.settings.seed = 7; input.settings.loop = false; input.settings.fade = 1.25;
  input.settings.continuous = true; input.settings.coverage = 65; input.settings.cycleDuration = 45;
  input.settings.qrPlacement = 'play-order';
  const saved = await background.save(input);
  assert.equal(saved.revision, 1); assert.equal(changes, 1);
  const restored = new DisplayBackground(path, () => {});
  assert.deepEqual(await restored.read(), saved);
  await assert.rejects(background.save(input), (error: AppError) => error.status === 409);
  assert.equal(changes, 1); assert.deepEqual(await background.read(), saved);
  const replay = await background.save(saved);
  assert.equal(replay.revision, 2, 'Saving unchanged controls explicitly replays on the display.');
  assert.deepEqual(replay.settings, saved.settings);
});

test('background API projects saved settings to the display and rejects invalid, cross-origin and stale writes', async t => {
  const dataDir = await directory(t); const saved = { ...defaults(), revision: 3 };
  saved.settings.seed = 7; saved.settings.enabled = false;
  saved.settings.continuous = true; saved.settings.coverage = 65; saved.settings.cycleDuration = 45;
  saved.settings.qrPlacement = 'play-order';
  const stored = JSON.stringify({ ...saved, settings: { ...saved.settings, width: 80 } });
  await writeFile(join(dataDir, 'display-background.json'), stored);
  const server = createServer(); const adapter = new FakePlayback(3600);
  let closeApp = () => {};
  t.after(() => { closeApp(); adapter.close(); server.closeAllConnections(); server.close(); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const port = (server.address() as AddressInfo).port; const base = `http://127.0.0.1:${port}`;
  let state: State = { schema: 3, room: null };
  const engine = new Engine({ load: async () => structuredClone(state), save: async next => { state = structuredClone(next); } }, adapter, base);
  await engine.init();
  const { app, close } = createApp(engine, { port, listenHost: '127.0.0.1', guestUrl: base, dataDir }, 'web');
  closeApp = close; server.on('request', app);
  const post = (body: unknown, origin = base) => fetch(`${base}/api/host/background-settings`, {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  assert.deepEqual(await (await fetch(`${base}/api/host/background-settings`)).json(), saved);
  assert.deepEqual((await (await fetch(`${base}/api/display/state`)).json() as View).background, saved);
  assert.equal((await post(saved, 'https://other.example')).status, 403);
  assert.equal((await post({ ...saved, settings: { ...saved.settings, duration: -10 } })).status, 400);
  assert.equal((await post({ ...saved, settings: { ...saved.settings, width: 80 } })).status, 400);
  assert.equal((await post({ ...saved, revision: 2 })).status, 409);
  assert.equal(await readFile(join(dataDir, 'display-background.json'), 'utf8'), stored);
});
