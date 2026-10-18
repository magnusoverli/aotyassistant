# Application responsiveness — 0.3.8

## Delivered changes

- **Smooth player progress:** the browser paints progress about every 80 ms and updates the visible seconds without waiting for the next MA observation. Same-recording samples correct the clock, small corrections ease over one second, and pause/offline freeze immediately. Extrapolation is capped at five seconds and the known duration. Pending starts and unrevealed public progress never acquire estimated elapsed time/duration. The clock sends no requests, commands or completion events; only authoritative natural completion may advance a turn.
- **One participant event connection:** `/api/participant/preparations/live` receives both path-scoped HttpOnly credentials and carries distinct room and private-list events. Membership and private-device revocation remain independent; a private revocation does not remove room controls, and removal returns to the separate owner-only feed. Slow clients retain the latest event per channel, never an unbounded queue. Periodic private authorization remains, but unchanged lists use a comment heartbeat instead of retransmitting full contents.
- **Targeted private-list updates:** save state/list changes update the list and Add buttons, not the search form, result rows or player. Upcoming entries retain their nodes and current order-dependent actions. History creates no entry rows while closed and expands 50 entries at a time. Focus, scroll, drafts, explicit recovery and permanent deletion remain supported.
- **Static delivery:** Vite prebuilds Brotli/gzip representations. Only hashed public JS/CSS receive immutable one-year caching and content negotiation/validators, including through Ingress. Named fallback CSS, HTML, APIs, private images and media retain `no-store`. No new runtime dependency is required.
- **Private snapshot reuse:** file-backed preparations retain up to 64 validated immutable snapshots within a 32 MiB serialized-byte cache budget. Every access stats the path and checks device/inode/size/nanosecond modification/change times; changed, missing, corrupt and oversized files invalidate the cached entry. Mutating loads receive separate clones. Authorization and artwork post-download checks are never skipped, and unsuccessful/uncertain saves invalidate the cache. Persistence still uses atomic replacement and file/directory synchronization.
- **Short room transactions:** audio actions keep a dedicated ordered lane, while resolution, upstream writes and confirmation run outside the room commit lane. Reservations and final commits recheck participant/turn/previous-playback identity and merge into the latest room state, preserving concurrent joins/reordering. A saved head is durably marked before audio; the owner read lane is then released while edits/review/duplicate Play remain blocked. Failed/uncertain attempts retain explicit review, and revoked devices receive no private bookkeeping response.
- **Other waiting:** replacement searches cancel old read-only work; speaker saves reuse their fresh inventory instead of discovering it again; optional file checks have a separate busy state and cannot rewind newer settings revisions. Unchanged settings focus/setup reads no longer remount the form. The original 128px thumbnail request was rejected by MA; the 0.3.10 correction uses supported 160px result/list thumbnails and small portraits, 512px player covers and 1024px display album covers after reveal. Uploaded cover handling is unchanged.

## Verification and measurements

Production build, typecheck, **223 backend/controller tests** and all **98 Chromium workflows** pass. The existing **33-scenario synthetic MA audit** passes, retaining six-request configured Play (~1,218 ms with +200 ms/request) and prompt Pause behind a held poll (~6 ms). Local Docker/container smoke checks were not run because this environment has no Docker CLI; release images are built by the existing multi-architecture publication workflow.

Same local synthetic audit before/after; rendering uses Chromium with 4× CPU slowdown. Edit-mode medians are four alternating toggles, not production p50/p95 statistics. Backend/HTTP samples are unthrottled local runs. Neither these samples nor the tests measure physical-phone or audible-speaker performance.

| Scenario | 0.3.7 | 0.3.8 |
| --- | ---: | ---: |
| Edit order, 20 upcoming entries: median synchronous work | 46 ms | 22 ms |
| Edit order, 200 upcoming + 800 closed-history entries: median | 453 ms | 103 ms |
| Elements mounted for that large list | 15,128 | 4,727 |
| One Remove: elements created / whole-workspace replacements | 45,221 / 3 | 99 / 0 |
| 20 authorized thumbnail requests, 625 KB owner record | 548 ms | 72 ms |
| Large private-state HTTP read | 27 ms | 8 ms |
| Health request with three participant tabs | timed out at 2,000 ms | 4 ms |
| Join while Play's upstream queue read is held for 300 ms | ~311 ms | 2 ms |
| JS/CSS body delivery on a cold direct-app request | ~172 KB, uncompressed | ~56 KB, gzip |

The new assets are slightly larger uncompressed because of the added functionality; compressed delivery and immutable reuse remove most transfer cost. The thumbnail sample now reuses a validated snapshot instead of loading/parsing the entire owner record twice per image. The server still stats/re-authorizes each request, including its post-download check. Named fallback CSS is explicitly excluded from hashed-asset handling.

The browser progress regression suppresses server progress events while leaving synthetic playback active, checks multiple in-between progress values and visible elapsed seconds, then verifies pause/offline freezing. Other regressions cover zero detachments of unchanged upcoming rows, bounded lazy history, replacement-search cancellation, independent file diagnostics, source/device revocation, corrupt warm caches, slow audio with concurrent room edits, and durable/private saved-play reservation outcomes.

Local audit sources/results are retained outside Git under `/tmp/opencode/aoty-performance-review.mjs`, `/tmp/opencode/aoty-performance-review-results.json` (before), `/tmp/opencode/aoty-038-performance-results.json` (after), and `/tmp/opencode/aoty-038-ma-audit.json`. The MA audit is reproducible with `npx tsx scripts/ma-latency-audit.ts`; the performance/privacy regressions run with the normal unit/browser suites.

Relevant regressions: `tests/responsiveness.test.ts`, `tests/static-assets.test.ts`, `tests/browser/responsiveness.spec.ts`, `tests/preparation-http.test.ts`, and `tests/http-utils.test.ts`, alongside the existing suite.

## Remaining limits

The app still supports one process per data directory. Large JSON mutations and durable synchronization are not replaced by a database, and uploaded-file integrity hashes remain in the explicit Add/Play paths. Progressive per-provider browse results and cross-tab shared workers are not introduced: the per-page stream consolidation addresses the reproduced three-tab stall without adding cross-tab private-data coordination. Real audible provider/player startup and physical-phone acceptance remain installation-specific checks.
