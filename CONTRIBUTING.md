# Contributing

Listening Room is a **Home Assistant app** for turn-based music sharing through Music Assistant. Changes should improve that installation and its guest, host, or display experience. Native Node and standalone Docker/Compose deployments are not supported products.

For a bug, use the [issue form](https://github.com/magnusoverli/aotyassistant/issues/new/choose) and include a minimal reproduction with versions and sanitized logs. Discuss substantial architecture or behaviour changes before implementing them. See [SECURITY.md](SECURITY.md) for private vulnerability reports.

## Repository layout

- `src/`: backend, Music Assistant/HA integrations, persistence, and playback.
- `web/`: participant, host, settings, and display interfaces.
- `tests/`: backend/controller tests, synthetic fixtures, and isolated Chromium workflows.
- `scripts/`: release validation, packaged-app smoke tests, and diagnostic audits.
- `config.yaml`, `Dockerfile`, `translations/`: Home Assistant packaging.
- `docs/`: product, architecture, testing, and maintenance documentation.

## Verify a change

These commands run build and test tooling in a source checkout; they are not an installation guide. Use Node.js 24. Browser fixtures create isolated synthetic apps and Music Assistant servers; they require no installed MA instance, speaker, or credentials.

```sh
npm ci
mkdir -p /tmp/opencode
npm run check:release
npm run typecheck
npm test
npm run build
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
- Use **listening room**, **display name**, **Your music**, **Your playlist**, **Play first selection**, **Move to top**, and **Reveal details** consistently. Album and release-year fields describe music, not event rules.
- Describe music discovery and turn-taking, not annual awards, voting, continuous playlist playback, or remote synchronized listening. Scope privacy claims to this app.
- Keep display copy in `src/product.ts` aligned with app/package/image metadata and the GitHub About description. Preserve installation IDs, API paths, cookies, and storage keys during wording changes.
- Keep internal discussions, personal accounts, and temporary progress reports out of product documentation.
- State support requirements and known limitations explicitly. Describe test coverage separately from verified compatibility.
- Keep unpublished changes under **Unreleased**. Add a version and release date only when publication is scheduled.

Before a release, follow [the publishing guide](docs/home-assistant-releases.md) and complete the applicable [validation procedures](docs/testing.md). Contributions are provided under the project’s [MIT license](LICENSE).
