# Changelog

## [Unreleased]

## [2.0.18] — 2026-11-11

- Keep the participant seek handle visible as a small dot, enlarging it when the progress bar is hovered, focused or dragged.
- Narrow the landscape display's centred track-details column to 70% of its previous width, with equal gaps on either side of the artwork between the screen edge and track details.
- Remove the idle display's redundant waiting-for-selection text and move “Nothing playing.” to the bottom of the details column.
- Use only the first letter of each participant's name in avatars and enlarge the letter for clearer recognition.

## [2.0.17] — 2026-11-11

- Make the room display's listening order slightly shorter and reduce participant-card width targets to 75% of their previous size.
- Automatically fit the animated background into a bounded region above playback, retire its width control while retaining saved animation settings, and prevent display scrollbars with a viewport-bounded layout.
- Centre the track-details column on landscape displays, placing the artwork to its left while retaining space for the side QR.
- Give track details about 20% more vertical breathing room above their existing bottom edge, and match album-name typography to the artist name.

## [2.0.16] — 2026-11-11

- Make room-display sizing automatic: adapt artwork, typography, QR placement and optional details to the available width and height, preserve browser text enlargement, and remove the room-wide and per-browser size controls. Previous size preferences no longer affect the layout.
- Keep desktop workspace padding bounded on large monitors and render join QR codes as sharp vector images.

## [2.0.15] — 2026-11-11

- Move within your song: during your turn, drag the progress bar in **Your music** (or use the arrow and Page Up/Down keys). A bubble shows the chosen time, the speaker moves when you let go, and the handle waits at that point until Music Assistant confirms. Moving a hidden song past the automatic-reveal marker reveals it, and the bubble warns before you let go. Only the participant whose song is playing can do this, and only while it plays.
- When **When a song ends** is set to **Continue current participant’s playlist**, the player's **Play first selection** becomes **Next track** during a song: it starts your next saved song at once and keeps your turn.

## [2.0.14] — 2026-11-11

- Rebuild the room display as one picture designed at 1920×1080 and scaled as a whole: header, play order, artwork, song details, join code and logo now grow together on any screen, including 960×540 TV boxes and 4K, instead of following separate rules. Text read from across the room is at least 24 design pixels.
- Add **Settings → Appearance → Room display size** (Close, Sofa, Across the room, Back of the room), saved for the room and applied live to every open room display. Larger sizes switch to a compact layout that moves the join code beside the play order and hides stream details. A single screen can still choose its own size from **Room display → Menu → This screen's size**; sizes chosen in 2.0.12 carry over.
- The play order on the room display shows as many listeners as fit, then "+N more", instead of scrolling. The menu and full-screen buttons float over the display and fade out when idle. Phones and portrait screens get a stacked layout.

## [2.0.13] — 2026-11-11

- Replace the automatic-play toggle with **Settings → Playback → When a song ends**: pass the turn and wait, play the next participant's song, or continue the current participant's playlist. Continuing a playlist keeps their turn and waits if the list is empty or the next track cannot play. Existing preferences carry over, and changing modes cancels pending automatic starts.

## [2.0.12] — 2026-11-10

- Scale the room display for TVs and high-resolution screens: larger header controls, listener names, avatars and QR codes, with proportional playback text, spacing and width limits. Keep the compact phone layout.
- Add **Room display → Menu → Display size**, with 85%, 100%, 125% and 150% choices saved in that browser. Keep the current and next listeners at the start of the display's play order as turns advance, without changing the room's saved order.
- Remove the separate **View albums** and **View tracks** buttons from artist and album results. The rows open directly with a click, Enter or Space; tracks retain **Add to list** and **Play**.
- Fix speaker selection remaining blocked by “Playback cannot be confirmed” after successful playback recovery or after another app replaces the song. Unconfirmed playback still requires recovery before changing speakers.

## [2.0.11] — 2026-11-10

- Security: devices on the host's tailnet can no longer reach the LAN port's unauthenticated host controls through the bundled Tailscale connector. The LAN listener in the Home Assistant app now refuses the connections Tailscale passes on from them.
- People without an invitation can no longer use up the request limits invited online guests share, and a flood of wrong invitations no longer blocks a real one.
- Online invitations connect sooner: the first check runs at once instead of after five seconds, waits for the bundled daemon instead of reporting a false failure, and reads the result the moment a Tailscale sign-in or approval completes. Settings follows setup every 1.5 seconds. **Replace invitation** keeps the tunnel running.
- A new online address that has not answered yet is shown as being set up for up to ten minutes, instead of as unreachable. A tunnel that cannot be set up is retried with growing pauses and reported, instead of being reset every five seconds.
- Room displays and host desks, including displays opened through an online invitation, are no longer sent the whole room again each time the online connection check runs. Occasional failed actions caused by the app closing idle connections that Tailscale's proxy was about to reuse are fixed.
- An online guest who scans the room code again enters without waiting, and the first screen's fonts load with the page.

## [2.0.10] — 2026-11-10

- Fix Android long-press playlist reordering on the participant page by handling touch gestures independently of pointer capture. Preserve the press-and-hold delay, normal swipe-to-scroll, and mouse dragging.

## [2.0.9] — 2026-11-10

- Centre the display artwork and details/progress as one combined block, with a 50px gap between them. Use the progress bar's right edge as the block boundary and keep space clear for the bottom-right QR or room logo.
- Lift display artwork and track details with a bottom margin of 3% of viewport width.

## [2.0.8] — 2026-11-10

- Enlarge the shared cover-artwork and placeholder-record frame by 25%, growing upward and rightward while keeping its left and bottom margins. Increase the gap to track details from 24px to 35px.
- Enlarge room-display track text by 1.5× while preserving its size hierarchy, including title, artist, album, playback status, times and stream details. Shorten the progress block by 25%.
- Remove the redundant “Currently playing: [name]” line above the room-display artwork; the current participant remains identified in the play-order bar.

## [2.0.7] — 2026-11-10

- Round the display QR corners subtly in the play-order bar (4px) and more softly at bottom-right (up to 12px, scaling down on small screens to preserve the white margin).
- Keep the last verified online invitation/QR for at least 30 seconds during temporary connectivity failures, without extending the grace period on repeated failed checks. Remove guest-access diagnostics and the Settings link from the room display; it quietly hides an expired QR instead.
- Use one verified Funnel request for both reachability and latency, removing the second request that could falsely mark a working connection offline. Add bounded probe/connector failure counters for diagnosis.
- Widen the display progress block by another 1.7×, from a 748px maximum to 1272px, within the available space beside the artwork.
- Use the same full-brightness vinyl artwork, centre-label styling and glow for idle and unrevealed playback. The idle record resets to its upright 0° starting position; paused playback retains its rotation angle.

## [2.0.6] — 2026-11-10

- Add a saved **Room display QR placement** setting in Appearance: **Bottom-right** or **Right of play order**. The header QR fits within the existing bar height; neither placement shows a “Join room” caption.
- Widen the display progress block from a 440px maximum to 748px (1.7×), while keeping it responsive on smaller screens.
- Keep display track details 24px from the actual artwork edge at every viewport size. Remove invisible playback-control spacing beneath idle text so it aligns with the artwork’s bottom edge.
- Place the animated logo on a clipped background layer behind playback. Enabling or disabling it no longer changes the artwork layout.

## [2.0.5] — 2026-11-10

- Improve readability with slightly wider letter spacing for listening-order names and the participant player's track title. Playlist titles use the same typeface and styling as the player title. Remove the redundant “Your search” label below **Find music**.
- Add **Continuous reveal** in **Settings → Appearance**: rounded reveal strokes travel around the letters without a full-logo hold or fade. Adjust **Visible outline** (5–95%) and **Continuous cycle time** (2–120 seconds). Switching it off returns to the saved intro-animation settings.
- Remove the late solid-letter fade-in. Growing reveal strokes now widen to reach the full letter shapes, clipped to each letter so they cannot reveal neighbours.
- Keep the room display within the viewport in normal and fullscreen modes. The animation has its own upper area, separate from artwork and track details; the logo scales down to fit instead of overlapping playback or creating page scrolling.

## [2.0.4] — 2026-11-10

- Move the animated display background just below the listening order and make it 8% shorter without narrowing it. Align the track-details block with the bottom of the artwork and anchor playback near the bottom of the display.
- Extend **Letter grow time** to 60 seconds. Rounded, softly irregular reveal masks and varied growth pulses give the logo a more organic entrance; a fixed seed keeps the pattern repeatable.

## [2.0.3] — 2026-11-10

- Add the animated BMF logo behind the room display, enabled and looping by default in the room’s gold. Adjust its growth order, origin, randomness, sprouts, timing, looping, hold, fade, pattern seed, opacity and size in **Settings → Appearance → Animated BMF background**.
- Preview changes locally with **Replay preview**, then select **Save and replay on display** to save them and update connected displays. Settings survive restarts; reduced-motion preferences show the finished logo without animation.

## [2.0.2] — 2026-11-10

- Show your room's logo: upload it in **Settings → Appearance**. It appears at the top right of the room display, whatever is playing, and above the join form on guests' phones, drawn in the room's gold so it suits the display. PNG, JPEG, WebP or SVG up to 10 MB; light-on-dark and dark-on-light artwork is converted automatically. Without a logo, both pages look as before.
- The room display keeps one layout in every state. The record stays in its place, resting and dimmed while nothing plays, and the title, artist, album, progress and join code no longer move when a song starts or is revealed. Long titles grow upward from the same line.
- A darker look with two fonts: Grenze for headings, names and what's playing, and Inter for everything you read closely or act on. Settings stays entirely in Inter. Both fonts now ship with the app, so phones, laptops and the TV show the same letters, also offline. Status labels use spaced capitals, and the pages get subtle film grain, darker edges and tapered dividers.

## [2.0.1] — 2026-11-10

- The repository and image are now named **doom-room** too: `https://github.com/magnusoverli/doom-room`. Nothing to do. If you added the old `aotyassistant` address to the app store, keep it: it redirects and updates continue. Don't add the new address as well, or Home Assistant lists a second, separate Doom Room.
- Private playlists now use the Doom Room name internally too. Saved playlists and sign-ins stay as they are; a participant page left open during the update may ask for one reload.

## [2.0.0] — 2026-11-09

- The app is now called **Doom Room** and installs as a new Home Assistant app. **Action required:** Listening Room receives no further updates, and its room, saved lists, uploaded files, sign-ins and settings do not move over. Install Doom Room from the app store and stop Listening Room first, because both use port 3000. Then connect Music Assistant, choose a speaker and invite everyone again. Online invitations get a new `https://doom-room.…ts.net` address. The installation guide's **Move from Listening Room** section lists every step. SuShe Online's **Share to Listening Room** links import as before.

- Change speakers while a song is playing: choose another speaker or group in **Settings → Playback** and confirm to move the current song at its position, keeping the turn, revealed details and uploaded-file access. Uses Music Assistant's native transfer, with no crossfade or replay fallback; a short interruption is expected. Requires MA 2.10.8 or later with a supported playback API. Paused songs can move to an idle, ungrouped speaker without starting audio. Unconfirmed transfers inspect both speakers during explicit playback recovery rather than retrying the move.

- Secret playback can be switched off: **Settings → Playback → Hide track details until revealed** is on by default and keeps today's hidden-until-revealed workflow. Switch it off and the room display shows each song's title, artist and artwork as soon as it starts. **Reveal details** disappears from participants' players, and the 70% marker and automatic reveal no longer apply, so that setting is greyed out. Switching it off during a hidden song reveals it right away; switching it back on never hides a song already shown. The host desk is unchanged.

## [1.2.5] — 2026-11-09

- Disable the embedded browser speaker inside Home Assistant Ingress. Playback controls still work there; direct LAN access and Tailscale invitations continue to register browser speakers automatically.
- Automatic play: switch on **Settings → Playback → Play the next song automatically** and, when a song finishes, the turn passes and the next participant's first song in Your playlist starts by itself. It is off by default. Nothing starts when their playlist is empty or the song can't play; they choose as usual. Finish turn, Skip turn and Pass turn never start the next song. While a song starts this way, the participant's playlist says so instead of asking for a review.

## [1.2.4] — 2026-11-09

- Replace uploaded songs too: **⇄** opens an upload-and-review dialog instead of album tracks. The new file takes the same playlist position only after saving. The original stays in Removed, or Previously played if it has history, with its file retained for separate deletion. Cancelled or rejected uploads leave the original untouched.

## [1.2.3] — 2026-11-09

- Replace a song in Your playlist with another from the same album: the new **⇄** beside **✕** lists the album's songs, with the current one marked. The chosen song takes the same place in the list. The old song leaves the list; if it was played before, its history stays in Previously played.

- Importing a list is much faster and no longer slows down and fails on larger lists. Music Assistant limits each service's requests (its shared Spotify login: one every 2 seconds), and the old import queued up far more than that. Now each song tries Tidal, Qobuz, Deezer and Apple Music and your library before Spotify, asks for fewer search results, and is saved without a second lookup. Requests are paced per service and may wait their turn instead of timing out.
- The import runs on the server: closing the window, locking the phone or reloading no longer interrupts it, and choosing Import again shows its progress. Songs someone else already imported are found instantly. Several failed lookups in a row stop the import with a clear message.

## [1.2.2] — 2026-11-09

- **Clear list** beside Your playlist starts again from scratch: after a confirmation, it removes every upcoming song and the whole history (Previously played and Removed) and permanently deletes your uploaded songs. Your place in the listening order is kept.
- Releases use the GitHub CLI's login when no token is set, and say so when GitHub's request limit is reached instead of waiting silently.
- Fix an occasional failure in the automatic checks, where a test removed its temporary folder while a background save was still writing to it.

## [1.2.1] — 2026-11-09

- Fix importing a list through an online invitation, which answered "Page not found": the invitation address did not allow the two import requests. A new test checks that every participant action is reachable online.

## [1.2.0] — 2026-11-09

- Import a list shared from SuShe Online: choose **Import** beside Your playlist and paste the list's one-week share link. Its songs, one per album, are added last album first; each is found in Music Assistant on its linked album or by searching, with checks on title, artist and length. The summary lists songs that weren't found, each with a Search button, and albums SuShe left out. The server opens only public `https` share links, never addresses on the home network. Needs Music Assistant; there is no demo version.

## [1.1.22] — 2026-11-08

- Refresh the application foundation to Node.js 26 LTS, TypeScript 7 and Vite 8 with native Rolldown/Oxc and Lightning CSS. Update npm dependencies and CI actions, pin runtime images/actions, and add reviewed dependency-update automation, runtime-alignment checks and emitted-asset/compression validation. Browser testing remains opt-in.

- Reuse and compile JSON request schemas with Zod 4.6 instead of rebuilding them for every request, and use boolean-only validation where parsed data is not needed. Adopt Node 26's native disconnect signals for catalogue reads and uploads without cancelling dispatched playback writes. Add regression coverage and separate server ES2025 types from browser DOM types.

- Reorder Your playlist by dragging a song's row, always and on every device: with a mouse, press and move; on a touch screen, press and hold, then drag, so a plain swipe still scrolls. The other songs slide aside to show where it will land, and the list scrolls at its edges. Edit order, the drag handle, the up/down buttons, Move to top and the ⋯ menu are gone; a ✕ on each row removes the song (Add back in Removed undoes it).

## [1.1.21] — 2026-11-08

- Phones show a compact waiting card while someone else has the turn: whose turn it is, whether they are choosing or playing, how many turns until yours, your next pick and the speaker, instead of a block of disabled controls. Search sits much higher on the first screen.
- Make your turn hard to miss on phones: the player's border lights up and pulses, the tab title starts with "● Your turn", supporting phones vibrate, and when the player is scrolled out of view a bar at the bottom says "It's your turn" with Go to player. The same bar reports a lost connection while browsing.
- Pass turn and Finish turn ask for confirmation, and sit apart from Reveal. The host's Skip turn also confirms while the participant is still choosing, and is no longer the most prominent button.
- Fix Previously played and Removed rows on phones, which showed no title and a stretched Add back button. History now scrolls inside the playlist's own area instead of growing the card.
- On phones the playlist is no longer pinned over the results, and shows about four rows. While browsing below it, a one-line playlist bar shows the track count and next pick, confirms each added song, and returns to the list. Edit order keeps up/down beside each song, and a song's ⋯ options open in view.
- One Music Assistant search now finds artists and song titles, listed as Artists and Songs. Tapping anywhere on an artist or album row opens it.
- Fix the ← Artists / ← Albums buttons and the phone's Back button while browsing, which could leave the page because a successful search or browse stopped before recording its step.
- Search results show Play only during your turn, and saved results are marked on their Added button instead of a merged green block.
- Joining starts with the name form; people who joined before choose their name underneath. PIN fields have a Show/Hide toggle inside the field.
- The menu lists Your music and Room display first, then the host's pages and Log out as separate groups. Your own card in the listening order is no longer dimmed.
- The host player drops its always-disabled Play button. On touch screens the host picks up a listening-order card with a press-and-hold, so swiping scrolls the order again.

## [1.1.20] — 2026-11-08

- Fix pages opened through Home Assistant still failing with "__VITE_PRELOAD__ is not defined" after 1.1.18. Browsers kept the broken 1.1.17 copy of the main script, because 1.1.18 left its content, and therefore its file name, unchanged; such files are cached for a year without asking again. Script and style file names now include the version, so every release is fetched fresh.

## [1.1.19] — 2026-11-08

- Publish releases in about half the time. The ARM image builds on a native ARM runner instead of under emulation, and the application checks run alongside the image builds instead of before them.
- The store shows a new version only after its images are published and verified: the publish workflow moves `main` itself. It also writes the GitHub release from the changelog, filling in releases missing for 1.1.15–1.1.18. `npm run release -- <version> "<summary>"` runs the whole release, and the manual store-manifest comparison is gone.

## [1.1.18] — 2026-11-08

- Fix pages failing with "__VITE_PRELOAD__ is not defined" in 1.1.17. The compressed copies of the JavaScript, which browsers receive, were made before the build finished, so every lazily loaded part (QR codes, Settings, the browser speaker) failed. The room display and host desk broke and browsers stopped registering as speakers. The build now compresses the finished files and fails if any placeholder remains.
- This also fixes the bundled software Opus decoder, which never loaded in production builds. Browsers without built-in Opus decoding, such as older iPhones, fell back to PCM (about 1.4 Mbit/s) instead of Opus.

## [1.1.17] — 2026-11-08

- Load pages with 60% less JavaScript (47 KB instead of 121 KB compressed). The browser-speaker audio code and its format checks load in the background after the page is shown; Settings and the QR-code encoder load only on the pages that use them, and the host desk prefetches Settings.
- Online pages skip the separate invitation session check when the page shows the invitation cookie is valid, saving one round trip on every load.
- Participant and join pages open their live connection once, after membership is known, instead of opening and replacing streams. Room pages no longer open the public listening-order feed while waiting for their own first view.
- Share artist searches, album lists and track lists between everyone for five minutes, and combine identical requests in progress. Playback always reads fresh availability.
- Load the albums of an exact-name artist match in the background, and start a browse request when the button is pressed down.
- Serve saved-list and history covers directly instead of redirecting, one request per cover, with the same revalidation tag as the catalogue image.

## [1.1.16] — 2026-11-08

- Load every thumbnail over online invitations. HTTP/2 browsers request a whole page at once; artwork beyond 16 simultaneous images failed and stayed blank. Images now wait for one of four Music Assistant fetches (two resizes for uploaded covers), and a waiting image is dropped when the browser leaves the page.
- Answer artwork revalidation without reading the image again, after the usual access checks, and keep thumbnails cached for an hour instead of five minutes.
- Compress JSON responses over 1 KiB, and shorten catalogue references from about 360 to 175 characters. A 60-album artist page drops from about 148 KiB to 32 KiB.
- Phones playing room audio over an online invitation request a 1 s start lead and a 1.5–4 s buffer, and cap Music Assistant's 30-second send-ahead at 1.92 MB, so FLAC/PCM bursts no longer flood the Funnel link. Any message from a browser speaker now counts as a heartbeat, so a ping waiting behind queued audio cannot disconnect it.
- Settings shows the online round trip through Funnel and whether direct (UDP) connections are available.

## [1.1.15] — 2026-11-08

- Allow the host to delete a user who is not taking their turn while playback controls need recovery or Music Assistant is unreachable.
- Signing in again as an existing room member no longer changes the room revision, so it cannot make a concurrent host reorder or removal fail with "The room changed".
- Share one implementation for bounded caches, rate limits, origin checks and size-limited private record reads, and remove unused modules and duplicated browser view code. Behaviour is otherwise unchanged.

## [1.1.14] — 2026-11-07

- Reuse 160-pixel JPEG thumbnails across catalogue results, saved lists/history and the participant player. Authorized saved-artwork routes share the catalogue cache target; private-list-only reads support conditional caching.
- Resize and cache uploaded artwork as JPEG variants, sharing its cache URL through preview, saved lists and playback. Preserve larger covers for the display on new uploads.
- Distinguish pending reveal confirmation from completed reveal in the player button and explain disabled reveal states in its tooltip.
- Remove the unavailable reveal button from the host-desk player.

## [1.1.13] — 2026-11-07

- Smooth concealed display progress between received positions, ease ordinary timing corrections after reveal, and widen the display's track-information/progress column.
- Prepare display artwork during playback by downloading an encrypted cover/portrait bundle before reveal. Reveal unlocks the downloaded images locally; stale preparations are discarded and ordinary artwork loading remains a fallback.

## [1.1.12] — 2026-11-07

- Keep loaded player covers and artist portraits when confirmed playback uses the same saved artwork. Decode genuinely changed images before swapping them in, and ignore superseded image loads.
- Combine matching album browse rows even when providers use different product barcodes or MusicBrainz release IDs. Preserve edition, year, artist, explicitness and release-group distinctions, and retain strict recording checks for playback.

## [1.1.11] — 2026-11-07

- Show previously played and removed tracks by default below the playlist. Remove the History expander and its explanatory text.
- Reduce excess space above music results and combine the browse-back button and artist/album heading into one compact row.
- Reduce artwork traffic with JPEG thumbnails, a larger bounded server thumbnail cache, and stable participant-scoped image URLs that support authorized browser cache revalidation. Add artwork server-timing headers for diagnosing slow loads.

## [1.1.10] — 2026-11-07

- Simplify music results by removing the Results/Browse music heading, result-count badge and top divider.
- Allow scrolling over the playlist to continue onto the page when the list reaches its boundary or has too few tracks to scroll, in desktop and compact layouts.
- Prefer verified Opus/FLAC browser audio instead of forcing uncompressed PCM, with browser-specific compatibility fallbacks, automatic decoder recovery and bounded adaptive buffering. Preserve the existing speaker identity and audio output through recovery.
- Add ordered, bounded backpressure handling for browser-audio relays and internal output-format/transfer diagnostics without adding user setup or controls.

## [1.1.9] — 2026-11-07

- Fix artist, album and track artwork returning 404 through online invitations: allow the encoded separator in participant artwork references through the public listener while retaining invitation and participant checks.

## [1.1.8] — 2026-11-07

- Clear visible catalogue rows while loading the next browse results, and sort combined artist albums newest first by release year, with undated albums last.

## [1.1.7] — 2026-11-07

- Add a subtle display-page line for the current stream's MA-reported format, bitrate and sample rate, visible independently of reveal. Omit unavailable technical fields.
- Merge matching artist results across providers and show their combined catalogue with each matching album once, including when shared identifiers are missing. Preserve distinct editions and exact-recording playback checks.
- Remove the routine source-coverage disclaimer from successful searches and simplify empty-result text.

## [1.1.6] — 2026-11-07

- Remove album-title subtitles from artist search results. Preserve artwork from equivalent sources and retrieve missing artist/album artwork from bounded, cached Music Assistant detail reads.

## [1.1.5] — 2026-11-07

- Simplify Music Assistant search to artists only, followed by albums and tracks. Remove the Songs/Artists toggle, obsolete search-mode state and styling, and song-search guidance.
- Fix missing usernames in browser speaker names: registration and session checks now use the participant cookie's path, so the signed-in Listening Room profile reaches the naming code.

## [1.1.4] — 2026-11-07

- Give browser speakers friendly names using the signed-in display name and device type. Refresh names after sign-in without interrupting the audio connection.
- Make paired Listening Room speakers visible in Music Assistant's group member picker using its player configuration API. Retry failed name/visibility updates without disconnecting audio or changing groups.

## [1.1.3] — 2026-11-07

- Register the browser player automatically, including invited internet browsers. Remove the extra menu item, setup panel, approval codes and enable/disable controls; use the existing speaker selector.
- Remove the browser player's 2.10.6–2.10.8 version restriction. Verify MA server identity, API schema and Sendspin exchanges instead; source-verify the unchanged authentication/pairing contract in MA 2.10.9.
- Separate audio permission from registration so a pending browser audio unlock cannot stall connection. Add automatic standby-tab handover and lifecycle/reconnection regression tests.

## [1.1.2] — 2026-11-06

- Add an opt-in, host-approved Sendspin browser speaker. Audio belongs to the persistent app shell and continues across internal page navigation; setup is in the menu and Playback settings, without a persistent indicator.
- Keep cross-page settings fragments and query links inside the app router. Add scoped speaker approvals, single-identity tab takeover, server-side MA authentication, bounded WebSocket relaying and revocation for LAN, Ingress and online access.
- Simplify the Room display invitation panel to “Join room” and its QR code.

## [1.1.1] — 2026-11-06

- Add opt-in online invitations with a bundled, pinned Tailscale Funnel connector and guided Home Assistant Settings setup. Guests can join over mobile data without a VPN app or HA account; the invitation address survives venue changes and restarts.
- Publish only a dedicated guest interface, protected by revocable invitations and expiring secure browser grants. Keep host APIs, settings, and Music Assistant playback-file access off the public tunnel.
- Verify the public HTTPS path before showing online invitations; reconnect automatically and coordinate connector shutdown with backup and app shutdown. Add invitation replacement, key-expiry guidance, and local-access fallback.
- Online uploads support up to 256 MiB with a two-minute request deadline; local upload behavior is unchanged. Existing installations remain local-only until online invitations are enabled.

## [1.1.0] — 2026-11-06

- Keep all menu pages on the current browser address, including Home Assistant Ingress, instead of opening Your music and Room display at a separate guest IP.
- Support participant sign-in, logout, playlists, uploads, artwork, and live display updates through the trusted Ingress path while preserving the persistent app header.
- Discover guest invitation addresses from Home Assistant LAN interfaces and the published guest port; refresh automatic selections after stable network changes without interrupting playback.
- Show consistent guest-sharing status on Host desk and Room display, and hide invitations when automatic discovery is unresolved or the guest port is disabled.
- Move manual guest-address controls under Advanced guest settings and add an option to return to automatic addressing.
- Upgrade note: existing saved guest addresses are preserved. Select **Settings → Access & network → Advanced guest settings → Use automatic address** to opt an older saved address into automatic management. Moving between LAN access and Home Assistant may require selecting your name and entering your PIN again; playlists and uploaded files are retained.

## [1.0.13] — 2026-10-28

- Remove the duplicate Music Assistant and Speaker navigation buttons above Settings; use the section navigation instead.

## [1.0.12] — 2026-10-28

- Add Log out to the shared header menu for signed-in users on every page, keeping their playlist, play-order place and other devices signed in.
- Remove the separate play-order removal control; manage user deletion and their place in the order together in Settings → Users.

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
