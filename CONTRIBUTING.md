# Contributing

Doom Room is a **Home Assistant app** for turn-based music sharing through Music Assistant. Changes should improve that installation and its guest, host, or display experience. Native Node and standalone Docker/Compose deployments are not supported products.

For a bug, use the [issue form](https://github.com/magnusoverli/doom-room/issues/new/choose) and include a minimal reproduction with versions and sanitized logs. Discuss substantial architecture or behaviour changes before implementing them. See [SECURITY.md](SECURITY.md) for private vulnerability reports.

## Repository layout

- `src/`: backend, Music Assistant/HA integrations, persistence, and playback.
- `web/`: participant, host, settings, and display interfaces.
- `tests/`: backend/controller tests, synthetic fixtures, and isolated Chromium workflows.
- `scripts/`: release validation, packaged-app smoke tests, and diagnostic audits.
- `config.yaml`, `Dockerfile`, `translations/`: Home Assistant packaging.
- `docs/`: product, architecture, testing, and maintenance documentation.

## Verify a change

These commands run build and test tooling in a source checkout; they are not an installation guide. Use Node.js 26 LTS (the exact version is in `.node-version`). Run the full persistence suite on Linux: it checks directory synchronization and Unix permissions, which native Windows cannot establish. Browser fixtures create isolated synthetic apps and Music Assistant servers; they require no installed MA instance, speaker, or credentials.

```sh
npm ci
mkdir -p /tmp/opencode
npm run check:release
npm run typecheck
npm test
npm run build
npm run check:build
```

Playwright is opt-in, not part of default local or CI checks. Run it only when explicitly requested. To opt in locally:

```sh
npx playwright install --with-deps chromium
npx playwright test
```

In GitHub Actions, manually dispatch **Application checks** with **run_browser_tests** enabled. Push, pull-request and release checks skip Playwright by default.

The packaged-app suites need Docker and use their own disposable containers/volumes:

```sh
npm run test:container
```

CI runs both suites on native amd64 and aarch64 runners. They exercise actual packaged audio analysis, storage permissions, restart persistence, and backup/restore. They do not contact installed services or establish physical-speaker acceptance.

## Dependency maintenance

`renovate.json` covers npm, Docker image tags/digests, GitHub Actions and `.node-version`. Enable the Renovate GitHub app for this repository to receive update pull requests; configuration alone does not activate the service. Updates are not automatically merged. Node.js and its declarations stay on the tested LTS major until an explicit migration is reviewed.

Keep `.node-version`, both Node image references in `Dockerfile`, `package.json` engines and `@types/node` aligned. `check:release` rejects runtime drift and unpinned images/actions. Review upstream migration notes for major releases, regenerate the lockfile with npm, and run all default checks plus both native package suites. `npm outdated` checks direct versions; `npm audit` also covers build/test dependencies. Do not force incompatible transitive versions just to make every indirect dependency report as latest.

Vite 8 uses Rolldown/Oxc and Lightning CSS without compatibility fallbacks. Its Baseline browser target is independent of the server's Node runtime. `check:build` verifies the emitted manifest and lazy chunks, JavaScript syntax, immutable-route-compatible filenames and byte-exact gzip/Brotli copies without launching a browser. Retain the post-write compression hook and release-specific filenames when changing the build.

For JSON routes, build schemas at registration with `jsonBody`, not inside a request callback. Keep schema transforms/refinements pure and preserve strictness and normalization. Use `.validate()` only when the parsed output/error is not needed. Only read-only catalogue work follows native HTTP disconnect signals; do not attach those signals to audio writes. The [modern implementation choices](docs/architecture.md#modern-implementation-choices) explain the applicable APIs and intentional exceptions.

## Change expectations

- Keep changes focused and use the surrounding TypeScript patterns.
- Add regression coverage for behaviour changes; retain privacy, exact-recording, turn, and playback-ownership checks.
- Preserve acknowledged data. Storage-format changes require a documented migration or recovery path.
- Treat simulator results and physical-device results as different evidence. Record untested behaviour honestly.
- Update user documentation and add a short entry under **Unreleased** in `CHANGELOG.md`.
- Keep screenshots, traces, generated builds, credentials, private data, and machine-specific deployment notes out of Git. Share only sanitized reproductions.

## Documentation style

- Describe product behaviour in the present tense. Use neutral language and direct instructions, such as “Select a speaker”.
- Use exact interface labels in procedures. Distinguish participant, host, and public-display access.
- Use **Doom Room** for the app and its room. Use **display name**, **Your music**, **Your playlist**, **Play first selection**, and **Reveal details** consistently. Album and release-year fields describe music, not event rules.
- Describe music discovery and turn-taking, not annual awards, voting, continuous playlist playback, or remote synchronized listening. Scope privacy claims to this app.
- Keep display copy in `src/product.ts` aligned with app/package/image metadata and the GitHub About description. Preserve installation IDs, API paths, cookies, and storage keys during wording changes.
- Keep internal discussions, personal accounts, and temporary progress reports out of product documentation.
- State support requirements and known limitations explicitly. Describe test coverage separately from verified compatibility.
- Keep unpublished changes under **Unreleased**. Add a version and release date only when publication is scheduled.

Before a release, follow [the publishing guide](docs/home-assistant-releases.md) and complete the applicable [validation procedures](docs/testing.md). Contributions are provided under the project’s [MIT license](LICENSE).
