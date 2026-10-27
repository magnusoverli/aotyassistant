# Architecture and data contracts

## Runtime

The Home Assistant image runs Node.js 24, a TypeScript/Express backend, and Vite-built browser assets. Startup prepares private storage and drops to the unprivileged `node` user. Supervisor provides `/data`, options, discovery information, Ingress, watchdog monitoring, and backup coordination.

The app has two listeners: guest/display/host LAN traffic on port 3000, and a dedicated host-only Ingress listener on 8099. Untrusted LAN headers cannot impersonate Supervisor Ingress. It needs no privileged mode, host networking, Docker socket, Core database, or shared media mount.

```text
Home Assistant Ingress ─ host interface ─┐
Guest phones ─────────── LAN listener ──┼─ backend ─ Music Assistant ─ speaker/group
Shared display ──────── LAN listener ───┘     └─ private /data
```

Only one process may own a data directory. JSON stores serialize mutations and use private temporary files, atomic replacement, and filesystem synchronization before acknowledging saves. Unknown or corrupt records stop startup without replacing saved data. Storage-format changes require a documented migration or recovery path that preserves acknowledged data.

## Main boundaries

| Area | Modules |
| --- | --- |
| Room, membership, turns, filtered views | `src/engine.ts`, `src/model.ts`, `src/store.ts` |
| Connection identity and output readiness | `src/integrations.ts`, `src/music-assistant-policy.ts` |
| HA discovery, addressing, authorization | `src/setup.ts`, `src/supervisor.ts`, `src/ma-discovery.ts`, `src/ma-authorization.ts` |
| Playback ownership and MA transport/events | `src/live-playback.ts`, `src/music-assistant.ts`, `src/music-assistant-events.ts` |
| Private preparation and uploads | `src/preparations.ts`, `src/uploads.ts`, `src/upload-analysis.ts` |
| HTTP, Ingress, events | `src/http.ts`, `src/integration-http.ts`, `src/ingress.ts`, `src/event-streams.ts` |
| Durability, shutdown, diagnostics | `src/backup.ts`, `src/operation.ts`, `src/index.ts`, `src/diagnostics.ts` |
| Browser UI and controllers | `web/` |
| Shared host/participant playback UI | `web/playback.ts`, `web/player-controller.ts`, `web/media.ts` |

Room changes and audio commands have distinct serialization boundaries. Network reads run outside mutation lanes with bounded concurrency, deadlines, cancellation, and generation/revision checks. An ambiguous write is reconciled through readback rather than replayed automatically.

`web/playback.ts` owns the persistent host and participant playback UI, including transport, read-only progress, mute/volume, and role-specific turn actions. `web/main.ts` supplies action callbacks and page placement; `PlayerController` retains optimistic command handling for both roles. Host pause/resume and stop act only on the exact app-owned playback; the host receives no participant-only source/reveal controls or private track metadata.

## Playback contract

- Play is explicit, current-turn-authorized, exact-source, and single-track. No whole-list queueing or automatic source replacement.
- Queue/item identity establishes ownership. Events prompt authoritative checks; they do not independently establish completion or ownership.
- Natural completion requires the same safe owned item, previously playing, and MA’s explicit `ended` state. Presentation clocks never advance turns.
- External takeover invalidates app ownership without stopping foreign audio. Uncertainty requires explicit recovery.
- Turn, destination, connection, and playback revisions reject stale commands and optimistic browser intentions.
- Restart drops playback/reveal, retains room/list/settings data, and never resumes audio automatically.

### Playback verification and failures

`src/playback-read.ts` is the read-only reconciliation boundary. It permits at most three attempts for classified temporary connection, timeout or destination-availability failures, with 150/350 ms backoff inside the existing eight-second read budget. It does not shorten the first request's timeout or extend the caller's deadline; retries run only while time remains. Authorization, unsupported responses, blocked addresses, cancellation and closed clients are not retried. Background snapshots remain outside the command serializer and are discarded if the command generation, connection revision or owned playback changes.

Audio and queue-policy writes are never retried. A lost Play/Pause/Resume/Stop acknowledgement may be reconciled through authoritative reads; success requires the exact safe queue/item and requested transport state. Play additionally requires a new queue-item identity, not an older instance of the same recording. Failed read-only control preflight sends no command and does not itself discard confirmed ownership. Once command confirmation is genuinely uncertain or monitoring retries are exhausted, existing fail-closed ownership, upload leases and explicit host recovery safeguards remain in effect.

Explicit recovery performs a fresh connection/speaker inspection after releasing the command lock, rather than acknowledging readiness from a cached failed inspection. Observation and configuration revisions prevent older inspections from undoing the recovered status.

`src/playback-problem.ts` defines fixed, sanitized problem codes, messages and whether recovery is required. Room and integration views retain the legacy `playbackIssue` string and add `playbackProblem`; public display views expose neither. The UI shows the specific reason and offers recovery only when required. External playback changes and a confirmed protective queue-policy stop retain the turn without requesting unnecessary recovery. Unconfirmed stops retain ownership and never advance the turn. Settings shows the problem directly and its diagnostic code under **Details**; no upstream exception, token, source URL or private recording metadata is included.

## Speaker inventory and readiness

Music Assistant's `players/all` is the inventory authority; the app does not probe physical speakers or infer availability from saved routing preferences. Only the selected destination ID/name is persisted. Runtime inventory observations have a 45-second freshness window and explicit `loading`, `refreshing`, `verified`, `stale` or `failed` state. Events prompt coalesced reads, with a 15-second polling fallback. Ordinary background refreshes leave existing fresh playback readiness intact and do not send audio commands.

Integration views expose `speakerInventory` with last-known public player IDs/names/availability, `checkedAt`, `expiresAt` and serialization time `asOf`. Last-known entries survive a failed read for labelled presentation only; the legacy `report` and playback-readiness checks still reject failed/expired evidence. A successful inventory replaces the list, removing absent/offline choices. Credential/origin changes clear observations, and in-flight checks are fenced by the existing configuration and observation revisions. Inventory freshness is distinct from the selected queue's readiness.

Settings retains its select node, options, draft fields and focus during updates, marks normal refreshes **Updating…**, and labels stale/failed data as last known. `web/speaker-freshness.ts` expires readiness independently of event delivery using relative server leases and client elapsed time, with no clock-synchronization requirement. Both inventory and queue certificates must be fresh; queued or replayed snapshots cannot restart a lease. One expiry wake-up initiates a coalesced read, not a polling/reselection loop. Selection and Play retain fresh backend validation, with no automatic target switch or fallback.

## Privacy contract

Membership credentials and private-list credentials are separate HttpOnly cookies. Automatic initialization privately binds one list to the authenticated participant browser; additional tabs and restarts reuse the durable binding. Existing authorized list cookies are adopted without moving entries or uploads. Display names never identify lists. Recovery-key, list-switching and device-management APIs are absent. Host controls on the LAN listener are unauthenticated and require a trusted network.

Role-filtered HTTP and server-sent events exclude unrevealed title/artist/artwork from public views and another person’s list from all other roles. Public artwork requires the exact revealed playback, checked before and after the upstream read. Upload streams use scoped capabilities; original media URLs and MA tokens remain server-side.

The browser uses independently updated regions so routine events preserve focus, input state, scroll position, and animation nodes. Public reveal/playback remains server-confirmed even when private controls show a pending state.

`web/main.ts` owns a persistent header and listening-order shell. Same-origin app navigation and browser Back/Forward replace only the page runtime (`web/page-runtime.ts`); unchanged order cards and their animation nodes remain mounted. Departing pages close subscriptions, timers and listeners, and ignore late responses. Modified clicks, external links and new-tab navigation keep normal browser behavior.

## Storage and lifecycle

The display name is Listening Room. Legacy installation IDs, repository/image addresses, `aoty_*` cookies, `aoty.*` browser-storage keys, and `AOTY_*` diagnostic environment variables remain unchanged for compatibility. Display wording is not a storage or API schema change.

- `/data/state.json`: schema-3 persistent room and membership/order; playback is cleared on restart.
- `/data/integrations.json`: MA token, verified identity/source binding, speaker, and guest/media addressing.
- `/data/preparations/`: schema-2 owner-scoped lists, exact recording descriptors, history, operation receipts, authorization hashes, and deletion intents. Schema-1 records migrate without their obsolete recovery hashes.
- `/data/preparations/bindings/`: private participant-credential-hash to owner-ID associations; no raw credentials or display names.
- `/data/uploads/`: published audio, metadata, and covers; originals are immutable.
- `/data/upload-staging/`: unpublished disposable work, not saved selections.

HA backup hooks pause durable changes while the archive is taken. Upload transfer/analysis does not hold the barrier; publication waits for thaw. Restore must include all private app data. Credentials and files in backups need protection.

SIGTERM stops admission/monitoring and drains operations/stores before disposal. The application’s final deadline is 25 seconds; the HA manifest allows 30 seconds before forced termination.

`/api/health` separates process liveness from storage/playback availability. `/api/host/diagnostics` contains bounded numeric aggregates under the existing host-access policy. Detailed timing flags are maintainer instrumentation, not an alternative installation interface. Logs must never include tokens, cookies, private metadata, or capability URLs.
