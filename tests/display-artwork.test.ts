import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DisplayArtwork, type DisplayArtworkTarget } from '../src/display-artwork.js';
import { packDisplayImages, unpackDisplayImages, type DisplayImages } from '../src/display-artwork-format.js';
import { DisplayArtworkLoader, unlockDisplayArtwork } from '../web/display-artwork.js';
import type { View } from '../src/model.js';

function deferred<T>() {
  let resolve!: (value: T) => void; let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject };
}
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
const images: DisplayImages = { artwork: { body: Uint8Array.from([255, 216, 255, 1]), contentType: 'image/jpeg' },
  artistArtwork: { body: Uint8Array.from([1, 2, 3, 4]), contentType: 'image/png' } };
const base: View = { connected: true, roomId: 'room', turnId: 'turn', revision: 1, current: { id: 'listener', nickname: 'Listener' }, next: null,
  progress: { id: 'playback', status: 'playing', fraction: .1 }, nowPlaying: { revealed: false } };
const revealed: View = { ...base, nowPlaying: { revealed: true, track: { id: 'track', title: 'Hidden song', artist: 'Hidden artist', album: 'Hidden album', duration: 180 } } };

test('only revealed projections carry a key; both HTTPS and LAN HTTP decrypt the same authenticated bundle', async t => {
  const target: DisplayArtworkTarget = { playbackId: 'playback', context: 'owner', references: { artwork: 'private-cover', artistArtwork: 'private-portrait' } };
  const calls: number[] = [];
  const service = new DisplayArtwork(() => target, async (_reference, _context, size) => {
    calls.push(size); const image = size === 1024 ? images.artwork! : images.artistArtwork!;
    return { body: Buffer.from(image.body), contentType: image.contentType };
  });
  const hidden = service.project(base).preparedArtwork!; assert.ok(hidden.id); assert.equal(hidden.key, undefined); assert.equal(calls.length, 0);
  const [first, duplicate] = await Promise.all([service.read(hidden.id), service.read(hidden.id)]);
  assert.deepEqual(first, duplicate); assert.deepEqual(calls.sort((a, b) => a - b), [160, 1024]);
  const key = service.project(revealed).preparedArtwork!.key!;
  assert.deepEqual(await unlockDisplayArtwork(first, key), images);
  const corrupt = new Uint8Array(first); corrupt[corrupt.length - 1]! ^= 1;
  await assert.rejects(unlockDisplayArtwork(corrupt, key));
  const crypto = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: undefined });
  t.after(() => { if (crypto) Object.defineProperty(globalThis, 'crypto', crypto); else Reflect.deleteProperty(globalThis, 'crypto'); });
  assert.deepEqual(await unlockDisplayArtwork(first, key), images, 'Plain HTTP uses software AES-GCM.');
  await assert.rejects(unlockDisplayArtwork(corrupt, key));
  service.close(); await assert.rejects(service.read(hidden.id));
});

test('old preparations expire across track changes, including in-flight reads, and one missing image is optional', async () => {
  let target: DisplayArtworkTarget | undefined = { playbackId: 'playback', context: 'owner', references: { artwork: 'first', artistArtwork: 'missing' } };
  const gate = deferred<void>();
  const service = new DisplayArtwork(() => target, async reference => {
    if (reference === 'missing') throw Error('No portrait');
    if (reference === 'first') await gate.promise;
    return { body: Buffer.from(images.artwork!.body), contentType: 'image/jpeg' };
  });
  const old = service.project(base).preparedArtwork!; const pending = service.read(old.id);
  const rejected = assert.rejects(pending, /expired/);
  target = { ...target, playbackId: 'replacement', references: { artwork: 'second', artistArtwork: 'missing' } };
  const nextView = { ...revealed, progress: { ...revealed.progress!, id: 'replacement' } };
  const next = service.project(nextView).preparedArtwork!; assert.notEqual(next.id, old.id);
  gate.resolve(); await rejected;
  const decoded = await unlockDisplayArtwork(await service.read(next.id), next.key!);
  assert.deepEqual(decoded, { artwork: images.artwork });
  target = undefined; service.refresh(); await assert.rejects(service.read(next.id));
  assert.equal(service.project(base).preparedArtwork, undefined);
});

test('browser prefetches once while hidden and reveal performs only local unlock', async () => {
  let loads = 0; let unlocks = 0; const ready: DisplayImages[] = []; const gate = deferred<Uint8Array>();
  const loader = new DisplayArtworkLoader({ load: async () => { loads++; return gate.promise; },
    unlock: async () => { unlocks++; return images; }, ready: result => ready.push(result), failed() { assert.fail('Unexpected fallback'); } });
  for (let i = 0; i < 5; i++) loader.update({ id: 'preparation' }, 'playback', false);
  gate.resolve(new Uint8Array([1])); await tick(); assert.equal(loads, 1); assert.equal(unlocks, 0); assert.equal(ready.length, 0);
  for (let i = 0; i < 5; i++) loader.update({ id: 'preparation', key: 'reveal-key' }, 'playback', true);
  await tick(); assert.equal(loads, 1); assert.equal(unlocks, 1); assert.deepEqual(ready, [images]);
  loader.clear();
});

test('immediate reveal shares an in-flight download; cancellation fences old decryption and failures fall back once', async () => {
  const loads: { signal: AbortSignal; gate: ReturnType<typeof deferred<Uint8Array>> }[] = []; const unlocking = deferred<DisplayImages>();
  let shown = 0; let failures = 0;
  const loader = new DisplayArtworkLoader({ load: (_id, signal) => {
    const gate = deferred<Uint8Array>(); loads.push({ gate, signal }); return gate.promise;
  }, unlock: () => unlocking.promise, ready: () => { shown++; }, failed: () => { failures++; } });
  loader.update({ id: 'first' }, 'first-track', false); loader.update({ id: 'first', key: 'key' }, 'first-track', true);
  assert.equal(loads.length, 1); loads[0]!.gate.resolve(new Uint8Array([1])); await tick();
  loader.update({ id: 'second' }, 'second-track', false); assert.equal(loads[0]!.signal.aborted, true);
  unlocking.resolve(images); await tick(); assert.equal(shown, 0);
  loads[1]!.gate.reject(Error('Network failed')); await tick(); assert.equal(failures, 0);
  for (let i = 0; i < 3; i++) loader.update({ id: 'second', key: 'key' }, 'second-track', true);
  await tick(); assert.equal(failures, 1); assert.equal(loads.length, 2);
  loader.update(undefined, '', false); assert.equal(loads[1]!.signal.aborted, true);
});

test('binary artwork bundles reject truncation, trailing bytes and non-raster images', () => {
  const packed = packDisplayImages(images); assert.deepEqual(unpackDisplayImages(packed), images);
  assert.throws(() => unpackDisplayImages(packed.subarray(0, packed.length - 1)));
  assert.throws(() => unpackDisplayImages(new Uint8Array([...packed, 0])));
  assert.throws(() => packDisplayImages({ artwork: { body: new Uint8Array([1]), contentType: 'image/svg+xml' } }));
});
