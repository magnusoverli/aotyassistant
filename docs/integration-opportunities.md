# Music Assistant / Home Assistant integration opportunities

Reviewed **2026-10-19**, application **0.3.15**. This is a prioritized investigation and implementation proposal.

## Implementation follow-up — 2026-10-19

The four highest-priority findings from the review summary are now implemented:

- **Identity-preserving address changes:** advanced token setup and browser authorization share connection-installation rules. Changed manual addresses are authenticated and checked against the saved server ID outside the playback lane; failed/different-server candidates preserve the old configuration. Speaker validation also persists the observed server ID. First-time offline setup and same-address token replacement retain their existing behavior.
- **Setup synchronization:** sign-in success is correlated with an explicit authorization attempt; unrelated settings revisions cannot report success. Settings streams include versioned addressing snapshots and setup updates, including diagnostic completion, while preserving unsaved address drafts.
- **Runtime recovery:** discovery continues with capped, jittered retries (up to one minute) and healthy network scans approximately every four to five minutes. Connection changes/failures schedule a coalesced scan. Trusted same-server relocation updates API/browser addresses, revalidates media access, and retains source identity, selected speaker, guest origin, and manual media override. The existing playback guard and mDNS trust boundary apply. Find Music Assistant is available for configured connections.
- **Compatibility reporting:** one backend policy supplies supported schemas and installed-version guidance. An unsupported playback schema has an explicit output state/reason, independently of successful speaker and queue checks; the selected speaker stays visible. The verified playback schema remains 65.

Regression coverage is in `tests/integration-recovery.test.ts` and `tests/browser/home-assistant.spec.ts`. The original findings below record the reviewed baseline; credential lifecycle, diagnostic export, CI expansion, and the optional HA bridge remain follow-up proposals.

**Verification:** `npm run typecheck`, `npm test` (**253 tests**), `npm run build`, and the complete `npx playwright test` suite (**122 Chromium workflows**) pass. These checks use isolated synthetic MA; real HA/speaker acceptance remains documented separately.

## Main recommendation

Prioritize identity-preserving reconfiguration, reliable setup-state synchronization, and recovery after network changes. These remove more everyday maintenance than adding another installation component. Then improve compatibility reporting, credential lifecycle, and diagnostics. An optional Home Assistant status/automation bridge is a useful later extension.

The existing foundation is substantial: Supervisor-assisted discovery, MA browser authorization, separate API/browser/media/guest addresses, host Ingress, same-server browser reauthorization, event-assisted speaker monitoring, bounded HTTP transport, exact-recording/queue ownership checks, hot-backup coordination, and prebuilt images are already implemented.

## Priorities

| Priority | Opportunity | User benefit | Relative effort |
| --- | --- | --- | --- |
| 1 | Unify reconfiguration and fix cross-tab setup state | Changing an address or renewing login preserves saved music and gives truthful feedback | Medium |
| 1 | Extend startup discovery into runtime recovery | Fewer manual repairs after DHCP changes, delayed startup, and network/container changes | Medium |
| 1 | Separate compatibility from speaker availability | An MA upgrade produces an actionable explanation instead of suggesting a broken speaker | Small for reporting; medium for a compatibility policy |
| 2 | Manage app-created token expiry and cleanup | Fewer surprise authorization failures and abandoned MA credentials | Medium |
| 2 | Provide a connection diagnostic summary | Users can identify the failing link and share useful support information | Medium |
| 2 | Automate integration contract/browser coverage | Catch upstream and setup regressions before users update | Medium |
| 3 | Optional HA status entities and automation events | Dashboard visibility, alerts, and lighting/display automations | Medium–large |

## 1. Make every setup path identity-aware and synchronize its results

### Confirmed: advanced token setup can strand saved catalogue entries

`src/integrations.ts:377–403` has different identity rules for manual token setup and browser authorization. `save()` preserves the source binding and destination only when the URL is identical; `saveAuthorized()` can preserve them using MA's server ID. Saved selections require the original source binding (`src/integrations.ts:247–255`).

**Reproduced:** configure the fixture through `127.0.0.1`, select its speaker, then save the same server through `localhost` with a valid token. A subsequent check confirms the same MA server ID, but the source binding has changed and the destination is cleared. Existing entries remain stored but cannot resolve through that new binding.

**Recommendation:** use one validated connection-installation path for browser authorization and advanced token entry. Verify the supplied endpoint/token and server ID before deciding whether to retain the catalogue binding and speaker. Represent an offline/unverified replacement explicitly rather than treating a URL change as proof of a new catalogue. Retain explicit handling for an actually different server.

### Confirmed: an unrelated settings revision can report successful sign-in

`web/settings.ts:58–62` interprets any revision change while authorization is pending as “Music Assistant connected.” The backend correctly rejects stale authorization transactions, but the initiating tab can announce success first.

**Reproduced:** start Connect, leave the MA login tab awaiting authorization, and save a guest address from another client. The original tab announces success while the backend is still unconfigured. Completing the stale callback then fails.

**Recommendation:** bind completion feedback to an explicit authorization attempt/result. A changed settings revision should reconcile or invalidate the attempt, not imply success.

### Confirmed: the original settings tab retains stale file-access state

Settings receives integration events, but its addressing panel owns a separate snapshot. `acceptLive()` and `refreshSnapshot()` update the connection without reloading addressing (`web/settings.ts:338–358`); address loading mainly follows local actions (`web/settings.ts:114`).

**Reproduced:** complete browser authorization in the new tab and let that tab verify file access. The original tab shows Music connection **Connected** while Uploaded-file playback still says **Connect Music Assistant to enable file access**. Backend file access is already verified.

**Recommendation:** publish/revalidate dependent addressing state on connection changes and diagnostic completion. Give connection, authorization, discovery, and addressing snapshots explicit revisions/outcomes so a browser can reconcile them without inferring success or launching duplicate checks.

## 2. Recover from changes throughout the application's lifetime

`src/setup.ts:62–71` performs an initial scan and at most four scheduled retries. Once that sequence finishes, the shared monitor checks the saved MA endpoint every 15 seconds (`src/output-monitor.ts:17–20`), but does not rediscover Supervisor addresses or an MA server that moved. The manual **Find Music Assistant** button is only rendered for an unconfigured connection (`web/settings.ts:164–180`).

Additional recovery gaps:

- `relocateServer()` updates the backend URL but retains the old `browserUrl` (`src/integrations.ts:410–420`). Reconnect can therefore still target an obsolete browser address.
- Automatic media candidates are refreshed during setup scans. File verification otherwise depends on explicit/UI-triggered checks; output monitoring does not repair media addressing.
- Supervisor discovery relies on an optional legacy embedded app list and conventional port hints (`src/supervisor.ts:71–85`). Missing enumeration, stopped apps, custom ports, and bridge-network mDNS misses should have distinct explanations.

**Recommendation:** add coalesced runtime rediscovery after sustained reachability failure and infrequent network refreshes, with capped backoff and jitter. Revalidate file access after a meaningful address change or reconnection. Keep rediscovery accessible for configured connections. Refresh the browser login candidate alongside an identity-verified API relocation.

Use the current trust rules: only trusted Supervisor-derived candidates can automatically receive a retained token; mDNS supplies suggestions. Preserve user-chosen guest origins and media overrides, and preserve source identity through verified relocation. Network checks should continue outside the playback command lane.

**Acceptance:** an MA server appearing after startup retries, moving to a new Supervisor-derived address, or returning after a host/network change becomes usable without restarting this app. Guest QR changes remain explicit because browser identities are origin-dependent.

## 3. Make compatibility an explicit integration state

Playback and event authorization require schema **65**, while read-only discovery has a separate compatibility rule (`src/music-assistant-policy.ts`). The frontend also hard-codes 65 (`web/settings.ts:289`).

**Reproduced:** change the synthetic server to schema 66 while retaining an available speaker and a valid queue. Connection and destination checks both succeed, but `src/integrations.ts:93–95` reports the output as unavailable. Settings tells the user to choose another speaker or wait for it to reconnect. A separate schema note is present, but the primary diagnosis is misleading.

**Recommendation:** return a typed playback-blocking reason such as `unsupported-schema`, independently of speaker availability. Show the installed MA version/schema, supported compatibility level, and the relevant app-update guidance. Have the frontend render the backend's policy instead of duplicating the number.

Then introduce a small versioned compatibility table backed by upstream contract fixtures and the playback invariants this application needs: exact recording, queue-item identity, explicit `ended`, pause/resume, repeat/autoplay, and upload resolution. Accept additional versions through verification, rather than simply removing the current gate.

Upstream MA **2.10.7** still declares schema **65**, minimum **28**. The schema-66 reproduction is a forward-compatibility scenario, not evidence that 2.10.7 currently breaks playback. Upstream describes schema increments as additions/non-breaking changes and minimum-schema increments as breaking compatibility [S1].

## 4. Manage the app-created credential lifecycle

Browser Connect creates a long-lived token named “Albums of the Year” on each successful authorization (`src/ma-authorization.ts:76–85`). Cleanup revokes a token from a failed transaction, but successful Reconnect leaves the superseded token in MA. Disconnect removes local credentials only. Expiry is displayed as a date (`web/settings.ts:162`); manually supplied tokens do not receive the same expiry metadata in `save()`.

MA 2.10.6 long-lived tokens expire after one year and do not renew on use [S2].

**Recommendation:**

- Persist provenance and the identifier of tokens this installation creates, with a recognizable installation-specific name.
- Show an actionable expiring/expired state and a direct Reconnect action before the connection fails.
- After confirming a replacement token works and is durably saved, clean up the superseded app-owned token. Reconcile ambiguous persistence before revoking anything.
- Provide app-owned credential cleanup on disconnect, with a recoverable pending-cleanup state if MA is offline. Keep manually supplied credentials distinguishable from app-owned tokens.
- Preserve separate error categories for rejected authentication and insufficient permissions: the transport currently merges HTTP 401 and 403 (`src/music-assistant-transport.ts:75–79`). Use those categories to select retry behavior and guidance.

## 5. Give users one useful diagnostic summary

Existing connection/speaker separation is valuable. Extend it to show the chain **application → MA authorization/compatibility → speaker/queue → MA fetching uploaded media**. Guest-phone access is a separate path and requires a phone/browser check; a successful server-side media check cannot prove guest Wi-Fi reachability.

The app already collects MA version/schema, Supervisor/Core versions, file-check timestamps, and sanitized metrics, but these are scattered across separate snapshots. `/api/host/diagnostics` currently returns aggregate counters (`src/diagnostics.ts`, `src/http.ts:128`), without an integration troubleshooting summary.

**Recommendation:** provide a host-visible **Check connections** result and **Download diagnostics** containing app/MA/Core/Supervisor versions, stable failure codes, check freshness, automatic/manual address provenance, event-connection status, retry state, and backup-paused state. Map each failure to an action: correct DNS, trust the certificate, reconnect authorization, update compatibility, repair the speaker, or verify file routing.

Export an explicit allowlist. Exclude tokens, login/capability URLs, participant identities, song metadata, and raw upstream responses. Link to the verified browser-reachable MA interface for source/player maintenance. Keep dependency health separate from Supervisor's process-liveness watchdog.

## 6. Make upstream and setup regression checks routine

`.github/workflows/ci.yaml` and the release workflow run typecheck, backend tests, and build, but neither runs the browser integration workflows. The existing HA browser tests exercise the callback tab, which explains why the initiating-tab defects above were not covered (`tests/browser/home-assistant.spec.ts:9–34`).

**Recommendation:**

- Run the focused Connect/Reconnect, Ingress, settings-health, and addressing browser workflows in CI and release checks.
- Add the four confirmed regressions above: same-server manual address change, unrelated revision during login, original-tab addressing refresh, and compatibility-specific output diagnosis.
- Add lifecycle fixtures for delayed startup beyond the retry window, post-start address relocation, stale login URLs, expired/revoked credentials, and unavailable Supervisor enumeration.
- Keep versioned, sanitized samples of the actual upstream API/OpenAPI and event shapes. Check required command arguments/fields and artwork constraints against those contracts, rather than relying solely on a mock built from the application assumptions. The prior 128px artwork regression is a concrete example (`CHANGELOG.md`, 0.3.10).
- Complete the documented real HA Companion/Safari authorization and audible playback acceptance: natural completion, parked pause, external takeover, disconnect/recovery, and backup/restore. Fixtures establish software behavior, not physical speaker behavior.

A small documentation cleanup also helps: `DOCS.md:13` still instructs users to press **Save destination**, although selection now applies immediately. Older portions of `PLAN.md` still call implemented Ingress/live-adapter work deferred; clearly mark historical material and keep one current installation/compatibility summary.

## 7. Add an optional Home Assistant status/automation bridge

Home Assistant currently hosts the application and supplies discovery/lifecycle services. A useful next level is an **Albums of the Year** device with connection health, active-output readiness, participant count, playback/ownership state, and a reauthorization-needed indicator. Turn/reveal events could drive lights or display automations.

For installations already using MQTT, opt-in MQTT discovery is a practical first implementation using HA's existing integration [S4]. This introduces a broker dependency, so its value should be evaluated against the simpler in-app diagnostics first. It needs persistent unique IDs, availability/last-will handling, discovery republishing after HA reconnects, and entity cleanup when disabled.

Publish only purpose-built, metadata-free status/events. HA history and automation traces are another persistence surface. Audio actions should continue through the application's existing ownership/turn checks if controls are added later.

Keep direct MA access for playback: the inspected HA 2026.10.0 `music_assistant.get_queue` implementation omits the explicit `ended` field used for reliable turn advancement [S3]. HA status integration can complement the existing adapter without replacing its exact-recording and queue contracts.

## Suggested delivery sequence

1. **Setup correctness:** unify identity-aware reconfiguration; fix authorization completion and cross-tab addressing; report compatibility accurately. Add regression coverage.
2. **Self-recovery:** runtime rediscovery, coordinated address/media refresh, typed failures, and expiry/credential maintenance.
3. **Supportability:** diagnostic summary/export, integration CI, contract fixtures, and current setup documentation.
4. **HA automation:** evaluate the optional metadata-free entity/event bridge after the reliability work.

## Verification performed for this review

- Production build passed: `npm run build`.
- **30** tests passed: `node --import tsx --test tests/home-assistant.test.ts tests/integrations.test.ts tests/output.test.ts`.
- **2** existing HA browser workflows passed: `npx playwright test tests/browser/home-assistant.spec.ts`.
- Additional temporary isolated probes reproduced **three browser defects** and **one same-server reconfiguration defect**, described above. They used local synthetic MA and temporary application storage. The browser probe also asserted that no playback/volume commands were issued.
- Upstream source/documentation was checked for schema semantics/current 2.10.7 constants, token lifetime/revocation, HA queue fields, Supervisor permissions, and MQTT discovery. Physical speaker and installed-HA behavior were not exercised by this review.

## Upstream references

- **S1:** [MA 2.10.7 schema/version constants](https://github.com/music-assistant/server/blob/2.10.7/music_assistant/constants.py) and [generated API documentation](https://www.music-assistant.io/api/).
- **S2:** [MA 2.10.6 token creation, lifetime, and revocation](https://github.com/music-assistant/server/blob/2.10.6/music_assistant/controllers/webserver/auth.py).
- **S3:** [HA Core 2026.10.0 MA media-player/get-queue implementation](https://github.com/home-assistant/core/blob/2026.10.0/homeassistant/components/music_assistant/media_player.py).
- **S4:** [Home Assistant MQTT discovery and availability](https://www.home-assistant.io/integrations/mqtt/#mqtt-discovery).
- **S5:** [Supervisor API permissions and versioning](https://developers.home-assistant.io/docs/api/supervisor/endpoints/).
