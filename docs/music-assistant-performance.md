# Music Assistant latency investigation

Date: 18 October 2026. Application baseline: **0.3.6**, commit `7ab83d1`. Optimizations below are included in **0.3.7**.

## Implemented improvements

- **Six HTTP requests for Play on an already-correct queue**: reuse the freshly validated preflight snapshot, change only incorrect continuation settings, and read back policy only when changed. A queue needing all three settings changes takes ten requests. Every Play still checks schema 65, the exact recording and the resulting one-item queue.
- **Bounded keep-alive pools** for controls, catalogue reads and artwork. The checked DNS address set is part of each pool key; hostname/TLS validation and IPv4/IPv6 fallback remain intact. Connection/token changes and shutdown dispose of the old transport. Interactive inventory checks reuse the client and omit optional `/api-docs` fetches; the explicit diagnostic probe still checks documentation.
- **Background queue reads outside the control lane**, with ownership/configuration/command-generation fences on both success and failure. A delayed observation cannot undo Pause/Resume, invalidate a newer track, or stop audio using an old snapshot. An unsafe-policy observation is freshly rechecked before Stop.
- **Authenticated MA WebSocket events** wake confirmation and coalesced queue refreshes. Only event type/object ID is retained; HTTP reconciliation remains authoritative. Schema-65 handshake, pinned LAN DNS, trusted TLS, bounded frames, heartbeat, exponential reconnection (1–60 seconds), disposal and no mutation replay are implemented. Missing/unsupported events fall back to normal polling. Default reconciliation is every three seconds while the event connection is authenticated, or 1.5 seconds otherwise; queue/player changes usually wake it within 50 ms.
- **Elapsed-time budgets**: 45 seconds across an engine playback action (including lane waits), five seconds for post-command confirmation, eight seconds per ordinary request including DNS/body/socket wait, and 20 seconds for MA's Play/Resume command handlers. Remaining action time caps each request. These bound network work; atomic disk persistence still completes before returning. Uncertain audio writes are retained for recovery and never retried.
- **Two-worker grouped browsing**, preserving source order without pairwise barriers. Participant catalogue requests have a 12-second upstream budget; superseded browser requests abort and disconnected read-only handlers cancel upstream I/O. Audio mutations continue independently of browser disconnection.
- **Opt-in timing-only diagnostics** correlate action totals, engine/integration lane waits, resolve, preflight, policy, Play, confirmation, DNS/connect/TLS, individual commands and atomic persistence. Background work runs outside the initiating action's timing/deadline context.

### Measured before/after

Same synthetic fixture and +200 ms per HTTP request; these are individual samples, not installed-speaker measurements:

| Scenario | 0.3.6 | Implemented |
| --- | ---: | ---: |
| Play, queue already correct: requests | 11 | 6 |
| Play, queue already correct: dispatch | 1,619 ms | 608 ms |
| Play, queue already correct: total | 2,229 ms | 1,218 ms |
| Play, all three policy settings need changing: requests | 11 | 10 |
| Play, all three policy settings need changing: total | 2,229 ms | 2,022 ms |
| Settings inventory + saved queue | 810 ms / 4 requests | 607 ms / 3 requests |
| Pause behind a held 300 ms poll, no injected latency | 308 ms | 5 ms |

The baseline always wrote all settings, so both initial policy states had the same eleven-request path. The updated audit explicitly tests both. The WebSocket is warmed during fixture setup; its initial connection/authentication is outside these HTTP action counts. Connection reuse benefits are not represented by the fixed per-request delay; separate regressions verify socket reuse and control capacity under artwork load.

### Using timings

For a source/container run, set `AOTY_MA_TIMINGS=1` in the application process environment, for example:

```sh
AOTY_MA_TIMINGS=1 npm start
```

Each completed action emits one `ma-timing` JSON log record with a random correlation ID, action, outcome, total milliseconds and up to 256 stage measurements. Stage measurements overlap (for example preflight contains `/info` and a queue read); do not sum them as disjoint durations. No credentials, media URLs, track metadata, queue payloads or raw exceptions are logged. Logging is off by default. Compare repeated cold/warm Play and provider/upload cases on the same destination; these logs cannot measure when sound becomes audible.

### Remaining measurement-led work

The engine's room transaction still includes playback; unrelated joins can wait behind Play. Splitting it requires a separate reservation/commit design. Uploaded-file integrity hashing and durable pending-play/list records remain in the path; deployed timing should establish their contribution before changing them. MA commands continue over pooled HTTP, with WebSocket used for event hints rather than cached ownership or write replay. No deployed speaker was exercised or upgraded as part of these changes.

### Verification

Production build and typecheck pass, together with **211 unit/controller tests**, **93 Chromium workflows**, and all **33 synthetic latency scenarios**. Regressions cover six-request Play, conditional policy readback, schema revalidation, stale poll successes/failures/ended/unsafe states, elapsed/queued action deadlines, socket reuse/DNS changes/control capacity, read cancellation, worker-pool progress, event-driven completion/confirmation and authentication-only WebSocket reconnection. Audit JSON and test logs are kept outside Git in `/tmp/opencode/`.

## Baseline findings (0.3.6)

The rest of this document records the original investigation and recommendations before the implementation above.

There is avoidable application-side latency, particularly before Play reaches Music Assistant (MA). The main causes are sequential upstream requests, repeated queue setup, fresh connections for every request, and shared work queues that let background reads hold up controls.

The highest-value first change is to shorten the Play preflight. A normal, already-configured queue can plausibly go from **11 upstream requests to 6**, while retaining fresh schema/queue validation, exact-recording resolution and post-start verification. This is a proposed optimization, not an implemented or measured speedup.

The app cannot attribute the installation's audible delay yet: it does not record stage timings, and this investigation did not measure a deployed speaker. MA's provider lookup, stream preparation, player startup and buffering remain separate contributors. Measure those separately from app preflight and acknowledgement time.

## Evidence and reproduction

Added `scripts/ma-latency-audit.ts`. It exercises the real engine, integration manager, playback controller, HTTP client and file store against the repository's **synthetic MA fixture**. It never connects to an installed MA instance or speaker.

```sh
npx tsx scripts/ma-latency-audit.ts > /tmp/opencode/aoty-ma-latency-audit.json
```

The fixture uses a loopback IP, warms capability/volume setup, and confirms state immediately. The script adds 0, 50 or 200 ms **per upstream request**, including `/info`; this represents a controlled per-request cost, not a measured LAN round-trip time. Timings below are individual diagnostic samples, not percentiles. It excludes browser/ingress latency and real provider/audio startup. Normal ownership polling is deferred during the samples; one scenario explicitly exercises a blocked poll.

| Action | MA requests, immediate success | Total with +50 ms/request | Total with +200 ms/request |
| --- | ---: | ---: | ---: |
| Play a catalogue song | 11 | 581 ms | 2,229 ms |
| Pause | 3 | 158 ms | 610 ms |
| Resume an active paused queue | 4 | 211 ms | 813 ms |
| Resume a parked paused queue | 5 | 266 ms | 1,013 ms |
| Participant volume | 3 | 155 ms | 607 ms |
| Host volume | 2 | 105 ms | 405 ms |
| Finish turn while playing | 3 | 159 ms | 610 ms |
| Reveal | 0 | <1 ms | 1 ms |
| Settings discovery, saved destination | 4 | 208 ms | 810 ms |

Additional observations:

- Play dispatched `play_media` at **422 ms** with 50 ms/request and **1,619 ms** with 200 ms/request. Eight requests precede it.
- At zero injected delay, Play took **22 ms** on this machine. The sequential design amplifies upstream slowness; it does not impose a fixed multi-second delay on a fast responder.
- A poll held for 300 ms made Pause take **308 ms** despite otherwise fast responses. The measured interval also contains the poll's optional volume refresh.
- Holding a Play queue read for 300 ms made an unrelated room join wait **311 ms**. Play holds the engine transaction as well as the integration lane.
- An accepted Pause that never changed the fixture state took **4,794 ms** to fail and made **22 MA requests**: preflight, command and 20 confirmation reads.
- Engine persistence was approximately **0.4–3.3 ms** in these local samples. This does not establish SD-card/HAOS storage performance.

`npm run typecheck` passes with the audit script. Generated JSON remains outside Git.

## 1. Play has eight upstream requests before the start command

Trace from `Engine.playSelection` → `ManagedPlayback.resolve/play` → `MusicAssistantClient`:

| Step | Request | Purpose |
| --- | --- | --- |
| 1 | `music/item_by_uri` | Resolve the exact selected recording, metadata updates disabled |
| 2 | `GET /info` | Validate schema 65 |
| 3 | `player_queues/get_active_queue` | Queue validation inside `playbackCapability` |
| 4 | `player_queues/get_active_queue` | Immediately fetch the initial queue again |
| 5 | `player_queues/autoplay` | Disable autoplay, even when already disabled |
| 6 | `player_queues/repeat` | Disable repeat, even when already off |
| 7 | `player_queues/shuffle` | Disable shuffle, even when already disabled |
| 8 | `player_queues/get_active_queue` | Read back policy settings |
| 9 | `player_queues/play_media` | Start the selected URI |
| 10 | `player_queues/get_active_queue` | Confirm exact current item, policy and playing state |
| 11 | `player_queues/items` | Verify the actual one-item queue |

Steps 10–11 may repeat while startup is incomplete. The 250 ms confirmation delay is conditional; it is **not** paid when the first read already confirms success.

Sources: `src/engine.ts:246–264`, `src/live-playback.ts:215–263`, `src/music-assistant.ts:302–360`.

### Recommended first optimization

1. Return the validated queue from capability/preflight and reuse it as the initial snapshot. Avoid the adjacent duplicate read.
2. Apply only the autoplay/repeat/shuffle changes needed by that fresh snapshot.
3. Read back policy after an actual change. When no change was necessary, the fresh preflight already established the policy; still verify policy after Play.
4. Retain exact recording resolution and final current-item/queue-items verification.

Already-correct queue: **6 requests**, with **3** before `play_media`, rather than 11 requests with 8 before it. At an illustrative 200 ms/request, that removes about **1 second before dispatch**; at 50 ms/request, about **250 ms**. Actual benefit depends on the measured cost of those specific calls. A queue requiring all three policy changes saves only the duplicate read initially.

The existing `verifyCapability()` caches by configuration revision, but `play()` intentionally calls `api.playbackCapability()` directly each time. Do not simply switch Play to the cached helper: a server can restart or change version without changing the app's configuration. Any later schema caching needs connection/restart invalidation or a defined freshness policy.

## 2. The transport deliberately disables connection reuse

`src/music-assistant-transport.ts:33–94` performs a hostname lookup per request, validates the addresses, then uses `agent: false`. Therefore each API/metadata/artwork request opens a new connection. HTTPS also repeats connection/TLS setup; IP-based HTTP avoids DNS but still reconnects.

MA's HTTP handler also authenticates individual API requests. That cost is upstream and currently unmeasured.

Recommended incremental change: a bounded keep-alive transport, retaining validated address pinning, TLS hostname validation, response limits and configuration lifecycle cleanup. Key connections to the validated endpoint so connection reuse cannot silently route a request to an unchecked address. Keep control capacity separate from artwork/catalogue work. Measure connection/DNS time first; on a fast local IP this may be a smaller gain than reducing request count.

A persistent authenticated **MA WebSocket** is the stronger long-term design: it provides correlated command results, server information and push events over one connection. It can replace repeated status reads and wake confirmation immediately. It does not remove provider or speaker startup, and command completion still invokes the same MA handlers.

## 3. Polling and controls share a blocking work queue

`IntegrationManager.withPlayback()` uses one FIFO `SerialQueue`. `ManagedPlayback.poll()` holds this lane while awaiting `get_active_queue` and, for parked pause, possibly `players/get`. Play, Pause, Resume, Stop, volume writes and integration commits use the same lane.

The usual queue poll starts 1.5 seconds after the preceding poll finishes. This is one server-side poller, **not one MA poller per participant**. Optional volume reads already execute outside the lane, so moving those again would not fix the remaining queue-read blocking.

Sources: `src/integrations.ts:277–295`, `src/live-playback.ts:176–180,265–334`.

Recommended change: perform background observation outside the command lane, then publish only if the configuration/ownership/command generation still matches. Discard stale failures as well as stale successes. A user command should obtain fresh relevant ownership information and take precedence over queued background work. Merely prioritizing a FIFO queue does not interrupt a slow read already in flight.

The engine has another FIFO transaction covering resolution, MA writes, confirmation and persistence. It also serializes joins, reorder/removal, reveal and volume. This explains why a slow Play can make unrelated room actions feel slow. A later two-phase resolve/reserve/commit design can shorten that lock, but must preserve current-turn, previous-playback, preparation-owner and source-revision checks. Fix the simpler upstream chain first.

## 4. Timeouts do not form a coherent action budget

- Transport: 8 seconds for DNS resolution, followed by a separate 8-second request deadline; DNS is not included in the request timer.
- Play confirmation: 20 reads with 250 ms delays. Transport confirmation: 20 reads with up to 19 delays. These are attempt counts, not wall-clock deadlines.
- A series of successful but slow, still-unconfirmed queue reads could consume approximately **165 seconds** in one confirmation loop alone. Parked-pause checks can add player reads. A single failed network request exits sooner.
- Browser playback mutations allow 120 seconds. A browser timeout does not cancel the backend command workflow. Read-only catalogue requests use the 15-second default.
- `play()` also performs cleanup reads and a possible Stop after failed verification.

Sources: `src/music-assistant-transport.ts:31–45,89–93`, `src/live-playback.ts:190–206,241–261`, `web/main.ts:183–186`, `web/request.ts:6–9`.

Use an overall operation deadline, stage timings and distinct read/command budgets. Bound remaining confirmation work by elapsed time rather than only attempts. Keep uncertain writes distinct from rejected writes; do not replay Play or transport mutations after a lost acknowledgement. Cancelling stale browse/observation reads is a different operation from cancelling an already-dispatched audio mutation.

### MA itself can wait for the player

Reviewed the upstream **2.10.6** source, the version recorded in this repository's previous deployment notes. Its HTTP endpoint awaits the command handler. `play_index()` loads/prepares media and then waits for the player's PLAYING state with `PLAYBACK_START_TIMEOUT = 5.0`. Thus a slow `play_media` response can include real player startup, rather than just HTTP overhead. The app's uniform 8-second request deadline leaves limited room for provider resolution plus that player wait.

The version currently installed must be checked before treating these upstream details as live-installation measurements. A longer timeout can prevent false failures, but is not itself a performance optimization.

## 5. Uploaded and saved tracks have additional work

- Saved-list Play writes a durable pending-play marker, runs the engine/MA workflow, then writes the played-list state. The engine also persists room playback. These are three atomic records on the happy path, each involving file and directory synchronization.
- Uploaded-file Play additionally re-hashes the **entire saved audio file** before issuing a lease. MA then resolves `builtin://track/<leased URL>` and must fetch the app's file before playback proceeds.
- Each upload lease has a new URL. Repeated upstream probing/cache misses are plausible and need measurement; the synthetic fixture's whole-file fetch does not establish how much a real MA deployment reads.

Sources: `src/preparations.ts:269–288`, `src/uploads.ts:154–160,179–189`, `src/integrations.ts:246–259`, `src/store.ts:30–47`.

Measure upload hashing, callback first-byte/bytes/ranges, MA resolution, and storage synchronization separately. Consider verified immutable-file reuse or prevalidation only after measuring its contribution, retaining content identity and deletion/lease coordination. Do not remove the pending-play durability marker to make the UI return earlier.

## 6. Other integration paths

- **Settings discovery:** `/info` → `players/all` → `/api-docs` → active queue for a saved destination. The optional documentation fetch is awaited despite not being necessary to discover speakers; a slow documentation endpoint can add up to its full deadline. Move it out of the interactive critical path. Discovery itself already runs outside the playback lane.
- **Search:** a single `music/search` requests all connected sources. A slow provider can dominate MA's result time; app connection reuse alone cannot fix that.
- **Grouped browsing:** up to eight sources, processed in fixed pairs with `Promise.allSettled`. Each pair waits for its slower member before the next pair starts. Four waves can exceed the browser's 15-second deadline; replace batch barriers with a two-worker pool and an overall request budget. Consider progressive source results rather than holding everything for the slowest source.
- **Cancelled browsing:** `CatalogueController.cancel()` only suppresses stale replies; it does not cancel HTTP or MA reads. Old work can continue alongside new user requests.
- **Artwork:** already cached and coalesced, with up to 16 upstream image reads. It does not hold the playback lock, but shares MA/network/CPU capacity. Separate or lower its priority before introducing a shared connection pool.
- **Volume:** browser writes already have a latest-only lane and 100 ms debounce, with immediate committed changes. Backend host volume still performs a fresh player read before the write; participant volume additionally checks queue ownership. Confirmation is already deferred. Retain destination/group correctness when reducing capability reads.
- **Browser status:** player controls already project local intent immediately. Backend SSE sends on changes; the 15-second heartbeat is not the normal command response delay. More optimistic UI will not make audio start faster.

Sources: `src/music-assistant.ts:81–96,186–203,216–244,365–390`, `src/integrations.ts:372–425`, `web/catalogue-controller.ts:13–19`, `web/player-controller.ts:95–156`, `src/http.ts:206–220`.

## Original recommended implementation order

1. **Measure real stages:** add command correlation and timing-only metrics for engine/integration queue wait, DNS/connect/TLS, exact resolution, preflight, policy changes, MA command, verification, persistence and total HTTP time. Record command names and durations, not credentials, leased URLs or private media payloads. Capture p50/p95 for cold/warm Play, replacement, provider type, uploads, Pause, parked Resume and Finish.
2. **Reduce the request chain:** reuse the validated preflight queue; make policy updates conditional; remove optional documentation fetches from interactive setup. Verify the expected 11→6 common-case request reduction with the fixture.
3. **Reuse transport connections:** bounded keep-alive, with control capacity and endpoint lifecycle management. Compare the same installed speaker/provider before and after.
4. **Remove observation-induced blocking:** generation-fenced background queue reads, user-command precedence, bounded overall deadlines, and cancellation of stale read-only work.
5. **Add persistent MA events:** authenticated WebSocket for immediate queue/player events and connection-scoped server information; retain reconciliation reads for reconnects, missing events and uncertain command outcomes. Reconnect must never replay audio writes.
6. **Optimize measured provider/upload/storage costs:** only after command-stage timing identifies their contribution. Compare against MA's own UI on the same destination to isolate upstream startup costs.

The initial investigation added the diagnostic script; the implementation status and measurements are recorded at the top of this document.

## Upstream references

- [MA API overview and deployed `/api-docs`](https://www.music-assistant.io/api/)
- [2.10.6 HTTP/WebSocket endpoints and awaited HTTP command handler](https://github.com/music-assistant/server/blob/2.10.6/music_assistant/controllers/webserver/controller.py)
- [2.10.6 authenticated WebSocket commands and event subscription](https://github.com/music-assistant/server/blob/2.10.6/music_assistant/controllers/webserver/websocket_client.py)
- [2.10.6 queue controls and player-start observation](https://github.com/music-assistant/server/blob/2.10.6/music_assistant/controllers/player_queues/controller.py)
- [2.10.6 playback-start timeout](https://github.com/music-assistant/server/blob/2.10.6/music_assistant/controllers/player_queues/constants.py)
