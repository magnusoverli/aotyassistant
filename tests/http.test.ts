import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { createServer } from 'node:http';
import { Engine } from '../src/engine.js';
import { FileStore } from '../src/store.js';
import { DemoAdapter } from '../src/playback.js';
import { createApp } from '../src/http.js';
import type { Config } from '../src/config.js';
import type { View } from '../src/model.js';

test('HTTP cookies, input validation, role privacy, and filtered/revocable event streams', async t => {
  const server = createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const port = (server.address() as AddressInfo).port;
  const base = `http://127.0.0.1:${port}`;
  const config: Config = { port, listenHost: '127.0.0.1', guestUrl: base,
    dataDir: await mkdtemp('/tmp/opencode/aoty-http-'), mode: 'demo', demoSeconds: 3600 };
  const adapter = new DemoAdapter(3600); const engine = new Engine(new FileStore(config.dataDir), adapter, config.guestUrl);
  await engine.init();
  const { app, close } = createApp(engine, config, 'web');
  server.on('request', app);
  t.after(() => { close(); adapter.close(); server.closeAllConnections(); server.close(); });
  const request = (path: string, data?: unknown, credential = '', origin = config.guestUrl) => fetch(`${base}${path}`, {
    method: data === undefined ? 'GET' : 'POST',
    headers: { ...(data === undefined ? {} : { Origin: origin, 'Content-Type': 'application/json' }), ...(credential ? { Cookie: credential } : {}) },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  });
  const json = async (path: string, data?: unknown, credential = '') => {
    const response = await request(path, data, credential); assert.equal(response.status, 200); return response.json() as Promise<View>;
  };
  assert.equal((await request('/api/host/create', {}, '', 'https://evil.example')).status, 403);
  assert.equal((await request('/api/participant/join', { unexpected: 'field' })).status, 400);
  const host = await json('/api/host/state');
  assert.equal(host.displayUrl, base + '/display'); assert.equal(host.joinUrl, base + '/join');
  const display = await request('/api/display/state'); assert.equal(display.status, 200); assert.equal(display.headers.get('set-cookie'), null);
  const displayCookie = ''; // Fresh displays need no authentication or preexisting cookie.
  const joinGuest = async (nickname: string) => {
    const response = await request('/api/participant/join', { nickname });
    assert.equal(response.status, 200); const cookie = response.headers.get('set-cookie')!;
    assert.match(cookie, /HttpOnly/); assert.match(cookie, /Path=\/api\/participant/);
    const state = await response.json() as View;
    assert.ok(!JSON.stringify(state).includes('credentialHash'));
    return { cookie: cookie.split(';')[0]!, state };
  };
  const alex = await joinGuest('Alex <script>alert(1)</script>'); const sam = await joinGuest('Sam');
  let hostView = await json('/api/host/state');
   assert.equal('phase' in hostView, false); assert.equal(hostView.current?.id, alex.state.me!.id);
  assert.equal('waiting' in hostView, false);
  for (const path of ['/api/host/admit', '/api/host/start', '/api/host/create', '/api/host/end', '/api/host/invitation', '/api/display/auth']) assert.equal((await request(path, { revision: hostView.revision })).status, 404);
  const turnId = hostView.turnId!;
  // Open event streams before playback: these bytes, not just DOM visibility, must be filtered.
  const controllers: AbortController[] = [];
  const openStream = async (path: string, cookie: string) => {
    const controller = new AbortController(); controllers.push(controller);
    const response = await fetch(`${base}${path}`, { headers: { Cookie: cookie }, signal: controller.signal });
    assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
    const reader = response.body!.getReader(); const decoder = new TextDecoder(); let buffer = '';
    return async () => {
      while (!buffer.includes('\n\n')) {
        const part = await reader.read(); if (part.done) throw new Error('Stream unexpectedly ended.');
        buffer += decoder.decode(part.value, { stream: true });
      }
      const index = buffer.indexOf('\n\n'); const frame = buffer.slice(0, index); buffer = buffer.slice(index + 2);
      return frame;
    };
  };
  t.after(() => { for (const controller of controllers) controller.abort(); });
  const displayEvent = await openStream('/api/display/events', displayCookie);
  const samEvent = await openStream('/api/participant/events', sam.cookie);
  const nextState = async (read: () => Promise<string>, matches: (state: View) => boolean) => {
    for (let i = 0; i < 30; i++) {
      const frame = await read(); const state = JSON.parse(frame.split('data: ')[1]!) as View;
      if (matches(state)) return frame;
    }
    throw new Error('The expected stream projection did not arrive.');
  };
  await displayEvent(); await samEvent();
  assert.equal((await request('/api/participant/play', { turnId, previousPlaybackId: null, trackId: 'demo:aurora' }, sam.cookie)).status, 403);
  const own = await json('/api/participant/play', { turnId, previousPlaybackId: null, trackId: 'demo:aurora' }, alex.cookie);
  assert.equal(own.ownPlayback!.track.title, 'Northern Lights');
  for (const frame of [await nextState(displayEvent, state => state.progress?.id === own.ownPlayback!.id), await nextState(samEvent, state => state.revision >= own.revision), JSON.stringify(await json('/api/display/state', undefined, displayCookie))]) {
    for (const sensitive of ['Northern Lights', 'The Paper Satellites', '/demo-cover.svg', 'demo:aurora']) assert.ok(!frame.includes(sensitive));
  }
  const resumed = await json('/api/participant/state', undefined, alex.cookie);
  assert.equal(resumed.me!.id, alex.state.me!.id);
  const playbackId = own.ownPlayback!.id;
  const revealed = await json('/api/participant/reveal', { turnId, playbackId }, alex.cookie);
  assert.ok((await nextState(displayEvent, state => state.revision >= revealed.revision)).includes('Northern Lights'));
  assert.ok(!(await nextState(samEvent, state => state.revision >= revealed.revision)).includes('Northern Lights'));
  const concurrent = await Promise.all([
    request('/api/host/advance', { turnId }), request('/api/participant/finish', { turnId }, alex.cookie),
  ]);
  assert.deepEqual(concurrent.map(r => r.status).sort(), [200, 409]);
  assert.equal((await json('/api/host/state')).current!.nickname, 'Sam');
  const concealed = await nextState(displayEvent, state => state.turnId !== turnId); assert.ok(!concealed.includes('Northern Lights'));
  await nextState(samEvent, state => state.turnId !== turnId);
  assert.equal((await request('/api/participant/reveal', { turnId, playbackId }, alex.cookie)).status, 409);
  hostView = await json('/api/host/state'); await json('/api/host/remove', { id: sam.state.me!.id, revision: hostView.revision });
  assert.match(await samEvent(), /event: revoked/);
  assert.match(await displayEvent(), /event: state/);
  assert.equal((await request('/api/participant/state', undefined, sam.cookie)).status, 401);
  hostView = await json('/api/host/state'); await json('/api/host/remove', { id: alex.state.me!.id, revision: hostView.revision });
  assert.equal((await request('/api/participant/state', undefined, alex.cookie)).status, 401);
  assert.equal((await request('/api/display/state', undefined, displayCookie)).status, 200);
  assert.equal((await request('/api/participant/state')).status, 401);
  const spoofedIngress = await fetch(`${base}/api/display/state`, { headers: { 'X-Ingress-Path': '/host', 'X-Remote-User-Id': 'admin' } });
  assert.equal(spoofedIngress.status, 200);
});
