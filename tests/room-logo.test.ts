import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import sharp from 'sharp';
import { RoomLogo, logoShape, prepareLogo } from '../src/room-logo.js';
import { AppError, type RoomLogoView, type View } from '../src/model.js';
import { Engine } from '../src/engine.js';
import { FileStore } from '../src/store.js';
import { DemoAdapter } from '../src/playback.js';
import { createApp } from '../src/http.js';
import type { Config } from '../src/config.js';

type Colour = [number, number, number, number];

const directory = async (t: TestContext) => {
  const path = await mkdtemp(join(tmpdir(), 'doom-room-logo-'));
  t.after(() => rm(path, { recursive: true, force: true }));
  return path;
};

/** A canvas of `background` with one `ink` rectangle; alpha 0 makes the background transparent. */
async function picture(format: 'png' | 'jpeg', background: Colour, ink: Colour,
  size = { width: 400, height: 200 }, box = { left: 100, top: 60, width: 200, height: 80 }) {
  const pixels = Buffer.alloc(size.width * size.height * 4);
  for (let y = 0; y < size.height; y++) for (let x = 0; x < size.width; x++) {
    const inside = x >= box.left && x < box.left + box.width && y >= box.top && y < box.top + box.height;
    pixels.set(inside ? ink : background, (y * size.width + x) * 4);
  }
  const image = sharp(pixels, { raw: { width: size.width, height: size.height, channels: 4 } });
  return format === 'png' ? image.png().toBuffer() : image.flatten().jpeg({ quality: 95 }).toBuffer();
}

async function shapeOf(png: Buffer) {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const alpha = (x: number, y: number) => data[(y * info.width + x) * 4 + 3]!;
  return { info, alpha, white: data.every((value, index) => index % 4 === 3 || value === 255) };
}

const rejects = (promise: Promise<unknown>, status: number, message: RegExp) =>
  assert.rejects(promise, error => error instanceof AppError && error.status === status && message.test(error.message));

test('a transparent logo keeps its own shape, drawn white and trimmed to its edges', async () => {
  const logo = await prepareLogo(await picture('png', [0, 0, 0, 0], [20, 30, 40, 255]));
  // 200x80 ink plus a margin of 1.5% of its longest side (3px) on every side.
  assert.deepEqual([logo.width, logo.height], [206, 86]);
  const shape = await shapeOf(logo.png);
  assert.equal(shape.white, true, 'Every pixel is white; only its alpha carries the logo.');
  assert.equal(shape.alpha(100, 40), 255); assert.equal(shape.alpha(1, 1), 0);
});

test('opaque logos become one shape, both light-on-dark and dark-on-light', async () => {
  const cases: Array<[Colour, Colour]> = [[[0, 0, 0, 255], [255, 255, 255, 255]], [[255, 255, 255, 255], [10, 10, 10, 255]]];
  for (const [background, ink] of cases) {
    for (const format of ['png', 'jpeg'] as const) {
      const logo = await prepareLogo(await picture(format, background, ink));
      assert.ok(Math.abs(logo.width - 206) <= 3 && Math.abs(logo.height - 86) <= 3, `${format} ${ink}: ${logo.width}x${logo.height}`);
      const shape = await shapeOf(logo.png);
      assert.ok(shape.alpha(100, 40) > 240, 'The artwork is solid.'); assert.ok(shape.alpha(1, 1) < 20, 'The background is clear.');
    }
  }
});

test('large originals are reduced to 1600 pixels on their longest side', async () => {
  const logo = await prepareLogo(await picture('png', [0, 0, 0, 0], [255, 255, 255, 255], { width: 4000, height: 1000 }, { left: 0, top: 0, width: 4000, height: 500 }));
  // Reduced to 1600x400 first; the half-height artwork plus its margin is then about 224px tall.
  assert.equal(logo.width, 1600); assert.ok(logo.height >= 220 && logo.height <= 230, `${logo.height}px tall`);
});

test('vector logos are drawn at the stored size', async () => {
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><rect x="20" y="20" width="160" height="60" fill="#fff"/></svg>');
  const logo = await prepareLogo(svg);
  assert.ok(logo.width > 1200, `Rendered sharply, not at 72 dpi: ${logo.width}px wide.`);
});

test('unsafe, unreadable, oversized and empty images are refused with a clear reason', async () => {
  await rejects(prepareLogo(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><image href="file:///data/options.json"/></svg>')), 400, /links to other files/);
  await rejects(prepareLogo(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><rect style="fill:url(https://example.com/a)"/></svg>')), 400, /links to other files/);
  await rejects(prepareLogo(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')), 400, /scripts/);
  await rejects(prepareLogo(Buffer.from('<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]><svg xmlns="http://www.w3.org/2000/svg">&x;</svg>')), 400, /scripts/);
  await rejects(prepareLogo(Buffer.from('not an image at all')), 415, /PNG, JPEG, WebP or SVG/);
  await rejects(prepareLogo(Buffer.alloc(0)), 400, /Choose an image/);
  await rejects(prepareLogo(Buffer.alloc(10 * 1024 * 1024 + 1)), 413, /larger than 10 MB/);
  await rejects(prepareLogo(await picture('png', [40, 40, 40, 255], [40, 40, 40, 255])), 400, /looks empty/);
  await rejects(prepareLogo(await picture('png', [0, 0, 0, 0], [0, 0, 0, 0])), 400, /looks empty/);
});

test('the shape is trimmed to the artwork and never reaches outside the image', () => {
  const pixels = Buffer.alloc(10 * 10 * 4); // Transparent, with one opaque pixel in the corner.
  pixels[3] = 255;
  const shape = logoShape(pixels, 10, 10)!;
  assert.deepEqual(shape.box, { left: 0, top: 0, width: 1, height: 1 });
});

test('the stored logo survives restarts, changes its version with its pixels, and can be removed', async t => {
  const dataDir = await directory(t);
  let changes = 0;
  const logo = new RoomLogo(dataDir, () => changes++); await logo.ready;
  assert.equal(logo.view(), null);
  const first = await logo.set(await picture('png', [0, 0, 0, 0], [255, 255, 255, 255]));
  assert.match(first.url, /^\/api\/logo\/[a-f0-9]{16}$/); assert.deepEqual([first.width, first.height], [206, 86]);
  assert.deepEqual(logo.image(first.url.split('/').pop()!), await readFile(join(dataDir, 'room-logo.png')));
  const restarted = new RoomLogo(dataDir); await restarted.ready;
  assert.deepEqual(restarted.view(), first);
  const second = await logo.set(await picture('png', [0, 0, 0, 0], [255, 255, 255, 255], undefined, { left: 50, top: 50, width: 300, height: 100 }));
  assert.notEqual(second.url, first.url);
  assert.throws(() => logo.image(first.url.split('/').pop()!), (error: AppError) => error.status === 404);
  await assert.rejects(logo.set(Buffer.from('broken')), (error: AppError) => error.status === 415);
  assert.deepEqual(logo.view(), second, 'A refused upload keeps the current logo.');
  await logo.remove();
  assert.equal(logo.view(), null);
  await assert.rejects(stat(join(dataDir, 'room-logo.png')), { code: 'ENOENT' });
  await logo.remove(); // Removing again is harmless.
  assert.equal(changes, 3);
});

test('the host uploads and removes the logo; every page learns it before its first paint', async t => {
  const server = createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const port = (server.address() as AddressInfo).port;
  const base = `http://127.0.0.1:${port}`;
  const config: Config = { port, listenHost: '127.0.0.1', guestUrl: base, dataDir: await directory(t), demoSeconds: 3600 };
  const adapter = new DemoAdapter(3600); const engine = new Engine(new FileStore(config.dataDir), adapter, config.guestUrl);
  await engine.init();
  const { app, close } = createApp(engine, config, 'web');
  server.on('request', app);
  t.after(() => { close(); adapter.close(); server.closeAllConnections(); server.close(); });
  const upload = (body: Buffer, headers: Record<string, string> = {}) => fetch(`${base}/api/host/logo`, { method: 'POST', body: new Uint8Array(body),
    headers: { Origin: base, 'Content-Type': 'application/octet-stream', ...headers } });
  const page = async () => (await fetch(`${base}/display`)).text();

  assert.deepEqual(await (await fetch(`${base}/api/logo`)).json(), { logo: null });
  assert.doesNotMatch(await page(), /doom-room-logo/);
  const image = await picture('png', [0, 0, 0, 0], [255, 255, 255, 255]);
  assert.equal((await upload(image, { Origin: 'https://evil.example' })).status, 403);
  assert.equal((await upload(image, { 'Content-Type': 'image/png' })).status, 415);
  const tooLarge = await upload(Buffer.alloc(10 * 1024 * 1024 + 1));
  assert.equal(tooLarge.status, 413); assert.match((await tooLarge.json()).error, /larger than 10 MB/);
  const refused = await upload(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><image href="http://example.com/x.png"/></svg>'));
  assert.equal(refused.status, 400); assert.match((await refused.json()).error, /links to other files/);

  const saved = await upload(image); assert.equal(saved.status, 200);
  const { logo } = await saved.json() as { logo: RoomLogoView };
  assert.match(logo.url, /^\/api\/logo\/[a-f0-9]{16}$/);
  assert.deepEqual(await (await fetch(`${base}/api/logo`)).json(), { logo });
  for (const role of ['host', 'display'] as const) assert.deepEqual((await (await fetch(`${base}/api/${role}/state`)).json() as View).logo, logo);
  const served = await fetch(`${base}${logo.url}`);
  assert.equal(served.status, 200); assert.equal(served.headers.get('content-type'), 'image/png');
  assert.equal(served.headers.get('cache-control'), 'public, max-age=31536000, immutable');
  assert.equal((await fetch(`${base}/api/logo/0123456789abcdef`)).status, 404);
  assert.equal((await fetch(`${base}/api/logo/not-a-version`)).status, 400);
  assert.match(await page(), new RegExp(`<meta name="doom-room-logo" content="${logo.url}" data-width="${logo.width}" data-height="${logo.height}">`));

  assert.equal((await fetch(`${base}/api/host/logo/remove`, { method: 'POST', body: '{}', headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json' } })).status, 403);
  const removed = await fetch(`${base}/api/host/logo/remove`, { method: 'POST', body: '{}', headers: { Origin: base, 'Content-Type': 'application/json' } });
  assert.deepEqual(await removed.json(), { logo: null });
  assert.equal((await fetch(`${base}${logo.url}`)).status, 404);
  assert.doesNotMatch(await page(), /doom-room-logo/);
  assert.equal(((await (await fetch(`${base}/api/display/state`)).json()) as View).logo, null);
});
