# Contributing

Albums of the Year is a **Home Assistant app**. Changes should improve that installation and its guest, host, or display experience. Native Node and standalone Docker/Compose deployments are not supported products.

For a bug, use the [issue form](https://github.com/magnusoverli/aotyassistant/issues/new/choose) and include a minimal reproduction with versions and sanitized logs. Discuss substantial architecture or behaviour changes before implementing them. See [SECURITY.md](SECURITY.md) for private vulnerability reports.

## Repository layout

- `src/`: backend, Music Assistant/HA integrations, persistence, and playback.
- `web/`: participant, host, settings, and display interfaces.
- `tests/`: backend/controller tests, synthetic fixtures, and isolated Chromium workflows.
- `scripts/`: release validation, packaged-app smoke tests, and diagnostic audits.
- `config.yaml`, `Dockerfile`, `translations/`: Home Assistant packaging.
- `docs/`: current user and maintainer guides. Completed work logs live in Git history.

## Verify a change

These commands run build and test tooling in a source checkout; they are not an installation guide. Use Node.js 24. Browser fixtures create isolated synthetic apps and Music Assistant servers; they require no installed MA instance, speaker, or credentials.

```sh
npm ci
mkdir -p /tmp/opencode
npm run check:release
npm run typecheck
npm test
npm run build
npx playwright install --with-deps chromium
npx playwright test
```

The packaged-app suites need Docker and use their own disposable containers/volumes:

```sh
npm run test:container
```

CI runs both suites on native amd64 and aarch64 runners. They exercise actual packaged audio analysis, storage permissions, restart persistence, and backup/restore. They do not contact installed services or establish physical-speaker acceptance.

## Change expectations

- Keep changes focused and use the surrounding TypeScript patterns.
- Add regression coverage for behaviour changes; retain privacy, exact-recording, turn, and playback-ownership checks.
- Preserve acknowledged data. Do not silently reset stored records, discard lists, or reuse development-era restart/data-loss permissions.
- Treat simulator results and physical-device results as different evidence. Record untested behaviour honestly.
- Update user documentation and add a short entry under **Unreleased** in `CHANGELOG.md`.
- Keep screenshots, traces, generated builds, credentials, private data, and machine-specific deployment notes out of Git. Share only sanitized reproductions.

Before a release, follow [the publishing guide](docs/home-assistant-releases.md) and review [remaining validation work](docs/release-readiness.md). Contributions are provided under the project’s [MIT license](LICENSE).
