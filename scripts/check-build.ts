import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';

type Chunk = { file: string; css?: string[]; assets?: string[]; imports?: string[]; dynamicImports?: string[] };

/** Verify emitted artifacts, not intermediate bundler output. No browser or audio is started. */
export async function checkBuild(directory = resolve('dist/web')) {
  const root = resolve(directory);
  const read = (name: string) => {
    const path = resolve(root, name);
    assert.ok(path.startsWith(root + sep), `Asset escapes build directory: ${name}`);
    return readFile(path);
  };
  const manifest = JSON.parse((await read('.vite/manifest.json')).toString()) as Record<string, Chunk>;
  const html = (await read('index.html')).toString();
  assert.ok(Object.keys(manifest).length, 'Build manifest must not be empty');
  assert.equal(manifest['index.html']?.file.endsWith('.js'), true, 'HTML entry must have a script');
  assert.ok(html.includes(`./${manifest['index.html']!.file}`), 'HTML must load the manifest entry');
  const files = new Set<string>();
  for (const [name, chunk] of Object.entries(manifest)) {
    assert.equal(typeof chunk.file, 'string', `${name}: missing output file`);
    for (const dependency of [...chunk.imports ?? [], ...chunk.dynamicImports ?? []]) {
      assert.ok(manifest[dependency], `${name}: missing chunk ${dependency}`);
    }
    for (const file of [chunk.file, ...chunk.css ?? [], ...chunk.assets ?? []]) { await read(file); files.add(file); }
  }
  let checked = 0;
  for (const name of await readdir(resolve(root, 'assets'))) {
    if (!/\.(js|css)$/.test(name)) continue;
    const file = `assets/${name}`;
    const hashed = /^[\w-]+-[\w-]{8}\.(js|css)$/.test(name);
    // Unhashed public styles support server-rendered error pages and are not immutable chunks.
    if (!files.has(file) && !hashed) continue;
    // Keep aligned with src/static-assets.ts: every emitted chunk must be servable.
    assert.ok(hashed, `Unservable asset: ${name}`);
    assert.ok(files.has(file), `Asset is missing from the manifest: ${name}`);
    const bytes = await read(file);
    assert.equal(bytes.includes('__VITE_PRELOAD__'), false, `Unresolved preload placeholder: ${name}`);
    assert.deepEqual(gunzipSync(await read(`${file}.gz`)), bytes, `Stale gzip asset: ${name}`);
    assert.deepEqual(brotliDecompressSync(await read(`${file}.br`)), bytes, `Stale Brotli asset: ${name}`);
    if (name.endsWith('.js')) execFileSync(process.execPath, ['--check', resolve(root, file)], { stdio: 'pipe' });
    checked++;
  }
  assert.ok(checked > 0, 'No script or style assets were built');
  return checked;
}

if (import.meta.main) console.info(`Verified ${await checkBuild()} built assets, lazy chunk references, JavaScript syntax and gzip/Brotli copies.`);
