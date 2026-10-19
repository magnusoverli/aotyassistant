# Backend reliability and latency — 0.3.14

Released in 0.3.14 from the 19 October 2026 backend review, against baseline 0.3.13.

## Behaviour and contracts

- **Failure isolation:** `/api/health` reports process liveness, with separate `storageAvailable` and `playbackAvailable` fields. Playback recovery does not fail Home Assistant's watchdog or block joining, ordering, and catalogue reads. Audio actions and reveal still require usable playback; storage failures still block room mutations.
- **Confirmed automatic stops:** a detected single-track-policy violation stops only the owned item and reads back idle before reporting success. An ignored/unconfirmed Stop retains ownership and recovery, without advancing the turn or retrying the write.
- **Ambiguous persistence:** the file writer distinguishes failures before replacement from failures synchronizing the replacement. An unknown/uncertain integration save disables routing. Discovery reconciles the stored configuration through a successful durable rewrite and fresh inventory/queue validation. An uncertain first connection save cannot fall back to demo audio.
- **Bounded waiting:** FIFO lanes admit at most 256 waiting operations. Deadlines and cancellation remove waiting operations immediately; their callbacks never execute later. A dispatched operation retains its completion/confirmation path. Recovery bookkeeping runs outside the failed command's elapsed budget. Keyed owner/asset lanes are released when idle and support draining.
- **Short capture transactions:** private Add checks intent/receipts under the owner lock, captures provider/file metadata outside it, then reauthorizes and checks the current revision before saving. Concurrent identical retries share the capture; successful receipts remain usable after a browse reference expires. At most 64 distinct captures run concurrently. Draft deletion waits for an outstanding capture to finish so it cannot race durable attachment.
- **Playback-critical capacity:** exact-recording resolution for explicit Play has a separate two-socket pool. Ordinary searches cannot occupy it. Catalogue, control, and artwork lanes retain their existing limits, validated DNS pinning, TLS checks, deadlines, and no-write-retry policy.
- **Bounded grouping:** normalized metadata buckets reuse evidence profiles and avoid repeated complete-link scans. Each identity/presentation pass has a 20,000-comparison ceiling; excessive ambiguity leaves separate source choices. Conflicting identities are never merged to save work.
- **Deletion housekeeping:** durable anti-replay tombstones remain separate from pending file deletions. Cleanup processes at most 16 assets per invocation, outside the owner lane, persists completed work, and synchronizes directory deletion before acknowledging it. List reads return before scheduling cleanup. Older records migrate their pending work lazily; successful deletions are not retried forever.
- **Targeted events:** Settings subscribes to integration/output/ownership changes rather than every progress sample. Listening-order projection uses names/order directly and skips playback/output-only notifications. Public host/display projections are reused within a change event; participant authorization stays per recipient. Pre-serialized filtered JSON is reused by SSE delivery.
- **Backup-safe uploads:** long transfers and child-process analysis run in `DATA_DIR/upload-staging/`. These unpublished bytes cannot be inspected as assets, attached to a list, or leased for playback. Final publication is an atomic directory rename synchronized under the backup barrier. A backup can freeze during analysis; publication waits for thaw. Abandoned staging is disposable after restart/restore. Published drafts still expire after seven days; retained originals never expire.
- **Drained shutdown:** SIGTERM/SIGINT stop HTTP admission and background scheduling, cancel incoming upload work, and drain admitted operations, room/list/integration transactions, and asset work before disposing transports. Shutdown has a 25-second final bound. Late background snapshots are fenced; a closed integration cannot recreate a client.

## Responsibility boundaries

| Module | Responsibility |
| --- | --- |
| `src/operation.ts` | Provider-neutral operation context, budgets, priorities, timings, and draining; `ma-operation.ts` retains compatibility aliases. |
| `src/serial.ts` | Bounded deadline-aware FIFO/keyed scheduling. |
| `src/integration-store.ts` | Integration schema and durable file storage. |
| `src/catalogue-references.ts` | Owner-scoped encrypted catalogue capabilities and catalogue epochs. |
| `src/output-monitor.ts` | Shared event subscription, coalescing, fallback scheduling, and disposal. |
| `src/lan-network.ts` | Shared HTTP/WebSocket LAN address validation and deadline/cancellation-aware DNS resolution. |
| `src/music-assistant-policy.ts` | Verified playback schema and read-only compatibility policy. |
| `src/upload-analysis.ts` | Isolated, bounded media-analysis process and result validation. |
| `src/diagnostics.ts` | Fixed-cardinality numeric operational aggregates. |
| `src/index.ts` | Production dependency construction and shutdown ordering, including one injected preparation repository for lists/uploads. |

Inventory and catalogue interfaces are separate; the playback controller depends on the integration capabilities it uses. The integration facade retains coordination and revision/ownership checks. The application remains a single process with atomic JSON persistence.

## Diagnostics

`GET /api/host/diagnostics` uses the existing host-access policy. It returns numeric `count`, `total`, and `max` aggregates for operation duration, queue wait/depth, upstream duration, persistence duration, recovery transitions, cleanup backlog, and event-loop delay, plus fixed failure-code counts. Durations are milliseconds. Counters are process-local and reset on restart; they are not percentile estimates.

- `AOTY_DIAGNOSTICS=1` emits the aggregate snapshot once per minute.
- `AOTY_TIMINGS=1` emits correlated action/stage timings and failed-operation HTTP status codes. `AOTY_MA_TIMINGS=1` remains supported.
- Payloads, credential values, URLs, track metadata, owner IDs, and raw exception messages are excluded.

## Measurements

Synthetic local measurements, not physical-speaker or production percentile results:

| Scenario | Review baseline | Implemented |
| --- | ---: | ---: |
| 500 identical-metadata album rows, median grouping | 216 ms | 3 ms isolated / 5 ms during concurrent checks |
| 2,000 identical-metadata album rows, median grouping | 3,490 ms | 7 ms isolated / 20 ms during concurrent checks |
| Same-owner list read behind a held 250 ms capture | 251 ms | 0.7 ms |
| 40 ms queue deadline behind 250 ms work | 251 ms | 40.7 ms |
| Playback resolution with four searches held for 250 ms | 256 ms | 2.8 ms |

The existing 33-scenario Music Assistant audit preserves six-request configured Play (~1,208 ms with 200 ms added per request), three-request Pause (~605 ms), and four-request Resume (~806 ms). Verification and persistence guarantees are retained.

Reproduce with:

```sh
npm run typecheck
npm test
npm run test:browser
npx tsx scripts/backend-latency-audit.ts
npx tsx scripts/ma-latency-audit.ts
```

`tests/backend-hardening.test.ts` covers recovery/liveness, first-save and routing commit ambiguity, ignored automatic Stop, bounded queue admission/deadlines/cancellation, capture retries/revocation/conflicts, deletion checkpoints, DNS cancellation, pool isolation, grouping conflicts, backup staging, and admitted-Play shutdown draining. Existing private-data, exact-source, ownership, reveal, and browser workflows remain part of acceptance.

Verification: production build/typecheck, **245 backend/controller tests**, all **113 Chromium workflows**, and subsequent **23 list/upload/settings** plus **15 output/settings** checks passed. Both synthetic audits completed. A separate real application child-process smoke check sent SIGTERM during a held synthetic Play: the request was acknowledged, playback state was durably committed, and the process exited with code 0 and no stderr output. No physical speaker was used.
