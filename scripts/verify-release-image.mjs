import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const [image, version] = process.argv.slice(2);
assert.match(image ?? '', /^ghcr\.io\/[a-z0-9_.-]+\/[a-z0-9_.-]+$/);
assert.match(version ?? '', /^\d+\.\d+\.\d+$/);
const repository = image.slice('ghcr.io/'.length);
const origin = 'https://ghcr.io';
// Use an anonymous pull token, never the workflow's package-publishing credential.
const tokenResponse = await fetch(`${origin}/token?service=ghcr.io&scope=repository:${repository}:pull`, { signal: AbortSignal.timeout(30_000) });
assert.equal(tokenResponse.status, 200, 'Image must be publicly accessible');
const { token } = await tokenResponse.json();
assert.equal(typeof token, 'string');
const accept = 'application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json';

async function request(path, method = 'GET') {
  let url = new URL(`/v2/${repository}/${path}`, origin);
  for (let redirects = 0; redirects < 5; redirects++) {
    const response = await fetch(url, { method, redirect: 'manual', signal: AbortSignal.timeout(60_000),
      headers: { Accept: accept, ...(url.origin === origin ? { Authorization: `Bearer ${token}` } : {}) } });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location'); assert.ok(location, 'Missing registry redirect');
      url = new URL(location, url); assert.equal(url.protocol, 'https:', 'Insecure registry redirect');
      await response.body?.cancel(); continue;
    }
    assert.equal(response.status, 200, `Anonymous image ${method} failed`);
    return response;
  }
  throw new Error('Too many registry redirects');
}
async function json(path, expectedDigest) {
  const response = await request(path);
  const bytes = Buffer.from(await response.arrayBuffer());
  const digest = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
  if (expectedDigest) assert.equal(digest, expectedDigest, 'Image content digest mismatch');
  const declared = response.headers.get('docker-content-digest');
  if (declared) assert.equal(digest, declared, 'Registry digest mismatch');
  return { value: JSON.parse(bytes.toString('utf8')), digest };
}

const index = await json(`manifests/${version}`);
const images = index.value.manifests.filter(item => item.platform?.os === 'linux' && ['amd64', 'arm64'].includes(item.platform.architecture));
assert.deepEqual(images.map(item => item.platform.architecture).sort(), ['amd64', 'arm64']);
const verified = [];
for (const descriptor of images) {
  const architecture = descriptor.platform.architecture;
  const manifest = await json(`manifests/${descriptor.digest}`, descriptor.digest);
  const config = await json(`blobs/${manifest.value.config.digest}`, manifest.value.config.digest);
  assert.equal(config.value.os, 'linux'); assert.equal(config.value.architecture, architecture);
  const labels = config.value.config.Labels;
  assert.equal(labels['io.hass.version'], version);
  assert.equal(labels['io.hass.arch'], architecture === 'arm64' ? 'aarch64' : 'amd64');
  assert.equal(labels['org.opencontainers.image.source'], `https://github.com/${repository}`);
  assert.equal(labels['org.opencontainers.image.version'], version);
  assert.equal(labels['org.opencontainers.image.licenses'], 'MIT');
  for (const layer of manifest.value.layers) {
    const response = await request(`blobs/${layer.digest}`, 'HEAD');
    const size = response.headers.get('content-length');
    if (size) assert.equal(Number(size), layer.size, 'Layer size mismatch');
  }
  verified.push({ architecture, manifestDigest: manifest.digest, configDigest: config.digest, accessibleLayers: manifest.value.layers.length });
}
console.info(JSON.stringify({ image: `${image}:${version}`, indexDigest: index.digest, anonymousAccess: true, verified }, null, 2));
