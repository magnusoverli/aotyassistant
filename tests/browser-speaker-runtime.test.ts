import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BrowserSpeakerRuntime, type BrowserAudioPlayer } from '../web/browser-speaker-runtime.js';
import { RequestError } from '../web/request.js';
import type { BrowserSpeakerView } from '../src/browser-speakers.js';

const settle = () => new Promise<void>(resolve => setImmediate(resolve));
function fixture() {
  const calls: string[] = []; const players: Array<BrowserAudioPlayer & { unlocks: number; connects: number; destroys: number }> = [];
  let scheduled: (() => void) | undefined; let action: 'ok' | 'network' | 'revoked' = 'ok';
  let active = true; let paired = false; let pendingUnlock = false; let pendingRegistration: Promise<void> | undefined;
  let id = 0;
  const runtime = new BrowserSpeakerRuntime({
    device: 'Browser', id: () => `session-${++id}`,
    schedule: work => { scheduled = work; return () => { scheduled = undefined; }; },
    create: () => {
      const player = { clientId: 'fixture-client', pairingToken: 'fixture-pairing', isConnected: false, unlocks: 0, connects: 0, destroys: 0,
        unlock() { this.unlocks++; return pendingUnlock ? new Promise<void>(() => {}) : Promise.resolve(); },
        async connect() { this.connects++; this.isConnected = true; },
        disconnect() { this.isConnected = false; }, destroy() { this.destroys++; this.isConnected = false; } };
      players.push(player); return player;
    },
    async request<T>(path: string) {
      calls.push(path);
      if (path === '/api/browser-speaker/stop') return {} as T;
      if (action === 'network') throw new TypeError('Offline');
      if (action === 'revoked') throw new RequestError('Session expired', 403);
      if (path === '/api/browser-speaker/info') return { scope: 'fixture', version: '2.10.9' } as T;
      if (path === '/api/participant/browser-speaker/register') await pendingRegistration;
      if (path === '/api/browser-speaker/pair') paired = true;
      return { id: `session-${id}`, name: 'Browser', active, connected: Boolean(players.at(-1)?.isConnected), paired, expiresAt: 1 } satisfies BrowserSpeakerView as T;
    },
  });
  return { runtime, calls, players, next: async () => { const work = scheduled; scheduled = undefined; work?.(); await settle(); },
    active: (value: boolean) => { active = value; }, network: (value: typeof action) => { action = value; },
    blockUnlock: () => { pendingUnlock = true; }, registration: (promise: Promise<void>) => { pendingRegistration = promise; } };
}

test('automatic registration and pairing do not wait for autoplay permission or require an enable button', async () => {
  const f = fixture(); f.blockUnlock(); f.runtime.start(); await settle();
  assert.equal(f.runtime.state, 'ready'); assert.equal(f.players[0]!.connects, 1);
  assert.ok(f.calls.includes('/api/participant/browser-speaker/register')); assert.ok(f.calls.includes('/api/browser-speaker/pair'));
  f.runtime.unlock(); assert.equal(f.players[0]!.unlocks, 2);
  assert.ok(f.calls.every(path => /^\/api\/(?:participant\/)?browser-speaker\//.test(path))); f.runtime.stop();
});

test('repeated shell initialization, normal gestures and polling preserve the same player and connection', async () => {
  const f = fixture(); f.runtime.start(); await settle();
  f.runtime.start(); f.runtime.unlock(); await f.next(); await f.next();
  assert.ok(f.calls.includes('/api/participant/browser-speaker/session/session-1'));
  assert.equal(f.players.length, 1); assert.equal(f.players[0]!.connects, 1); assert.equal(f.players[0]!.destroys, 0);
  assert.equal(f.calls.filter(path => path.endsWith('/pair')).length, 1); f.runtime.stop();
});

test('standby tabs register silently and connect when the server grants their identity lease', async () => {
  const f = fixture(); f.active(false); f.runtime.start(); await settle();
  assert.equal(f.runtime.state, 'standby'); assert.equal(f.players[0]!.connects, 0);
  f.active(true); await f.next(); assert.equal(f.runtime.state, 'ready'); assert.equal(f.players[0]!.connects, 1);
  f.active(false); await f.next(); assert.equal(f.runtime.state, 'standby'); assert.equal(f.players[0]!.isConnected, false);
  f.runtime.stop();
});

test('a transient HTTP failure preserves audio; a revoked session tears down and can register again', async () => {
  const f = fixture(); f.runtime.start(); await settle(); f.network('network'); await f.next();
  assert.equal(f.players[0]!.destroys, 0); assert.equal(f.runtime.state, 'retrying');
  f.network('ok'); await f.next(); assert.equal(f.runtime.state, 'ready'); assert.equal(f.players.length, 1);
  f.network('revoked'); await f.next(); assert.equal(f.players[0]!.destroys, 1);
  f.network('ok'); await f.next(); assert.equal(f.runtime.state, 'ready'); assert.equal(f.players.length, 2);
  f.runtime.stop();
});

test('leaving during registration cannot reconnect a destroyed player or keep an orphaned session', async () => {
  const f = fixture(); let finish!: () => void;
  f.registration(new Promise<void>(resolve => { finish = resolve; })); f.runtime.start(); await settle();
  f.runtime.stop(); finish(); await settle();
  assert.equal(f.runtime.state, 'stopped'); assert.equal(f.players[0]!.connects, 0); assert.equal(f.players[0]!.destroys, 1);
  assert.ok(f.calls.includes('/api/browser-speaker/stop'));
  await f.next(); assert.equal(f.runtime.state, 'stopped');
});
