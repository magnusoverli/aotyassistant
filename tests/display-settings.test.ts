import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import type { State, View } from '../src/model.js';
import { Engine } from '../src/engine.js';
import { DemoAdapter } from '../src/playback.js';
import { createApp } from '../src/http.js';

test('obsolete display settings cannot affect or block the automatic display, including corrupt records', async t => {
  const dataDir = await mkdtemp(join(tmpdir(), 'doom-room-auto-display-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  // An upgrade neither needs to parse nor rewrite this retired preference record.
  const legacy = '{obsolete and unreadable';
  await writeFile(join(dataDir, 'display-settings.json'), legacy);
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
  const response = await fetch(`${base}/api/display/state`);
  assert.equal(response.status, 200);
  const view = await response.json() as View;
  assert.equal('displaySettings' in view, false);
  assert.equal(view.background?.settings.enabled, true, 'Background settings still load normally');
  assert.equal(await readFile(join(dataDir, 'display-settings.json'), 'utf8'), legacy);
});
