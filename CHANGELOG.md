# Changelog

## [Unreleased]

## [1.0.11] — 2026-10-28

- Organize Settings into Playback, Users, Music Assistant and Access sections with responsive navigation and clearer user-management actions.
- Allow a fresh user registration after deletion, including the same name, without inheriting the deleted playlist or being blocked by old browser cookies.
- Style Host desk as a matching navigation button alongside the other home-page actions.
- Permanently delete users, their playlists and uploads from Host Settings, with confirmation and retryable cleanup.
- Recognize returning users by name and four-digit PIN, with remembered devices, one shared personal playlist and host PIN reset.
- Show play-order arrows consistently on every page, including Host desk and mobile layouts.
- Choose Music Assistant recordings without provider dropdowns, preserve verified equivalents in saved lists, and validate the reported playback source.
- Improve Music Assistant search deadlines, dynamic-queue takeover and position updates while reducing redundant volume polling.
- Automatically reveal tracks at 70% playback by default, with a Settings toggle and a progress marker that disappears after reveal.
- Combine desktop search and playlist into one workspace with a wider, scrollable playlist pane and compact inline editing.
- Enlarge Display page artwork and track typography slightly while retaining its spacious layout and centered alignment.
- Place the Display page QR invitation at the bottom-right and center track information vertically alongside the cover art.
- Remove redundant participant and demo labels from the host player while retaining configured speaker status.
- Keep the header menu button the same width when switching between Menu and Close.
- Give desktop player transport buttons equal widths and readable labels instead of squeezing Pause into broken lines.
- Restore fullscreen directly in the Display page header on mobile and desktop, with no fullscreen control on other pages.
- Match the Host desk player to the participant layout with a generic animated record and no track metadata, including after reveal.
- Unify header and play-order styling across pages, retain Host desk management, and place display-only fullscreen in the menu.
## [1.0.10] — 2026-10-27

- Make Playwright browser tests opt-in for local development and CI, including releases.
- Keep the header and play-order bar mounted when navigating between local pages, updating only changed content and closing old page subscriptions.
- Use the compact participant header and play-order bar across all mobile pages, with display fullscreen available from the menu.
## [1.0.9] — 2026-10-26

- Keep mobile playback button labels readable on narrow phones across system fonts.
- Recheck membership when a participant event stream fails so removal during startup returns to the join form.
- Clear failed or missing upload attempts on refresh without residual errors, while retaining background checks for uncertain uploads.
- Remove manual upload cancellation and its cleanup flow while retaining progress, background completion checks, and interrupted-upload handling.
- Simplify uploading to choose, review and add, with automatic completion checks and safe cleanup instead of upload-draft management buttons.
- Rename the list card to “Your playlist” and show its track count as a separate subtitle instead of part of the title.
- Let stale list cookies from an earlier empty installation open the automatic list instead of showing “Needs attention,” without replacing existing saved data.
- Make selections one automatic persistent list per participant browser, remove list recovery and device-management flows, and show a useful empty list beside search.
- Combine mobile selections and search into one music card with an always-visible, inline-editable list, preserving desktop and the player.
- Halve the mobile participant page’s gap between the play-order bar and player from 20px to 10px without changing desktop.
- Trim mobile participant play-order cards to 40px and their bar to 49px, preserving text size, stable turn positions, desktop, and host controls.
- Slim the mobile participant header to 44px with a 40px Menu button while retaining its full 44px tap area and unchanged desktop styling.
- Remove the mobile participant header subtitle and reduce its top bar from 56px to 48px while preserving menu touch targets and desktop styling.
- Shorten the mobile player by 28px with compact playback buttons and no unused output row, preserving padding, 44px touch targets, state stability, and desktop.
- Remove redundant Private and Private pick labels from the idle mobile player without changing its layout or desktop.
- Remove the mobile player’s info icon and output text, and reserve a blank artist line until a song is active without moving its content or changing desktop.
- Give the mobile participant player a fixed-size layout, permanent touch controls, labelled turn actions, and a full-details sheet without changing desktop.
- Track speaker-inventory freshness explicitly, retain labelled last-known choices during refreshes, and expire stale readiness in the browser without changing speaker-selection controls.
- Tolerate temporary playback-status read failures without replaying commands, and distinguish connection, command-confirmation, queue-policy and external-playback problems.
- Refresh speaker readiness after playback recovery so stale connection checks do not block the next song.

## [1.0.8] — 2026-10-26

- Update request parsing and schema validation dependencies to fix high-severity denial-of-service vulnerabilities.
- Keep the current participant first and the next participant second in the mobile play-order bar without changing desktop or persisted turn order.
- Keep waiting participants inside visible cards on mobile instead of showing their names without a background or border.
- Narrow mobile play-order cards and centre participant names and turn labels, preserving desktop styling and host controls.
- Extend the mobile header’s upper divider edge-to-edge to match the line beneath the play-order bar.
- Slightly brighten the mobile header’s Menu button text and border without changing desktop styling.
- Slightly compact the shared mobile header and play-order bar while preserving touch targets and desktop styling.
- Remove the redundant turn-distance and music shortcut row from the mobile participant page to free up space, leaving desktop unchanged.
- Add direct Stop and Mute/Unmute controls, host Pause/Resume, and a compact shared player layout with playback and turn actions kept separate.
- Span the participant player across both desktop columns, with search and saved selections aligned below it.
- Consolidate host and participant playback into one shared component with role-specific controls and privacy safeguards.
- Keep participant names, avatars, and controls in fixed positions whether or not a turn label is shown.
- Remove waiting participants’ “Listening” labels and dim their cards to 55% opacity, with the next turn at 85% and the current turn fully bright.
- Widen the current-turn border light to 64px and strengthen its halo with 0.9 opacity and a 3px blur.
- Make participant cards slightly narrower with less horizontal padding, keeping removal controls unchanged.
- Remove participant card numbers to give names and turn labels more room on desktop and mobile.
- Slightly brighten the current-turn border light and strengthen its soft halo without changing its shape or speed.

## [1.0.7] — 2026-10-20

- Replace the inset, snake-like turn marker with a diffuse travelling light on the participant card’s actual border and a subtle surrounding glow.
- Remove the redundant unavailable-volume hint and settings link from the host’s Speaker volume card.

## [1.0.6] — 2026-10-20

- Rename the app to Listening Room and clarify turn-based sharing, private selections, reveal controls, and silent demo playback without changing existing installation or list access.

## [1.0.5] — 2026-10-20

- Soften the current-turn border into one uniformly blurred glow with feathered ends and a gentle ten-second circuit.
- Make dragging and trash icons available directly in the host’s listening order, removing the Manage people mode.
- Remove visible listening-order feedback and hint popups while retaining screen-reader announcements.

## [1.0.4] — 2026-10-20

- Keep participant cards compact with corner trash icons, and slide neighbouring cards into place while reordering.
- Make the travelling border mark the current participant’s turn, including while choosing a song, paused or stopped.
- Prevent dragged or cancelled pointer gestures over trash icons from removing participants.

## [1.0.3] — 2026-10-20

- Replace the pulsing playing-participant border with a glowing segment that travels around the card every eight seconds.
- Reorder participants by dragging whole cards in Manage people, with touch, keyboard controls and edge scrolling instead of up/down buttons.
- Show the revealed track title and artist on the spinning record when cover artwork is missing or unavailable.

## [1.0.2] — 2026-10-20

- Double the room-display record’s rotation speed to one revolution every 17.65 seconds.
- Show “Currently playing: <username>” on the room display only during active playback.
- Add directional arrows between participants and a slow, subtle border glow during playback, replacing the arrow beside “Up next”.
- Make the room-display join QR code 25% smaller.
- Show playback progress and reveal status on the host desk, with a Stop song action that keeps the participant’s turn.

## [1.0.1] — 2026-10-19

- Advance to the next participant when Music Assistant confirms a song’s natural end after its idle delay.
- Spin the room-display record about 1.7 times faster during playback.
- Combine participant search and results into one compact panel, with saved-list playback controls in the player.
- Expand the desktop header and listening order across the full browser width.

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
