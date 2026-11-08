/** The edits a release makes: its version in every file that carries one, and a dated
 * changelog section. Line endings are preserved; anything unexpected throws. */
export const versionPattern = /^\d+\.\d+\.\d+$/;
export type VersionedFiles = { packageJson: string; lock: string; config: string; dockerfile: string };

export function newerVersion(next: string, current: string) {
  const [a, b] = [next, current].map(value => value.split('.').map(Number));
  for (let i = 0; i < 3; i++) if (a![i] !== b![i]) return a![i]! > b![i]!;
  return false;
}

const escaped = (value: string) => value.replaceAll('.', '\\.');
function replaceLine(text: string, pattern: RegExp, replacement: string, file: string) {
  if (!pattern.test(text)) throw new Error(`${file}: the current version was not found.`);
  return text.replace(pattern, replacement);
}

export function setVersion(files: VersionedFiles, from: string, to: string): VersionedFiles {
  const field = new RegExp(`"version": "${escaped(from)}"`, 'g');
  const packageJson = replaceLine(files.packageJson, new RegExp(`"version": "${escaped(from)}"`), `"version": "${to}"`, 'package.json');
  // The lockfile repeats the version for the root package only, in its first two entries.
  let count = 0; const lock = files.lock.replace(field, match => ++count <= 2 ? `"version": "${to}"` : match);
  const parsed = JSON.parse(lock); const before = JSON.parse(files.lock);
  if (JSON.parse(packageJson).version !== to || parsed.version !== to || parsed.packages[''].version !== to) throw new Error('The package version could not be set.');
  parsed.version = before.version; parsed.packages[''].version = before.packages[''].version;
  if (JSON.stringify(parsed) !== JSON.stringify(before)) throw new Error('package-lock.json: a dependency shares the version; edit it by hand.');
  return {
    packageJson, lock,
    config: replaceLine(files.config, new RegExp(`^version: "${escaped(from)}"(\\r?)$`, 'm'), `version: "${to}"$1`, 'config.yaml'),
    dockerfile: replaceLine(files.dockerfile, new RegExp(`^ARG BUILD_VERSION=${escaped(from)}(\\r?)$`, 'm'), `ARG BUILD_VERSION=${to}$1`, 'Dockerfile'),
  };
}

/** The entries of a released version's changelog section. */
export function changelogSection(changelog: string, version: string) {
  const text = changelog.replace(/\r\n/g, '\n'); const heading = text.indexOf(`\n## [${version}] — `);
  if (heading < 0) throw new Error(`CHANGELOG.md has no section for ${version}.`);
  const body = text.slice(text.indexOf('\n', heading + 1) + 1); const end = body.search(/^## \[/m);
  return (end < 0 ? body : body.slice(0, end)).trim();
}

/** Moves the Unreleased entries under a dated heading and keeps an empty Unreleased section. */
export function dateChangelog(changelog: string, version: string, date: string) {
  const eol = changelog.includes('\r\n') ? '\r\n' : '\n'; const text = changelog.replace(/\r\n/g, '\n');
  const marker = '## [Unreleased]\n'; const start = text.indexOf(marker);
  if (start < 0) throw new Error('CHANGELOG.md has no "## [Unreleased]" section.');
  if (text.includes(`## [${version}] — `)) throw new Error(`CHANGELOG.md already has a ${version} section.`);
  const rest = text.slice(start + marker.length); const end = rest.search(/^## \[/m);
  if (!/^- /m.test(end < 0 ? rest : rest.slice(0, end))) throw new Error('Add the release notes under "## [Unreleased]" in CHANGELOG.md first.');
  return `${text.slice(0, start + marker.length)}\n## [${version}] — ${date}\n${rest}`.replace(/\n/g, eol);
}
