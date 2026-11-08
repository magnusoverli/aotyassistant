// npm run release -- <version> "<short summary>" [--trailer "<commit trailer>"]...
//
// From main, with the finished changes and their "Unreleased" changelog entries
// (committed or not): checks, release branch, version and changelog date, commit,
// push, application checks on the branch, then the v<version> tag. The publish
// workflow builds and verifies the images, then updates the store (main) and the
// GitHub release. If the branch checks fail, fix them on release/<version>, commit,
// and run the same command again: it continues from the branch.
import { execFileSync, execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { dateChangelog, newerVersion, setVersion, versionPattern } from './release-files.js';

const fail = (message: string): never => { console.error(`\n✖ ${message}`); process.exit(1); };
const step = (message: string) => console.log(`\n→ ${message}`);
const git = (...args: string[]) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const npm = (script: string) => execSync(`npm run --silent ${script}`, { stdio: 'inherit' });

const trailers: string[] = []; const positional: string[] = [];
for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i] === '--trailer') trailers.push(process.argv[++i] ?? ''); else positional.push(process.argv[i]!);
}
const [version = '', summary = ''] = positional;
if (!versionPattern.test(version) || !summary.trim()) fail('Usage: npm run release -- <version> "<short summary>"');
const branch = `release/${version}`; const tag = `v${version}`;
const slug = /github\.com[:/](.+?)(?:\.git)?$/.exec(git('remote', 'get-url', 'origin'))?.[1] ?? fail('origin is not a GitHub repository.');

async function workflowRun(file: string, sha: string) {
  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  const headers = { 'User-Agent': 'listening-room-release', Accept: 'application/vnd.github+json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  const started = Date.now(); let reported = '';
  while (Date.now() - started < 40 * 60_000) {
    await delay(15_000);
    try {
      const response = await fetch(`https://api.github.com/repos/${slug}/actions/workflows/${file}/runs?head_sha=${sha}&event=push&per_page=1`, { headers });
      const run = (await response.json() as { workflow_runs?: { status: string; conclusion: string | null; html_url: string; name: string }[] }).workflow_runs?.[0];
      if (!run) continue;
      if (reported !== run.status) { reported = run.status; console.log(`  ${run.name}: ${run.status} ${run.html_url}`); }
      if (run.status === 'completed') return run;
    } catch { /* Network hiccup: keep waiting. */ }
  }
  return fail(`Timed out waiting for ${file}. Check https://github.com/${slug}/actions`);
}

const current = git('rev-parse', '--abbrev-ref', 'HEAD');
git('fetch', '--quiet', '--tags', 'origin');
if (git('tag', '--list', tag)) fail(`${tag} already exists. Released versions are never reused; choose the next version.`);

if (current === 'main') {
  try { git('merge-base', '--is-ancestor', 'origin/main', 'HEAD'); } catch { fail('main has diverged from origin/main. Bring it up to date first.'); }
  if (git('ls-remote', '--heads', 'origin', branch) || git('branch', '--list', branch)) fail(`${branch} already exists.`);
  const previous = (JSON.parse(readFileSync('package.json', 'utf8')) as { version: string }).version;
  if (!newerVersion(version, previous)) fail(`${version} must be newer than ${previous}.`);
  // Everything that can fail runs before any file is changed.
  const files = { packageJson: readFileSync('package.json', 'utf8'), lock: readFileSync('package-lock.json', 'utf8'),
    config: readFileSync('config.yaml', 'utf8'), dockerfile: readFileSync('Dockerfile', 'utf8') };
  const edits = (() => {
    try { return { ...setVersion(files, previous, version), changelog: dateChangelog(readFileSync('CHANGELOG.md', 'utf8'), version, new Date().toLocaleDateString('sv-SE')) }; }
    catch (error) { return fail((error as Error).message); }
  })();
  step('Typecheck and build'); npm('typecheck'); npm('build');
  step(`Create ${branch} with version ${version}`);
  git('checkout', '-b', branch);
  writeFileSync('package.json', edits.packageJson); writeFileSync('package-lock.json', edits.lock);
  writeFileSync('config.yaml', edits.config); writeFileSync('Dockerfile', edits.dockerfile); writeFileSync('CHANGELOG.md', edits.changelog);
  npm('check:release');
  git('add', '--all');
  execFileSync('git', ['commit', '--quiet', '--file', '-'], { input: [`Release ${version}: ${summary.trim()}`, ...(trailers.length ? ['', ...trailers] : [])].join('\n') + '\n' });
} else if (current !== branch) {
  fail(`Run this from main, or from ${branch} to continue a release.`);
} else {
  if (git('status', '--porcelain')) fail(`Commit the changes on ${branch} first, then run the same command again.`);
  step(`Continue ${branch}`); npm('check:release');
}

const sha = git('rev-parse', 'HEAD');
step(`Push ${branch} and wait for the application checks`);
git('push', '--quiet', '--set-upstream', 'origin', branch);
const checks = await workflowRun('ci.yaml', sha);
if (checks.conclusion !== 'success') fail(`The checks failed: ${checks.html_url}\n  Fix on ${branch}, commit, and run the same command again.`);

step(`Tag ${tag} and publish`);
execFileSync('git', ['tag', '--annotate', tag, '--message', `Listening Room ${version}`]);
git('push', '--quiet', 'origin', tag);
const published = await workflowRun('publish.yaml', sha);
if (published.conclusion !== 'success') fail(`Publishing failed: ${published.html_url}\n  The store still offers the previous version.`);

git('fetch', '--quiet', 'origin'); git('checkout', '--quiet', 'main'); git('merge', '--quiet', '--ff-only', 'origin/main');
console.log(`\n✔ Listening Room ${version} is published, in the Home Assistant store, and has its GitHub release.\n  ${published.html_url}`);
