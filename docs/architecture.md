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

Room changes and audio commands have distinct serialization boundaries. Network reads run outside mutation lanes with bounded concurrency, deadlines, cancellation, and generation/revision checks. An ambiguous write is reconciled through readback rather than replayed automatically.

## Playback contract

- Play is explicit, current-turn-authorized, exact-source, and single-track. No whole-list queueing or automatic source replacement.
- Queue/item identity establishes ownership. Events prompt authoritative checks; they do not independently establish completion or ownership.
- Natural completion requires the same safe owned item, previously playing, and MA’s explicit `ended` state. Presentation clocks never advance turns.
- External takeover invalidates app ownership without stopping foreign audio. Uncertainty requires explicit recovery.
- Turn, destination, connection, and playback revisions reject stale commands and optimistic browser intentions.
- Restart drops playback/reveal, retains room/list/settings data, and never resumes audio automatically.

## Privacy contract

Membership credentials and private-list credentials are separate HttpOnly cookies. Recovery keys authorize list recovery, not room membership. Host controls on the LAN listener are unauthenticated and require a trusted network.

Role-filtered HTTP and server-sent events exclude unrevealed title/artist/artwork from public views and another person’s list from all other roles. Public artwork requires the exact revealed playback, checked before and after the upstream read. Upload streams use scoped capabilities; original media URLs and MA tokens remain server-side.

The browser uses independently updated regions so routine events preserve focus, input state, scroll position, and animation nodes. Public reveal/playback remains server-confirmed even when private controls show a pending state.

## Storage and lifecycle

The display name is Listening Room. Legacy installation IDs, repository/image addresses, `aoty_*` cookies, `aoty.*` browser-storage keys, and `AOTY_*` diagnostic environment variables remain unchanged for compatibility. Display wording is not a storage or API schema change.

- `/data/state.json`: schema-3 persistent room and membership/order; playback is cleared on restart.
- `/data/integrations.json`: MA token, verified identity/source binding, speaker, and guest/media addressing.
- `/data/preparations/`: owner-scoped lists, exact recording descriptors, history, operation receipts, credential/recovery hashes, and deletion intents.
- `/data/uploads/`: published audio, metadata, and covers; originals are immutable.
- `/data/upload-staging/`: unpublished disposable work, not saved selections.

HA backup hooks pause durable changes while the archive is taken. Upload transfer/analysis does not hold the barrier; publication waits for thaw. Restore must include all private app data. Credentials and files in backups need protection.

SIGTERM stops admission/monitoring and drains operations/stores before disposal. The application’s final deadline is 25 seconds; the HA manifest allows 30 seconds before forced termination.

`/api/health` separates process liveness from storage/playback availability. `/api/host/diagnostics` contains bounded numeric aggregates under the existing host-access policy. Detailed timing flags are maintainer instrumentation, not an alternative installation interface. Logs must never include tokens, cookies, recovery keys, private metadata, or capability URLs.
