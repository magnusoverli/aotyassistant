import assert from 'node:assert/strict';
import { appendFileSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { productName, productDescription } from '../src/product.ts';

const root = process.cwd();
// Windows checkouts may use CRLF; the committed files (and these checks) use LF.
const read = path => readFileSync(resolve(root, path), 'utf8').replace(/\r\n/g, '\n');
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
assert.ok(manifest.startsWith(`name: ${productName}\n`), 'App display name');
assert.ok(manifest.includes(`\npanel_title: ${productName}\n`), 'Sidebar display name');
assert.ok(read('repository.yaml').startsWith(`name: ${productName}\n`), 'Repository display name');
assert.equal(pkg.description, productDescription, 'Package description');
assert.ok(manifest.includes(`\ndescription: ${productDescription}\n`), 'App description');
assert.ok(dockerfile.includes(`org.opencontainers.image.title="${productName}"`), 'Image display name');
assert.ok(dockerfile.includes(`org.opencontainers.image.description="${productDescription}"`), 'Image description');
assert.ok(read('web/index.html').includes(`<title>${productName}</title>`), 'Browser entry title');
assert.ok(read('web/index.html').includes(`<meta name="description" content="${productDescription}"`), 'Browser description');
// Rewording must not turn an existing installation into a different app/package.
assert.equal(pkg.name, 'albums-of-the-year', 'Stable package identity');
assert.equal(lock.name, pkg.name, 'Lockfile package identity');
assert.equal(lock.packages[''].name, pkg.name, 'Lockfile root package identity');
assert.match(manifest, /^stage: stable$/m);
assert.match(manifest, /^slug: albums_of_the_year$/m);
assert.match(manifest, /^image: ghcr\.io\/magnusoverli\/aotyassistant$/m);
assert.match(manifest, /^arch:\n  - amd64\n  - aarch64\n/m);

// The same tested LTS runtime must build, type-check and run the packaged app.
const nodeVersion = read('.node-version').trim();
assert.match(nodeVersion, /^\d+\.\d+\.\d+$/, 'Exact Node version');
const nodeMajor = Number(nodeVersion.split('.')[0]);
assert.equal(pkg.engines.node, `>=${nodeVersion} <${nodeMajor + 1}`, 'Supported Node LTS range');
assert.equal(Number(/^\^(\d+)\./.exec(pkg.devDependencies['@types/node'])?.[1]), nodeMajor, 'Node declarations must match the runtime');
const baseImages = [...dockerfile.matchAll(/^FROM (\S+)/gm)].map(match => match[1]);
for (const image of baseImages) assert.match(image, /@sha256:[a-f0-9]{64}$/, `Image must be digest-pinned: ${image}`);
const nodeImages = baseImages.filter(image => image.startsWith('node:'));
assert.equal(nodeImages.length, 2, 'Build and runtime Node images');
assert.equal(nodeImages[0], nodeImages[1], 'Build and runtime must use identical Node images');
assert.ok(nodeImages[0].startsWith(`node:${nodeVersion}-`), 'Image must use the CI/development Node version');
for (const file of readdirSync(resolve(root, '.github/workflows')).filter(file => /\.ya?ml$/.test(file))) {
  const workflow = read(`.github/workflows/${file}`);
  for (const match of workflow.matchAll(/\buses: (\S+)/g)) {
    if (match[1].startsWith('./')) continue;
    assert.match(match[1], /^[\w.-]+\/[\w./-]+@[a-f0-9]{40}$/, `${file}: external actions must be commit-pinned`);
  }
  assert.doesNotMatch(workflow, /\bnode-version:/, `${file}: use the shared .node-version file`);
  if (workflow.includes('actions/setup-node@')) assert.match(workflow, /node-version-file: \.node-version/, `${file}: shared Node runtime`);
}
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
