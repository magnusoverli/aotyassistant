# Albums of the Year

A listening circle: participants take turns sharing one song from a favourite album, then reveal it on a public display.

**Development release:** real Music Assistant track search, artist → albums → tracks browsing, and private preparation are available. Experimental Sonos playback is undergoing **owner-led live testing**; the complete exact-recording, natural-end, pause, interference, and recovery checks are not yet verified. Playback is available once a connection and speaker are configured; music starts only on an explicit Play action. Without a saved connection, the demo catalogue simulates playback with a timer. Progress and remaining live acceptance checks are in [PLAN.md](PLAN.md).

Music Assistant **connection setup is available in the host frontend**. No environment-file editing or separate playback enablement is needed for integrations.

**Home Assistant 2026.10+:** Supervisor-assisted server/address discovery, MA browser sign-in, and host Ingress are implemented. Install → Connect Music Assistant → choose a speaker → share the guest QR. See [installation](DOCS.md).

## Try it locally

Requires Node.js 24+.

**Address setup:** in **Connections & settings → Application addresses → Change guest address**, use the address opened in your browser for guest links, or supply a stable hostname. MA-facing media addresses are suggested and verified by a real protected-file fetch without playing audio; advanced overrides must pass the same check. UI choices persist across restarts without `.env` edits. See [address setup and safeguards](docs/application-addressing.md), including private-list recovery when changing browser origins.

**Deployed to the development instance:** participants can upload one MP3, M4A (AAC/ALAC), FLAC, WAV, AIFF, Vorbis or Opus file, review its metadata/embedded cover, and save it to the existing private list. Standalone `.aac` is excluded; there are no upload-storage quotas. Docker includes FFprobe; native installations need it on `PATH` (usually supplied by the OS `ffmpeg` package). Uploaded playback uses Music Assistant, not the demo timer. Real MA protected-file fetch/resolution passes over LAN for all supported formats, without VPN-specific workarounds. See [uploaded tracks](docs/uploaded-audio.md) for setup, retention, privacy, and the outstanding real-phone/speaker checks.

```sh
npm ci
npm run build
npm start
```

Open **http://localhost:3000/display** for the permanent public room, **/join** to participate, or **/host** to manage the listening order. The room is always ready: no sessions, admission, Create/Start/End controls or expiring display links. Participants join the rotation directly; the first join gets the first turn. The host can still reorder/remove people and advance turns. The current listener can search the demo catalogue, play, pause, resume, stop, reveal and finish. Joining never starts audio. A demo track finishes after 30 seconds and advances exactly once. See [the persistent room](docs/persistent-room.md).

Once a Music Assistant connection is saved, every joined participant’s **Find your song** screen uses its global catalogue search instead of the demo. Spotify, Tidal, local files, and other connected providers are included through Music Assistant—there is no Spotify-specific API or provider filter. Choose **Search artists**, select **View albums**, then **View tracks** to browse a provider's artist catalogue. Some providers return only indexed library albums or do not support artist albums; choose another provider result or use track search in that case. Recording versions/providers remain explicit; the app does not silently cross-match recordings.

Anyone joined—including waiting participants—can browse **Find music** and press **Add to my list**. **My list** is a durable, private, ordered preparation list: next at the top, last at the bottom. **Edit order** offers drag handles and accessible up/down buttons; a track's options offer **Make next** and reversible **Remove**. Successful playback retains the entry in collapsed **Played** history; **Removed** entries can also be restored. Only the current participant can explicitly **Play next**, control/reveal playback, or finish the turn. The app never autoplays the list or sends it wholesale to Music Assistant.

**Deployed on 2026-10-15; refresh participant pages to load the new UI.** Saved lists survive refreshes, app restarts, speaker changes, and new events. They use separate anonymous browser credentials and owner-only APIs/events; neither host nor display nor another participant receives list contents or counts. **Keep or recover your list** offers an optional private recovery key and device revocation. Keep that key private: it grants list access, not event membership. Losing cookies without a recovery key loses access; losing the data volume without a backup loses the data. See [docs/preparation-playlists.md](docs/preparation-playlists.md).

Edits require connectivity. **Saved ✓** means the server acknowledged durable storage; **Saving** or **Not synced** does not. A single unconfirmed edit is retained locally across reloads for explicit retry/review, never automatically replayed. Conflicts load the latest list before offering to apply the retained change. If an unsaved catalogue reference expires, reselect that exact recording; no title-based substitute is chosen. Limits are 200 upcoming picks, 1,000 retained entries including history, 10 devices, and a seven-day save-operation retry window; capacity errors never delete existing work. A failed or uncertain play keeps the entry for explicit review. The local upload implementation uses the same private list/history/recovery rules, without file-size or storage quotas; upload completion alone is not Add/Saved. Reversible Remove retains audio; explicit permanent deletion is available under Removed.

Title, artist, album, and version details are shown only to the requester. Original artwork URLs, source URIs, provider internals, and tokens stay server-side. Browse references expire after up to 12 hours, cache eviction, Music Assistant server/token replacement or removal, or app restart—not speaker-only changes. **Saved entries do not depend on those references:** they retain exact server-owned recording identities and resolve them afresh before playback, never by title or another provider. Unavailable or disconnected-source entries stay visible and keep their order. Empty/unsupported-provider results and connection failures are explicit; real search never silently falls back to demo songs.

Phones cannot reach your computer’s `localhost`. For a LAN demo, set both the listen address and the externally reachable URL:

```sh
LISTEN_HOST=0.0.0.0 GUEST_URL=http://192.168.1.50:3000 npm start
```

Replace the address with your own host’s LAN address. Use that same address in the host browser. QR invitations use `GUEST_URL`, not an inferred container/Ingress address.

## Three interfaces, three jobs

Every route uses the same persistent, compact header at every width: the app brand, relevant mode/turn status, **Full screen** where the browser permits it, and **Menu**. Menu contains **Host desk**, **Connections & settings**, **My seat**, and **Listening room**, with the current page marked. The Listening room link opens `/display` directly; no special display authorization is needed. The host QR card contains permanent join/display links. Practical labels, actual errors and recovery notices remain; decorative slogans and repeated open-host banners do not. The shared implementation is in `web/app-header.ts`, with routes/navigation in `web/navigation.ts`.

- **Public display:** a permanent, directly accessible, full-screen-capable listening stage with a quiet current-turn heading and borderless joining QR. The names-only bottom strip follows actual turn order from the current person, uses chevrons and distinct current/next styling, and shows a responsive window of two to seven people with a remaining count. Names do not stretch across the screen in small groups; a lone listener is not repeated as Next. The current label reflects **Playing**, **Paused**, or **Current turn** rather than implying audio during idle/disconnection. Idle/stopped playback shows **Nothing playing**, without placeholder artwork or track details. Reveal changes metadata, not the animation nodes or timing. Pause freezes motion; elapsed/total times stay hidden until reveal. Disconnection hides stale details and shows **Playback unavailable**. No host controls, private searches/lists or future music queue is shown. The room stays open even when everyone is removed. These refinements are included in 0.2.5; update the installed app and refresh display pages to load them.
- **Host desk:** current/next turn controls, participant count, ordering/removal, invitations, and display/settings links. Rooms are ready immediately; new people join at the end without admission. Reordering never changes the current participant. Connections & settings uses the same navigation and dark green-and-gold cards for the music source and speaker/group, with playback recovery shown only when needed. Once Music Assistant is configured, its setup form is replaced by a summary and Disconnect button; setup help appears only when configuring a connection.
- **Participant:** a responsive workspace matching the host pages’ sans-serif typography, dark green cards, and gold actions. The sticky header shows **Your turn**, **Up next** or **Listening** immediately after joining. The current listener and compact seat/countdown sit above the combined private search/list workspace; expand **Circle** to see the rotation. Uploads sit beside search, with result counts and accessible search feedback. Search, private lists/uploads and playback controls remain accessible together, with no admission/pre-start screen. Your selections and playback/reveal controls remain private.

**Version 0.2.7 participant refinements:** Search artists is the leftmost/default Music Assistant search mode, with Search tracks still available. My list shares the player card’s green gradient, border and rounded surface on desktop and phones.

**Version 0.2.8 multi-provider search:** artist, album and track results group matching Spotify, Tidal and other Music Assistant sources into clearer rows with explicit source choices. Verified artist/release identities can browse all listed catalogues; same-name or metadata-only matches require a source choice rather than guessing identity. Track selection always retains its exact source, with distinct recordings/versions kept separate and no automatic playback or source substitution. See [multi-provider search](docs/multi-provider-search.md) for matching rules and limits.

Before joining, **My seat** uses the same nickname form as `/join`, with optional private-list recovery instead of an empty/disabled workspace. **Since 0.2.7:** My list stays hidden until joining, even for returning browsers with saved music; the entry screen remains a single join card rather than previewing tracks. Loading, offline and failed membership checks have distinct states, and a failed check never silently presents a new-visitor form. Rejoining restores the same private list and unsynced edits; unfinished uploads remain recoverable, and nothing starts playing automatically. The original entry-screen and shared-header refinements are included in 0.2.6; update the installed app and refresh open pages to load them.

Public playback movement is decorative: only the slow record rotation and subtle glow remain, without a simulated audio-level meter. Motion uses confirmed playback status, never microphones, speaker analysis, or concealed metadata. The whole record, including its centre sticker, turns once per minute while playing. The record and animated layer remain mounted across reveal and real-time updates, with the same palette and timing; revealed album artwork stays upright over the record. Pause freezes rotation and other motion, and system reduced-motion preferences disable them.

Before reveal, only the record’s small centre sticker is personalized: the current listener’s name above one of **180 short, playful labels**, such as **TRUST THE SPIN** or **ALIBI IN STEREO**. The main **Keep them guessing** headline is unchanged. Each new unrevealed playback gets one phrase, stable through pause, telemetry, reconnect, and refresh—not a distracting mid-song carousel. A shuffled browser-local bag uses every phrase before repeating; exhaustion starts a new shuffled cycle without an immediate repeat. History survives refreshes/new sessions in that display browser, not across separate browsers or cleared site data. Blocked storage falls back to in-page history. Only phrase indexes and public playback/person/session IDs are saved—no names, music metadata, credentials, or prepared choices.

Seat numbers reflect the host’s ordered rotation—not album ranks or physical chairs. Seat/countdown data is calculated atomically by the backend and updates for wrapping, reordering, removal and direct late joins. Every joined participant has a seat immediately. The roster contains only participant IDs/nicknames, not anyone’s track selections. Personal preparation survives ordinary turn/seat changes. Keyboard focus and open-circle/scroll state are retained through real-time refreshes, with a separate accessible announcement when turn status changes.

Artist results use artist images; albums, tracks, prepared choices, and your current track use album artwork when supplied by the provider. Missing/unsupported images fall back to the generic record. Browsers contact only this app: an authorized proxy retrieves bounded raster thumbnails from the configured Music Assistant image proxy, never arbitrary artwork URLs. Private image references are bound to participant/session/catalogue connection, not the selected speaker; public image requests require the exact currently revealed playback and are rechecked after the download. Responses are `no-store`; a bounded server-side cache does not bypass authorization.

Uploaded covers are extracted locally into private raster thumbnails and follow the same owner/reveal checks; tag-embedded external URLs are never fetched. Original uploads live under `DATA_DIR/uploads/`; include this directory with private lists in backups. Saved audio survives event/server changes and does not depend on an expiring Music Assistant URL. Published drafts expire after seven days; incomplete `upload-staging/` data is disposable after restart/restore.

The **host** and **current playing participant** have a volume slider. Real volume control is available automatically for a configured, supported destination; unsupported/unavailable destinations show a disabled control. Commands target only the saved destination, use group volume for groups, and reject stale turns/playback/destination revisions. Participant volume also revalidates current queue ownership. Demo sliders are synthetic and change no speaker volume. Automatic capability/volume checks are read-only, never volume changes.

The participant player responds optimistically: play, pause/resume, stop, and reveal update the private controls immediately, with a small pending indicator instead of disabling the whole player. Commands remain ordered; controls queued while a track starts wait for its exact confirmed playback ID. Public playback/reveal state remains server-confirmed. Volume sliders stay usable while requests run, briefly debounce drag input, and keep only the latest unsent adjustment. Speaker readback happens in the background rather than holding the write request open; mismatches correct the displayed value after a short propagation grace period. Failures refresh authoritative state, discard unsent follow-ups, and never automatically retry a write. Turn/destination changes and disconnection cancel pending intentions.

**0.3.8 responsiveness:** player time advances locally between confirmed samples instead of jumping several seconds at a time; pause/disconnection freezes it immediately, and fresh samples correct it. Estimates stop after five seconds without a new position and never complete playback or advance a turn. Joined participant pages use one combined, independently authorized room/list event connection. Saved-list edits retain search/player and upcoming-row nodes; History loads only when opened, 50 entries at a time. Public hashed assets are compressed/cacheable, while HTML, APIs and private artwork remain `no-store`. See [responsiveness improvements](docs/application-performance.md).

**Pause has no app timeout.** Music Assistant can release a paused stream after about 30 seconds; the app keeps the exact selection, frozen progress, reveal and turn. Resume explicitly restarts that queue item from the saved position after ownership checks. Finishing a parked pause does not resume music. Restart, changing the item/group, uncertain connectivity or external takeover still invalidate playback.

## Security and privacy — read before sharing

- **Host controls are intentionally open**, at the owner’s request. Anyone who can reach the app can manage the listening order, change integration credentials, adjust speaker volume and recover controls. Saved tokens are never returned, but the open host page is not an authentication boundary. Use a trusted LAN only; do not expose the port to the internet.
- Browsing/capturing catalogue choices requires an individual HttpOnly room-membership credential, valid for a year in the browser. Playback/reveal/finish also require the current turn. Private-library credentials are separate, HttpOnly and renewable for a year; removing a participant does not remove library access. The public display is read-only and requires no credential. There are no guest accounts or music-service authorizations.
- Before reveal, display responses and real-time events contain no title, artist, or cover-art reference. Other participant responses never contain another participant’s metadata, even after reveal. Search results remain private to the requester.
- Before reveal, public progress contains only playback identity/status and a fraction—not elapsed seconds, duration, or timestamps. Relative progress can still suggest approximate duration when observed over time; a progress bar is not absolute protection against inference. Progress is display-only and never triggers completion.
- The permanent join/display links do not expire. Removing a listener revokes their current membership; joining again is allowed. Refresh/restart retains valid participant identities and order. Display access never grants player/private-library authority.
- Reveal belongs to the exact turn and playback identity. Track changes (even replaying the same track), advancing, and restarting conceal again.
- This app cannot conceal independently accessible Sonos, Music Assistant, Home Assistant, or sending-app metadata. Restrict those interfaces where practical.
- Prefer HTTPS using a trusted reverse proxy, especially on shared Wi-Fi. Configure `GUEST_URL` as the external HTTPS origin and preserve its `Host` header. Cookies then use `Secure`; API responses are non-cacheable. Disable proxy buffering for SSE and do not log API bodies, cookies, or invitation links. Do not trust forwarded Ingress/user headers.
- Nicknames are text, never HTML. Requests are validated, bounded, rate-limited, and same-origin checked. This is a baseline, not a production security audit.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port |
| `LISTEN_HOST` | `127.0.0.1` | Bind address; use `0.0.0.0` deliberately for LAN access |
| `GUEST_URL` | `http://localhost:3000` | External HTTP(S) origin, no subpath/query/fragment |
| `DATA_DIR` | `./data` | Application-owned persistent directory |
| `PLAYBACK_MODE` | `demo` | Fallback without a Music Assistant connection; configured connections use their selected speaker automatically |
| `DEMO_TRACK_SECONDS` | `30` | Synthetic track duration, 1–3600 seconds |
| `AOTY_TIMINGS` | unset | Set to `1` for sanitized correlated operation timings; `AOTY_MA_TIMINGS` remains an alias |
| `AOTY_DIAGNOSTICS` | unset | Set to `1` for once-per-minute numeric backend diagnostics |

`.env` files are not loaded implicitly. See `.env.example`; with an existing `.env`, start the built server using `node --env-file=.env dist/server/index.js`.

Room state is atomically persisted to `DATA_DIR/state.json` (schema 3) with restrictive permissions. Restart restores participants/order but clears playback/reveal and rotates the turn identity; music never starts automatically. Old development session records (schema 1/2) are discarded, not migrated, as requested; private lists/uploads/settings remain intact. Corrupt/unsupported current room state fails startup. Run only **one application process per data directory**.

Integration settings are stored separately in `DATA_DIR/integrations.json`, also with mode `0600`. Tokens are stored server-side in plaintext in that protected file, **not encrypted**; secure the host, volume, and backups. The application does not put tokens in browser storage or return them in responses. Restart retains the connection/destination and revalidates output readiness through read-only capability/inventory/volume checks—never audio or volume commands. An uncertain settings save disables routing until durable reconciliation and fresh validation succeed.

Private lists live independently in `DATA_DIR/preparations/<owner-id>.json`, with mode `0600` under a `0700` directory. Include the whole data directory in backups. Files contain exact recording descriptors, metadata, history, and credential/recovery **hashes**, never raw owner/recovery secrets. Unknown/corrupt data fails closed without resetting lists or stopping another participant's audio. Existing connection files receive a private source-binding ID on first startup. Restarts/speaker changes and token-only updates retain this binding; disconnecting/replacing the connection creates a new one. Old entries remain saved but are not silently rebound. Same-binding playback still requires fresh exact provider/item/URI/version verification; an origin alone is not proof of a recording's identity.

Private-list JSON snapshots have a 32 MiB read/write bound. A change that would exceed it fails before replacing the last saved list; this metadata bound is separate from uploaded audio storage, which has no configured size quota.

`/api/health` reports process liveness independently of playback recovery, with separate storage/playback availability fields. `/api/host/diagnostics` exposes fixed numeric operational aggregates under the existing host-access policy. See [backend reliability, architecture, and measurements](docs/backend-hardening.md).

## Connect Music Assistant from the host browser

1. Open `/host` and choose **Connections & settings**, or go directly to `/host/settings`.
2. Choose a detected MA server or enter its direct API origin, such as `http://192.168.1.20:8095`.
3. Choose **Connect Music Assistant** and sign in in the new tab. The app creates its own token. **Advanced: token or separate login address** provides manual token entry and an alternate browser login origin when internal DNS is not reachable by the browser.
4. Once saved, the form is replaced by a **Configured** badge and reconnect/disconnect controls. Speakers are discovered automatically after saving and when opening settings; refresh the browser page to retry discovery after a failure. Address editing and setup guidance are expandable. The backend reads server info, authenticated inventory, and documentation availability. No queue metadata or song titles are returned.
5. Use the always-visible **Speaker or group** menu in the Speaker card. A changed selection is validated and applied automatically—there are no Change/Save speaker buttons. The backend refreshes inventory and checks the destination’s active Music Assistant queue before saving; a failed selection restores the current speaker and shows a local error. Selecting a speaker does not play, pause, stop, regroup speakers, change volume, or edit a queue.

**Changing speakers preserves everyone’s private searches, browsing, saved lists, and artwork.** It cancels stale playback/volume intentions without requiring a separate enable step; audio starts on the new destination only after a fresh Play action. Stop or finish the app-owned track first—destination changes are blocked while it is playing or paused. Changing/forgetting the server or token invalidates transient browsing, never saved entries. Disconnecting creates a new source binding on reconnection: old-source entries are retained as unavailable rather than silently moved to another catalogue.

Saving is possible before the new Music Assistant instance is online; automatic speaker discovery shows a clear error if it is unavailable, without affecting the demo or its turn rotation. If the saved destination disappears, a successful inventory read still lets you choose a replacement. An invalid token clears the discovered inventory until you disconnect and configure the connection with a valid token.

**Since 0.3.9**, Settings reports these connections separately: **Music connection** covers Music Assistant reachability, authorization and server identity; **Speaker** covers the selected speaker’s reported availability and queue check. An offline/missing speaker or failed queue check does not turn a healthy Music Assistant connection into **Needs attention** or suggest reconnecting it. If Music Assistant cannot be reached, the saved speaker stays **Not checked** rather than being diagnosed as disconnected. These are read-only checks through Music Assistant, not a direct speaker connection or an audible playback test.

Use **Reconnect Music Assistant** to renew the same server's authorization while retaining its destination and private-list source identity. MA 2.10.6 long-lived tokens expire after one year. To replace the server, Disconnect explicitly and connect the new instance. Disconnecting removes credentials only from this app; revoke tokens in MA separately if needed. Stop or finish owned playback before changing the connection. Concurrent edits are version-checked.

Advanced token setup verifies changed server addresses before saving and preserves the speaker/private-list identity for the same MA instance. Failed or different-server candidates keep the saved setup. Background discovery continues after startup, with capped retries and periodic network refreshes; trusted Supervisor-derived same-ID moves also refresh the browser login address and recheck file access. **Find Music Assistant** remains available when configured. Sign-in and file-check results synchronize across Settings tabs, and unsupported playback schemas are reported separately from speaker availability.

Connection targets are limited to private IPv4 LAN addresses, IPv6 unique-local addresses, and loopback. DNS results are validated and pinned to each request; public/cloud-metadata/link-local addresses and HTTP redirects are blocked. Requests have time/size limits, and TLS certificates must be trusted. Firewall rules remain important: open host controls still permit read-only requests to allowed LAN targets. In a container, `localhost` refers to that container, **not** the Home Assistant host—use a reachable LAN address/name. DNS/mDNS resolution must work in the application’s network environment.

The HA app uses Supervisor's injected token for default-role information reads and Ingress for host access; users do not create an HA token. Standalone installs use the same frontend and direct MA connection. Saving a connection, selecting a speaker and discovery never start audio or change speaker volume.

## Play through Music Assistant

1. Save the Music Assistant connection and select your Sonos destination in `/host/settings`.
2. Participants browse/save privately. When their turn arrives, **Play** or **Play next** starts that exact recording on the saved destination. A Play action takes ownership of that destination, replaces its queue with one track, and disables autoplay, repeat, and shuffle. It may interrupt existing audio. There is no separate enable/disable switch.
3. Before any queue mutation, the controller validates the destination and the verified API **schema 65**; unsupported versions fail clearly while browsing remains available.
4. Pause/resume/reveal and finish-turn controls remain restricted to the current participant. **Since 0.2.7:** Finish my turn replaces Stop inside the participant player, with no duplicate below it; participants without a selected track can still pass their turn. Advancement stops only application-owned playback; music externally substituted into the destination is not stopped.

The controller verifies command results, one queue item, the exact recording/provider identity (or its exact library provider mapping), playback state, and queue-item identity. It polls authoritative queue state approximately every 1.5 seconds. Automatic advancement requires the same owned item, previously observed playing, an idle queue, and Music Assistant's explicit `ended` flag. It does **not** use elapsed-time guesses or the `media_item_played.fully_played` threshold (which can occur before the track ends). Pause, explicit app stop, and unverified errors do not advance.

External queue/source changes invalidate the app's playback/reveal without sending metadata from the new source to browsers. Unsafe repeat/autoplay/queue changes stop a still-owned track. On uncertain connectivity, the app conceals metadata and disables mutations; the host can explicitly choose **Recover playback controls**, which stops the exact item only if it is still owned, clears uncertainty, and does not advance or restart music. Configuration changes are blocked while the app owns playback. External control can race with polling; this is not exclusive access control over Sonos/Music Assistant.

Restart drops ownership, clears playback/reveal and never resumes audio; Music Assistant may continue independently. Room membership/order, saved lists and connection/speaker remain. Unsaved search results need re-browsing. The owner permits restarts/playback interruption on the development instance and reports successful uploaded-file playback; full audible natural-end, extended-pause and interference/recovery acceptance remains outstanding. Fixture tests are not proof of actual speaker behaviour.

## Container

```sh
docker compose up --build -d
```

The Compose default publishes only to loopback. For a deliberate LAN demo:

```sh
BIND_IP=0.0.0.0 GUEST_URL=http://192.168.1.50:3000 docker compose up --build -d
```

For Tailscale, use the server's actual Tailscale IPv4 address as `GUEST_URL`. Save these settings in `.env` so subsequent Compose restarts retain them:

```dotenv
BIND_IP=0.0.0.0
GUEST_URL=http://100.106.148.23:3000
```

Replace the example IP with the address shown by `tailscale ip -4`, then run `docker compose up -d` and open `http://<tailscale-ip>:3000/host` from a device connected to your tailnet. `BIND_IP` controls Docker's host-side port publication; changing only `LISTEN_HOST` inside the container will not expose a loopback-only published port. `GUEST_URL` also configures the accepted HTTP host and invitation URLs; an unmatched address returns **Unconfigured host**. For Tailscale-only access, set `BIND_IP` to the Tailscale IP instead of `0.0.0.0`. Keep host controls restricted to trusted networks and restart only when playback can safely be cleared.

Data persists in a dedicated volume. Startup prepares that directory and then drops to the unprivileged `node` user. No privileged mode, host networking, Home Assistant token, or internal HA database access is used.

## Home Assistant local add-on

### Install from GitHub

Add `https://github.com/magnusoverli/aotyassistant` to the HA app store's **Repositories**, then install **Albums of the Year (development)**. Supervisor downloads a public prebuilt image for amd64 or aarch64. Open the host interface through Ingress, connect the detected MA server and select a speaker. See [installation](DOCS.md) and [prebuilt-image releases](docs/home-assistant-releases.md).

[![Add repository to Home Assistant](https://my.home-assistant.io/badges/supervisor_addon_repository.svg)](https://my.home-assistant.io/redirect/supervisor_addon_repository/?repository_url=https%3A%2F%2Fgithub.com%2Fmagnusoverli%2Faotyassistant)

### Local development installation

Packaging is provided for testing; installation on a real Supervisor instance remains unverified. It never starts audio automatically; a saved connection/speaker becomes available for an explicit participant Play action, just as outside the add-on.

1. On a Home Assistant OS/Supervised host, place this project under `/addons/albums_of_the_year/` (the local add-on directory), including `config.yaml`, `Dockerfile`, lockfile, source, web assets, and entrypoint. Remove the `image` line from this local copy of `config.yaml` to build your changed source instead of downloading the published release.
2. Reload local add-ons in the add-on store, select **Albums of the Year (development)**, and build/install it.
3. Keep the guest port published. Supervisor supplies its effective port and LAN-address candidates; `guest_url` is an optional override.
4. Start it and open the host desk through Ingress. Guests use the direct QR/display links.
5. Permit guest phones and the TV to reach this port. Isolated guest Wi-Fi may require a targeted firewall rule. This also makes the intentionally open host desk reachable to those guests.

State and options live in `/data`. Default-role Supervisor reads assist setup; a separate Ingress listener serves host controls. Ingress does not protect the intentionally open LAN host endpoint. Hot-backup hooks coordinate persistent writes/uploads, and new installs default to automatic startup.

## Music Assistant integration work

The host frontend is the primary setup workflow. See [docs/music-assistant.md](docs/music-assistant.md) for researched commands and the live-verification checklist. An optional developer-only read-only CLI probe is also available:

```sh
node --env-file=.env --import tsx scripts/ma-probe.ts
```

Alternatively, export `MUSIC_ASSISTANT_URL`, `MUSIC_ASSISTANT_TOKEN`, and optionally `PLAYBACK_DESTINATION`, then run `npm run ma:probe`. This optional probe does not configure the app or replace browser setup. Use Music Assistant’s server-generated `/api-docs` and a long-lived token configured by the host. The probe only reads player/queue state and prints no track metadata or raw responses; it never plays, pauses, or changes anything. Read-only catalogue search has also been checked against the development deployment; Sonos playback has not.

## Development and tests

```sh
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run test:browser
npm run test:container
```

After building once, `npm run dev` watches the backend; frontend changes require rebuilding. Every browser workflow uses its own app/storage and mock Music Assistant, with separate host/listener/display contexts. Container tests create/remove their own test containers/volumes. Tests cover permanent public links, filtered HTTP/SSE/artwork, turn/reveal identity, membership removal/rejoining, persistence, private music, playback and integration setup. They do not prove real speaker behaviour.

See the [2026-10-15 codebase audit](docs/codebase-audit.md) for fixes, shared-module boundaries, verification results and remaining limitations. Container checks use the dedicated `aotyassistant:smoke` image tag.

## Not included yet

Production-verified Sonos/uploaded-file playback, guarded external artwork, cross-service matching, pasted links, live-phone casting, authenticated host administration, and automatic recovery after uncertain playback. Uploads/address setup are deployed for development testing, not production-verified audible lifecycle behaviour. Recovery is deliberately host-controlled. Unsupported inputs fail explicitly without changing the rotation.
