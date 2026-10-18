import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { gzipSync, brotliCompressSync } from 'node:zlib';
import { Engine } from '../src/engine.js';
import { FileStore } from '../src/store.js';
import { DemoAdapter } from '../src/playback.js';
import { createApp } from '../src/http.js';

test('only hashed public assets are immutable, negotiate precompression and retain correct MIME, length and validators', async t => {
  const dir = await mkdtemp('/tmp/opencode/aoty-static-'); await mkdir(`${dir}/assets`);
  const source = '/* public build */\n'.repeat(200);
  await Promise.all([
    writeFile(`${dir}/assets/index-abcd1234.js`, source), writeFile(`${dir}/assets/index-abcd1234.js.gz`, gzipSync(source)),
    writeFile(`${dir}/assets/index-abcd1234.js.br`, brotliCompressSync(source)), writeFile(`${dir}/assets/record.svg`, '<svg/>'),
    writeFile(`${dir}/assets/ui-components.css`, '.panel { padding:16px; }'),
    writeFile(`${dir}/index.html`, '<html><head></head><body></body></html>'),
  ]);
  const server = createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const port = (server.address() as { port: number }).port; const origin = `http://127.0.0.1:${port}`;
  const demo = new DemoAdapter(); const engine = new Engine(new FileStore(`${dir}/data`), demo, origin); await engine.init();
  const app = createApp(engine, { port, guestUrl: origin, listenHost: '127.0.0.1', dataDir: `${dir}/data`, mode: 'demo', demoSeconds: 30 }, dir); server.on('request', app.app);
  t.after(() => { app.close(); demo.close(); server.closeAllConnections(); server.close(); });
  for (const encoding of ['br', 'gzip', 'identity']) {
    const response = await fetch(`${origin}/assets/index-abcd1234.js`, { headers: { 'Accept-Encoding': encoding } });
    assert.equal(response.status, 200); assert.equal(response.headers.get('content-encoding'), encoding === 'identity' ? null : encoding);
    assert.match(response.headers.get('content-type')!, /javascript/); assert.match(response.headers.get('vary')!, /Accept-Encoding/);
    assert.match(response.headers.get('cache-control')!, /public.*immutable/); assert.equal(await response.text(), source);
    const etag = response.headers.get('etag'); assert.ok(etag);
    const unchanged = await fetch(`${origin}/assets/index-abcd1234.js`, { cache: 'force-cache', headers: { 'Accept-Encoding': encoding, 'If-None-Match': etag } });
    assert.equal(unchanged.status, 304);
  }
  for (const path of ['/host', '/api/host/state', '/assets/record.svg', '/assets/ui-components.css', '/assets/missing-abcd1234.js']) {
    const response = await fetch(origin + path); assert.equal(response.headers.get('cache-control'), 'no-store'); await response.arrayBuffer();
  }
});
