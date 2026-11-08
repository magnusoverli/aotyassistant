// Writes the GitHub release for the version being published (marked latest) from
// its CHANGELOG.md section. Versions published since the newest existing release
// that still have none are written first, so a skipped release is filled in.
// Runs in the publish workflow with the GitHub CLI and GH_TOKEN.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { changelogSection, newerVersion, versionPattern } from './release-files.ts';

const { VERSION: version, IMAGE: image, RUN_URL: runUrl } = process.env;
if (!versionPattern.test(version ?? '') || !image) throw new Error('VERSION and IMAGE are required.');

const run = (command, args) => execFileSync(command, args, { encoding: 'utf8' }).trim();
const newer = (a, b) => newerVersion(a.replace(/^v/, ''), b.replace(/^v/, ''));
const changelog = readFileSync('CHANGELOG.md', 'utf8');
function notes(release, validation) {
  return [
    '## Highlights', '', changelogSection(changelog, release), '',
    '## Upgrade', '', `Refresh the Home Assistant app store, update Listening Room to **${release}**, and reload open Listening Room tabs. Any required action is listed above.`, '',
    '## Verification', '', 'The release workflow passed application checks, the unit and integration suite, native **amd64** and **aarch64** packaged-app tests, both image builds and anonymous public-image verification. Browser tests are opt-in and were not run.',
    ...(validation ? ['', `Validation: ${validation}`] : []), '',
    `Image: \`${image}:${release}\` for **amd64** and **aarch64**.`, '',
  ].join('\n');
}

const directory = mkdtempSync(join(tmpdir(), 'release-notes-'));
function publish(release, latest, validation) {
  const file = join(directory, `${release}.md`); writeFileSync(file, notes(release, validation));
  run('gh', ['release', 'create', `v${release}`, '--verify-tag', '--title', `Listening Room ${release}`, '--notes-file', file, `--latest=${latest}`]);
  console.log(`Wrote the GitHub release for ${release}${latest ? ' (latest)' : ''}.`);
}

const released = new Set(run('gh', ['release', 'list', '--limit', '1000', '--json', 'tagName', '--jq', '.[].tagName']).split('\n').filter(Boolean));
if (released.has(`v${version}`)) { console.log(`The GitHub release for ${version} already exists.`); process.exit(0); }
const newest = [...released].filter(tag => /^v\d+\.\d+\.\d+$/.test(tag)).reduce((a, b) => newer(b, a) ? b : a, 'v0.0.0');
const missing = run('git', ['tag', '--list', 'v*']).split('\n')
  .filter(tag => /^v\d+\.\d+\.\d+$/.test(tag) && !released.has(tag) && newer(tag, newest) && newer(`v${version}`, tag))
  .sort((a, b) => newer(a, b) ? 1 : -1);
for (const tag of missing) publish(tag.slice(1), false);
publish(version, true, runUrl);
