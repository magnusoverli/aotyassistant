import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { setTimeout } from 'node:timers/promises';
import type { View } from '../src/model.js';
import type { IntegrationView } from '../src/integrations.js';
import type { PreparationView, PreparationResult } from '../src/preparations.js';
import { docker, image, availablePort } from './container-fixture.js';

const port = await availablePort();
let origin = `http://127.0.0.1:${port}`;
const volume = `aoty-smoke-${randomUUID()}`;
let container = '';
try {
  await docker('volume', 'create', volume);
  container = await docker('run', '--detach', '--rm', '--publish', `127.0.0.1:${port}:3000`, '--volume', `${volume}:/data`,
    '--env', `GUEST_URL=${origin}`, image);
  const waitReady = async () => {
    for (let attempt = 0; attempt < 50; attempt++) {
      try {
        const response = await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(1000) });
        if (response.ok && (await response.json()).ok) return;
      } catch { /* Container may still be starting. */ }
      await setTimeout(100);
    }
    const logs = await docker('logs', container).catch(() => 'Container exited before inspection.');
    const shape = await docker('run', '--rm', '--network', 'none', '--read-only', '--cap-drop', 'ALL', '--user', '1000:1000', '--volume', `${volume}:/data:ro`, '--entrypoint', 'node', image, '--input-type=module', '-e',
      `import {readFile} from 'node:fs/promises';import {stateSchema} from '/app/dist/server/model.js';const value=JSON.parse(await readFile('/data/state.json','utf8'));const parsed=stateSchema.safeParse(value);console.log(JSON.stringify(parsed.success?'valid':parsed.error.issues.map(issue=>({code:issue.code,path:issue.path}))));`).catch(() => 'Saved-record inspection unavailable.');
    throw new Error(`Container did not become healthy. ${logs}\nSaved record shapes: ${shape}`);
  };
  await waitReady();
  const process = await docker('exec', container, 'cat', '/proc/1/status');
  assert.match(process, /Uid:\s+1000\s+1000\s+1000\s+1000/);
  assert.equal(await docker('exec', container, 'stat', '-c', '%a', '/data'), '700');
  const created = await fetch(`${origin}/api/host/state`);
  assert.equal(created.status, 200);
  const room = await created.json() as View;
  assert.ok(room.roomId); assert.equal(room.current, null);
  assert.equal((await fetch(origin + '/api/display/state')).status, 200);
  const post = (path: string, data: unknown, cookie = '') => fetch(origin + path, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify(data) });
  const joined = await post('/api/participant/join', { nickname: 'Container listener' }); assert.equal(joined.status, 200);
  const membership = joined.headers.get('set-cookie')!.split(';')[0]!;
  const initialized = await post('/api/participant/preparations/init', {}, membership); assert.equal(initialized.status, 200);
  const libraryCookie = initialized.headers.get('set-cookie')!.split(';')[0]!; const credentials = `${membership}; ${libraryCookie}`;
  let library = await initialized.json() as PreparationView;
  for (const trackId of ['demo:aurora', 'demo:summer']) {
    const added = await post('/api/participant/preparations/add', { trackId, operation: { id: randomUUID(), revision: library.revision, issuedAt: Date.now() } }, credentials);
    assert.equal(added.status, 200); library = (await added.json() as PreparationResult).view;
  }
  const moved = await post('/api/participant/preparations/move', { entryId: library.upcoming[1]!.id, beforeId: library.upcoming[0]!.id, operation: { id: randomUUID(), revision: library.revision, issuedAt: Date.now() } }, libraryCookie);
  assert.equal(moved.status, 200); library = (await moved.json() as PreparationResult).view;
  const savedLibrary = library;
  const guestOrigin = origin.replace('127.0.0.1', 'localhost');
  const addressing = await fetch(origin + '/api/host/addressing'); assert.equal(addressing.status, 200);
  const addresses = await addressing.json() as { revision: number };
  const addressSaved = await post('/api/host/addressing/guest', { origin: guestOrigin, revision: addresses.revision }); assert.equal(addressSaved.status, 200);
  origin = guestOrigin; // Subsequent full-control requests must use the newly configured Host.
  const before = await (await fetch(origin + '/api/host/state')).json() as View;
  assert.equal(new URL(before.joinUrl!).origin, guestOrigin);
  const settingsResponse = await fetch(`${origin}/api/host/integrations`);
  const initialSettings = await settingsResponse.json() as IntegrationView;
  const savedSettings = await fetch(`${origin}/api/host/integrations/save`, {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: 'http://127.0.0.1:8095', accessToken: 'container-fixture-token', revision: initialSettings.revision }),
  });
  assert.equal(savedSettings.status, 200);
  assert.ok(!(await savedSettings.text()).includes('container-fixture-token'));
  await docker('restart', container); await waitReady();
  const response = await fetch(`${origin}/api/host/state`); const after = await response.json() as View;
  assert.equal(after.roomId, before.roomId);
  assert.equal(after.current?.id, before.current?.id);
  assert.deepEqual(after.active!.map(person => person.nickname), ['Container listener']);
  assert.equal('waiting' in after, false);
  assert.notEqual(after.turnId, before.turnId);
  assert.equal(after.revision, before.revision + 1);
  assert.equal(new URL(after.joinUrl!).origin, guestOrigin);
  const addressRestored = await (await fetch(origin + '/api/host/addressing')).json() as { guestOrigin: string };
  assert.equal(addressRestored.guestOrigin, guestOrigin, 'UI-selected guest origin overrides deployment defaults across restart.');
  const restoredSettings = await (await fetch(`${origin}/api/host/integrations`)).json() as IntegrationView;
  assert.equal(restoredSettings.tokenConfigured, true); assert.equal(restoredSettings.status, 'not-checked');
  assert.ok(!JSON.stringify(restoredSettings).includes('container-fixture-token'));
  const restored = await fetch(origin + '/api/participant/preparations/state', { headers: { Cookie: libraryCookie } }); assert.equal(restored.status, 200);
  const restoredLibrary = await restored.json() as PreparationView;
  assert.equal(restoredLibrary.revision, savedLibrary.revision);
  assert.deepEqual(restoredLibrary.upcoming.map(entry => entry.id), savedLibrary.upcoming.map(entry => entry.id));
  assert.deepEqual(restoredLibrary.upcoming.map(entry => entry.title), ['Late Summer', 'Northern Lights']);
  assert.ok(restoredLibrary.upcoming.every(entry => entry.sourceAvailable === false));
  const initializedAgain = await post('/api/participant/preparations/init', {}, membership); assert.equal(initializedAgain.status, 200);
  assert.equal((await initializedAgain.json() as PreparationView).ownerId, library.ownerId);
  for (const path of ['/api/host/admit', '/api/host/start', '/api/host/create', '/api/host/end', '/api/host/invitation', '/api/display/auth']) assert.equal((await post(path, { revision: after.revision })).status, 404);
  const saved = JSON.parse(await docker('exec', container, 'node', '--input-type=module', '-e', `import {readFile} from 'node:fs/promises';const state=JSON.parse(await readFile('/data/state.json','utf8'));console.log(JSON.stringify({schema:state.schema,session:'session' in state,playback:state.room.playback}));`));
  assert.deepEqual(saved, { schema: 3, session: false, playback: null });
  const memberState = await fetch(origin + '/api/participant/state', { headers: { Cookie: membership } }); assert.equal(memberState.status, 200);
  assert.equal((await fetch(origin + '/api/display/state')).status, 200);
  console.info('Container smoke passed: persistent room/membership, public display, removed lifecycle APIs, settings/guest URL and the same automatic list survive restart.');
} finally {
  if (container) await docker('stop', '--time', '5', container).catch(() => {});
  await docker('volume', 'rm', volume).catch(() => {});
}
