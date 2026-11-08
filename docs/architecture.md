# Architecture and data contracts

## Runtime

The Home Assistant image runs Node.js 26 LTS, a TypeScript/Express 5 backend, and Vite 8-built browser assets. The native TypeScript 7 compiler checks both browser/bundler and server/NodeNext resolution. Vite uses Rolldown/Oxc and Lightning CSS with its Baseline Widely Available browser target; browser audio still probes capabilities independently. Startup prepares private storage and drops to the unprivileged `node` user. Supervisor provides `/data`, options, discovery information, Ingress, watchdog monitoring, and backup coordination.

Node and Tailscale images and CI actions are digest-pinned. `.node-version` supplies the CI runtime; release validation checks it against both image stages, package engines and Node declarations. Renovate configuration tracks dependency updates for review rather than automatically deploying them. See [dependency maintenance](../CONTRIBUTING.md#dependency-maintenance).

The app has a guest/display/host LAN listener on port 3000, an authenticated Ingress listener on 8099 supporting all browser pages, and a guest-only loopback listener on 8098 in the bundled HA image. Untrusted headers cannot impersonate either trusted listener context. Participant cookies, uploads, artwork, and event streams use the trusted Ingress base path. It needs no privileged mode, host networking, Docker socket, Core database, or shared media mount.

Opt-in online invitations launch a pinned Tailscale userspace daemon as `node`, with a private socket and persistent device state. The manager uses fixed CLI arguments (no shell), projects only status and allowlisted approval URLs, and validates the exact Funnel mapping before a bounded public HTTPS challenge. Guest sharing is independent of LAN discovery and Music Assistant's file origin. The public gateway uses explicit method/path allowlists and invitation grants, plus global/per-grant limits; it cannot route host or media-playback APIs. A request-local WeakMap, not proxy headers, identifies public traffic for HTTPS cookie and CSRF handling. Disable/rotation closes public streams, and generation checks reject stale network results. Backup freeze stops the daemon before acknowledging the snapshot barrier; thaw permits automatic reconnection. See [online invitations](online-invitations.md).

```text
Home Assistant Ingress ─ host interface ─┐
Guest phones ─────────── LAN listener ──┼─ backend ─ Music Assistant ─ speaker/group
Shared display ──────── LAN listener ───┘     └─ private /data
```

Only one process may own a data directory. JSON stores serialize mutations and use private temporary files, atomic replacement, and filesystem synchronization before acknowledging saves. Unknown or corrupt records stop startup without replacing saved data. Storage-format changes require a documented migration or recovery path that preserves acknowledged data.

## Modern implementation choices

Modernization means using applicable capabilities without weakening the application's contracts. These choices are implementation-level, not just dependency version requirements.

| Area | Implementation and rationale |
| --- | --- |
| Node 26 request cancellation | Catalogue operations and upload transfer/analysis use native `IncomingMessage.signal`. It handles disconnects even after the request body finishes. Playback writes deliberately do not inherit this signal: a disconnected browser is not proof that an audio command did not commit. |
| Zod 4.6 parsing | `jsonBody` constructs/compiles a route's schema at registration, instead of rebuilding it on each request. Typed parsed output retains trims, defaults, strict unknown-key rejection and ordinary Zod errors. Compilation is server-only and explicit, not a global setting affecting persistence or browser CSP. Refinements/transforms must be pure because an invalid input can also take the runtime fallback. |
| Zod boolean checks | Origin, UUID and exact-Funnel checks that only need validity use `.validate()`, avoiding result/error construction. Checks that need normalized output or error details retain `.parse()`/`.safeParse()`. |
| Express 5 promises | Async route promises are returned directly to Express's native error handling. The compiled-body adapter does not add a separate error-catching framework or change middleware authorization order. |
| TypeScript 7 | Native compilation, isolated-module checks and explicit type-only imports match Vite's per-file transformation. The server uses ES2025/NodeNext without DOM globals; browser compilation retains its separate compatibility target. |
| Vite 8 | Native Rolldown/Oxc and Lightning CSS, lazy settings/audio chunks and final-output precompression are used together. The emitted manifest and compressed bytes are checked after the build, not before lazy-import placeholders are resolved. |
| HTTP and WebSockets | Keep pinned-address HTTP agents and `ws` for validated DNS, redirect rejection, payload bounds, upgrade handling and backpressure. `ws` 8.22 uses Node 26's native frame masking automatically; no optional native addon or unguarded native-client replacement is needed. Node's keep-alive timeout buffers already have protective defaults. |
| Sendspin 6 | Public timing, minimum-buffer and sync-correction APIs are used, with native/software codec capability probes. Decoder health and codec changes still lack a public `SendspinPlayer` API; the small instance-scoped extension remains version-pinned and contract-tested. Do not bypass application playback ownership through SDK controller commands. |
| Media and browser crypto | Sharp's bounded resize work, metadata allocation limits and disposable media-analysis processes remain in place. Secure pages use Web Crypto; plain-LAN HTTP keeps the audited AES-GCM fallback. Zod has no runtime browser imports here, so switching to Mini would not reduce this browser payload. New image encodings require separate latency and device-compatibility measurements. |
| Storage and streaming | Existing `AsyncLocalStorage.snapshot()`, composed abort signals, stream pipelines, bounded queues and fsynced atomic stores already use modern platform capabilities. Native SQLite or a different concurrency framework would require a separate migration case, not an automatic replacement. |

Upstream contracts: [Node HTTP signals](https://nodejs.org/docs/latest-v26.x/api/http.html#messagesignal), [Express 5 migration](https://expressjs.com/en/guide/migrating-5.html), [Zod compilation](https://zod.dev/compile) and [Zod 4.6 validation](https://zod.dev/blog/zod-4-6). `tests/modern-http.test.ts` checks compiled/runtime parity, real registered routes, async error propagation, mid-transfer/post-transfer cancellation and independent audio writes. `npm run bench:validation` measures parser cost only; it is not HTTP throughput or a physical-device benchmark.

## Main boundaries

| Area | Modules |
| --- | --- |
| Room, membership, turns, filtered views | `src/engine.ts`, `src/model.ts`, `src/store.ts` |
| Connection identity and output readiness | `src/integrations.ts`, `src/music-assistant-policy.ts` |
| HA discovery, addressing, authorization | `src/setup.ts`, `src/supervisor.ts`, `src/ma-discovery.ts`, `src/ma-authorization.ts` |
| Playback ownership and MA transport/events | `src/live-playback.ts`, `src/music-assistant.ts`, `src/music-assistant-events.ts` |
| Private preparation and uploads | `src/preparations.ts`, `src/uploads.ts`, `src/upload-analysis.ts` |
| Permanent users, PINs and browser sessions | `src/users.ts` |
| HTTP, Ingress, events | `src/http.ts`, `src/integration-http.ts`, `src/ingress.ts`, `src/event-streams.ts` |
| Online invitations and bundled connector | `src/online-access.ts`, `src/tailscale.ts`, `src/public-listener.ts`, `web/online-panel.ts`, `web/online-entry.ts` |
| Durability, shutdown, diagnostics | `src/backup.ts`, `src/operation.ts`, `src/index.ts`, `src/diagnostics.ts` |
| Browser UI and controllers | `web/` |
| Shared host/participant playback UI | `web/playback.ts`, `web/player-controller.ts`, `web/media.ts` |

Room changes and audio commands have distinct serialization boundaries. Network reads run outside mutation lanes with bounded concurrency, deadlines, cancellation, and generation/revision checks. An ambiguous write is reconciled through readback rather than replayed automatically.

`web/playback.ts` owns the persistent host and participant playback UI, including transport, read-only progress, mute/volume, and role-specific turn actions. `web/main.ts` supplies action callbacks and page placement; `PlayerController` retains optimistic command handling for both roles. Host pause/resume and stop act only on the exact app-owned playback; the host receives no participant-only source/reveal controls or private track metadata.

## Playback contract

- Play is explicit, current-turn-authorized, recording-specific, and single-track. Equivalent providers may be resolved before Play; an uncertain Play is never retried through another source.
- Queue/item identity establishes ownership. Events prompt authoritative checks; they do not independently establish completion or ownership.
- Natural completion requires the same safe owned item, previously playing, and MA’s explicit `ended` state. Presentation clocks never advance turns.
- External takeover invalidates app ownership without stopping foreign audio. Uncertainty requires explicit recovery.
- Turn, destination, connection, and playback revisions reject stale commands and optimistic browser intentions.
- Restart drops playback/reveal, retains room/list/settings data, and never resumes audio automatically.

### Playback verification and failures

`src/playback-read.ts` is the read-only reconciliation boundary. It permits at most three attempts for classified temporary connection, timeout or destination-availability failures, with 150/350 ms backoff inside the existing eight-second read budget. It does not shorten the first request's timeout or extend the caller's deadline; retries run only while time remains. Authorization, unsupported responses, blocked addresses, cancellation and closed clients are not retried. Background snapshots remain outside the command serializer and are discarded if the command generation, connection revision or owned playback changes.

Audio and queue-policy writes are never retried. A lost Play/Pause/Resume/Stop acknowledgement may be reconciled through authoritative reads; success requires the exact safe queue/item and requested transport state. Play additionally requires a new queue-item identity, not an older instance of the same recording. Failed read-only control preflight sends no command and does not itself discard confirmed ownership. Once command confirmation is genuinely uncertain or monitoring retries are exhausted, existing fail-closed ownership, upload leases and explicit host recovery safeguards remain in effect.

### Music Assistant audit changes

1. **Canonical library responses:** resolution accepts explicit provider mappings while retaining recording/version checks, including older saved choices.
2. **Stream identity:** playback reads retain `streamdetails.provider` and `item_id`, checked against sources resolved before Play. A playing catalogue item requires stream identity; parked pauses can release it. This verifies MA's reported source, not physical audio.
3. **Search deadlines:** search gets 12 seconds, beyond MA's eight-second provider cutoff; catalogue HTTP operations have 16 seconds and browsers wait 18 seconds. Optional matching shares a three-second budget, eight reads and at most two simultaneous requests.
4. **Dynamic queues:** explicit takeover stops and clears the queue before changing locked policies, with queue read-back before Play.
5. **Position corrections:** `queue_time_updated` prompts authoritative refresh; periodic polling still covers progress and missed events.
6. **Monitoring cost:** background volume reads are limited to once per 15 seconds, with player events and explicit operations refreshing sooner. Ownership and readiness reads remain authoritative.
7. **Provider transparency:** `catalogue-grouping.ts` combines compatible artist/album metadata into navigable browse groups, retaining every provider reference for union browsing. Known identity and edition conflicts remain separate. Recording substitution requires IDs or mappings, not browse matches or matching names. `recording-identity.ts` persists private evidence and bounded equivalents without library mutations; public references remain participant-bound and opaque. Existing saved choices continue to load.

Explicit recovery performs a fresh connection/speaker inspection after releasing the command lock, rather than acknowledging readiness from a cached failed inspection. Observation and configuration revisions prevent older inspections from undoing the recovered status.

`src/playback-problem.ts` defines fixed, sanitized problem codes, messages and whether recovery is required. Room and integration views retain the legacy `playbackIssue` string and add `playbackProblem`; public display views expose neither. The UI shows the specific reason and offers recovery only when required. External playback changes and a confirmed protective queue-policy stop retain the turn without requesting unnecessary recovery. Unconfirmed stops retain ownership and never advance the turn. Settings shows the problem directly and its diagnostic code under **Details**; no upstream exception, token, source URL or private recording metadata is included.

## Speaker inventory and readiness

Music Assistant's `players/all` is the inventory authority; the app does not probe physical speakers or infer availability from saved routing preferences. Only the selected destination ID/name is persisted. Runtime inventory observations have a 45-second freshness window and explicit `loading`, `refreshing`, `verified`, `stale` or `failed` state. Events prompt coalesced reads, with a 15-second polling fallback. Ordinary background refreshes leave existing fresh playback readiness intact and do not send audio commands.

Integration views expose `speakerInventory` with last-known public player IDs/names/availability, `checkedAt`, `expiresAt` and serialization time `asOf`. Last-known entries survive a failed read for labelled presentation only; the legacy `report` and playback-readiness checks still reject failed/expired evidence. A successful inventory replaces the list, removing absent/offline choices. Credential/origin changes clear observations, and in-flight checks are fenced by the existing configuration and observation revisions. Inventory freshness is distinct from the selected queue's readiness.

Settings retains its select node, options, draft fields and focus during updates, marks normal refreshes **Updating…**, and labels stale/failed data as last known. `web/speaker-freshness.ts` expires readiness independently of event delivery using relative server leases and client elapsed time, with no clock-synchronization requirement. Both inventory and queue certificates must be fresh; queued or replayed snapshots cannot restart a lease. One expiry wake-up initiates a coalesced read, not a polling/reselection loop. Selection and Play retain fresh backend validation, with no automatic target switch or fallback.

## Privacy contract

Permanent users own exactly one private list and can have multiple independent browser sessions. Room participants link to user IDs, so concurrent joins reuse one listening-order seat; removal requires an explicit rejoin. Public user IDs are separate from private list IDs. Display names are labels and never authorize access or merge users. Existing private bindings and authorized legacy list cookies migrate without moving entries or uploads.

Session and private-list credentials use separate HttpOnly cookies. The user store accepts only active session hashes and their corresponding list credentials; PIN reset revokes both, including legacy bootstrap access. PINs remain four-character strings and use versioned, salted asynchronous scrypt (`N=16384, r=8, p=5`), with two concurrent jobs, a bounded waiting queue, and per-user cooldowns after five incorrect attempts. PIN work runs outside the playback lane. Host controls, including PIN reset in Settings, remain unauthenticated on the trusted LAN. Reset does not modify room placement or playback.

Permanent user deletion first persists a revocation marker under the owner's write lock. It then removes any listening-order seat using the engine's existing stop/advance behavior, deletes owner-scoped uploads, list data and legacy bindings, and retains only opaque user/list/registration IDs to reject stale credentials and registration retries. Partial deletions stay hidden from participants and visible to the host for explicit, idempotent cleanup retries, including after restart. Other users' lists and uploads are retained.

Role-filtered HTTP and server-sent events exclude unrevealed title/artist/artwork from public views and another person’s list from all other roles. Public artwork requires the exact revealed playback, checked before and after the upstream read. Upload streams use scoped capabilities; original media URLs and MA tokens remain server-side.

The display's subtle technical line is independent of reveal: it exposes only fixed format labels and positive bitrate/sample-rate values reported in the verified current queue item's `streamdetails.audio_format`. It describes source audio, not the destination's potentially transcoded output. Missing fields are omitted; recording names, paths and free-form stream metadata are excluded.

The browser uses independently updated regions so routine events preserve focus, input state, scroll position, and animation nodes. Public reveal/playback remains server-confirmed even when private controls show a pending state.

Host and participant players share their card layout and responsive control slots. The host variant reads only participant identity and host playback status, never recording metadata, even after reveal. Its generic vinyl graphic spins during confirmed playback and pauses with playback or connection loss. Starting a selection and revealing remain participant-only actions; the corresponding host slots are disabled.

The engine can also reveal automatically at 70% of observed playback progress. Its persisted room setting defaults to enabled for existing and new rooms. Reveal checks revalidate playback identity, setting and connectivity inside the room write queue, and publish revealed metadata only after a successful save. Browser progress interpolation only paints the line and marker; it never triggers reveal. Unknown duration or missing progress cannot trigger automatic reveal.

`web/main.ts` owns a persistent header and listening-order shell. Same-origin app navigation and browser Back/Forward replace only the page runtime (`web/page-runtime.ts`); unchanged order cards and their animation nodes remain mounted. Departing pages close subscriptions, timers and listeners, and ignore late responses. Modified clicks, external links and new-tab navigation keep normal browser behavior.

Settings uses `web/settings-sections.ts` for four hash-linked sections (`#playback`, `#users`, `#music-assistant`, `#access`). Desktop navigation sits beside a wide content pane; smaller screens use a wrapping two-column selector. Section changes hide rather than remount controllers, preserving drafts, live subscriptions and control identity. Feedback and connection/speaker status stay in their respective sections. User rows expose inline PIN editing and a separately styled permanent-deletion action.

## Storage and lifecycle

The display name is Listening Room. Legacy installation IDs, repository/image addresses, `aoty_*` cookies, `aoty.*` browser-storage keys, and `AOTY_*` diagnostic environment variables remain unchanged for compatibility. Display wording is not a storage or API schema change.

- `/data/state.json`: schema-3 persistent room and membership/order; playback is cleared on restart.
- `/data/integrations.json`: MA token, verified identity/source binding, speaker, and guest/media addressing.
- `/data/preparations/`: schema-2 owner-scoped lists, exact recording descriptors, history, operation receipts, authorization hashes, and deletion intents. Schema-1 records migrate without their obsolete recovery hashes.
- `/data/preparations/bindings/`: private participant-credential-hash to owner-ID associations; no raw credentials or display names.
- `/data/users.json`: permanent user names, private list associations, salted PIN verifiers, session hashes/expiry, registration receipts and cooldowns. Include it in backups alongside room, preparations and uploads.
- `/data/uploads/`: published audio, metadata, and covers; originals are immutable.
- `/data/upload-staging/`: unpublished disposable work, not saved selections.

HA backup hooks pause durable changes while the archive is taken. Upload transfer/analysis does not hold the barrier; publication waits for thaw. Restore must include all private app data. Credentials and files in backups need protection.

SIGTERM stops admission/monitoring and drains operations/stores before disposal. The application’s final deadline is 25 seconds; the HA manifest allows 30 seconds before forced termination.

`/api/health` separates process liveness from storage/playback availability. `/api/host/diagnostics` contains bounded numeric aggregates under the existing host-access policy. Detailed timing flags are maintainer instrumentation, not an alternative installation interface. Logs must never include tokens, cookies, private metadata, or capability URLs.
