# Changelog

## [Unreleased]

## [1.0.0] — 2026-10-19

- Add Home Assistant-only installation and usage guides, MIT licensing, and stable app metadata.
- Document setup, playback, list recovery, troubleshooting, and contribution requirements.
- Allow graceful shutdown to finish and preserve unsupported legacy room files instead of silently resetting them.
- Gate image publication on browser and packaged-app checks, consistent release metadata, and anonymous image verification.
- Standardize documentation and interface copy with neutral terminology, current control labels, and clear compatibility guidance.
- Keep speaker-status guidance compact and record-sticker captions readable across system fonts.

## [0.3.16] — 2026-10-19

- Preserve private-list identity and speaker selection when advanced setup verifies a new address for the same Music Assistant server.
- Match sign-in feedback to its authorization attempt and synchronize file-access results across Settings tabs.
- Rediscover Music Assistant throughout runtime, refresh verified media/login addresses, and keep Find Music Assistant available after connection.
- Report unsupported Music Assistant schemas separately from speaker availability, with installed-version and update guidance.
- Remove the redundant private-list removal-confirmation box; restore removed tracks with Add back in History.
- Expand Music Assistant/Home Assistant setup, recovery, compatibility, and diagnostics documentation.

## [0.3.15] — 2026-10-19

- Update player, catalogue, uploads, and settings in place while preserving unrelated content, focus, text selection, and animations.
- Keep listening-order seats and entry forms mounted, and retain live connections during unchanged tab rechecks.

## [0.3.14] — 2026-10-19

- Keep playback recovery independent of app health, confirm automatic stops, reconcile uncertain settings saves, and reduce list/catalogue latency with bounded work and backup-safe uploads.
- Add focused backend modules, sanitized diagnostics, and graceful shutdown draining while preserving private lists and exact-source playback.
- Show a subtle animated dotted spinner inside Refresh speakers for the duration of discovery.

## [0.3.13] — 2026-10-19

- Make speaker selection a live active output, with automatic availability updates, restart revalidation, and synchronized speaker names in Settings and playback controls.

## [0.3.12] — 2026-10-19

- Show only available speakers in Settings, explain empty/offline inventories, and keep unavailable saved speakers out of the dropdown while allowing read-only rediscovery.

## [0.3.11] — 2026-10-19

- Refine the mobile workspace with a smaller stable player, a compact listening-order strip, and direct search/list shortcuts. Improve secondary text and touch targets.
- Reflow artist/album rows and source choices at phone widths so source prompts remain readable and browse actions have their own space.
- Show a mobile playback-status/return link when the player is off-screen. Distinguish starting, confirmed playback/reveal and errors without replaying actions or moving the browsing position.
- Space initial music setup controls consistently, put link copying before the QR on phones, and give host participant management the full width of the order strip.
- Make the mobile listening order a compact names-only strip with shorter Now/Next labels and two fully visible entries at 320px. Move Manage people beside Host desk, expanding entries only while managing.

## [0.3.10] — 2026-10-18

- Restore artist, album and track thumbnails by using Music Assistant's supported 160px size; normalize older 128px requests. Use 1024px high-quality album artwork on the display after reveal, with small artist portraits and size-specific caching.
- Make the Music Assistant fixture enforce its real image-size allowlist, with regressions for thumbnail loading, legacy URLs and reveal-gated high-resolution covers.
- Keep the Settings speaker selector visible and apply a changed selection automatically, without Change/Save speaker buttons. Preserve the current destination if validation fails and keep playback-blocked changes disabled.
- Remove the redundant “Return to host · Invite people” link from Settings; host navigation remains in the menu.

## [0.3.9] — 2026-10-18

- Separate Music Assistant connection health from saved-speaker availability and queue errors in Settings. Speaker failures no longer suggest reconnecting a healthy Music Assistant server; an unreachable server leaves speaker health unconfirmed rather than declaring the speaker disconnected.
- Keep failed speaker selections in the Speaker card, preserve confirmed server health across speaker/address-only changes, and treat explicitly unavailable queues as speaker issues without changing the saved destination.

## [0.3.8] — 2026-10-18

- Advance the player time/progress smoothly between confirmed playback updates, with immediate pause/offline freezing, bounded stale estimates and authoritative correction—without more Music Assistant polling or timer-based turn advancement.
- Combine room and private-list events into one participant connection, retaining independent membership/device revocation and suppressing unchanged full-list heartbeats.
- Keep private-list updates out of the search/player render path, retain upcoming row nodes, and create history only when opened, 50 entries at a time.
- Serve immutable hashed public assets with prebuilt Brotli/gzip; keep HTML, APIs and private artwork non-cacheable. Use smaller Music Assistant thumbnails for result/list rows.
- Reuse bounded, immutable, validated private-list snapshots, checking file identity/timestamps and authorization on every access; preserve corruption detection and durable save semantics.
- Release room and private-list transaction lanes during slow playback I/O, keeping joins/order and private reads responsive while audio remains ordered and saved-play reservations stay durable.
- Allow replacement searches to cancel old reads, reuse speaker-save discovery results, and keep optional file diagnostics from disabling unrelated settings.

## [0.3.7] — 2026-10-18

- Reduce Music Assistant Play to six HTTP requests when queue settings are already correct; reuse bounded connections with separate control, catalogue and artwork capacity.
- Keep background queue reads from blocking controls, discard stale observations, and use authenticated Music Assistant events for prompt state reconciliation and playback confirmation.
- Bound playback/confirmation work by elapsed time, allow longer MA Play/Resume handlers, and add opt-in timing-only diagnostics.
- Speed up settings discovery and multi-source browsing; cancel superseded read-only catalogue requests.

## [0.3.6] — 2026-10-18

- Remove the redundant Invite people shortcut from the host page heading.
- Show supported upload formats as small, muted helper text below the file-selection button instead of a disclosure.
- Increase listening-order spacing and name sizes, and distinguish the current participant from the next participant.

## [0.3.5] — 2026-10-18

- Keep the shared listening order always visible as a compact horizontal bar beneath the header.
- Remove the player shortcut from the participant’s private list.
- Simplify the navigation menu to page links by removing playback readiness and the Full screen button.

## [0.3.4] — 2026-10-18

- Use one participant-style listening-order disclosure beneath the header on all application pages; move host management into it and replace the separate host and display lists.
- Match the header's responsive gutters and menu layering, preserving expansion and horizontal scrolling during live updates.
- Keep home, settings and unjoined entry pages up to date through a names-only feed, including Home Assistant ingress.

## [0.3.3] — 2026-10-18

- Introduce shared workspace, compact and display layouts with common cards, forms, headings and notices.
- Unify join and participant entry screens, responsive spacing and header/menu alignment.
- Share the CSS foundation with JavaScript-free server error pages, including Home Assistant ingress.
- Make participant scrolling follow the active CSS layout and add cross-page layout regression checks.

## [0.3.2] — 2026-10-18

- Unify host, settings and participant workspace widths, desktop columns, gutters and mobile stacking; align host/settings card spacing and headings.
- Top-align the participant's desktop list with the player in the shared two-column workspace.

## [0.3.1] — 2026-10-18

- Keep the participant player visible at a stable size while idle, playing, paused and waiting for a turn; update playback locally without rebuilding search and list content.
- Remove the participant's “Updating player…” message and its unused controller getter.
- Keep the playback volume slider visible directly in the player, removing its expandable wrapper.
- Show the start of new search, artist and album result lists below sticky controls; preserve saved scroll positions when browsing Back/Forward.

## [0.3.0] — 2026-10-18

- Simplify the mobile workspace with a compact header/list, one turn summary, inline list expansion, and separate playback, reveal, volume and finish controls.
- Clarify music results and source choices; restore browsing context with in-page and browser Back/Forward without putting private music in URLs or history state.
- Simplify list history, Undo, upload review/cancellation and recovery-key creation, replacement and copying.
- Prioritise invitations in empty rooms and current-turn status in active rooms; put roster editing behind Manage people and confirm consequential host actions.
- Organise setup into connection, speaker and guest access, with healthy summaries, local retry, explicit sign-in states and playback-blocked controls.
- Refresh Home, Join, route titles, favicon, themed error pages and the room display's linked QR invitation.

## [0.2.9] — 2026-10-18

- Replace the hard-coded speaker/live badge with truthful playback availability and describe idle participants by whose turn it is.
- Offer private-list recovery on both joining pages, acknowledge recovery, and show nickname errors beside the field.
- Keep playback and turn controls usable during searches, with search failures and retry beside the results.
- Confirm active or paused song replacement consistently from search results and the private list.
- Synchronize the first saved list with already-open tabs without reload or automatic playback.
- Fix menu dismissal when keyboard focus leaves it and improve mobile input readability.

## Earlier versions

- **0.2.8:** Group multi-provider artist, album, and track results while retaining exact source and recording choices.
- **0.2.7:** Simplify participant entry, default to artist search, and integrate turn finishing with the player.
- **0.2.6:** Add a shared compact header and an entry screen that retains saved music, recovery access, and unfinished uploads.
- **0.2.5:** Align host, settings, participant, display, and joining layouts, with clearer navigation and search feedback.
- Add public amd64/aarch64 images for Home Assistant installation, automatic server/address discovery, browser sign-in, Ingress, watchdog support, and coordinated backups.
- Replace session creation and admission with one persistent room, permanent join/display links, and direct joining.
- Add private saved lists with ordering, reversible history, recovery keys, device revocation, and restart persistence.
- Add single-file uploads with metadata/cover review and permanent deletion for MP3, M4A, FLAC, WAV, AIFF, Vorbis, and Opus.
- Verify file-playback addresses through Music Assistant without starting audio; provide configurable guest links and manual overrides.
- Keep search, private lists, uploads, and playback controls together in a responsive participant workspace.
- Add single-track Music Assistant playback, exact-recording validation, pause/resume, natural-completion handling, and explicit recovery.
- Preserve private browsing and saved choices across speaker changes; support destination-bound speaker/group volume.
- Add reveal-gated artwork and progress, with continuous record animation, reduced-motion support, and rotating record-sticker captions.
