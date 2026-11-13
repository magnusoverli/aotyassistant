# Frontend/backend performance and latency findings

Date: 2026-11-13  
Application version investigated: 2.1.8  
Investigation environment: Windows, Node.js 26.13.0

## Conclusion and scope

Several integration paths still undermine low latency. Reproducible catalogue cancellation and event-payload issues, together with startup recovery, lifecycle, and large-list concerns, prevent concluding that all user-facing paths are optimized or reliably low-latency.

This file records the investigation's issues, optimization opportunities, measurements, and verification gaps. Existing mechanisms assessed as working well are omitted.

Scope: browser startup and navigation, HTTP request lifetimes, real-time events, catalogue browsing, playback commands, artwork, uploads, imports, settings, persistence, asset delivery, and browser audio.

Measurements use local synthetic fixtures. They are not measurements of a deployed Home Assistant system, real network, physical speaker, or mobile browser. Source line references describe the code at investigation time.

## 2.1.10 bandwidth follow-up

Implemented all five online-audio follow-up items: shared playback/telemetry limits (500–4,000 ms across LAN/online policies), per-receiver transfer measurements, promptly flushed SSE gzip, current Sendspin format renegotiation, and Opus negotiation/fallback diagnostics and contract tests.

The main bandwidth change mitigates F02/F03 without changing event JSON, visualizer analysis/frame rate, or list projections. `EventStreams` negotiates gzip, uses compression level 1 and `Z_SYNC_FLUSH` after every event/heartbeat, and retains bounded backpressure, coalescing and revocation cleanup. Clients that do not accept gzip receive the existing plain stream.

Reproduce with `node --import tsx scripts/stream-bench.ts`. The fixture uses 300 overlapping spectrum packets (60 seconds at five packets/second), pseudo-random band values, and a real preparation projection with 200 upcoming/800 history entries. It checks decoded events byte-for-byte. Events are sent as fast as acknowledgements allow; these are loopback results, not a live Funnel measurement.

| Measurement | Plain | Gzip |
| --- | ---: | ---: |
| Spectrum payload per viewer over 60 seconds | 2,925,351 bytes | 294,652 bytes |
| Equivalent spectrum bandwidth per viewer | 390.0 kbit/s | 39.3 kbit/s |
| 1,000-entry list snapshot | 341,060 bytes | 31,762 bytes |
| Spectrum delivery p95, one viewer | 0.142 ms | 0.365 ms |
| Spectrum delivery p95, 20 viewers | 0.945 ms | 2.202 ms |
| CPU for 20 viewers' 60-second spectrum fixture | 203 ms | 657 ms |

CPU measurements include both the server and loopback clients' decompression/verification. The extra 454 ms per minute for 20 viewers is about 0.76% of one CPU core on this Windows machine, not a Raspberry Pi estimate. List delivery on unrestricted loopback was 1.41 → 3.33 ms; at a hypothetical 1 Mbit/s bottleneck, payload serialization alone drops from approximately 2.73 s to 0.25 s. TLS, TCP, proxy and real-network costs are excluded.

### Receiver diagnostics

The existing authenticated `/api/host/diagnostics` response now includes `browserSpeakers`; each receiver's owner-scoped status also includes the same sanitized measurements. These fields do not contain pairing material or upstream credentials.

| Field | Interpretation |
| --- | --- |
| `network` | Server-observed LAN or online connection |
| `audio.codec`, `audioReportedAt` | Actual last reported stream format and report freshness, rather than assumed preference |
| `audio.advertisedCodecs`, `audio.opusSupport` | Actual SDK hello order, browser exclusions, probe failures, native/software support or decoder failure |
| `codecSelection` | Opus, receiver fallback, matching MA format override, unexplained server selection, or unknown |
| `preferredFormat`, `configurationCheckedAt` | Validated MA setting from the existing player configuration read; mismatches refresh at most once/minute |
| `transfer.bytesToBrowser` | Cumulative successful WebSocket payload writes across reconnects |
| `transfer.rate` | Current connection's first-30-second startup bytes/rate and approximately 30-second rolling rate in decimal kbit/s; `steadyKbps` stays null until a full post-startup window exists at 60 seconds |

Rates include Sendspin control/encryption payloads, but not WebSocket/TCP/TLS overhead. They describe transport throughput, not the Opus encoder bitrate. Startup is measured from the first transferred frame on a connection; a later track-start burst can still raise the rolling rate. Idle windows decay to zero; closed connections have no current/steady rate. Existing 30-second client telemetry throttling is retained.

`AutomaticAudioPlayer` now uses `client/state.player.format`, selecting a format actually present in its hello. The preference accompanies the SDK's complete player state and persists through later volume/buffer updates, with SDK activation/clock gates intact. Ignored recovery requests retain the bounded reconnect with reduced codec capabilities. SDK 6.0.0 speaks rc1/player@v1; a legacy-wire server cannot complete that handshake, so no speculative legacy message or MA-version guess is used.

Real-SDK tests check Opus-first hello and returned stream format under simulated Chrome/iOS capabilities, plus Firefox exclusions, software fallback, SDK filtering and failed probes. A failed FLAC probe no longer discards verified Opus. MA's `preferred_sendspin_format` setting is observed, not overwritten; a fallback without matching override evidence is labelled server-selected rather than inventing its cause. Protocol references: [Sendspin specification](https://www.sendspin-audio.com/build/spec/) and [MA Sendspin player implementation](https://github.com/music-assistant/server/blob/dev/music_assistant/providers/sendspin/player.py).

Local validation: focused codec/relay/runtime/SSE tests passed; typecheck, release validation, production build and built-asset validation passed. Five broader visualizer tests failed during Windows persistence setup; the full Windows suite again stalled and was terminated after 180 seconds. Local packaged tests were unavailable because Docker's Linux daemon was stopped. Release CI supplies the required Linux full-suite and native amd64/aarch64 packaged checks. Actual Funnel/browser throughput, proxy flushing and physical audible latency still require deployed testing; no Playwright run was requested.

## Priority summary

P1 means address first because the issue directly affects request responsiveness, event delivery, or recovery. P2 means a meaningful latency or verification gap. P3 means a lower-priority optimization candidate. These are performance priorities, not security severity ratings.

| ID | Priority | Finding |
| --- | --- | --- |
| F01 | P1 | Shared catalogue reads bypass caller cancellation and deadlines |
| F02 | P1 | Spectrum updates repeatedly transmit overlapping frames |
| F03 | P1 | Small private-list changes transmit the entire list and history |
| F04 | P1 | Initial host/display failures can leave the live subscription unopened |
| F05 | P2 | Startup sequencing adds round trips and couples room readiness to library initialization |
| F06 | P2 | Optional artwork enrichment delays usable browse results |
| F07 | P2 | Ordinary list-save browser and server time budgets are misaligned |
| F08 | P2 | Album additions perform per-track reads before final capacity checks |
| F09 | P2 | Read cancellation is inconsistent across pages, dialogs, and artwork routes |
| F10 | P2 | Import polling and dialogs can outlive their page |
| F11 | P2 | Prominent artwork competes with thumbnails without foreground priority |
| F12 | P2 | Visualizer analysis runs on the HTTP event loop; its HTTP reads recreate transports |
| F13 | P2 | Uploaded-file actions incur whole-file integrity reads; upload stall handling is incomplete |
| F14 | P2 | Large catalogue results still create and reconcile every row |
| F15 | P2 | Production latency observability and end-to-end verification are incomplete |
| F16 | P3 | Shared page code and deferred audio assets leave further payload-reduction opportunities |
| F17 | Measurement | Playback confirmation latency multiplies upstream request latency |
| F18 | Tradeoff | Browser-audio buffering deliberately adds latency for continuity |

## Highest-priority findings

### F01. Shared catalogue reads bypass caller cancellation and deadlines

**Evidence:** [src/music-assistant.ts](../src/music-assistant.ts), lines 111-129, detaches shared listing reads through `background()`. The caller then awaits the shared promise without an independent deadline/cancellation boundary. See also [src/operation.ts](../src/operation.ts), lines 27-51 and 64: operation budgets are cooperatively enforced rather than a universal timeout around arbitrary awaited work.

**Impact:** Abandoned searches continue occupying browse connections. A new search can wait behind work the user no longer wants. Multi-source browsing can outlive the documented foreground request budget.

**Reproduction:** A request with a 50 ms operation budget, cancelled after 20 ms, still fulfilled after 242 ms. After four abandoned listing reads, a new browse took 425 ms against a fixture that needed 220 ms per request. All four abandoned reads also fulfilled.

**Recommendation:** Give shared upstream work its own bounded lifetime, enforce each caller's waiting budget, and bound admission. Track interested callers so obsolete work can be cancelled when no caller needs it, without cancelling work still needed by another viewer.

**Coverage gap:** The cancellation test in [tests/ma-performance.test.ts](../tests/ma-performance.test.ts), lines 77-89, exercises the transport directly. It does not establish cancellation through the shared-listing client layer.

### F02. Spectrum updates repeatedly transmit overlapping frames

**Evidence:** [src/spectrum.ts](../src/spectrum.ts), lines 30-33, selects a rolling window from 150 ms behind to 1,200 ms ahead. [src/spectrum-broadcast.ts](../src/spectrum-broadcast.ts), line 11, sends a packet every 200 ms while active.

**Impact:** Most frames in successive packets overlap. Continuous spectrum traffic competes with user-facing traffic on constrained connections and increases JSON parsing work in every subscribed browser.

**Measurement:** A representative packet contained 82 frames and occupied 9,741 bytes including its SSE framing. At five packets per second, this is 48,705 bytes/second per viewer, or about 7.8 Mbit/s for 20 viewers before transport overhead or any proxy compression.

**Recommendation:** Send incremental frames after an initial synchronization snapshot, with explicit resynchronization on reconnect or epoch changes. Adapt delivery to visibility and connectivity while preserving the timing information needed by the visualizer.

### F03. Small private-list changes transmit the entire list and history

**Evidence:** [src/preparations.ts](../src/preparations.ts), lines 215-229, constructs a complete private-list view. [src/preparation-http.ts](../src/preparation-http.ts), lines 222-226, serializes that complete view into the event stream. HTTP JSON compression is implemented separately in [src/http-utils.ts](../src/http-utils.ts), lines 40-53; it does not compress application SSE frames.

**Impact:** A reorder or removal can transfer hundreds of kilobytes. The browser must parse and compare the complete snapshot, including history that may not be visible. Mutation responses and live events can also deliver overlapping state.

**Measurement:** A representative list with 200 upcoming and 800 historical entries produced a 341,060-byte SSE frame. The corresponding JSON compressed to 30,671 bytes with gzip.

**Combined effect with F02:** Private-list updates, room state, and spectrum share the participant's ordered event connection. Later room-state events cannot overtake list or spectrum bytes already queued for transmission.

**Recommendation:** Introduce revisioned incremental changes, paginated history, and smaller mutation acknowledgements. Retain authorized full snapshots for initial synchronization and recovery. Any SSE compression approach must preserve prompt flushing rather than introduce buffering latency.

### F04. Initial host/display failures can leave the live subscription unopened

**Evidence:** [web/page-runtime.ts](../web/page-runtime.ts), lines 845-853, opens the host/display event subscription only after a successful initial state GET. Visibility recovery at lines 884-887 fetches state without reopening that subscription.

**Impact:** A transient initial request failure can leave controls disconnected even after subsequent ordinary state reads recover. This is a source-level recovery finding; it was not reproduced in a real browser during this investigation.

**Recommendation:** Make bootstrap and subscription recovery explicit and retryable. A successful recovery must restore both the snapshot and the live subscription, with lifecycle guards against duplicate connections.

## Additional findings

### F05. Startup sequencing adds round trips and couples readiness

**Evidence:** [web/page-runtime.ts](../web/page-runtime.ts), lines 845-863, fetches host/display state before opening streams that send state again. Participant startup holds its event connection while private-list initialization finishes. Player command availability depends on the `realtime` state at lines 157-160.

**Impact:** Bootstrap incurs avoidable sequential round trips. Slow private-list initialization delays room-control readiness even when room state is already available.

**Recommendation:** Use the first authorized stream snapshot as bootstrap where practical, or establish the stream concurrently. Avoid making room-control readiness depend on private-library readiness.

### F06. Optional artwork enrichment delays usable browse results

**Evidence:** [src/music-assistant.ts](../src/music-assistant.ts), lines 216-252, awaits artwork metadata enrichment before returning grouped artist/album results, with a budget of up to 1.5 seconds.

**Impact:** Optional images delay usable text results. This can also affect a cached listing when its enrichment data needs refreshing.

**Recommendation:** Return usable results immediately and enrich asynchronously, or allocate a substantially smaller foreground budget to optional artwork enrichment.

### F07. Ordinary list-save time budgets are misaligned

**Evidence:** [web/preparation-controller.ts](../web/preparation-controller.ts), lines 19-27 and 223-245, uses a 15-second timeout for ordinary Add/Replace requests and retries transient failures. Their handlers in [src/preparation-http.ts](../src/preparation-http.ts), lines 54-60 and 159-165, do not establish an explicit overall operation budget. [src/music-assistant.ts](../src/music-assistant.ts), lines 487-514, can attempt multiple exact-recording sources sequentially.

**Impact:** A slow save can outlive the browser's timeout and hold later edits behind timeout-driven retries. Idempotency prevents duplicate changes but does not resolve the waiting-time problem.

**Recommendation:** Align browser and server budgets. For genuinely long operations, expose explicit progress and reconciliation rather than relying on repeated request timeouts.

### F08. Album additions perform per-track reads before final capacity checks

**Evidence:** [src/integrations.ts](../src/integrations.ts), lines 384-397, captures tracks individually in batches. [src/preparations.ts](../src/preparations.ts), lines 316-323 and 369-375, applies the selections and enforces capacity after capture.

**Impact:** A large album selection can perform substantial upstream work before determining that the list cannot accept it.

**Recommendation:** Preflight capacity where it can be determined safely. Evaluate reusing validated listing descriptors, as the import path does, while retaining exact-recording and source-binding checks.

### F09. Read cancellation is inconsistent

**Evidence:** The page API wrapper in [web/page-runtime.ts](../web/page-runtime.ts), lines 313-318, checks lifecycle state but does not pass the signal into `requestJson`. The integration request wrapper in [web/settings.ts](../web/settings.ts), lines 79-81, similarly omits it. Replacement-dialog reads in [web/replace-track.ts](../web/replace-track.ts), lines 77-81, fence late results without aborting the request. Saved-artwork handlers in [src/preparation-http.ts](../src/preparation-http.ts), lines 189-206, lack the cancellation/deadline wrapper used by catalogue artwork.

**Impact:** Navigating away or closing a dialog can leave unnecessary reads, socket use, and queued artwork work running.

**Recommendation:** Propagate lifecycle cancellation through read-only requests and enforce bounded waiting. Preserve independent completion and reconciliation for already-dispatched mutations.

### F10. Import polling and dialogs can outlive their page

**Evidence:** [web/list-import.ts](../web/list-import.ts), lines 13-17 and 119-133, maintains a one-second polling loop without a page-disposal method. [web/preparation-panel.ts](../web/preparation-panel.ts), line 179, stops uploads and replacement UI but not the importer. Page cleanup in [web/page-runtime.ts](../web/page-runtime.ts), lines 889-896, does not dispose its poller or body-mounted dialog.

**Impact:** Repeated navigation can retain pollers, dialog elements, and old UI callbacks. This is a source-level lifecycle finding rather than a browser-measured accumulation result.

**Recommendation:** Add a page-scoped disposer for polling, requests, callbacks, and dialogs. The server-side import should continue independently when the page leaves.

### F11. Prominent artwork lacks foreground priority

**Evidence:** [src/music-assistant.ts](../src/music-assistant.ts), lines 93-96 and 137-163, uses four shared artwork slots. Display/current-track images reach that same work path through [src/display-artwork.ts](../src/display-artwork.ts), lines 33-39.

**Impact:** Slow thumbnail batches can delay prominent display or current-track artwork.

**Recommendation:** Prioritize current/display artwork, bound thumbnail waiting, and cancel obsolete queued requests.

### F12. Visualizer analysis shares the HTTP event loop

**Evidence:** [src/room-visualizer.ts](../src/room-visualizer.ts), line 179, invokes the synchronous analyser. Its sample processing and FFT work are in [src/spectrum-analysis.ts](../src/spectrum-analysis.ts), lines 54-69. Visualizer HTTP reads also create and close a transport for each read at [src/room-visualizer.ts](../src/room-visualizer.ts), lines 116-120.

**Impact:** Audio-analysis bursts can delay unrelated HTTP and event-processing work. Recreating transports forfeits connection reuse for those reads.

**Measurement:** Feeding one second of stereo audio as a single batch blocked the event loop for 23.1 ms; a five-second batch blocked it for 72.3 ms. These are synthetic burst measurements on the workstation, not observed production chunk sizes or average utilization.

**Recommendation:** Move analysis to a worker or process it in bounded batches. Reuse a properly scoped HTTP transport for visualizer reads.

### F13. Uploaded-file latency grows with file size

**Evidence:** [src/uploads.ts](../src/uploads.ts), lines 140-155 and 227-232, performs whole-file integrity verification during capture and playback leasing. [web/upload-panel.ts](../web/upload-panel.ts), lines 96-111, configures upload progress and error handling without an explicit client timeout or inactivity watchdog.

**Impact:** Large files and slow storage increase save/start latency. A stalled transfer may leave the user waiting for network-level or server-side failure detection.

**Recommendation:** Measure large-file behavior on the intended storage. Evaluate safe verification reuse or background verification without weakening file identity checks. Add an inactivity watchdog and explicit recovery flow.

### F14. Large catalogue results still create every row

**Evidence:** [web/page-runtime.ts](../web/page-runtime.ts), lines 659-686, iterates and reconciles the entire displayed result set. [web/music-collection.css](../web/music-collection.css), lines 10-16, addresses offscreen layout/painting but does not eliminate JavaScript row construction and update work.

**Impact:** Large result sets can still produce main-thread work and input delay on slower devices. No device-level long-task measurement was made here.

**Recommendation:** Measure large results on representative phones and introduce progressive rendering or virtualization if long tasks are observed.

### F15. Latency observability and verification are incomplete

**Evidence:** [src/diagnostics.ts](../src/diagnostics.ts), lines 3-24, aggregates count, total, and maximum across broad categories. [src/operation.ts](../src/operation.ts), lines 27-39 and 64, provides optional operation timing, but detached shared reads lose their originating operation context.

**Impact:** Route/action tail latency, interaction-to-confirmation delay, browser long tasks, and event-delivery delay cannot currently be established from these aggregates alone.

**Recommendation:** Add bounded per-action latency histograms and queue, cancellation, cache, and event-delivery metrics. Add browser performance measurements. Distinguish time to local feedback, server acknowledgement, authoritative confirmation, and audible playback.

### F16. Shared and deferred assets leave payload-reduction opportunities

**Evidence:** The production build's core JavaScript, CSS, and two preloaded fonts total approximately 145 KB with Brotli. Main JavaScript is approximately 214 KB before compression. Every route imports the shared page runtime through [web/main.ts](../web/main.ts). Deferred browser-audio code, the software decoder, and its loader can add roughly another 151 KB with Brotli.

**Impact:** Cold-load transfer and parse costs remain relevant on constrained networks and devices. Deferred audio initialization can also consume network and CPU capacity while initial application data is still loading.

**Recommendation:** Measure role-specific startup and consider further code splitting or later loading of optional work. This is a lower-priority opportunity than request lifetime and real-time payload fixes.

## Playback latency measurements and tradeoffs

### F17. Confirmation latency multiplies upstream request latency

The engine, integration layer, and HTTP transport were exercised against a synthetic Music Assistant fixture using memory stores. The memory stores avoid this Windows environment's directory-synchronization incompatibility; the results therefore exclude durable-storage costs.

| Action | Upstream requests in fixture | Completion with 200 ms injected per request |
| --- | ---: | ---: |
| Play requiring queue-policy changes | 10 | 2,056 ms |
| Play with queue already configured | 6 | 1,240 ms |
| Pause | 3 | 613 ms |
| Resume | 4 | 828 ms |
| Seek | 3 | 614 ms |
| Participant volume | 3 | 614 ms |
| Host volume | 2 | 428 ms |
| Reveal | 0 | 0.1 ms |
| Finish turn | 3 | 618 ms |
| Speaker discovery | 3 | 612 ms |

These are sensitivity measurements, excluding browser-network latency and physical audio startup. The approximately 12 ms no-injected-delay Play result is a baseline for interpreting the multiplication, not a deployment performance guarantee. Request counts are fixture-specific, not universal counts for every playback state or destination.

Relevant paths: [src/live-playback.ts](../src/live-playback.ts), lines 317-390, and [src/music-assistant.ts](../src/music-assistant.ts), lines 551-605.

**Recommendation:** Remove avoidable work and parallelize genuinely independent reads where the upstream contract permits it. Preserve ownership, queue-policy, and authoritative confirmation checks; optimistic UI is not evidence that audio playback committed.

### F18. Browser-audio buffering adds deliberate latency

| Connection | Configured minimum buffer | Adaptive maximum |
| --- | ---: | ---: |
| LAN | 500 ms | 2,000 ms |
| Online | 1,500 ms | 4,000 ms |

Source: [web/audio-policy.ts](../web/audio-policy.ts), lines 8-12.

These settings represent a continuity-versus-latency tradeoff. They are not measured end-to-end audible delays and should not be interpreted as such.

**Recommendation:** Validate actual audible startup, continuity, and synchronization on intended browsers and networks before deciding whether lower buffering is appropriate.

## Verification gaps

| Gap | Investigation result and consequence |
| --- | --- |
| Full-suite completion | The full test suite encountered persistence failures and stalled; it was stopped. A complete passing result was not obtained. |
| Windows persistence compatibility | An isolated failing test traced the error to directory synchronization at [src/store.ts](../src/store.ts), line 78, in this environment. |
| Focused test failures | Of 91 focused tests, 3 failed in persistence-dependent setup. The run does not establish complete passing integration coverage. |
| Packaged Linux validation | Docker's Linux daemon was unavailable, so package validation could not be performed. |
| Browser execution | Browser testing was not run, following the project's opt-in browser-testing instructions. Source-level UI findings remain unverified in a rendered browser. |
| Deployment performance | Actual Home Assistant hardware, storage, Ingress, online relay, mobile browsers, and physical speakers were not measured. |

## Recommended deployment measurement pass

| Dimension | Required coverage |
| --- | --- |
| Concurrency | Concurrent browsing, playback controls, imports, and uploads with representative viewer counts |
| Real-time traffic | Spectrum enabled, large private lists, event backpressure, and reconnect/resynchronization |
| Startup | Cold and warm loads, delayed/failed bootstrap requests, navigation during in-flight work |
| Networks | LAN, Home Assistant Ingress, and online access, including constrained throughput and intermittent connectivity |
| Devices and storage | Actual HA hardware/storage and representative mobile browsers |
| Measurements | p50/p95/p99 per action, queue wait, event-loop delay, browser long tasks, event-delivery delay, and audible startup measured separately |

The first remediation priorities are enforcing catalogue request lifetimes, reducing real-time payloads, and fixing startup/lifecycle recovery.
