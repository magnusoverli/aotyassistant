import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Engine } from '../src/engine.js';
import { FileStore } from '../src/store.js';
import { DemoAdapter } from '../src/playback.js';
import { createApp } from '../src/http.js';
import { ingressListener } from '../src/ingress.js';
import { BrowserSpeakers, type BrowserSpeakerView } from '../src/browser-speakers.js';
import type { Config } from '../src/config.js';

for (const ingress of [false, true]) test(`speaker names receive path-scoped participant cookies over ${ingress ? 'Ingress' : 'LAN'}`, async t => {
  const server = createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const port = (server.address() as AddressInfo).port; const origin = `http://127.0.0.1:${port}`;
  const base = ingress ? '/api/hassio_ingress/fixture' : '';
  const config: Config = { port, listenHost: '127.0.0.1', guestUrl: origin,
    dataDir: await mkdtemp(join(tmpdir(), 'aoty-speaker-identity-')), demoSeconds: 3600 };
  const adapter = new DemoAdapter(3600); const engine = new Engine(new FileStore(config.dataDir), adapter, origin); await engine.init();
  const speakers = new BrowserSpeakers(() => ({ origin: 'http://127.0.0.1:8095', token: 'fixture-only', epoch: '1', scope: 'fixture', version: '2.10.9', serverId: 'fixture' }));
  const { app, close } = createApp(engine, config, 'web', undefined, undefined, undefined, undefined, undefined, speakers);
  server.on('request', ingress ? ingressListener(app, '127.0.0.1') : app);
  t.after(() => { speakers.close(); close(); adapter.close(); server.closeAllConnections(); server.close(); });

  // Send cookies only where the browser would, using actual Set-Cookie paths from the app.
  const jar = new Map<string, { pair: string; path: string }>();
  const cookiesFor = (path: string) => [...jar.values()].filter(cookie => path === cookie.path || path.startsWith(cookie.path + '/')).map(cookie => cookie.pair).join('; ');
  const request = async (path: string, data?: unknown) => {
    const response = await fetch(origin + path, {
      method: data === undefined ? 'GET' : 'POST',
      headers: { Cookie: cookiesFor(base + path),
        ...(data === undefined ? {} : { Origin: ingress ? 'https://ha.example' : origin, 'Content-Type': 'application/json' }),
        ...(ingress ? { 'x-ingress-path': base, 'x-forwarded-proto': 'https', 'x-forwarded-host': 'ha.example', 'x-remote-user-id': 'ha-user' } : {}),
      },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    });
    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(';')[0]!; const path = /;\s*Path=([^;]+)/i.exec(cookie)?.[1];
      if (path) jar.set(pair.split('=')[0]! + path, { pair, path });
    }
    return response;
  };
  const register = async () => {
    const response = await request('/api/participant/browser-speaker/register', { id: randomUUID(), clientId: randomBytes(32).toString('base64url'), name: 'Listening Room (Windows PC)', device: 'Windows PC' });
    assert.equal(response.status, 200); return response.json() as Promise<BrowserSpeakerView>;
  };
  const status = async (id: string) => {
    const response = await request(`/api/participant/browser-speaker/session/${id}`);
    assert.equal(response.status, 200); return response.json() as Promise<BrowserSpeakerView>;
  };

  assert.equal((await request('/api/browser-speaker/info')).status, 200);
  const guest = await register(); assert.equal(guest.name, 'Listening Room (Windows PC)');
  assert.equal((await request('/api/participant/join', { nickname: 'Magnus', pin: '1234' })).status, 200);
  assert.ok(!cookiesFor(base + '/api/browser-speaker/register').includes('aoty_participant='));
  assert.ok(cookiesFor(base + '/api/participant/browser-speaker/register').includes('aoty_participant='));
  assert.equal((await status(guest.id)).name, 'Listening Room (Magnus · Windows PC)');
  assert.equal((await register()).name, 'Listening Room (Magnus · Windows PC)');

  assert.equal((await request('/api/participant/logout', {})).status, 200);
  assert.equal((await request(`/api/participant/browser-speaker/session/${guest.id}`)).status, 403);
  const next = await register(); assert.equal(next.name, 'Listening Room (Windows PC)');
  assert.equal((await request('/api/participant/join', { nickname: 'Sam', pin: '5678' })).status, 200);
  assert.equal((await status(next.id)).name, 'Listening Room (Sam · Windows PC)');
});
