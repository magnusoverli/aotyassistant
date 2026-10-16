import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';

test('an occupied listening port fails startup without reporting a running application', { timeout: 10_000 }, async t => {
  const directory = await mkdtemp('/tmp/opencode/aoty-startup-');
  t.after(() => rm(directory, { recursive: true, force: true }));
  const occupied = createServer(); occupied.listen(0, '127.0.0.1'); await once(occupied, 'listening');
  t.after(() => occupied.close());
  const port = (occupied.address() as AddressInfo).port;
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], { env: { ...process.env,
    PORT: String(port), LISTEN_HOST: '127.0.0.1', DATA_DIR: directory, GUEST_URL: `http://127.0.0.1:${port}`, HA_ADDON: '0', PLAYBACK_MODE: 'demo',
  }, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => { if (child.exitCode === null) child.kill('SIGKILL'); });
  let output = ''; let error = '';
  child.stdout.on('data', chunk => { output += chunk; }); child.stderr.on('data', chunk => { error += chunk; });
  const [code] = await once(child, 'close');
  assert.equal(code, 1); assert.doesNotMatch(output, /listening on port/); assert.match(error, /Startup failed/);
  assert.doesNotMatch(error, /node:|at .*\(|EADDRINUSE/);
});
