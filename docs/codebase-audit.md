# Codebase audit — 2026-10-15

## Scope and baseline

Reviewed application source, browser controllers and rendering, persistence, HTTP boundaries, Music Assistant transport/ownership, uploads, packaging, scripts, documentation and test coverage. Generated output and installed dependencies are not application source; dependencies were checked with `npm audit` (zero reported vulnerabilities).

Baseline: typecheck, 139 unit/integration tests, production build and 35 browser tests pass. A source/configuration snapshot is retained at `/tmp/opencode/aotyassistant-before-audit-20261015.tar.gz`; this workspace has no Git history.

## Resolved findings

| Area | Finding | Implemented resolution |
| --- | --- | --- |
| Playback lifecycle | Stale invalidation/status callbacks could conceal a replacement or revive stopped playback; a rejected preflight could leave the original display concealed. | Bind callbacks and concealment to the exact playback/attempt, retaining the previous reveal when playback was untouched. |
| Exact recording ownership | Queue ownership checks omitted the recording version after initial resolution. | Verify version alongside provider/item/URI and queue-item identity throughout playback, pause/resume and volume checks. Substituted audio loses ownership without being stopped. |
| Transport acknowledgement | Acknowledged but ignored transport commands could release ownership or permit an incorrect turn transition. | Read back transport outcomes without retrying writes. An ignored Stop retains uncertainty and does not advance. |
| Source transitions | Disconnect between resolve and Play could turn a live selection into a demo timer; a concurrent settings save could change source underneath demo playback. | Bind demo selections to their configuration and serialize playback acquisition with settings commits. Release late live selections on shutdown. |
| Browser identity | Delayed private-list reads/recovery-key replies could restore revoked access or overwrite a recovered owner. | Fence asynchronous work by lifecycle, serialize identity changes, and ignore obsolete streams. |
| Browser catalogue | Delayed search/browse responses could outlive membership or connection identity. | Add `web/catalogue-controller.ts` for request lifetime; retain browsing across ordinary turn and speaker changes. |
| Browser volume | Old volume intentions could survive replacement or Stop within the same turn. | Bind participant volume work and acknowledgements to the exact playback. |
| Upload lifecycle | File selections could overlap while initializing an owner; cancellation only aborted an existing XHR. Late draft operations could update a different owner. | Reserve selection before awaiting initialization, invalidate cancelled selections, serialize draft actions and fence their replies. |
| Uploaded source integrity | Saved upload checksums were not compared with the playback asset; lease acquisition was not serialized with deletion. | Verify the saved checksum and acquire leases in the asset lane. Require the exact media filename. |
| Event streams | Pending authorization could bypass stream capacity; disconnects during setup could leak subscriptions; a valid large snapshot could trigger endless reconnects. | Reserve capacity before awaits, centralize disposal, and coalesce snapshots until drain with a bounded stall timeout. |
| Persistence | A schema-valid preparation state could exceed the reader's 32 MiB bound when saved, making the next read fail. | Enforce the same serialized byte bound before atomic replacement, preserving the previous readable file. |
| Discovery responsiveness | Slow read-only discovery occupied the playback command lane. | Move inspection and destination discovery outside that lane; recheck revisions and ownership before publishing/committing. Coalesce connection checks. |
| Media HTTP | Upload and diagnostic range parsing was duplicated and accepted overflowing suffix values after clamping. | Share a bounded range parser with regression coverage. |
| Startup | Express 5 passed asynchronous listen errors to a callback that ignored them, reporting successful startup and exiting with code 0 on a port conflict. | Await the listening event/error, clean up initialized resources, and exit unsuccessfully with a sanitized message. |
| Maintenance | Repeated infrastructure, obsolete playback paths/copy/CSS and unused symbols complicated maintenance. | Extract shared infrastructure, remove confirmed dead paths, and enable TypeScript unused-local/parameter checks. |

## Architecture and compatibility

- `src/serial.ts` provides FIFO and keyed work lanes. Engine, settings, owner saves and upload assets retain their separate ordering boundaries.
- `src/http-utils.ts` and `src/event-streams.ts` centralize cookies, input policy, byte ranges, and SSE reservations/disposal/backpressure. `src/integration-http.ts` owns integration routes.
- `src/music-assistant-transport.ts` owns LAN/DNS pinning, HTTP deadlines, response limits and sanitized transport failures. `src/music-assistant.ts` retains catalogue/queue domain logic. Structural capability interfaces replace concrete-client coupling.
- `web/request.ts` centralizes deadline-bounded JSON requests without automatic mutation retries. Catalogue, preparation and player controllers retain independent lifecycles; DOM presentation stays in the browser panels/main view.
- Removed the unused `selectionForPlayback`/`markPlayed` path; tests exercise the production `playHead` workflow with durable review markers and exact-head checks.
- `scripts/container-fixture.ts` shares disposable-container helpers. Tests build `aotyassistant:smoke`; the runtime data-directory permission is `0700`.

The existing features, API routes, persisted schemas, privacy boundaries, explicit-play rules and intentionally open LAN host controls remain the compatibility contract. Dependencies are unchanged. This is a focused refactor rather than a framework/storage rewrite. The audit was completed locally; the subsequent authorized deployment is recorded below. No real speaker commands were issued. The pre-change archive excludes `.env`, installed dependencies and generated outputs.

## Verification

| Check | Final result |
| --- | --- |
| `npm run typecheck` | Passed, including unused-local/parameter checks. |
| `npm test` | **160 passed**, no failures/skips. Baseline: 139. |
| `npm run test:browser` | Production build and **37 browser workflows passed**. Baseline: 35. |
| `npm run test:container` | Production image built; persistent-room/private-list and real packaged audio-processing smoke suites passed. |
| `npm audit --json` | Zero reported vulnerabilities; dependencies unchanged. Container dependency audit also reported zero. |

The container suites verify restart persistence, private-list recovery, original audio/artwork retention, all supported formats, and rejection of text/raw AAC. Browser coverage includes desktop and narrow-phone layouts, independent roles, privacy, uploads, recovery, playback controls and live-update continuity. The newly serialized discard UI required the cancellation workflow test to wait for the enabled file-selection button before supplying another file.

Regression cases reproduced the original stale-playback, rejected-preflight, changed-version, overlapping/cancelled-upload and occupied-port failures before their fixes. Additional cases cover private-owner revocation/recovery, delayed catalogue/volume responses, oversized persistence, large SSE snapshots, upload manifest integrity and stale discovery publication.

## Development deployment — 2026-10-16

Deployed and restarted following the owner's explicit request. No app-owned playback was active. The Compose build and running container match all 26 tested application/build files from `aotyassistant:smoke`.

- Running image: `sha256:2f66a0fd5b39889d2004e4730afcdb65f398a90e2bbb8beae925939f7670fe8b`.
- `/api/health` is healthy in Music Assistant mode, including through `http://192.168.5.147:3000`. All six application routes return 200. Fresh 320px browser checks of display, host and participant pages report no page errors or horizontal overflow.
- Both participants, their membership credentials/order/current listener, four private owner snapshots, uploads and integration/address settings are retained. All ten non-room persisted files are byte-identical to the stopped-container backup. Restart cleared playback and rotated the turn identity as designed. The data volume and published port bindings are unchanged.
- Music Assistant verified the protected diagnostic file after restart. Discovery reports the saved **Roam unavailable**; audible playback acceptance remains pending. Integration revision 20 and the configured token/destination were retained.
- Protected backup and verification evidence: `/tmp/opencode/aoty-audit-deploy-20261016T050134Z/`. It contains the stopped-container data archive, deployment configuration and rollback filesystem archive. Rollback image: `aotyassistant:before-audit-20261016t050134z`.
- Docker could no longer resolve the former image/content for tagging or committing. The rollback image was instead reconstructed from an export of the running container, retaining its runtime configuration and verifying its application-file hashes against that container before replacement.

Refresh open browser pages to load the deployed fixes.

## Remaining limitations

- Real Sonos/phone lifecycle acceptance remains outstanding, including audible natural completion, long pause/resume and interference/recovery. Synthetic Music Assistant/browser fixtures and packaged FFprobe tests cannot establish those results. Existing acceptance checklists remain in `PLAN.md` and `docs/uploaded-audio.md`.
- File-backed state and serialization support one application process per data directory, as documented. Multi-process coordination and a database migration would be separate changes.
- Owner snapshots are bounded JSON documents. The 32 MiB persistence check prevents unreadable saves, but large-list serialization still runs in-process; streaming/delta events or transactional storage should follow measured scale requirements.
- The feature-rich preparation, upload and main-rendering modules remain substantial. Smaller shared responsibilities have been extracted; further splitting should follow concrete ownership boundaries rather than redistribute coupled state arbitrarily.
- Container checks cover Linux x64/Alpine, not every Home Assistant architecture or an actual Supervisor installation. Docker emits a legacy-builder deprecation notice; an npm install-script approval warning for esbuild is non-fatal in the verified build.
