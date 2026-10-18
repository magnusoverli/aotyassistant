# Albums of the Year — implementation plan and progress

## Status

**0.3.5 release — 2026-10-18:** the shared listening order is an always-visible compact bar beneath the header. Remove the participant My list player shortcut and simplify navigation to page links. Release build/typecheck, 192 unit/controller tests and all 93 Chromium workflows pass. Publication uses the `v0.3.5` workflow, with anonymous amd64/arm64 image verification before updating the store branch. See the [shared-layout follow-up](docs/shared-page-layout.md). Screenshots remain local/ignored.

**0.3.4 release — 2026-10-18:** one shared participant-style listening-order disclosure beneath the header across all six application routes, with host management and names-only live updates on entry/settings pages. Previous host, participant-body and display lists are replaced. Release build/typecheck, 193 unit/controller tests and all 93 Chromium workflows pass. Publication uses the `v0.3.4` workflow, with anonymous amd64/arm64 image verification before updating the store branch. See the [shared-layout follow-up](docs/shared-page-layout.md). Screenshots remain local/ignored.

**0.3.3 release — 2026-10-18:** [shared page-layout plan, progress and verification](docs/shared-page-layout.md). Explicit workspace/compact/display layouts and shared component styling now cover all routes and server fallbacks. Release build/typecheck, 195 unit/controller tests and all 90 Chromium workflows pass. Publication uses the `v0.3.3` workflow, with anonymous amd64/arm64 image verification before updating the store branch. Screenshots remain local/ignored.

**0.3.2 release — 2026-10-18:** align the participant's desktop list with the player and unify host/settings/participant workspace widths, columns, gutters and mobile stacking. Shared layout rules use a 1320px desktop container, 360px sidebar and a single column below 1100px; host/settings headings and card spacing are aligned. Build/typecheck, 195 unit/controller tests and all 86 browser workflows pass. Publication uses the `v0.3.2` workflow, with anonymous amd64/arm64 image verification before updating the store branch. Screenshots remain local/ignored.

**0.3.1 release — 2026-10-18:** stabilise the participant player and surrounding workspace across playback/turn changes, keep volume visible, remove “Updating player…”, and open new catalogue lists at their beginning while retaining Back/Forward positions. Build/typecheck, 195 unit/controller tests and all 86 browser workflows pass. Publication uses the `v0.3.1` workflow, with anonymous amd64/arm64 image verification before updating the store branch. Screenshots remain local/ignored.

**0.2.9 release checkpoint — 2026-10-18:** published completed UI/UX Batch 1. Build/typecheck, 194 unit/controller tests and 70 Chromium browser tests passed for the release. Public amd64/arm64 image manifests and configurations were verified before completing publication. Screenshots are ignored and none are tracked.

**0.3.0 release — 2026-10-18:** all scoped UI/UX batches 1–7 completed; version 0.3.0 includes Batches 2–7 following the 0.2.9 checkpoint. Build/typecheck, 195 unit/controller tests and all 79 browser workflows pass. Phone, tablet, desktop and display captures were reviewed; screenshots remain ignored. Publication uses the `v0.3.0` workflow, with public image verification before updating the store branch. See the [implementation plan and progress](docs/ui-ux-implementation.md) for delivered behaviour, verification and deliberate deferrals. The implementation retains the owner's simple-code/simple-flow direction; accessibility-specific work is excluded.

**HAOS release acceptance — 2026-10-16:** 0.2.2 is installed and healthy at `10.69.6.39`. Live discovery, Open web UI/Ingress and Supervisor hot backup passed; packaged upload/backup restore checks passed. GitHub checks and public amd64/aarch64 image publication passed, with anonymous pulling verified. The store now uses prebuilt images. Interactive MA sign-in, Reconnect and media verification await corrected HA login credentials.

**Automatic HA setup — implemented 2026-10-16:** Supervisor/mDNS discovery, automatic guest/media candidates, MA browser Connect/Reconnect, dedicated host Ingress, backup write coordination, startup/watchdog support and multi-architecture publishing workflow are implemented. Typecheck/build, 168 backend tests and 39 browser workflows pass. Real discovery was checked against the replacement HAOS at `10.69.6.39` (Core 2026.10.1, Supervisor 2026.10.2, MA 2.10.6/schema 65); it correctly identifies the guest port, internal media addresses and MA. MA initially reports incomplete onboarding. Deployment and live sign-in/Ingress verification are in progress. See [setup research/status](docs/home-assistant-setup-research.md).

**Home Assistant repository preparation — 2026-10-16:** created the public `magnusoverli/aotyassistant` GitHub repository and prepared Supervisor repository metadata, installation documentation, and application CI. The existing root add-on configuration and Dockerfile remain the source-build context. Local typecheck, all 160 tests, and production build pass. GitHub CI results and real HAOS installation must be verified separately; no VM deployment or speaker operation is implied by repository setup.

**Persistent room — implemented, tested and deployed:** one room exists automatically; `/display` and `/join` are permanent links with no display/invitation secret. No Create/Start/End/admission/invitation controls or runtime session phases remain. Host reordering/removal/advance, private lists/uploads and current-turn/reveal checks remain. See `docs/persistent-room.md`. Refresh old tabs and join the new room.

**Development directive:** this is not production. The owner explicitly says there are no rooms requiring preservation/migration and permits playback interruption/restarts as needed. Do not build room-migration machinery or require idle-playback/restart approval for development changes. Old schema-1/2 event state is discarded and replaced with an empty persistent room; independent private libraries/uploads/integration settings remain intact. Refresh old tabs and join again after this upgrade.

**Latest verification:** typecheck/build, **139 backend/controller tests**, **35 isolated browser workflows** and both container smokes pass. Deployed image `a500f35cea88` is healthy; backend hashes match, all six pages return 200, fresh/stale-cookie display access works and desktop/320px captures have no overflow. Independent private-library/upload files and MA settings remain; only old development event state was replaced. Prior real-MA resolution passed; the owner reports successful uploaded-file playback. Real-phone picker and full audible lifecycle acceptance remain outstanding.

**Participant workspace — deployed for development testing:** search and private lists share one responsive workspace, with a desktop sidebar and compact expandable phone list. Search stays visible during playback; query/breadcrumbs, focus/selections, independent list scroll, private save/recovery, uploads and player controls are preserved. Regression tests and desktop/phone/short-height captures pass; see `docs/participant-workspace.md`.

**Implemented stack:** Node.js 24 / TypeScript / Express backend, Vite-built browser interfaces, role-filtered server-sent events, and a single-process atomic JSON store. A synthetic playback adapter supports local tests without audio or music-service accounts.

**Uploaded-audio implementation — deployed for development testing:** [docs/uploaded-audio.md](docs/uploaded-audio.md) covers private single-file uploads, metadata/embedded-cover review, durable assets/list/history/recovery, explicit permanent deletion, and guarded typed MA playback with verified automatic addressing. Support is MP3, M4A (AAC/ALAC), FLAC, WAV, AIFF, Vorbis and Opus, without storage quotas; standalone AAC/remux is excluded. Packaged format/image/persistence and real MA fetch/identity/range/revocation checks pass. Native phone and audible lifecycle acceptance remain pending. Historical findings remain in [research](docs/uploaded-audio-research.md).

**Address setup — implemented and deployed:** [docs/application-addressing.md](docs/application-addressing.md) describes browser/deployment suggestions, real MA fetch verification without playback, durable UI guest links, verified manual overrides, scoped local recovery setup, expiring diagnostics and non-blocking checks. Normal deployment does not require Tailscale, fixed development IPs in source, or environment-file edits for guest URL changes.

**Post-deployment settings repair:** after manual host changes swapped the app/MA ports, the owner authorized restoration of any needed settings. Restored the MA API origin (`192.168.5.139:8095`), app guest/media origin (`192.168.5.147:3000`), original catalogue source binding and Roam selection. Retained the current valid token rather than the rejected old backup token. Fresh no-playing/paused guard, protected config backup, restart, data-hash comparison and real MA diagnostic passed. Two participants/private libraries remain intact. Roam is unavailable; no speaker command was issued. Repair evidence is under `/tmp/opencode/aoty-ma-settings-repair-20261015T201724049Z/`.

**Important:** This is not a production-verified playback release. Generated browse/playback/progress/volume contracts, real read-only browsing, exact resolution, queue shape, image retrieval, and volume capability have been checked. The owner is now testing live playback and has reported the latency and long-pause issues addressed in this update. At the owner's request, the manual playback enable/disable switch is removed: a saved connection and speaker allow explicit current-participant Play actions, never automatic audio. No assistant-run real speaker or volume test has been performed; the complete audible natural-end/pause/interference/recovery matrix and installation on Supervisor remain pending.

This file is the project’s source of truth for scope, confirmed decisions, work remaining, and verification. Update its checkboxes and progress log as work is completed. Mark a task complete only when its implementation or verification is actually finished.

## Purpose

Build a private, turn-based listening application for gatherings. Participants reveal favourite albums progressively by playing one song per turn, rotating through a host-arranged list of people.

The application manages **participant order**, not album rankings or a shared future-song playback queue. **Scope update requested on 2026-10-15:** add a durable, private, ordered preparation playlist per participant. This extension is implemented and deployed; it does not authorize autoplay or provider-side playlist/queue creation.

Target deployment: a dedicated Home Assistant instance, Music Assistant, an existing Sonos speaker or group, participant phones, and a browser-based public display.

## Confirmed owner decisions

| Decision | First-release behaviour |
| --- | --- |
| Concealment reset | Conceal metadata on every track change, turn advancement and restart. Bind reveal to the specific turn and playback identity. |
| Manual advancement | Both the host and the current participant can explicitly finish/advance the current turn. |
| Natural track completion | Stop playback and advance to the next participant automatically. Pause, explicit stop, and playback failures do not count as natural completion. |
| Playback scope | Search the Music Assistant catalogue; select an exact track; play, pause, resume, and stop. |
| Browse extension | Search artists, select an artist, browse their albums, then choose a specific album track. Keep service/version identity explicit. |
| Preparation and authority | All joined members may browse/save before their turn; only the current participant can start/control/reveal playback or finish a turn. Durable private lists, reordering, history/recovery, and saved-entry playback are deployed. Next choice belongs at the top; no silent loss, list broadcast, or autoplay. |
| Speaker changes | Preserve private searches, artist/album browsing, preparation, and artwork when changing speakers. Keep catalogue identity separate from routing; server/token replacement, forgetting the connection, and restart still invalidate catalogue references. Speaker changes retain playback/volume guards and cancel old intents; a fresh explicit Play is required, not a separate enable step. |
| Public display dynamics | Idle/stopped playback uses a clean no-track state. Playback movement stays subtle and unchanged across reveal; pause freezes motion, and reduced-motion preferences disable it. |
| Public record sticker | Leave the main headline unchanged. Replace only the small AOTY/SIDE A sticker with the current listener’s name and one of at least 150 playful alternatives (180 implemented). Use a non-repeating shuffled bag, stable per playback and remembered in that display browser across refreshes. |
| Record rotation | Turn the whole public record, including its name/joke label, slowly while playing; no label counter-rotation. Retain animation timelines through reveal, freeze on pause, and disable for reduced-motion preferences. |
| Live development | The owner permits playback interruption and restarts as needed for development. No room-preservation migration or extra restart approval is required. Normal app behaviour still starts music only on explicit Play and retains exact-source/ownership/privacy checks. |
| Local-file uploads | Implemented locally, not deployed: one browser-selected MP3, M4A (AAC/ALAC), FLAC, WAV, AIFF, Vorbis or Opus file; metadata/cover review; no upload-storage quotas; private durable assets with normal list/playback/reveal/history/recovery and guarded permanent deletion. Standalone AAC is excluded at the owner's request. See `docs/uploaded-audio.md`. |
| Deferred inputs | Standalone AAC/ADTS, Spotify/Tidal links, Spotify Connect, AirPlay, AriaCast, other live-phone inputs, batch/folder/archive imports, and cataloguing remain outside this extension. |
| Host access | **Open LAN host controls**, explicitly requested by the owner. No host password, secret host link, or Home Assistant login. Remove repeated on-page open-host warnings at the owner's request; document the access model in setup/security guidance. |
| External connection setup | Configure Music Assistant and any future external integrations in the host frontend; environment-file editing must not be required. |
| Application addresses | Host UI selects guest links and suggests MA-facing origins. Only exact, observed protected diagnostic fetches permit automatic media selection or manual override saving; no audio, library import, custom provider or automatic network rule changes. Installer origins are fallback hints, not fixed network assumptions. |
| Persistent room | No sessions, Create/Start/End/admission/invitation lifecycle or expiring display links. One room exists on boot; permanent `/join` and `/display`. Joining appends directly; first join is current, without autoplay. Host reordering/removal remain. Old development events are discarded, not migrated. |
| Development vs. deployment | The instance supplied on 2026-10-15 is for development only. All later installation targets remain configurable through the host UI; never bake development addresses into application defaults or source. |

### Uploaded-audio acceptance

- [x] Stream a single supported file to private durable storage, without a file-size/storage quota or whole-file memory buffer.
- [x] Validate actual audio; extract common metadata and embedded JPEG/PNG covers; permit text corrections before Add; retain original bytes/integrity hashes.
- [x] Reuse private list revisions, idempotent attachment, duplicate suppression, recovery, history, and explicit playback review; never autoplay.
- [x] Handle interrupted transfers, lost replies, cancellation, device revocation, staged cleanup, inconsistent backups, and durable permanent-deletion cleanup without erasing acknowledged work.
- [x] Resolve exact typed Builtin sources before any queue write, require observed media callback access, protect ranged reads, keep pause access, revoke stale streams and reveal-only artwork, and pin uncertain deletion until recovery.
- [x] Add host-frontend media-origin configuration and scoped Host validation without changing firewall/routing or requiring environment-file edits.
- [x] Pass typecheck/build, 122 backend/controller tests, 28 browser workflows, and actual packaged-format/cover/restart container tests; inspect 320px preview/list screenshots.
- [x] Diagnose the development reverse-network failure: overlapping Tailscale/LAN routes; owner disconnected the VPN. Verify real MA protected-file resolution for ten fixtures across all supported formats through the actual packaged app, including range requests/revocation, with unchanged queue identity/status and no speaker writes or network workarounds.
- [ ] Test native iPhone/Android file pickers and large/interrupted uploads on real devices.
- [ ] With approval, validate real speaker exact-file start, ordinary/parked pause/resume, stop/finish, natural end, takeover, connection loss and recovery across formats.
- [x] Deploy uploads/workspace/address setup for development testing. The owner subsequently permits playback interruption/restarts and reports successful uploaded-file playback.

### Development environment — not application defaults

- Normal deployment does not require Tailscale. Do not add VPN-specific routing/interface workarounds for this laptop; use a stable app LAN origin reachable from MA and verify the callback path.
- Current development guest/media origin: `http://192.168.5.147:3000`, saved through the host address UI; the original environment fallback was not edited. Do not bake this address into source or deployment defaults.
- Home Assistant host: `192.168.5.139`.
- Owner-supplied Music Assistant dashboard link: `http://192.168.5.139/app/d5369777_music_assistant` (HTML UI, not the direct API origin).
- Direct Music Assistant development origin: `http://192.168.5.139:8095`.
- Read-only discovery on 2026-10-15: `/info` returned version `2.10.6`, schema `65`, minimum supported schema `28`; `/api-docs` returned HTTP 200.
- Discovery sent no token, changed no saved application configuration, and issued no playback commands. Enter the development origin/token in `/host/settings` when ready; production or replacement instances use that same editable workflow.

### Explicit security exception: open host controls

The owner confirmed open LAN host controls after being advised that anyone who can reach the application can reorder, remove, or advance participants and manage sessions.

Host controls have a distinct interface, but **not an authenticated privilege boundary**. Participant credentials protect participant endpoints; the public display is unauthenticated but strictly filtered/read-only. Neither prevents a guest from using the deliberately open host interface.

The exception also covers host integration setup: anyone who reaches the app can change settings, enable playback, and recover controls on the configured destination. Tokens are write-only at the frontend/API boundary and protected in an application-owned file, but open host access is not a secure administrative boundary. Require a newly entered token when the server origin changes; never forward a retained token to a substituted origin.

Document this access model in setup/security instructions. The owner requested removing repeated host-interface warning banners for this local-only deployment; do not reintroduce them as UI clutter. Do not describe the application as preventing arbitrary LAN users from controlling the event. Open host access does not authorize exposing Music Assistant credentials or bypassing participant checks on participant endpoints.

## First-release interfaces

### Participant: mobile-first

- Join using permanent `/join` or the room QR and a nickname; no session/invitation secret, account, password or installation.
- Issue a separate private browser credential per participant; refresh/reconnection restores identity without duplicate membership.
- Show current participant, next participant, and whether it is the viewer’s turn.
- Clearly distinguish your-turn, up-next and listening states immediately after joining. Show a numbered seat and advances until the turn, with an expandable names-only circle and sticky status while browsing; no admission/pre-start state.
- Match the public display’s dark green-and-gold theme and keep the participant view compact: current listener, one seat/countdown line, and private search/playback, without repeated instructional panels.
- Every joined participant can privately search and browse artists/albums/tracks; only the current participant can start/control/reveal playback or finish their turn. The participant UI has durable **Find music / My list** preparation, retained played/removed history, recovery, and guarded Play next. See `docs/preparation-playlists.md`.
- Show the current participant their own track information and an explicit reveal action.
- Keep the entire participant player responsive while requests complete, with private optimistic/pending states, ordered transport intents, latest-only volume adjustments, and explicit failure reconciliation; never optimistically reveal on the public display.
- Use artist/album images in private browsing and playback, and allow only the current playing participant to control the configured destination’s volume.
- Provide an explicit “Finish turn” action for the current participant.
- Never send another participant’s track metadata, private search results, or pending playback actions to this interface, even after public reveal.

### Public display: landscape and TV-friendly

- Show a QR code pointing to the configured guest-facing URL, plus current and next participant.
- Before reveal, send only generic artwork/title/artist placeholders—not concealed metadata or artwork references.
- After reveal, show the exact current track’s title, artist, and artwork when available.
- Show a clean **Nothing playing** state without placeholder artwork/details/progress when idle or stopped. During playing/paused playback, show status/progress before reveal, but disclose elapsed/total times and artist/album images only with the track reveal; keep times out of unrevealed HTTP/SSE payloads.
- Keep decorative playback motion subtle, continuous through reveal and state updates, frozen during pause, and disabled for reduced-motion preferences. Disconnection must show unavailable state rather than falsely claiming nothing is playing.
- Never expose future selections or the Music Assistant queue.
- Provide read-only access through a display credential distinct from participant credentials.

### Host: open LAN administration

- View and manage participants in the always-ready room; there are no Create/Start/End actions.
- Arrange the active rotation without unintentionally changing the current participant.
- Advance/skip turns and reorder/remove participants. Late joins append directly without changing the current turn or playback.
- Omit the repeated open-host banner as requested; retain actual connectivity, credential-transport, and playback-recovery feedback.
- Use a dedicated control-desk layout for overview, ordering, late arrivals, invitations, and display/settings access; keep participant music selection out of host controls.
- Discover speakers automatically in settings and validate destination changes without a manual-check prerequisite. Provide a volume control bound to the configured destination and its revision.

## Architecture and state

```text
Participant phones ─┐
Public display ─────┼── Application backend ── Music Assistant API ── Sonos
Host browser ───────┘
```

- Backend owns one persistent room, participant credentials, rotation, turn state, playback/reveal and filtered updates; no lifecycle, invitation or admission phase.
- Implementation stack: Node.js 24, TypeScript, Express, Vite, and atomic JSON persistence; independently runnable as a container.
- Persist application state in its own data directory, using transactions or equivalent serialization for state changes.
- Store persistent room/current-playback state, not rankings or shared future-song queues. Private preparation has an independent durable owner/list store and write lane.
- Keep Music Assistant URL, credentials, and playback destination server-side. Browsers must never receive its token or use its administrative API directly.
- Use role-specific response/event serializers rather than broadcasting complete internal state.
- Keep participant/private-list and Music Assistant credentials out of logs; no display/invitation credentials exist.

### Turn and playback correctness

- Give each turn an authoritative identity/version. Require expected turn/version on mutation requests so simultaneous actions cannot advance twice.
- Serialize host advancement, participant finish, and natural-completion advancement through the same transition mechanism.
- Track playback identity independently from track URI: playing the same recording again must not reuse an old reveal or completion event.
- Bind reveal requests to both turn and playback identity; revalidate current-participant permission on every request.
- Reset concealment before publishing any track or turn change.
- Reordering retains the current participant; define deterministic successor behaviour for removal and skipping.
- Joining is always available; new participants append directly. The first join into an empty room becomes current without audio.
- Natural-completion handling must distinguish actual track completion from pause, stop, replacement, disconnect, and stale events. Verify what the deployed Music Assistant API exposes before implementation.
- Pause must not expire: retain the exact paused selection when Music Assistant parks its stream, and resume only on explicit request after identity/source checks. Retain fail-closed handling for external takeover, uncertainty, and restart.
- After advancement, do not play another track automatically or permit an existing queue to continue. Playback adapter must establish and verify single-track playback with repeat/autoplay disabled.
- Disable playback/turn mutations while Music Assistant state is uncertain; show clear errors and preserve rotation consistency.
- Restore the persistent room/membership/order on restart without autoplay; reject stale playback/completion identities.

## Privacy boundary

Concealment is enforced on the server, not by CSS. Before reveal, public HTML, JSON, real-time events, artwork URLs, preload requests, and error responses must contain no concealed title, artist, or cover-art reference.

The application cannot conceal metadata in separately accessible Sonos apps, Music Assistant, Home Assistant media-player views, Spotify Connect, or other sending applications. Document that limitation and recommend restricting direct access where practical.

## Deployment requirements

- Standalone container plus Home Assistant add-on manifest and installation instructions.
- Persistent application data in the add-on’s own data directory; no access to Home Assistant internal databases or `.storage`.
- Configure Music Assistant URL, credentials, Sonos destination, guest-facing URL, and required network/port settings.
- Request only necessary permissions; avoid privileged mode and host networking unless a verified requirement justifies them.
- Dedicated LAN guest/display endpoint. Ingress alone does not satisfy password-free guest access.
- Never trust client-supplied Ingress headers on the guest endpoint. Optional host Ingress integration is deferred; it would not protect the separately open LAN host interface.
- QR links must use the configured guest-facing URL, not a container address or Ingress URL.
- Document guest Wi-Fi reachability rules, HTTPS recommendations, and the deliberate open-host risk.
- Use permanent public join/display links; issue an unguessable private participant credential on joining and revoke it on removal.
- Validate requests, safely render nicknames, and avoid secrets/private metadata in logs.

## Implementation milestones

### 0. Planning

- [x] Capture the brief and first-release scope.
- [x] Confirm concealment, advancement, playback, host-access, and track-completion decisions.
- [x] Record the open-host security exception.
- [x] Save a progress-tracking implementation plan.

### 1. Foundation and Music Assistant feasibility

- [x] Choose and scaffold backend, frontend, persistence, and test tooling.
- [x] Define validated configuration and a safe example configuration without secrets.
- [x] Research upstream supported command interfaces and add a read-only connection/destination probe; record findings in `docs/music-assistant.md`.
- [x] Implement and fixture-test a bounded, LAN-only read-only HTTP client for server info, player inventory, and active queue validation; fix the CLI probe to use HTTP direct-result response semantics.
- [x] Verify the development deployment's generated `music/search` request/response schemas and a real read-only query without changing playback.
- [ ] Verify supported Music Assistant authentication, search, playback, queue, artwork, and event APIs against the deployed version’s generated documentation.
- [ ] Verify single-track playback on the selected Sonos destination, with no repeat/autoplay/queue continuation.
- [ ] Verify reliable natural-end detection; record event semantics and limitations. If reliable automatic advancement is not feasible, seek owner approval for a fallback rather than silently changing behaviour.
- [x] Build the adapter contract and a synthetic adapter for deterministic tests/local development.
- [ ] Implement the version-aware live adapter after deployed-version verification.

### 2. Persistent room and turn engine

- [x] Replace the session lifecycle with one automatically created persistent room and stable public join/display URLs.
- [x] Implement private participant credentials and idempotent rejoin.
- [x] Implement direct joining, ordering, removal, skipping and stable current participant; remove lifecycle/admission and discard old development events without migration.
- [x] Implement atomic/version-checked host advance and participant finish.
- [x] Implement playback-bound reveal state and concealment resets.
- [x] Test turn invariants, concurrency, stale requests, and restart recovery.

### 3. Playback and filtered real-time API

- [x] Implement member-private search and current-participant-only playback against the demo adapter.
- [x] Connect private member search to Music Assistant's global catalogue across all available sources; preserve version/provider distinctions and clear empty/error states.
- [x] Extend browsing/preparation to all joined members and add artist → albums → tracks navigation with participant-bound references.
- [x] Implement exact-track playback through a host-enabled experimental adapter; real Sonos audio verification remains pending.
- [x] Implement play/pause/resume/stop through the demo adapter.
- [ ] Implement and verify live Music Assistant playback controls.
- [x] Implement and fixture-test play/pause/resume/stop, queue ownership/one-track policy, explicit host recovery, and fail-closed concealment; manual enablement was subsequently removed at the owner's request.
- [x] Implement deduplicated natural-completion advancement and turn-transition cleanup in the engine/demo adapter.
- [ ] Map verified Music Assistant completion/interference events to the engine and reconcile reconnects safely.
- [x] Implement queue-item-pinned authoritative `ended` polling, duplicate guards, external-takeover invalidation, and explicit host recovery; real lifecycle verification remains pending.
- [x] Implement reveal checks bound to current turn and playback identity.
- [x] Implement independently filtered participant, display, and host API/event payloads.
- [x] Implement clear request/connection errors and connectivity/storage guards; browser mutations disable on lost SSE connectivity.
- [ ] Implement live playback failure detection and recovery/reconciliation.
- [x] Verify demo artwork is not requested or referenced in display traffic before reveal.
- [x] Implement and verify guarded delivery of external Music Assistant artwork, including real read-only image fetches and fixture/browser reveal/revocation checks.

### 4. Browser interfaces

- [x] Build mobile joining and persistent participant identity.
- [x] Build participant turn status, search, playback controls, reveal, and finish-turn controls for the demo.
- [x] Build large landscape display with invitation QR and concealed/revealed now-playing states.
- [x] Build ready-room lifecycle, ordering, removal and advancement controls; remove admission and Start actions.
- [x] Implement accessible connection/error states. The original repeated open-host banner is removed in the local cleanup below at the owner's request.
- [x] Test reconnection, refresh, 390px mobile layout, and 1920px display; inspect the display screenshot.
- [x] Redesign the display as a fullscreen-capable public stage, the host as a control desk, and participants as mobile listening cards with clear turn states.
- [x] Compute and test role-filtered seats/countdowns for wraparound, reordering, direct late joins, removal, empty ready rooms and single-person circles.
- [x] Browser-test responsive role layouts, private-preparation continuity, admission-free joining/turn stability and 1366×768/1920×1080 TV fit; inspect screenshots.
- [x] Verify narrow-phone (320px), focus/open-circle retention, and immediate offline-disable/reconnection behaviour.
- [x] Deploy the role-specific UI update, preserving saved state and leaving real music untouched.
- [x] Simplify the participant page using the public display palette, with compact turn/seat status and less explanatory copy; keep circle/search details on demand without discarding browse state.
- [x] Complete final narrow-phone regression checks and deploy the simplified participant page without touching real music.
- [x] Clean up Connections & settings with shared host navigation, separate connection/speaker/playback cards, and on-demand help/diagnostics; verify setup/privacy/safety and 320/390px mobile layouts.
- [x] Deploy the cleaned-up host settings page without touching real music.
- [x] Implement automatic speaker discovery, reveal-filtered public status/progress, private/public guarded artwork, and host/current-participant volume controls; verify privacy, ownership, and destination-revision guards.
- [x] Complete final typecheck/build, 48 backend tests, seven browser workflows, and container restart/persistence checks for media/progress/volume; verify real artwork and volume capability using read-only requests.
- [x] Deploy the media/progress/volume update after explicit restart approval; verify live control resets off, saved participants/settings remain, and automatic read-only speaker discovery succeeds.
- [x] Implement private optimistic play/pause/resume/stop/reveal and non-locking, coalesced participant/host volume with asynchronous readback and stale-generation guards.
- [x] Reproduce Music Assistant pause-to-idle parking in fixtures and verify a simulated 24-hour paused selection remains resumable without changing turn/reveal or automatically starting audio.
- [x] Pass final typecheck/build, 57 backend/controller tests, nine browser workflows, and container restart/persistence checks for optimistic controls and indefinite pause; inspect pending-player screenshot.
- [x] Deploy the responsiveness/indefinite-pause fixes after fresh restart approval; verify new assets, healthy runtime, saved members/settings, and live-control reset without real speaker commands.
- [x] Separate catalogue identity/cache/references from speaker routing, preserving private preparation/browsing/artwork while retaining stale-command, membership, credential-change, and playback-ownership guards; pass 65 backend/controller tests, ten browser workflows, and container persistence checks.
- [x] Deploy the speaker-change fix after fresh restart approval. Warn that this one-time restart invalidates existing prepared references and page refresh clears preparation; subsequent speaker-only changes preserve it.
- [x] Replace public idle/stopped placeholders with a clean no-track state and add persistent, reveal-independent playback motion with paused/reduced-motion/offline handling. Verify 68 backend/controller/presentation tests, twelve browser workflows, TV/phone layouts and screenshots, and container persistence checks.
- [x] Deploy the public-display update after fresh restart approval; preserve saved members/settings and remind participants to refresh/reselect preparations once and explicitly re-enable live playback.
- [x] Personalize only the unrevealed record sticker with the current nickname and 180 compact phrases; verify no repeats before bag exhaustion, stable/reload-safe choices, storage-failure fallback, and no stored names or music metadata.
- [x] Add persistent one-revolution-per-minute record rotation with an upright readable sticker, paused/reduced-motion handling, and unchanged animation timelines through reveal; pass typecheck/build, 74 tests, thirteen browser workflows, and container persistence checks; inspect screenshots.
- [x] Deploy personalized stickers and slow record rotation after fresh restart approval; retain saved members/settings and remind participants to refresh/reselect preparations once and re-enable live playback.
- [x] Diagnose apparently stationary rotation using read-only live transform samples; remove label counter-rotation at the owner’s request and verify painted sticker text rotates with the disc. Typecheck/build, 74 tests, fourteen browser workflows, and container persistence smoke pass.
- [x] Deploy the whole-record/label rotation correction after fresh restart approval; the owner explicitly chose Restart now after the active-playback warning. Preserve saved data, clear app ownership/live opt-in, and issue no speaker stop/volume command.

### 4a. Durable private preparation playlists — implemented, validated, and deployed

- [x] Investigate current page-local preparation, expiring catalogue/cache identities, event-scoped credentials, persistence, playback coupling, role-filtered events, and compact UI integration; save the proposed design in `docs/preparation-playlists.md`.
- [x] Start implementation using the recommended retained-library/non-destructive-history baseline, with optional private recovery and explicit capacity errors rather than silent deletion.
- [x] Add a dedicated durable preparation owner/store with independent revisions/transactions, versioned fail-closed persistence, backup restoration, private owner subscriptions, and operation deduplication; never stop audio on a preparation save failure. Initial foundation had 17 tests; integration and additional coverage are complete below.
- [x] Require connectivity for edits and retain one unconfirmed draft across reloads for explicit receipt reconciliation/rebase; surface capacity/recovery rules without promising a full offline outbox.
- [x] Persist validated exact recording descriptors and source bindings, with fresh resolution/artwork authorization after restart/expiry and preserved unavailable entries after connection changes. Reserve private asset-backed upload entries without enabling uploads.
- [x] Implement private owner-only read/edit/event APIs, guarded saved-entry playback, and concurrent-edit protection without private-data/edit broadcasts to host/display/other participants.
- [x] Add the compact Find music/My list participant panel, append/add feedback, next-at-top ordering, accessible reorder controls, clear save status, and non-destructive history/undo.
- [x] Complete combined regression validation: typecheck/build, 106 backend/controller tests, 18 browser workflows, and isolated container persistence/recovery smoke pass. Preserve the other agent's automatic-readiness model. Verify failed/ambiguous saves, expired references/fresh caches/restarts, source/speaker changes, owner-only SSE/artwork, recovery/revocation, conflicts, duplicate play/crash markers, and independent player responsiveness. Inspect 320px list screenshot; keyboard reorder focus survives saves and falls back to the drag handle at the top.
- [x] Document the upgrade warning: old deployed page-local choices cannot be recovered after reload/restart unless captured first; do not promise retroactive migration.
- [x] Deploy after fresh restart approval and a playback-impact check. The owner explicitly chose Restart now after a paused-track warning. Preserve the data volume, guest URL, session/order, connection/token/destination, and existing private library; retain a protected data backup and rollback image. Confirm deployed assets/backend match the tested build. No real speaker stop/play/volume command was issued.

### 4b. Shared header and navigation — implemented, validated, and deployed

- [x] Replace scattered sidebar/body navigation with one persistent `AppHeader` and centralized typed route/navigation definitions; settings reports state through a callback rather than editing header DOM.
- [x] Keep primary navigation consistent on all routes, with current-page semantics, a Home wordmark, accessible mobile menus, host-only credential-bearing session links, shared turn/mode badges, and fullscreen controls.
- [x] Preserve header/link nodes, open menus, and keyboard focus through realtime updates; handle Escape/outside click, viewport changes, sticky-header anchor offsets, and a skip link that does not overwrite invitation fragments.
- [x] Verify the four new header browser workflows independently, including all six routes, 320/390px layouts, persistent public animation through fullscreen/reveal, no playback/settings mutations, and successful joining after skip navigation. Inspect desktop settings, narrow-phone menu, and participant screenshots.
- [x] Complete final typecheck/build, 109 tests, 22 browser workflows, and isolated container persistence smoke. Existing playback, playlists, privacy, public animation, settings, and responsive role-layout regressions pass.
- [x] Deploy after fresh approval and a no-active-playback check. Preserve the data volume, guest URL, session/order, private library, connection/token/destination, and automatic readiness. Verify rendered headers/menus on all six live routes at desktop/320px widths; send no browser mutations or real speaker commands. Retain a protected backup and `aotyassistant:shared-header-previous-20261015` rollback image.

### 4c. Header consistency and plain copy — implemented, validated, and deployed

- [x] Use the same four primary link labels/URLs, shared header styling, and 1200px responsive breakpoint across all pages; remove participant/join/display-only menu and width overrides.
- [x] Remove the Session links submenu and same-page shortcuts. Keep authorized guest-invitation/public-display launch links with the host QR card, without changing the common header or exposing credentials to other roles. Settings no longer loads host session state solely for header links.
- [x] Remove repeated open-host banners and decorative slogans/introductory labels across home, host, settings, join, participant, and public views. Use plain session/turn/empty-state text; retain meaningful controls, errors/recovery, the previously requested reveal headline, and personalized record stickers.
- [x] Pass typecheck/build, 109 tests, 23 browser workflows, and isolated container persistence smoke. Verify identical menus at desktop/1200/1100/390/320px widths, access-link privacy, guest joining, failed/recovery states, playlists/player responsiveness, and public animation/reveal. Inspect cleaned-up host, settings, and participant screenshots.
- [x] Deploy after fresh approval and a no-active-playback check. Preserve the persistent volume, guest URL, session/order, private library, connection/token/destination, and playback availability. Verify rendered menus/copy on all six live routes and responsive breakpoint widths; issue no browser mutations or real speaker commands. Retain a protected backup and `aotyassistant:header-copy-cleanup-previous-20261015` rollback image.

### 4d. Simultaneous participant search/list — implemented and validated locally, not deployed

- [x] Review the mutually exclusive tabs, 660px participant width, large mobile list rows, independent preparation/player controllers, and playback-time Choose another song disclosure.
- [x] Document a desktop search/list split and a compact sticky phone list with inline expansion, keeping the shared header, visual language, ordering/privacy/durability rules, and explicit playback unchanged.
- [x] Build a standalone visual study with fictional tracks and no HTTP/API writes. Check 1440×1000, 390×844, 320×700, and a simulated 390×440 short viewport, including local Add feedback, expansion bounds, result/list visibility, and no horizontal overflow. Inspect screenshots; do not claim real keyboard or production app acceptance.
- [x] Implement the combined participant workspace using the existing independent controllers and one authoritative list. Preserve player availability, search/browse/focus/scroll, conflict/review handling, source-neutral saved entries, and private-only data flows. Retain existing upload controls without modifying their implementation.
- [x] Pass typecheck/build, 122 backend/controller tests, and 31 browser workflows. Inspect desktop/phone/short-height captures, including focused result actions, long lists/metadata/missing artwork, list expansion, and scroll preservation. Verify reserved preview space prevents result jumps on additions, and keep Play next/Edit order above long lists.
- [ ] Owner-led real phone keyboard/safe-area acceptance remains pending; simulated short-height views are not native-device validation. Any deployment/restart or real speaker command requires fresh approval.

### 5. Packaging and documentation

- [x] Add container build and standalone deployment configuration.
- [x] Smoke-test container health, unprivileged web-server UID, and persistent session restoration after restart.
- [x] Add demo Home Assistant add-on manifest, persistence/config wiring, and local installation instructions.
- [x] Document guest URL/network/HTTPS setup and read-only Music Assistant connection/destination verification.
- [x] Add persistent host-frontend connection/token/destination setup, available in standalone/container/add-on deployments without environment edits.
- [x] Document browser setup, write-only tokens, open-host configuration risks, and read-only check limitations.
- [ ] Add finalized live Sonos playback setup instructions and deployed-version verification.
- [x] Document security exceptions, privacy boundaries, supported demo inputs, and troubleshooting.
- [x] Document local development and reproducible test commands.

### 6. Acceptance and release

- [x] Run automated unit/integration/privacy/concurrency tests against the demo.
- [x] Run browser-level acceptance tests against the fake adapter.
- [ ] Run real Music Assistant/Sonos smoke tests on the owner’s deployment.
- [ ] Verify add-on installation and restart persistence.
- [x] Record initial demo results and remaining limitations without claiming verified Sonos playback.

### Next integration milestone

The development connection/destination, read-only browse/resolve/queue contracts, image proxy, and volume capability are verified. Next, arrange an explicitly approved Sonos test of the experimental adapter, including exact recording, single-track playback, progress, speaker/group volume, natural completion, stop/pause, failures, external takeover, and host recovery. Keep playback disabled until the host chooses to test. Do not log credentials or private metadata. All external targets remain editable through the host frontend.

### Host setup verification

- [x] Save/replace/forget Music Assistant credentials in the host browser; saved tokens never return in API responses or browser storage.
- [x] Persist settings privately and reset connection-check state on restart, without automatic outbound requests or audio.
- [x] Check server/schema/authentication and choose an available destination using only read-only commands.
- [x] Strip current/upcoming queue metadata and original artwork references from integration responses.
- [x] Reject cross-origin changes, stale concurrent edits, redirects, oversized responses, unsupported responses, and non-LAN targets.
- [x] Changing origin requires a newly entered token; an unavailable saved destination can be replaced after inventory checking.
- [x] Verify host setup against the development Music Assistant deployment: owner reported a successful check, and saved authenticated connection/destination were confirmed. Actual Supervisor installation remains unverified.

## Acceptance checklist

Checked items are verified against the **synthetic demo**, not Music Assistant/Sonos. All live-dependent behaviours must be retested after integration.

- [x] Guest joins by QR invitation and nickname without external account authorization; a real-phone QR scan remains to be tested on the LAN.
- [x] Host arranges and starts the rotation.
- [x] All interfaces agree on current and next participant.
- [x] Late arrivals can join and be inserted without interrupting the current turn.
- [x] Participant playback/reveal/finish requests are accepted only from the current participant; stale-turn requests fail.
- [ ] An exact selected song plays on the configured Sonos destination.
- [x] Demo display HTTP/SSE traffic before reveal contains no title, artist, or artwork reference; browser makes no artwork request.
- [x] Explicit reveal displays the correct current playback, and delayed reveal cannot expose the next track.
- [x] Other participants receive no track metadata belonging to another participant, including after reveal.
- [x] Refresh/reconnection preserves participant identity without duplicate membership.
- [x] Concurrent host, participant, and track-completion actions cannot accidentally advance multiple turns.
- [x] Demo natural completion stops and advances exactly once; pause/stop/rejected-input/stale events do not advance.
- [x] Changing track or turn resets concealment; repeat selection of the same track remains concealed until a new reveal.
- [x] Unsupported inputs fail clearly without breaking rotation state.
- [x] Removing a participant revokes room controls while retaining private lists; the public display remains open without credentials.
- [x] Restart restores state without starting demo playback or applying stale completion events.
- [ ] Verify live integration/browser/error/log traffic never contains Music Assistant credentials or concealed metadata.
- [x] Open host controls and their security consequences are clearly documented.

## Progress log

| Date | Update | Verification |
| --- | --- | --- |
| 2026-10-15 | Replaced sessions with one persistent room, stable public display/join URLs, direct nickname joining, and retained reorder/remove/advance. Removed lifecycle APIs/UI/CSS/types, display auth/cookies, and unused shared browser-test server. Owner explicitly rejected room migration and permits development playback interruption/restarts. Deployed the change. | Typecheck/build, 139 backend/controller tests, 35 isolated browser workflows and both container smokes pass. Running image `a500f35cea88` is healthy and backend hashes match. Six live pages, fresh/obsolete-cookie public display, stable links and 320px host verified; live screenshots inspected. Old development event state was replaced by an empty schema-3 room without migration; private lists/uploads and MA settings retained. |
| 2026-10-14 | Saved initial plan with owner-confirmed scope and open-host exception. | Planning only; no application code or playback tests yet. |
| 2026-10-14 | Implemented session/turn engine, persistent browser credentials, filtered HTTP/SSE API, demo playback, and mobile/TV/host interfaces. | Typecheck/build pass; 16 backend/integration tests and one multi-browser end-to-end test pass. Reconnect, privacy, concurrency, and restart cases covered. |
| 2026-10-14 | Added container/add-on packaging, setup/security documentation, and a read-only Music Assistant probe. | Docker image builds; runtime/UID/restart-persistence smoke passes. Live Music Assistant/Sonos and actual Supervisor installation not yet verified. |
| 2026-10-14 | Owner confirmed later provisioning and required all integration connections to be configurable in the host frontend. Implemented browser setup, server-only token persistence, read-only checks, and destination selection. | Mock API and browser setup tests pass; no real Music Assistant/Sonos connection or playback was attempted. |
| 2026-10-14 | Deployed the host settings update at `http://localhost:3000/host/settings`, retaining the existing application volume. | Typecheck/build, 24 backend tests, two browser workflows, and container session/integration restart-persistence smoke pass. Running health/settings endpoints return 200; playback remains demo-only. |
| 2026-10-15 | Recorded the owner-supplied development-only instance and discovered its direct Music Assistant API origin without hard-coding application settings. | `/info` and `/api-docs` reachable on port 8095; version 2.10.6/schema 65. No credentials, saved-configuration changes, or playback commands involved. |
| 2026-10-15 | Diagnosed missing participant search: only the three demo tracks were wired in. Added read-only global Music Assistant search using saved frontend settings, with private filtered results and explicit loading/empty/error states. | Generated search contract reviewed; a real development query returned 18 available results without any playback commands. Spotify/Tidal/local-file routing and turn/configuration-race privacy are covered by tests. |
| 2026-10-15 | Deployed the real-catalogue search update at port 3000 while retaining the application data volume and saved host connection/destination. | Typecheck/build, 30 backend tests, three browser workflows, and container persistence smoke pass. Running health/participant endpoints verified; real playback remains disabled. |
| 2026-10-15 | Added artist/album/track navigation, pre-turn private preparation, and an experimental current-participant playback controller behind transient host opt-in. | Real read-only browse returned 20 artists/137 albums/29 tracks; exact resolution and queue schema checks passed without playback commands. Fixture tests cover playback authority, privacy, ownership, natural-end/stop/pause, recovery, and restart safety. Actual Sonos audio remains untested. |
| 2026-10-15 | Deployed artist browsing, pre-turn preparation, and host-enabled experimental playback at port 3000, preserving saved data/connections. | Typecheck/build, 39 backend tests, four browser workflows, and container persistence smoke pass. Running health/page endpoints verified; live playback confirmed disabled. No real Sonos playback commands issued. |
| 2026-10-15 | Redesigned public/host/participant views and added backend-derived seat/turn-distance projections without track-data broadcasts. | Initial typecheck/build, 41 backend tests, and five browser workflows pass. Role screenshots inspected; TV layouts fit at 1366×768 and 1920×1080. Narrow-phone/focus checks and final deployment remain next. |
| 2026-10-15 | Deployed the role-specific UI at port 3000, including immediate offline control disabling and authoritative reconnects. | Final typecheck/build, 41 backend tests, five browser workflows, and container persistence smoke pass. Phone widths 320/390px, TV fit, keyboard/open-circle retention, late-arrival placement, private preparation, and end-session clearing verified. Running health/host/rotation endpoints checked; saved members/connections retained and live playback remains disabled. No real music commands issued. |
| 2026-10-15 | Simplified and deployed the participant page in the public display’s dark green-and-gold theme; consolidated turn/seat information, removed repeated instructions, and tucked playback-time search behind “Choose another song.” | Typecheck/build, 41 backend tests, five browser workflows, and container persistence smoke pass. Shared palette, all turn states at 320/390px, retained browse/disclosure state, and private preparation verified; screenshots inspected. Live health/assets checked; members/connections retained, playback disabled, and no real music commands issued. |
| 2026-10-15 | Cleaned up and deployed Connections & settings with shared host navigation, matching green-and-gold connection/speaker/playback cards, and expandable setup help/diagnostics. | Typecheck/build, 41 backend tests, six browser workflows, and container persistence smoke pass. Desktop and 320/390px layouts, token privacy, enable/disable confirmations, and guarded recovery checked; screenshots inspected. Live health/settings assets verified; saved members/connections retained, playback remains disabled, and no real music commands issued. |
| 2026-10-15 | Implemented automatic speaker discovery, concealed/revealed public progress/times, guarded artist/album images, and host/current-participant destination-bound volume controls. | Typecheck/build, 48 backend tests, seven browser workflows, and container restart/persistence smoke pass; screenshots inspected. Real artist/album PNGs and volume capability fetched read-only. No real audio or volume commands issued. Deployment awaits restart timing confirmation because live control is enabled on the running instance. |
| 2026-10-15 | Deployed the media/progress/volume update after the owner explicitly approved restarting the live-enabled instance; no app-owned playback was recorded before restart. | Running health/assets verified, saved members/connection/destination retained, live control reset off, and automatic read-only discovery returned four available destinations. No real playback or volume-changing command issued; audible Sonos/volume/lifecycle validation remains pending. |
| 2026-10-15 | Implemented non-locking optimistic participant transport/reveal, coalesced participant/host volume with asynchronous confirmation, and retention/resume of exact paused items after Music Assistant stream parking. | Typecheck/build, 57 backend/controller tests, nine browser workflows, and container persistence smoke pass. Delayed/rejected writes, stale telemetry, actor changes, a simulated 24-hour pause, silent finish, and foreign-source rejection verified. Owner is testing live playback; production remains untouched pending restart approval, and no real speaker commands were issued. |
| 2026-10-15 | Deployed responsive-player and indefinite-pause fixes after fresh owner restart approval and a no-active-track check. | Live health/new assets verified; two participants and saved connection/destination retained. Live control reset off. No real playback/volume commands issued; owner should refresh and re-enable controls to validate a longer pause/resume on Sonos. |
| 2026-10-15 | Diagnosed and fixed speaker changes incorrectly clearing private preparation: catalogue identity, encrypted references, and caches now remain stable across routing-only changes; playback/volume configuration guards stay independent. | Typecheck/build, 65 backend/controller tests, ten browser workflows, and isolated container persistence smoke pass. Current and waiting listeners retain browsing, preparation, images, membership, and focus; credential/origin/restart revocation, in-flight reads/lookups, failed persistence, and stale command cancellation covered. Running app untouched; deployment awaits fresh restart approval, with a one-time re-selection of prepared choices after restart. No real speaker/volume commands issued. |
| 2026-10-15 | Deployed the speaker-change preparation fix after the owner approved deployment and no app-owned track was active. | Live health, all role pages/assets, and backend hashes match the verified build. The same persistent volume, two participants/order, session, and saved connection/destination remain; turn identity rotated and live playback reset off. Previous image retained for rollback. No real speaker/volume commands issued; refresh pages and reselect existing preparation once before continuing. |
| 2026-10-15 | Cleaned up public idle/stopped playback and introduced a persistent stage with restrained glow/activity motion independent of reveal. Paused motion freezes; reduced-motion and disconnected states are explicit. | Typecheck/build, 68 backend/controller/presentation tests, twelve browser workflows, and isolated container persistence smoke pass. Browser checks verify identical animation objects/start times through reveal and telemetry, paused/reduced motion, reconnect privacy, natural completion, missing artwork, long metadata, TV fit, and phone width; screenshots inspected. Running app untouched; deployment awaits fresh restart approval. No real speaker/volume commands issued. |
| 2026-10-15 | Deployed the cleaner public display and reveal-continuous motion after explicit owner approval and a no-active-track check. | Running health, backend hashes, and all role pages/assets match the verified build. Rendered live idle display checked at 1366×768: no placeholder artwork/progress, QR visible, no overflow. Two participants/order, session, saved connection/destination, and persistent volume retained; live playback reset off. Prior image retained for rollback. No real speaker/volume commands issued; refresh pages, reselect preparation once, and explicitly re-enable playback to continue. |
| 2026-10-15 | Personalized only the small unrevealed vinyl sticker with the current nickname and 180 playful phrases, plus slow record rotation and an upright readable label. The main headline is unchanged. | Typecheck/build, 74 tests, thirteen browser workflows, and isolated container persistence smoke pass. Full-bag uniqueness, cycle-boundary handling, refresh/reconnect stability, blocked/read-only/corrupt storage, literal nickname rendering, TV/phone layouts, paused/reduced motion, and exact animation identity through reveal verified; screenshots inspected. History is browser-local and stores no names/song metadata. Running app untouched; deployment awaits fresh restart approval. No real speaker/volume commands issued. |
| 2026-10-15 | Deployed personalized record stickers and slow rotation after explicit deploy/restart approval and a no-active-track check. | Health, backend hashes, and all served role pages/assets match the verified build. Session, two participants/order, saved connection/destination, and persistent volume retained; live control reset off at restart. Subsequent read-only rendered-display check observed playing, confirmed 60-second rotation and upright-label styles, and verified QR/1366×768 fit. Previous image retained for rollback. No real speaker/volume commands issued; no second restart was performed after the interrupted response. |
| 2026-10-15 | Investigated the seemingly stationary record: read-only live samples showed about 15.6° rotation over 2.6 seconds, but circular grooves and a counter-rotated label obscured the motion. At the owner’s request, the label now rotates with the disc; no extra groove marker was added. | Typecheck/build, 74 tests, fourteen browser workflows, and isolated container persistence smoke pass. New rendered-pixel/geometry regression verifies actual painted label movement and 30° label orientation after five simulated seconds; pause, reduced-motion, and reveal-continuity tests pass. Running app untouched; deployment awaits fresh restart approval. No real speaker/volume commands issued. |
| 2026-10-15 | Investigated the requested private multi-track preparation extension and documented a compact UI plus durable storage/identity/source-binding/privacy plan in `docs/preparation-playlists.md`. | Code review confirms that current selections are page-local and use 12-hour/process-local references; event-only ownership and playback-coupled transactions are unsuitable for durable lists. Proposed defaults include cross-event retention, non-destructive Played history, and optional private recovery; these need agreement before implementation. No playlist code, live configuration, playback, or deployment changes made. |
| 2026-10-15 | Deployed whole-record/label rotation, then began playlist implementation as requested. The initial deployment guard found playing audio; the owner explicitly chose Restart now after being warned that continuing Music Assistant audio would be left outside app control. | Health, backend hashes, role pages/assets, and read-only rendered display verified; label counter-rotation is absent. Same persistent volume/session/two participants/order and saved connection/destination retained. App playback ownership cleared and live opt-in reset off. Prior image retained for rollback; no real speaker stop/playback/volume commands issued. |
| 2026-10-15 | Implemented `src/preparations.ts`: per-owner durable snapshots, anonymous credentials/recovery/device revocation, append/move/remove/restore, retained played bookkeeping, private view/events, revisions, idempotency, and bounded retry/capacity rules. | Typecheck/build, 91 tests (17 new foundation cases), fourteen existing browser workflows, and isolated container persistence smoke pass. Restart/backup restoration, exact descriptor retention, cross-owner isolation, concurrent edits, ambiguous writes, corrupt files, full capacity, and failure isolation from a running engine covered. Playlist foundation is not imported by bootstrap or exposed to the UI/API yet; next work is catalogue capture/source bindings, private endpoints, and the participant list/Play next integration. No further deployment performed. |
| 2026-10-15 | Connected durable private playlists end-to-end: exact saved descriptors/source bindings, owner-only APIs/events/artwork, compact Find music/My list, accessible reordering, undo/history/recovery, retained unsynced drafts, and guarded single-entry Play next with crash-review bookkeeping. Reserved private asset-backed entries for future uploads. | Typecheck/build, 106 combined tests, 18 browser workflows, and isolated container list/order/recovery restart smoke pass. Preserved the other agent's automatic playback-readiness changes as directed. Verified privacy, expiry/fresh readers/restart, failed saves independent of audio, conflict/retry handling, keyboard focus, narrow-phone layout, and delayed Play next with responsive controls. No deployment or real speaker commands; fresh restart approval is still required. |
| 2026-10-15 | Deployed durable private playlists and automatic speaker readiness after fresh deploy/restart approval; the owner confirmed Restart now after a paused-playback warning. | Healthy runtime, eight backend hashes, all role pages/assets, and private-library authorization endpoint match the verified build. Same volume/guest URL/session, one seated participant/order, saved connection/token/destination, and existing private library retained. Paused app ownership/reveal cleared; playback remains available for an explicit Play, with no auto-resume. Protected data backup and `aotyassistant:private-playlists-previous-20261015` rollback image retained. No real speaker/volume commands issued. |
| 2026-10-15 | Replaced host sidebar/body navigation and per-page header handling with a persistent shared `AppHeader`, centralized routes/navigation, host-scoped session links, responsive menus, current-page states, shared fullscreen/status controls, and safe skip navigation. | Typecheck/build, 109 tests, 22 browser workflows, and isolated container persistence smoke pass. All six routes and 320/390px layouts verified; menu/link focus survives live updates and viewport changes, invitation fragments survive skip navigation, and fullscreen/reveal do not remount the header or restart record motion. Screenshots inspected. No deployment/restart or real speaker commands; fresh approval is required. |
| 2026-10-15 | Deployed the shared header/navigation after fresh owner approval and confirmation that no app-owned track was playing or paused. | Healthy runtime, backend hashes, and all six page/assets match the verified build. Same data volume/guest URL/session, one seated participant/order, existing private library, and connection/token/destination retained; playback remains available for an explicit Play. Rendered all six live routes and 320px menus without overflow or browser mutations; saved live host/menu screenshots. Protected backup and `aotyassistant:shared-header-previous-20261015` rollback image retained. No real speaker/volume commands issued. |
| 2026-10-15 | Corrected header consistency and reduced copy at the owner's request: identical menu links/styles/breakpoint everywhere, no Session links submenu or same-page shortcuts, no repeated open-host banners, and plain functional page wording. Moved protected session launch links to the host QR card. | Typecheck/build, 109 tests, 23 browser workflows, and isolated container persistence smoke pass. All routes/layout breakpoints share the same navigation; joining, access-link privacy, keyboard/focus, saved lists, player controls, and public animation/reveal remain verified. Existing record sticker/reveal headline retained. Screenshots inspected. Not deployed; no real speaker commands or restart performed. |
| 2026-10-15 | Deployed identical header navigation and plain-copy cleanup after fresh restart approval and confirmation that no app-owned track was active or paused. | Healthy runtime, backend hashes, and all page/assets match the verified build. Session, one seated participant/order, private library, saved connection/token/destination, volume, guest URL, and automatic readiness retained. Rendered all six routes at desktop, 1201/1200px, and 390/320px widths: identical menus/breakpoint, removed slogans/banners/submenu absent, and no overflow. No browser mutations or real speaker/volume commands. Protected backup and `aotyassistant:header-copy-cleanup-previous-20261015` rollback image retained. |
| 2026-10-15 | Investigated participant search/list polish after the owner resolved disabled search by starting a new event. Documented a combined desktop workspace and compact sticky mobile list with inline expansion; added an isolated mock-data visual study. | Inspected current UI/code and prototype at 1440×1000, 390×844, 320×700, and simulated 390×440 short height. Compact list, first result action, local Add/count feedback, bounded expansion, and scroll visibility checked without HTTP requests or horizontal overflow. Real phone keyboard and production integration remain future acceptance work. No runtime source, live session/settings, audio, or deployment changes. |
| 2026-10-15 | Implemented private single-file uploads after the owner dropped standalone AAC: MP3/M4A (AAC/ALAC)/FLAC/WAV/AIFF/Vorbis/Opus, metadata/cover review, durable originals/list attachment, no storage quotas, guarded typed MA playback/capability lifecycle, host callback origin, and explicit permanent deletion. | Typecheck/build, 122 backend/controller tests, 28 browser workflows, and both isolated container smokes pass. Actual packaged FFprobe/metadata/image processing covers CBR/VBR, JPEG/PNG, all included formats, rejected raw/renamed AAC/text, unchanged originals, restart/artwork/recovery. Verified privacy, lost acknowledgements, cancellation, revocation, ranged reads, indefinite parked pause, takeover, cleanup failures and inconsistent-backup safety in fixtures; 320px screenshots inspected. Existing workspace prototype preserved. No deployment, network changes or real speaker commands; reverse connectivity and audible/real-phone acceptance remain pending. |
| 2026-10-15 | Implemented the requested combined participant search/private-list UI: desktop sticky sidebar, compact expandable phone preview, search available during playback, independent player controls, and focus/selection/list/page-scroll preservation. Retained the existing upload implementation. | Typecheck/build, 122 backend/controller tests, and 31 browser workflows pass. Real application checked at 1440×1000, 1000×800, 999×800, 390×844, 320×700, and simulated 390×440; desktop, phone, short-height, and full-list captures inspected. Long titles/lists, missing artwork, inline expansion, unobscured focused Add actions, private owner/session updates, stable result placement, keyboard acknowledgements, saves/conflicts/recovery, playback, privacy, and upload regressions covered. No deployment, live mutations or real speaker commands. Native phone keyboard/safe-area acceptance remains pending. |
| 2026-10-15 | Cleared the MA-to-app callback blocker without application/network workarounds. Diagnosed overlapping local-LAN and accepted Tailscale subnet routes; the owner disconnected Tailscale to match a normal LAN deployment. | Verified Tailscale Stopped and the direct Wi-Fi route. An isolated unprivileged packaged app with temporary tmpfs assets passed real MA exact typed resolution for ten fixtures across every supported format, observed repeated/nonzero ranged callbacks without browser credentials, preserved app metadata, served HEAD/matching range reads, and denied revoked capabilities. Only music/item_by_uri and get_active_queue reads were issued; sampled queue identity/status stayed unchanged. Temporary container removed. No firewall/routing rule, source-code change, live settings write, production restart or speaker command; documentation updated. Real-phone/deployment/audible lifecycle acceptance remains pending. |
| 2026-10-15 | Implemented owner-approved automatic/verified application addressing: browser/deployment candidates, a synthetic protected WAV fetched through MA without playback, durable UI guest links, verified manual overrides, bounded/non-blocking diagnostics, startup/freshness checks and scoped private-LAN setup access. Preserved guest/media preferences across speaker changes. | Typecheck/build, 132 backend/controller tests, 34 browser workflows and both container smokes pass. Verified real MA automatic selection/guest setup and all ten protected format fixtures in an isolated unprivileged packaged app without audio/queue writes. Tested denied/unobserved/substituted fetches, stale settings, persistence failures, concurrent/slow diagnostics, paused ownership, exact Host/Origin/CSRF boundaries, ranges, expiry/revocation, preference persistence, no returned capabilities/tokens and 320px rendering. No fixed network IPs, custom MA provider, firewall or route workarounds introduced. |
| 2026-10-15 | Deployed the latest uploads/workspace/address-setup build under the owner's standing deploy approval, after fresh no-playing/paused and healthy-state checks. Selected the LAN origin through the new host UI rather than editing the protected `.env`. | Running image `195225071537` matches the tested build; ten backend hashes, web entry/assets and all six role routes verified. Real deployed MA file check passed; queue identity/status remained unchanged. Persistent data hashes prove the same session/order, two participants/private libraries and MA token/source binding/destination before and after setup. No app-owned playback remained; no speaker/queue/volume command issued. Desktop/320px settings captures inspected with no overflow. MA reports the saved speaker unavailable, so audible testing remains owner-led. Backup `/tmp/opencode/aoty-deploy-addressing-20261015T200336664Z/data.tar.gz` (private directory/file permissions) and rollback image `aotyassistant:pre-addressing-20261015t200336664z` retained; no network rules or deployment defaults changed. |
| 2026-10-15 | Owner confirmed an uploaded file plays successfully. Implemented the requested admission/host-Start cleanup; explicitly retained host reordering/removal after clarification. Ready rooms/direct joins now provide the first turn immediately without audio, with old routes/UI/CSS/flags removed and strict schema-1→2 migration. | Typecheck/build, 141 backend/controller tests, 35 browser workflows and both isolated container smokes pass. Verified first/late/concurrent/full/rejoining rooms, exact paused/revealed continuity, retained moderation/turn/privacy/list/upload behaviour, removed API 404s, old active/draft/ended rooms, migration idempotence/fail-closed writes, and real packaged migration/list recovery. Read-only, network-disabled migration preview of live saved state preserves both participants/credentials/order with zero audio operations or writes. Host/participant/TV screenshots inspected. Running app/playback/settings remain untouched; implementation is local and deployment still requires restart approval. |
