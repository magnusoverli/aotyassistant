import { docker, image } from './container-fixture.js';
import { randomUUID } from 'node:crypto';

// Real pinned binaries, as the same non-root user as the app. No login, public tunnel,
// host privileges or external network is needed for this packaging contract.
const name = `aoty-tailscale-smoke-${randomUUID()}`;
try {
console.log(await docker('run', '--rm', '--name', name, '--network=none', '--user=node', '--entrypoint=node', image, '--input-type=module', '-e', `
  import assert from 'node:assert/strict';
  import { execFileSync } from 'node:child_process';
  import { mkdtemp, readFile } from 'node:fs/promises';
  import { setTimeout } from 'node:timers/promises';
  import { TailscaleConnector } from './dist/server/tailscale.js';
  assert.notEqual(process.getuid(), 0);
  assert.match(execFileSync('/usr/local/bin/tailscale', ['version'], { encoding: 'utf8' }), /^1\\.104\\.4/);
  assert.match(await readFile('./licenses/tailscale.txt', 'utf8'), /BSD 3-Clause/);
  const dir = await mkdtemp('/tmp/listening-room-tailscale-');
  const connector = new TailscaleConnector(dir, dir + '/run');
  try {
    await connector.start(); let status;
    for (let i = 0; i < 40; i++) {
      try { status = await connector.status(); break; } catch { await setTimeout(250); }
    }
    assert.ok(status, 'Non-root userspace daemon must start');
    assert.equal(status.TUN, false);
    assert.ok(['NoState', 'NeedsLogin', 'Stopped'].includes(status.BackendState));
  } finally { await connector.stop(); }
  await assert.rejects(connector.status());
  console.log('Bundled Tailscale userspace daemon, private socket and shutdown verified.');
`));
} finally { await docker('rm', '--force', name).catch(() => {}); }
