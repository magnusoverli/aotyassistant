import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Engine } from '../src/engine.js';
import { FakePlayback } from './fixtures/fake-playback.js';
import { createApp } from '../src/http.js';
import { AppError, stateSchema, type State } from '../src/model.js';
import type { Store } from '../src/store.js';
import { clockTime, seekPreview } from '../web/seek-bar.js';

class MemoryStore implements Store {
  state: State = { schema: 3, room: null };
  async load() { return stateSchema.parse(structuredClone(this.state)); }
  async save(state: State) { this.state = structuredClone(state); }
}
async function room(seconds = 200) {
  const adapter = new FakePlayback(seconds); const engine = new Engine(new MemoryStore(), adapter, 'http://localhost:3000'); await engine.init();
  const alex = await engine.join('Alex'); const sam = await engine.join('Sam');
  const host = () => engine.view({ kind: 'host' });
  const own = () => engine.view({ kind: 'participant', credential: alex });
  await engine.play(alex, host().turnId!, null, 'demo:aurora');
  return { adapter, engine, alex, sam, host, own, display: () => engine.view({ kind: 'display' }),
    seek: (position: number, credential = alex) => engine.seek(credential, host().turnId!, host().hostPlayback!.id, position),
    close: () => adapter.close() };
}
const rejects = (status: number) => (error: unknown) => error instanceof AppError && error.status === status;

test('the bubble shows the chosen time, and warns only when moving a hidden song past the reveal marker', () => {
  assert.equal(clockTime(0), '0:00'); assert.equal(clockTime(59.9), '0:59'); assert.equal(clockTime(134), '2:14'); assert.equal(clockTime(-3), '0:00');
  assert.deepEqual(seekPreview({ seconds: 134, duration: 250, revealAt: .7, hidden: true }),
    { seconds: 134, fraction: .536, time: '2:14', reveals: false, label: '2:14' });
  const past = seekPreview({ seconds: 175, duration: 250, revealAt: .7, hidden: true });
  assert.equal(past.reveals, true); assert.equal(past.label, '2:55 · Reveals the song');
  assert.equal(seekPreview({ seconds: 175, duration: 250, revealAt: .7, hidden: false }).reveals, false, 'A revealed song has nothing left to reveal.');
  assert.equal(seekPreview({ seconds: 175, duration: 250, hidden: true }).reveals, false, 'Automatic reveal is off.');
  assert.deepEqual(seekPreview({ seconds: 900, duration: 250, revealAt: .7, hidden: true }).seconds, 250, 'Targets stay within the song.');
  assert.equal(seekPreview({ seconds: 10, duration: 0, revealAt: .7, hidden: true }).reveals, false);
});

test('only the participant whose song is playing moves within it, and the song follows', async t => {
  const f = await room(); t.after(f.close);
  await f.seek(120);
  assert.ok(Math.abs(f.own().progress!.elapsed! - 120) < 1);
  assert.ok(Math.abs(f.host().progress!.fraction! - .6) < .01);
  await assert.rejects(f.seek(30, f.sam), rejects(403));
  const id = f.host().hostPlayback!.id;
  await f.engine.control(f.alex, f.host().turnId!, id, 'pause');
  await assert.rejects(f.seek(30), rejects(409), 'A paused song is never moved.');
  await f.engine.control(f.alex, f.host().turnId!, id, 'resume');
  await f.seek(10_000); assert.ok(Math.abs(f.own().progress!.elapsed! - 200) < 1, 'Positions past the end stop at the end.');
  await f.engine.control(f.alex, f.host().turnId!, id, 'stop');
  await assert.rejects(f.seek(30), rejects(409));
  await assert.rejects(f.engine.seek(f.alex, 'stale-turn', id, 30), rejects(409));
});

test('moving a hidden song past the automatic-reveal marker reveals it, as the bubble warned', async t => {
  const f = await room(); t.after(f.close);
  assert.equal(f.own().progress?.autoRevealAt, .7);
  await f.seek(100); f.adapter.onProgress(); await f.engine.drain();
  assert.equal(f.display().nowPlaying?.revealed, false);
  await f.seek(150); f.adapter.onProgress(); await f.engine.drain(); await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(f.display().nowPlaying?.revealed, true);
});

test('participants learn the room’s song-end mode, which decides whether Play pick becomes Next track', async t => {
  const f = await room(); t.after(f.close);
  assert.equal(f.own().songEnd, 'off');
  await f.engine.setAutoplay('same-participant', 0);
  assert.equal(f.own().songEnd, 'same-participant');
  assert.equal(f.engine.view({ kind: 'participant', credential: f.sam }).songEnd, 'same-participant');
  assert.equal(f.host().songEnd, undefined); assert.equal(f.display().songEnd, undefined);
});

test('the seek API is participant-only, validated and cannot be used across the origin boundary', async t => {
  const dataDir = await mkdtemp(join(tmpdir(), 'doom-room-seek-')); t.after(() => rm(dataDir, { recursive: true, force: true }));
  const adapter = new FakePlayback(200); const server = createServer();
  let closeApp = () => {};
  t.after(() => { closeApp(); adapter.close(); server.closeAllConnections(); server.close(); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const port = (server.address() as AddressInfo).port; const base = `http://127.0.0.1:${port}`;
  const engine = new Engine(new MemoryStore(), adapter, base); await engine.init();
  const { app, close } = createApp(engine, { port, listenHost: '127.0.0.1', guestUrl: base, dataDir }, 'web');
  closeApp = close; server.on('request', app);
  const alex = await engine.join('Alex'); await engine.join('Sam');
  const turnId = engine.view({ kind: 'host' }).turnId!;
  await engine.play(alex, turnId, null, 'demo:aurora');
  const playbackId = engine.view({ kind: 'host' }).hostPlayback!.id;
  const post = (path: string, body: unknown, origin = base) => fetch(base + path, { method: 'POST', body: JSON.stringify(body),
    headers: { Origin: origin, 'Content-Type': 'application/json', Cookie: `doom_room_participant=${alex}` } });
  const response = await post('/api/participant/seek', { turnId, playbackId, position: 90 });
  assert.equal(response.status, 200);
  assert.ok(Math.abs((await response.json()).progress.elapsed - 90) < 1);
  for (const position of [-1, 'ninety', null, 86_401]) assert.equal((await post('/api/participant/seek', { turnId, playbackId, position })).status, 400);
  assert.equal((await post('/api/participant/seek', { turnId, playbackId, position: 10, extra: true })).status, 400);
  assert.equal((await post('/api/participant/seek', { turnId, playbackId, position: 10 }, 'https://other.example')).status, 403);
  assert.equal((await post('/api/host/seek', { turnId, playbackId, position: 10 })).status, 404);
});
