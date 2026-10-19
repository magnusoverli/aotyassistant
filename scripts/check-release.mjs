import assert from 'node:assert/strict';
import { appendFileSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const root = process.cwd();
const read = path => readFileSync(resolve(root, path), 'utf8');
const pkg = JSON.parse(read('package.json'));
const lock = JSON.parse(read('package-lock.json'));
const manifest = read('config.yaml');
const dockerfile = read('Dockerfile');
const version = pkg.version;
assert.match(version, /^\d+\.\d+\.\d+$/);
assert.equal(lock.version, version, 'Lockfile version');
assert.equal(lock.packages[''].version, version, 'Lockfile root version');
assert.equal(pkg.license, 'MIT');
assert.equal(lock.packages[''].license, pkg.license);
assert.match(read('LICENSE'), /MIT License/);
assert.ok(manifest.includes(`version: "${version}"\n`), 'Manifest version');
assert.ok(dockerfile.includes(`ARG BUILD_VERSION=${version}\n`), 'Image default version');
assert.match(manifest, /^name: Albums of the Year$/m);
assert.match(manifest, /^stage: stable$/m);
assert.match(manifest, /^slug: albums_of_the_year$/m);
assert.match(manifest, /^image: ghcr\.io\/magnusoverli\/aotyassistant$/m);
assert.match(manifest, /^arch:\n  - amd64\n  - aarch64\n/m);
const shutdownMs = Number(/deadline = setTimeout\([^\n]*, ([\d_]+)\)/.exec(read('src/index.ts'))?.[1]?.replaceAll('_', ''));
const supervisorSeconds = Number(/^timeout: (\d+)$/m.exec(manifest)?.[1]);
assert.ok(shutdownMs > 0 && supervisorSeconds * 1000 > shutdownMs, 'Supervisor must allow graceful shutdown to finish');

const changelog = read('CHANGELOG.md');
assert.ok(changelog.includes('## [Unreleased]\n'));
const released = changelog.includes(`## [${version}] — `);
const unreleased = changelog.split('## [Unreleased]\n')[1]?.split('\n## ')[0];
assert.ok(released || unreleased?.includes('\n- '), 'Version needs release notes or pending Unreleased entries');
if (process.env.GITHUB_REF_TYPE === 'tag') {
  assert.equal(process.env.GITHUB_REF_NAME, `v${version}`, 'Tag must match release metadata');
  assert.ok(released, 'Tagged releases require a dated changelog section');
}

// Keep user/maintainer documentation navigable without contacting external sites.
const markdown = readdirSync(root).filter(path => path.endsWith('.md'));
function collect(directory) {
  for (const entry of readdirSync(resolve(root, directory), { withFileTypes: true })) {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) collect(path);
    else if (path.endsWith('.md')) markdown.push(path);
  }
}
collect('docs');
for (const path of markdown) {
  for (const match of read(path).matchAll(/\[[^\]\n]*\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g)) {
    const target = match[1];
    if (/^(?:[a-z]+:|#|\/\/)/i.test(target)) continue;
    const file = decodeURIComponent(target.split('#')[0]);
    if (file) assert.ok(existsSync(resolve(root, dirname(path), file)), `${path}: missing link ${target}`);
  }
}

if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `version=${version}\nimage=ghcr.io/magnusoverli/aotyassistant\n`);
}
console.info(`Release metadata and ${markdown.length} documentation files checked (${version}).`);
