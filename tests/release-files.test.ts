import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { changelogSection, dateChangelog, newerVersion, setVersion } from '../scripts/release-files.js';

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('a release sets its version in exactly the files that carry it, keeping their line endings', async () => {
  const files = { packageJson: await read('package.json'), lock: await read('package-lock.json'), config: await read('config.yaml'), dockerfile: await read('Dockerfile') };
  const current = JSON.parse(files.packageJson).version as string; const [major, minor, patch] = current.split('.').map(Number);
  const next = `${major}.${minor}.${patch! + 1}`;
  const updated = setVersion(files, current, next);
  assert.equal(JSON.parse(updated.packageJson).version, next);
  const lock = JSON.parse(updated.lock); assert.equal(lock.version, next); assert.equal(lock.packages[''].version, next);
  assert.match(updated.config, new RegExp(`^version: "${next.replaceAll('.', '\\.')}"\\r?$`, 'm'));
  assert.match(updated.dockerfile, new RegExp(`^ARG BUILD_VERSION=${next.replaceAll('.', '\\.')}\\r?$`, 'm'));
  for (const key of Object.keys(files) as (keyof typeof files)[]) {
    assert.equal(updated[key].split('\r\n').length, files[key].split('\r\n').length, `${key} keeps its line endings`);
    assert.equal(updated[key].length, files[key].length + (key === 'lock' ? 2 : 1) * (next.length - current.length));
  }
});

test('a dependency sharing the version before the root entry stops the release instead of being changed', () => {
  const lock = JSON.stringify({ name: 'app', version: '1.0.0', lockfileVersion: 3, packages: { 'node_modules/x': { version: '1.0.0' }, '': { version: '1.0.0' } } }, null, 2);
  assert.throws(() => setVersion({ packageJson: '{\n  "version": "1.0.0"\n}\n', lock, config: 'version: "1.0.0"\n', dockerfile: 'ARG BUILD_VERSION=1.0.0\n' }, '1.0.0', '1.0.1'), /could not be set/);
});

test('the changelog dates the Unreleased entries, keeps an empty Unreleased section and line endings', () => {
  const changelog = '# Changelog\r\n\r\n## [Unreleased]\r\n\r\n- New thing.\r\n\r\n## [1.0.0] — 2026-01-01\r\n\r\n- Old thing.\r\n';
  const dated = dateChangelog(changelog, '1.0.1', '2026-02-03');
  assert.equal(dated, '# Changelog\r\n\r\n## [Unreleased]\r\n\r\n## [1.0.1] — 2026-02-03\r\n\r\n- New thing.\r\n\r\n## [1.0.0] — 2026-01-01\r\n\r\n- Old thing.\r\n');
  assert.equal(changelogSection(dated, '1.0.1'), '- New thing.'); assert.equal(changelogSection(dated, '1.0.0'), '- Old thing.');
  assert.throws(() => dateChangelog(dated, '1.0.2', '2026-02-04'), /Add the release notes/);
  assert.throws(() => dateChangelog(changelog, '1.0.0', '2026-02-04'), /already has/);
  assert.throws(() => changelogSection(dated, '9.9.9'), /no section/);
});

test('versions compare numerically', () => {
  assert.equal(newerVersion('1.1.10', '1.1.9'), true); assert.equal(newerVersion('1.2.0', '1.1.18'), true);
  assert.equal(newerVersion('1.1.18', '1.1.18'), false); assert.equal(newerVersion('1.1.9', '1.1.10'), false);
});
