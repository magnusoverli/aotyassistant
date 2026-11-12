import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express, { type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { catalogueRead, jsonBody } from '../src/http-utils.js';
import { operation, operationSignal } from '../src/operation.js';
import { AppError } from '../src/model.js';
import { applicationOrigin, setupHostAllowed, shareableOrigin } from '../src/addressing.js';
import { musicAssistantUrl } from '../src/lan-network.js';
import { exactFunnel, funnelTarget } from '../src/tailscale.js';
import { createApp } from '../src/http.js';
import { Engine } from '../src/engine.js';
import { FakePlayback } from './fixtures/fake-playback.js';
import type { State } from '../src/model.js';

const gate = <T = void>() => {
  let resolve!: (value: T) => void;
  const pending = new Promise<T>(done => { resolve = done; });
  return { pending, resolve };
};
async function serve(t: TestContext, app: express.Express) {
  const server = createServer(app); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}
const post = (url: string, data: unknown) => fetch(url, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data), signal: AbortSignal.timeout(3000),
});
const errors = (error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (res.destroyed) return;
  res.status(error instanceof z.ZodError ? 400 : error instanceof AppError ? error.status : 500).json({ error: 'Request rejected.' });
};

test('compiled JSON routes retain typed transforms/defaults, reject extra fields and do not mutate input', async t => {
  const app = express(); app.use(express.json()); let calls = 0;
  const schema = z.strictObject({ name: z.string().trim().min(1), size: z.enum(['small', 'large']).default('small') });
  app.post('/input', jsonBody(schema, (input, _req, res) => { calls++; res.json(input); }));
  app.use(errors); const origin = await serve(t, app);
  for (let i = 0; i < 3; i++) {
    const response = await post(origin + '/input', { name: '  Listener  ' });
    assert.equal(response.status, 200); assert.deepEqual(await response.json(), { name: 'Listener', size: 'small' });
  }
  for (const value of [{ name: '' }, { name: 'Listener', foreign: true }, { name: 'Listener', size: 'huge' }]) {
    assert.equal((await post(origin + '/input', value)).status, 400);
  }
  assert.equal(calls, 3, 'Invalid inputs never reach application work.');
  assert.deepEqual(schema.parse({ name: ' Original ' }), { name: 'Original', size: 'small' }, 'The original schema remains usable.');
});

test('Express 5 forwards schema, synchronous and asynchronous handler errors exactly once', async t => {
  const app = express(); app.use(express.json()); let forwarded = 0;
  app.post('/sync', jsonBody(z.strictObject({}), () => { throw new AppError(409, 'Synthetic failure.'); }));
  app.post('/async', jsonBody(z.strictObject({}), async () => { await delay(1); throw new AppError(503, 'Synthetic failure.'); }));
  app.use((error: unknown, req: Request, res: Response, next: NextFunction) => { forwarded++; errors(error, req, res, next); });
  const origin = await serve(t, app);
  assert.equal((await post(origin + '/sync', { extra: true })).status, 400);
  assert.equal((await post(origin + '/sync', {})).status, 409);
  assert.equal((await post(origin + '/async', {})).status, 503);
  assert.equal(forwarded, 3);
});

test('compiled JSON routes match runtime schema outputs and errors for nested requests', () => {
  const schema = z.strictObject({ operation: z.strictObject({ id: z.uuid(), revision: z.number().int().nonnegative() }),
    before: z.uuid().nullable().optional(), title: z.string().trim().min(1) });
  const original = { operation: { id: '11111111-1111-4111-8111-111111111111', revision: 2 }, title: '  Track  ' };
  let parsed: unknown; const handler = jsonBody(schema, value => { parsed = value; });
  const response = {} as Response; const next: NextFunction = () => {};
  handler({ body: original } as Request, response, next);
  assert.deepEqual(parsed, schema.parse(original)); assert.notEqual(parsed, original); assert.equal(original.title, '  Track  ');
  for (const value of [null, {}, { ...original, extra: true }, { ...original, operation: { ...original.operation, revision: -1 } }]) {
    const runtime = schema.safeParse(value); assert.equal(runtime.success, false);
    assert.throws(() => handler({ body: value } as Request, response, next), (error: unknown) => {
      assert.ok(error instanceof z.ZodError); if (!runtime.success) assert.deepEqual(error.issues, runtime.error.issues); return true;
    });
  }
});

test('real room routes compile at registration and preserve strict validation and revision guards', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'doom-room-modern-http-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const adapter = new FakePlayback(); let state: State = { schema: 3, room: null };
  const engine = new Engine({ load: async () => structuredClone(state), save: async value => { state = structuredClone(value); } }, adapter, 'http://localhost:3000');
  t.after(() => adapter.close()); await engine.init();
  const server = createServer(); t.after(() => { server.closeAllConnections(); server.close(); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const port = (server.address() as AddressInfo).port; const origin = `http://127.0.0.1:${port}`;
  const http = createApp(engine, { port, guestUrl: origin, listenHost: '127.0.0.1', dataDir: directory });
  server.on('request', http.app); t.after(http.close);
  assert.equal((await fetch(origin + '/api/health')).status, 200);
  const settings = await (await fetch(origin + '/api/host/playback-settings')).json() as { enabled: boolean; revision: number };
  const change = (value: unknown) => fetch(origin + '/api/host/playback-settings', {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(value), signal: AbortSignal.timeout(3000),
  });
  assert.equal((await change({ enabled: false, revision: settings.revision, extra: true })).status, 400);
  const saved = await change({ enabled: false, revision: settings.revision }); assert.equal(saved.status, 200);
  assert.deepEqual(await saved.json(), { enabled: false, revision: settings.revision + 1 });
  assert.equal((await change({ enabled: true, revision: settings.revision })).status, 409);
});

test('Node 26 native request signals cancel catalogue work after a fully received POST disconnects', { timeout: 5000 }, async t => {
  const app = express(); app.use(express.json()); const entered = gate<AbortSignal>(); const stopped = gate();
  app.post('/read', jsonBody(z.strictObject({}), async (_input, req, res) => {
    try {
      await catalogueRead(req, 'synthetic-read', async () => {
        assert.equal(req.complete, true); assert.equal(operationSignal(), req.signal);
        entered.resolve(req.signal); await delay(10_000, undefined, { signal: operationSignal() });
      });
      res.json({ ok: true });
    } catch (error) { stopped.resolve(); throw error; }
  }));
  app.use(errors); const origin = await serve(t, app);
  const client = httpRequest(origin + '/read', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
  client.on('error', () => {}); t.after(() => client.destroy()); client.end('{}');
  const signal = await entered.pending; assert.equal(signal.aborted, false);
  client.destroy(); await stopped.pending; assert.equal(signal.aborted, true);
});

test('Node 26 upload signals survive body completion and abort during post-transfer analysis on disconnect', { timeout: 5000 }, async t => {
  const app = express(); const entered = gate<AbortSignal>(); const stopped = gate();
  app.post('/upload', async (req, res) => {
    const signal = req.signal;
    try {
      for await (const _chunk of req) { signal.throwIfAborted(); }
      assert.equal(req.complete, true); assert.equal(signal.aborted, false);
      entered.resolve(signal); await delay(10_000, undefined, { signal }); res.json({ ok: true });
    } catch (error) { stopped.resolve(); throw error; }
  });
  app.use(errors); const origin = await serve(t, app);
  const client = httpRequest(origin + '/upload', { method: 'POST' }); client.on('error', () => {});
  t.after(() => client.destroy()); client.end('synthetic audio');
  const signal = await entered.pending; client.destroy(); await stopped.pending; assert.equal(signal.aborted, true);
});

test('Node 26 upload signals abort while request bytes are still arriving', { timeout: 5000 }, async t => {
  const app = express(); const entered = gate<AbortSignal>(); const stopped = gate();
  app.post('/upload', async (req, res) => {
    const signal = req.signal;
    try {
      for await (const _chunk of req) { entered.resolve(signal); signal.throwIfAborted(); }
      res.json({ ok: true });
    } catch (error) { stopped.resolve(); throw error; }
  });
  app.use(errors); const origin = await serve(t, app);
  const client = httpRequest(origin + '/upload', { method: 'POST', headers: { 'Content-Length': '10000' } });
  client.on('error', () => {}); t.after(() => client.destroy()); client.write('partial audio');
  const signal = await entered.pending; client.destroy(); await stopped.pending; assert.equal(signal.aborted, true);
});

test('audio-write operations remain independent of HTTP disconnects', { timeout: 5000 }, async t => {
  const app = express(); app.use(express.json()); const entered = gate<AbortSignal>(); const release = gate(); const committed = gate();
  t.after(() => release.resolve());
  app.post('/write', jsonBody(z.strictObject({}), async (_input, req, res) => {
    await operation('synthetic-write', async () => {
      assert.equal(operationSignal(), undefined); entered.resolve(req.signal); await release.pending; committed.resolve();
    });
    res.json({ ok: true });
  }));
  app.use(errors); const origin = await serve(t, app);
  const client = httpRequest(origin + '/write', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
  client.on('error', () => {}); t.after(() => client.destroy()); client.end('{}');
  const signal = await entered.pending; const disconnected = once(signal, 'abort'); client.destroy(); await disconnected;
  release.resolve(); await committed.pending;
});

test('Zod 4.6 boolean validation preserves origin restrictions and exact Funnel policy', () => {
  for (const schema of [applicationOrigin, musicAssistantUrl]) {
    for (const value of ['http://127.0.0.1:8095', ' http://homeassistant.local:8095 ', 'https://[fd12::1]:8095',
      'not a URL', 'http://supervisor', 'ftp://localhost', 'http://localhost/secret', 'http://user:pass@localhost', null, 42]) {
      assert.equal(schema.validate(value), schema.safeParse(value).success, String(value));
    }
  }
  assert.equal(setupHostAllowed('homeassistant.local:3000', '192.168.1.5'), true);
  assert.equal(setupHostAllowed('arbitrary.example:3000', '192.168.1.5'), false);
  assert.equal(shareableOrigin('http://localhost:3000'), false);
  const host = 'room.example.ts.net'; const hp = `${host}:443`;
  const config = { TCP: { '443': { HTTPS: true } }, Web: { [hp]: { Handlers: { '/': { Proxy: funnelTarget } } } }, AllowFunnel: { [hp]: true } };
  assert.equal(exactFunnel(config, host), true);
  assert.equal(exactFunnel({ ...config, Extra: true }, host), false);
  assert.equal(exactFunnel({ ...config, Web: { [hp]: { Handlers: { '/': { Proxy: 'http://127.0.0.1:3000' } } } } }, host), false);
});
