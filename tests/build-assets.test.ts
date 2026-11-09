import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync, brotliCompressSync } from 'node:zlib';
import { checkBuild } from '../scripts/check-build.js';

async function fixture(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), 'doom-room-build-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(join(directory, 'assets')); await mkdir(join(directory, '.vite'));
  const write = (path: string, data: string | Buffer) => writeFile(join(directory, path), data);
  const asset = async (name: string, source: string) => {
    await write(`assets/${name}`, source);
    await write(`assets/${name}.gz`, gzipSync(source));
    await write(`assets/${name}.br`, brotliCompressSync(source));
  };
  const manifest = {
    'index.html': { file: 'assets/index-abcd1234.js', css: ['assets/index-abcd1234.css'], dynamicImports: ['lazy.ts'] },
    'lazy.ts': { file: 'assets/lazy-1234abcd.js', isDynamicEntry: true },
  };
  await write('index.html', '<script type="module" src="./assets/index-abcd1234.js"></script>');
  await write('.vite/manifest.json', JSON.stringify(manifest));
  await asset('index-abcd1234.js', 'export const load = () => import("./lazy-1234abcd.js");');
  await asset('lazy-1234abcd.js', 'export const value = 1;');
  await asset('index-abcd1234.css', 'body { color: black; }');
  return { directory, write, asset, manifest };
}

test('build validation checks entry, lazy chunks, CSS, syntax and both precompressed copies', async t => {
  const f = await fixture(t); await f.write('assets/ui-components.css', 'body { color: black; }');
  assert.equal(await checkBuild(f.directory), 3);
});

for (const encoding of ['gz', 'br']) test(`build validation rejects stale ${encoding} copies`, async t => {
  const f = await fixture(t);
  await f.write(`assets/index-abcd1234.js.${encoding}`, encoding === 'gz' ? gzipSync('stale') : brotliCompressSync('stale'));
  await assert.rejects(checkBuild(f.directory), /Stale/);
});

test('build validation rejects unresolved Vite preload placeholders even in matching compressed copies', async t => {
  const f = await fixture(t); await f.asset('lazy-1234abcd.js', 'export const value = __VITE_PRELOAD__;');
  await assert.rejects(checkBuild(f.directory), /Unresolved preload/);
});

test('build validation rejects missing lazy chunks and output files', async t => {
  const f = await fixture(t);
  await f.write('.vite/manifest.json', JSON.stringify({ 'index.html': f.manifest['index.html'] }));
  await assert.rejects(checkBuild(f.directory), /missing chunk/);
  await f.write('.vite/manifest.json', JSON.stringify(f.manifest));
  await rm(join(f.directory, f.manifest['lazy.ts'].file));
  await assert.rejects(checkBuild(f.directory), { code: 'ENOENT' });
});

test('build validation rejects malformed JavaScript', async t => {
  const f = await fixture(t); await f.asset('lazy-1234abcd.js', 'export const = ;');
  await assert.rejects(checkBuild(f.directory));
});

test('build validation rejects paths escaping the output directory', async t => {
  const f = await fixture(t); f.manifest['lazy.ts'].file = '../private.js';
  await f.write('.vite/manifest.json', JSON.stringify(f.manifest));
  await assert.rejects(checkBuild(f.directory), /escapes build directory/);
});

test('build validation rejects chunks that the immutable asset route cannot serve', async t => {
  const f = await fixture(t); f.manifest['lazy.ts'].file = 'assets/unhashed.js';
  await rm(join(f.directory, 'assets/lazy-1234abcd.js'));
  await f.asset('unhashed.js', 'export const value = 1;');
  await f.write('.vite/manifest.json', JSON.stringify(f.manifest));
  await assert.rejects(checkBuild(f.directory), /Unservable asset/);
});

test('build validation rejects an HTML entry pointing at stale assets', async t => {
  const f = await fixture(t); await f.write('index.html', '<script type="module" src="./assets/old-1234abcd.js"></script>');
  await assert.rejects(checkBuild(f.directory), /HTML must load/);
});
