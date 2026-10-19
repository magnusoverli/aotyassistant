# Release readiness

## 1.0 release scope

The supported product is the Home Assistant app on amd64/aarch64, with Music Assistant schema-65 playback. Existing 0.3.16 installations retain the app slug, storage layout, room, lists, uploads, and settings. The app has a stable store name/stage, MIT licensing, and Home Assistant-only installation documentation.

The release cleanup replaces completed plans, prototypes, and machine-specific work logs with maintained user/maintainer guides. Historical evidence remains in the [0.3.16 snapshot](https://github.com/magnusoverli/aotyassistant/tree/v0.3.16).

## Findings addressed

| Finding | Release change |
| --- | --- |
| Development name and experimental store metadata | Stable **Albums of the Year** branding and 1.0 version metadata |
| README mixed setup, internal design, dated deployments, and unsupported installation methods | Focused README, Home Assistant installation guide, dedicated use/recovery/troubleshooting pages; removed Compose/environment templates |
| Missing reuse and support policy | MIT license, contribution guide, security reporting, and issue templates |
| Backend allowed 25 seconds to drain but Supervisor defaulted to 10 seconds | App shutdown allowance set to 30 seconds |
| Legacy room schemas were silently discarded | Unsupported schemas now fail startup without overwriting stored data |
| Browser and packaged-app tests were outside publishing gates | Shared CI gates Chromium and native amd64/aarch64 package, persistence, audio-format, and backup/restore checks |
| Version and image verification depended on manual steps | Release-metadata/link checker and anonymous multi-architecture registry verification in the publishing workflow |
| Combined-event test assumed unrelated stream events could not interleave | Event-aware assertions retain privacy/revocation checks without depending on incidental timing |

## Evidence and limits

The release-preparation checkout passes release metadata/documentation-link checks, workflow linting, typecheck, production build, and all **253 backend/controller tests**. `npm audit` reports no known vulnerabilities in the current locked dependency tree. Browser and both-architecture package results are recorded below when complete.

Earlier release verification recorded 253 backend/controller tests and 122 isolated Chromium workflows. Existing packaged-app tests cover actual FFprobe/metadata/cover processing, restart persistence, private-list recovery, and backup restore. MA 2.10.6 read-only search, artwork, queue contracts, and protected-file resolution have been exercised against a real server; uploaded-file playback was reported by the owner. A historical HAOS installation passed startup, discovery, Ingress, and hot backup.

These results do **not** establish complete physical-device coverage for the 1.0 build. Record fresh results with each release; do not carry old test counts or deployment claims forward as if rerun.

## Remaining validation and follow-up

- **Physical playback matrix:** exact catalogue/upload recording, speaker and group volume, natural completion, ordinary and long-paused resume, external takeover, network loss, and explicit recovery.
- **Real devices:** iPhone/Safari and Android file pickers, large/interrupted uploads, mobile keyboards, HA companion-app sign-in, and TV/fullscreen behaviour. Chromium fixtures are the automated browser baseline.
- **Installed upgrade and restore:** confirm the 1.0 package on HAOS with retained 0.3.16 data and a real Supervisor restore, including a changed host address.
- **Compatibility maintenance:** review new MA schemas explicitly before expanding the supported playback policy; do not bypass the guard to claim broader support.
- **Credential lifecycle:** consider clearer token-expiry guidance and cleanup/revocation of abandoned authorization tokens where MA provides a supported API.
- **Support diagnostics:** consider an opt-in sanitized diagnostic export. Current issue reports use versions, visible status, and redacted log excerpts.

No automatic playback retry, hosted service, standalone deployment support, or new authenticated-host model is introduced by the release cleanup.
