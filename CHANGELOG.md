# Changelog

## [Unreleased]

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
- Give the listening-order bar more breathing room, larger names and clearer current/next markers, including “You’re next” on your own upcoming seat.

## [0.3.5] — 2026-10-18

- Keep the shared listening order always visible as a compact horizontal bar beneath the header.
- Remove the player shortcut from the participant's My list.
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
- Verify with 195 unit/controller tests and 79 browser workflows; retain screenshots as ignored local artifacts.

## [0.2.9] — 2026-10-18

- Replace the hard-coded speaker/live badge with truthful playback availability and describe idle participants by whose turn it is.
- Offer private-list recovery on both joining pages, acknowledge recovery, and show nickname errors beside the field.
- Keep playback and turn controls usable during searches, with search failures and retry beside the results.
- Confirm active or paused song replacement consistently from search results and the private list.
- Synchronize the first saved list with already-open tabs without reload or automatic playback.
- Fix menu dismissal when keyboard focus leaves it and improve mobile input readability.
- Add the UI/UX audit and remaining implementation plan; keep generated screenshots outside version control.

## Earlier development releases

- Release 0.2.8 with grouped multi-provider artist, album, and track results, explicit source choices, and preserved recording/version distinctions.
- Show ID-less multi-provider matches once with an unverified label and exact source choices, without merging artist or saved-recording identities.
- Group Music Assistant duplicates by explicit identity, browse listed sources, and require exact track-source choices with clear incomplete-result notices.
- Release 0.2.7 with a simpler participant entry, in-player turn finishing, artist-first search, and matching player/list surfaces.
- Put Search artists first and select it by default, and match My list’s surface to the participant player on desktop and mobile.
- Replace the participant player’s Stop button with Finish my turn, removing the separate action below the player while retaining Pause/Resume.
- Hide My list until participants join, keeping recovery available and saved music, unsynced changes, and unfinished uploads intact.
- Release 0.2.6 with a compact shared header on every page and a redesigned participant entry screen that preserves saved music, recovery, and unfinished work.
- Replace the unjoined participant fallback with a shared join form, compact saved-music access, recovery, and distinct loading/offline/error states while preserving private drafts.
- Use the listening room’s compact, reusable Menu and Full screen header on every page, preserving contextual status and keyboard navigation.
- Release 0.2.5 with coherent host, settings, participant, listening-room, and joining interfaces, plus clearer navigation and search feedback.
- Align Join room with the host and participant pages’ sans-serif headings, dark background, form styling, and responsive card spacing.
- Redesign the listening room with a spacious stage, quieter joining QR, compact navigation, and a clear current/next turn-order strip without duplicate status panels.
- Match My seat to the host pages’ typography and surfaces, bring uploads beside search, and improve list readability, touch targets, search feedback, and speaker-setup access.
- Simplify Connections & settings, remove the saved-settings reload button, and tuck address editing and technical guidance behind expandable controls.
- Put the current turn first on the host desk, remove its page heading, slim the volume panel with a settings link, and move invitations to a right sidebar.
- Remove the “updating” text from all volume controls.
- Accept Home Assistant-verified LAN addresses alongside saved guest URLs, with a helpful setup page for other guest-address mismatches.
- Publish public amd64/aarch64 0.2.2 images and enable download-based Home Assistant installation.
- Reject queued pause/resume commands when background polling has already revoked playback ownership.
- Create the test scratch directory on GitHub runners and bound check jobs so image publishing cannot hang indefinitely.
- Record live HAOS 0.2.1 discovery, Ingress and hot-backup verification, with interactive MA sign-in still pending.
- Fix Home Assistant's Open web UI entry path and allow MA sign-in before music sources and players are configured.
- Add automatic Home Assistant/MA discovery and addresses, browser sign-in/reconnect, host Ingress, coordinated backups, startup/watchdog support, and prebuilt-image release automation.
- Document opportunities for automatic Home Assistant setup, Music Assistant browser login, and Ingress integration.
- Add a public Home Assistant source repository, lab installation guidance, and automated application checks.
- Deploy the audit fixes and restart the development app with saved data/settings retained; refresh open pages.
- Harden playback, private-list recovery, uploads and live updates against stale requests; fix startup errors and consolidate shared infrastructure without changing the feature set.
- Replace sessions with one persistent room, permanent public display/join links, and no Create/Start/End or admission controls; retain private music and host reordering/removal.
- Restore the development app/MA addresses and original catalogue identity/speaker while retaining the newly configured valid token; live file verification passes.
- Deploy uploads, the combined participant workspace, and MA-verified address setup; guest links now use the LAN address, with existing session/lists retained.
- Suggest and verify app media addresses through Music Assistant without playback, with host-configurable guest links, safe LAN setup, and verified manual overrides.
- Verify real Music Assistant protected-file fetches for all supported formats over LAN after disconnecting the conflicting development VPN; no routing workarounds needed.
- Show participant search and private lists together, with a desktop sidebar, expandable phone preview, and uninterrupted access during playback.
- Add private single-file uploads with metadata/cover review, durable lists, guarded Music Assistant playback, and permanent deletion; support MP3, M4A, FLAC, WAV, AIFF, Vorbis and Opus without storage quotas (not standalone AAC).
- Document a combined participant search/private-list layout with a desktop sidebar, compact expandable phone list, and standalone visual prototype.
- Document uploaded-audio research, broad formats without storage quotas, AAC timing handling, and Music Assistant callback-network requirements.
- Deployed identical header menus and the plain-copy cleanup; refresh open pages to load the changes.
- Use identical header navigation on every page, remove the redundant Session links menu and open-host banners, and replace decorative slogans with concise functional wording.
- Deployed the shared header and navigation on all pages; refresh open pages to load it.
- Share one persistent header across every page, with centralized desktop/mobile navigation, host session links, accessible menus, and preserved playback/display state.
- Deployed durable private playlists and automatic speaker readiness; refresh participant pages, then use an explicit Play when ready.
- Remove the manual playback enable/disable switch; configured speakers are available automatically, with explicit Play actions and all playback/ownership safeguards retained.
- Deployed the simplified Music Assistant settings; refresh pages and re-enable live playback when ready.
- Simplify configured Music Assistant settings to a summary and Disconnect button, hiding setup fields and removing the redundant manual connection check.
- Connect durable private playlists to participant search, reordering, history/recovery, guarded Play next, and restart-safe catalogue identities; reserve private asset-backed entries for future uploads.
- Deployed whole-record rotation so the personalized label now turns with the disc.
- Started the durable private-playlist backend with saved ordering, reversible history, conflict-safe edits, and owner recovery; participant UI integration is still pending.
- Enable this deployment's LAN/Tailscale port access with the correct Tailscale invitation URL, and document persistent Docker bind settings.
- Make the record label spin with the disc so rotation is clearly visible, without changing the rest of the public display.
- Document the proposed durable private preparation playlist, with ordered tracks, recovery safeguards, and a compact participant UI.
- Deployed personalized record stickers and slow rotation; refresh the public display to load the new visuals.
- Personalize unrevealed vinyl stickers with the current listener’s name and 180 playful labels, shuffled without repeats until exhausted and remembered across display refreshes.
- Spin the public record slowly during playback, keeping its label readable and rotation continuous through reveal, frozen on pause, and disabled for reduced motion.
- Deployed the cleaner public display; refresh pages and re-enable live playback after upgrading.
- Clean up the idle public display and add restrained playback motion that stays continuous through reveal, pauses with playback, and respects reduced motion.
- Deployed the speaker-change fix; refresh pages once and re-enable live playback to continue.
- Preserve private prepared tracks, browsing, and artwork when changing speakers, while keeping playback and destination safety checks intact.
- Made the participant player and host volume respond optimistically without page-wide locking, coalescing rapid adjustments and correcting failed or mismatched updates.
- Keep paused tracks resumable indefinitely when Music Assistant releases their stream, while retaining exact-item and external-source safeguards.
- Discover speakers automatically in settings, without requiring a manual connection check before changing destination.
- Added public playback status and progress, revealing elapsed/total times only with the track information.
- Added private artist/album artwork browsing and guarded, reveal-only images on the public display.
- Added destination-bound volume controls for the current playing participant and host, with group-volume support.
- Cleaned up Connections & settings to match the host desk, with separate connection, speaker, and playback cards plus on-demand setup details.
- Simplified the participant page with the public display’s dark green-and-gold theme, compact turn/seat status, and less repeated information.
- Redesigned the TV display, host desk, and participant UI with clear turn states, seat positions, and a private rotation countdown.
- Disable session controls immediately when the browser goes offline and revalidate state on reconnection.
- Added private artist/album browsing and preparation for all participants, plus host-enabled experimental single-track Music Assistant playback.
- Connected private participant search to all Music Assistant catalogue sources, with clear empty/error states; real playback remains disabled.
- Recorded development-only Music Assistant API discovery and the editable host-UI configuration workflow.
- Added host-browser Music Assistant setup, read-only checks, and speaker/group selection with server-only tokens; playback remains demo-only.
- Added a runnable demo with QR joining, private reveals, atomic turn controls, mobile/TV/host views, persistence, tests, container/add-on packaging, and a read-only Music Assistant probe; live Sonos playback remains pending.
- Added the Albums of the Year implementation plan, confirmed owner decisions, and progress/acceptance checklists.
