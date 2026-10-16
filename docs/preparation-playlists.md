# Private preparation playlists — design and implementation

**Current room model:** [one persistent room](persistent-room.md) replaces the original event/session lifecycle described in the historical design below. Membership cookies last a year; public display/join links have no secrets or expiry. Removing a participant revokes room controls, not saved music. The owner permits development restarts/playback interruption; old room migration is not required.

Status: **implemented, validated, and deployed on 2026-10-15 after fresh approval**. The owner explicitly chose Restart now after a paused-track warning. This supersedes the original single, page-local preparation decision. It does **not** authorize autoplay, a shared future-song queue, or playing outside the current participant’s turn.

## Implementation progress

`src/preparations.ts` provides the independent preparation owner/store, integrated by `src/preparation-http.ts` through `createApp`:

- Per-owner, versioned, atomic/fsynced JSON snapshots under `DATA_DIR/preparations/`, private file permissions, strict schemas/order validation, backup restoration, and fail-closed corrupt/oversized-file handling.
- Separate anonymous owner credentials, hashed recovery keys, explicit recovery-key replacement, bounded device recovery, and device revocation without deleting saved tracks. Raw credentials/recovery keys are never persisted or included in list views.
- Durable descriptor schemas, append/exact-duplicate handling, stable-entry/anchor moves, reversible removals/restores, retained played history, and playback-ID-idempotent bookkeeping.
- Independent list revisions, operation IDs/receipts, stale-edit rejection, and reconciliation after a write committed but its acknowledgement failed. No operation retries audio.
- Owner-targeted subscriptions with allowlisted metadata-only views. Provider internals, source URIs, image IDs, credentials, recovery hashes, and operation receipts stay out of the view.
- No engine/live-adapter dependency: preparation reads/edits/save failures do not stop or mutate a running track, its turn, or reveal.
- Verified Music Assistant descriptor capture, persisted source bindings, exact re-resolution without browse-cache dependence, and guarded saved artwork. Restarts/speaker changes/token-only saves retain a binding; origin changes or disconnect/reconnect do not. A fresh exact provider/item/URI/version check is required even on the same origin. Unavailable entries are retained, never substituted or silently rebound.
- Private HttpOnly ownership cookies, strict owner-scoped APIs/events/artwork, optional recovery and device revocation. Room membership is required to capture new catalogue choices and current-turn authority for Play next; library reads/edits/recovery survive removal from the room.
- Compact **Find music / My list** tabs with add feedback, next-at-top ordering, drag plus accessible up/down/Make next controls, reversible removal, and collapsed Played/Removed history/recovery. The player retains its independent optimistic command lane.
- Explicit **Play next** pins the exact owner/head/revision/turn/previous playback and revalidates source/destination. A durable review marker is saved before audio; confirmed playback is retained in Played history. Errors/crash gaps retain the entry for review, and bookkeeping failure after audio never retries audio or reports that start as failed.
- Source-neutral saved entries support private `assetId`/optional artwork assets. The subsequent [single-file upload implementation](uploaded-audio.md) adds metadata/cover review and guarded MA playback locally, not yet deployed; browser paths and permanent public audio URLs are never accepted.

Initial protective limits are 200 upcoming entries, 1,000 retained entries including history/removals, 10 authorized devices, and 5,000 operation receipts within a seven-day retry window. Serialized owner snapshots have a 32 MiB read/write bound, enforced before atomic replacement. Capacity errors retain existing entries; recent receipts are not silently evicted. Expired operations require a fresh read/review instead of being replayed blindly.

**First-release offline policy:** edits require a connection. One unconfirmed save operation is persisted in browser storage before sending, with its original operation ID, expected revision, reference/entry/anchor, timestamp, and a display title for review. Reload does not resend it automatically. Explicit retry reconciles the server receipt even after the old browse reference expires. Conflicts fetch the latest list and require explicit rebasing; expired unsaved references require exact re-selection. This is not a full offline-edit outbox. Play/transport/reveal/volume writes are never persisted or automatically retried. Plain-HTTP LAN guests use `crypto.getRandomValues` for operation UUIDs rather than secure-context-only `crypto.randomUUID`.

Verification: typecheck/build, **106 combined backend/controller tests**, **18 browser workflows**, and isolated container list/order/recovery persistence smoke pass. Backend/HTTP tests cover expiry, fresh readers/restart, exact-source rejection, owner-only SSE/artwork, recovery/revocation, duplicate play, crash markers, ambiguous saves, and save/player lane isolation. Browser tests cover retained drafts, explicit conflict reconciliation, narrow-phone keyboard reordering/undo/recovery, event retention, and delayed Play next with responsive controls. The other agent's automatic-readiness model is preserved: configured speakers allow explicit Play, never automatic audio. No fixture/container test proves real speaker behaviour.

## Recommendation

Build a **server-saved private list**, with a small dedicated participant UI and an independent persistence/control path. Do not expand the browser’s `prepared` variable into an array and call that durable. Preserve the existing green-and-gold styling, browsing, current-player card, turn controls, and reveal rules.

### Confirmed requirements

- Every joined participant can prepare multiple tracks while somebody else is playing.
- Add tracks and reorder them; top means the next intended selection, bottom means last.
- Never silently discard preparation on refresh, restart, speaker changes, connectivity problems, or catalogue-reference expiry.
- Keep lists private: neither the host frontend, public display, nor other participants receive their contents.
- Keep the current simple, uncluttered visual language.

### Implementation defaults and remaining UX decisions

- Keep lists across events, not just within the currently active session.
- After a confirmed play, move an entry into collapsed **Played** history instead of deleting it. Failed or uncertain play attempts never consume it.
- Keep an undo/recovery path for removals; no prominent destructive “clear everything” button.
- Offer an optional private recovery key/link for a new phone or lost cookies, without accounts or nickname-based access.
- Default to appending new tracks at the bottom; **Move to next** brings a chosen entry to the top. Avoid accidental duplicate upcoming entries for the same exact recording; replaying a historical entry remains explicit.
- First release can require connectivity to commit changes. Clearly distinguish acknowledged **Saved** entries from local **Pending** drafts; do not promise full offline editing before implementing a durable outbox.

## Original implementation constraints (addressed by this extension)

| Area | Current implementation | Consequence |
| --- | --- | --- |
| Original preparation | The previously deployed `web/main.ts` had one in-memory `prepared` value; Prepare replaced it, successful play cleared it, reload lost it. | Replaced locally by an authoritative server list; old page memory cannot be migrated after reload. |
| Catalogue references | `src/integrations.ts` seals references with process-local keys and a 12-hour expiry. | Saving these references does not make selections playable after restart. |
| Exact recordings | `src/music-assistant.ts` stores provider/item/URI/version in a 5,000-entry, expiring in-memory reference map. | Save a validated durable descriptor, not the cache key or search text. |
| Artwork | Current image URLs use the same short-lived participant/session/catalogue references. | Regenerate authorized artwork access from saved image identities; never persist expiring proxy URLs as permanent artwork. |
| Membership | Participant credentials belong to an event, cookies expire after seven days, removal deletes membership, and a new event replaces the current session. | Event membership alone cannot own a reusable, recoverable private library. |
| Persistence | `src/store.ts` already provides atomic, file-and-directory-fsynced JSON replacement with restrictive permissions. | This is a useful storage primitive; preparation must not be mixed blindly into ephemeral session state. |
| Transactions | `Engine.transaction` depends on playback readiness; save failure can issue a stop. | Do not use this transaction path for adding/reordering a private list. A preparation save must not affect somebody else’s playback. |
| Events | `src/http.ts` emits role-filtered snapshots on the shared engine `change` event. | Preparation changes need owner-targeted updates, not global broadcasts or changes to public session revision. |
| Browser controls | `PlayerController` cancels intentions on turn/configuration/offline changes. | Keep preparation state and save operations out of this transport-command queue. |

## Compact participant UI

Follow-up implementation: [`participant-workspace.md`](participant-workspace.md) describes the combined search/private-list workspace, implemented locally but not deployed. The tabs below describe the earlier deployed baseline, superseded locally by the desktop sidebar and expandable phone companion. Ownership, save lanes, and playback safeguards are unchanged.

Keep the hero, sticky turn indicator, and expandable circle. Keep the current-player card when it is the participant’s turn. Replace the single prepared card with **one private music panel**, not another dashboard:

```text
Find music                My list · 6
──────────────────────────────────────
Your next picks               Saved ✓

1  [cover] Track title          NEXT
           Artist · album   [Play next]

2  [cover] Track title             ⋯
           Artist · album
3  [cover] Track title             ⋯
           Artist · album

Edit order                  Played ▸
```

- **Find music:** retain today’s track search and artist → albums → tracks navigation. Replace Prepare with **Add to my list**, then a quiet **Added ✓** state. Appending a track must not clear search results, change scroll position, or start playback.
- **My list:** artwork, title, artist, and restrained ordering numbers. Only the first entry gets the **NEXT** emphasis. Show a prominent **Play next** only on the participant’s turn; no automatic start when their turn arrives.
- **Reorder:** **Edit order** reveals drag handles and keyboard/touch-friendly Move up/down/Move to next actions. Do not rely on drag-and-drop alone. Avoid permanent rows of large action buttons.
- **Save state:** one small Saved/Saving/Not synced indicator for the panel. Optimistic reordering is fine, but **Saved** must mean a successful durable server commit.
- **While playing:** keep transport/reveal/volume controls unchanged. Participants may still switch between search and their private list without stopping or replacing the current track.
- **Empty state:** one short invitation to find music, not multiple instructional cards.
- **Played/removed entries:** collapsed, owner-only history/recovery, so the main upcoming list stays clean.
- Keep cover thumbnails and existing typography/palette. Preserve keyboard focus, scroll, selected tab, and reorder mode through realtime updates.

## Durability and ownership

### Separate preparation from the event

Introduce an anonymous, durable **preparation owner**, separate from event participation. A dedicated private HttpOnly preparation credential survives normal rejoining/new events. Event membership and current-turn checks remain mandatory for actual playback.

Ending an event must still revoke its participant/display control access; it must not delete the durable list. Removing a participant revokes their event permissions, not ownership of their private saved work. A nickname is never proof of ownership, and entering the same name on a different device must not reveal someone else’s list.

For cross-event access, use an explicit private-library API/credential scope separate from the existing event endpoints. Continuing to access one’s own library is not permission to control an ended/new event.

### Dedicated preparation store

Reuse the atomic JSON primitive initially, behind a new `PreparationStore` interface. A practical single-process layout is one versioned snapshot per owner under `/data/preparations/<owner-id>.json`, with the owner’s credential hashes, list/order, played/removed entries, revision, and idempotency records committed together.

- Derive/validate the owner from a private credential before reading data; never accept an arbitrary caller-supplied owner ID as authority. Owner identifiers used in file paths must be strictly validated.
- Keep recovery credential validation in that same owner record; avoid an uncoordinated multi-file owner/list/recovery-index transaction.
- Serialize preparation writes independently of the playback engine. Use a preparation revision, not session/turn/catalogue revision.
- Return success only after the durable replacement succeeds. On failure, keep the last saved list and a clear unsaved state; never stop audio, advance a turn, clear a reveal, or substitute a new list.
- Lists and history need explicit capacity/retention rules. Reject additions clearly at capacity rather than silently dropping old entries.
- Include the preparation directory in container/add-on backups. Test worst-case serialization/write cost; the store interface permits moving to transactional SQLite if measured size/write volume warrants it, without changing the UI contract.

### Meaning of “never lost”

Confirmed saved work should survive refresh, ordinary disconnect, app/container restart, speaker change, and Music Assistant/token replacement. Preserve unavailable entries and their order instead of deleting them.

No implementation can guarantee recovery from deletion of the data volume, failed hardware without a backup, or lost anonymous credentials without a recovery mechanism. Make these limits explicit. An optional private recovery link/key handles cookie loss/new devices; backups handle server-data loss. Never expose recovery material to the host/public display, log it, or recover by nickname.

An IndexedDB cache/outbox can preserve unsent preparation intentions across a page reload and distinguish Pending from Saved. Retries are allowed only for **idempotent preparation operations** with stable operation IDs, not play/pause/reveal/volume commands. Set an explicit retry/deduplication lifetime. An expired capture reference must leave a recoverable pending draft requiring exact re-selection, not silently disappear or be matched by title.

## Save actual recording identity

On Add, accept only the existing authenticated catalogue reference. The backend unseals it, captures/validates the server-known selection, rechecks ownership and connection identity after I/O, and saves an entry with its own durable ID:

```text
entryId, sourceBindingId, addedAt
exact recording: provider instance/domain, provider item ID, URI, version
display snapshot: title, artist, album, provider label, duration
artwork identities: supported Music Assistant image-proxy IDs, if present
state: upcoming | played | removed | needs-review
```

Source URIs/provider internals stay server-only. Do not trust browser-supplied titles/URIs or persist complete upstream objects. Do not run the playback adapter’s resolve/pending-intent path just to save a choice.

Before playing a saved entry, resolve its exact descriptor without depending on the transient browse cache; verify recording/version and availability again. Generate fresh, owner-authorized artwork URLs from the saved image identities. Revalidate authorization after image downloads, just as today.

Separate **durable source binding** from the process-local catalogue epoch and speaker configuration revision:

- Speaker changes/restarts do not remove items or change their durable source binding.
- Token replacement preserves entries but requires fresh authorization/exact resolution before playback.
- Changing/forgetting the Music Assistant connection preserves the list and marks affected entries unavailable or needing reconnection; it does not migrate their URIs silently to another server.
- An origin alone does not prove that the server/library behind it is unchanged. Use a stable server identity if the verified API exposes one; otherwise require explicit revalidation/rebinding rather than assuming that the same address means the same catalogue.
- Missing providers/recordings remain visible with an explanation; no automatic name-based or cross-provider substitution.

## Private APIs and concurrent edits

Proposed contract (exact route naming belongs to implementation): read own list, add one captured choice, move an entry relative to another entry/top/bottom, remove/restore an entry, and play a saved entry.

- Owner is derived from credentials, never from a selectable participant/owner parameter.
- Add/move/remove/restore use a client-generated operation ID and expected **list revision**. Repeated delivery of one operation cannot append duplicates or move something twice.
- Move operations identify stable entry IDs/anchors. A stale device must not overwrite a newer addition with an old full-array snapshot. Return a clear conflict and the owner’s latest list for reconciliation.
- Use an owner-only realtime channel (or targeted refresh). Do not emit global `engine.change` merely because someone edits their preparation. No titles, artwork references, contents, or list counts should enter host/display/other-participant views or events.
- Give preparation edits their own per-owner request limits and coalesce reorder gestures. They must not exhaust the shared playback-control request budget or hold the player’s request lane open.
- New private-list state has its own browser controller and revision handling. Ordinary turn/configuration changes must not reset it; revoked event control does not imply deletion of saved library data.
- Catalogue capture and playback remain permission-checked independently. Saving/editing existing entries must not depend on a selected speaker or playback connectivity.

## Playback and played entries

The first upcoming entry is the next **choice**, not an instruction to Music Assistant. **Play next** is explicit and allowed only for the current participant. Only that exact entry is sent to the existing single-track controller; never send the entire preparation list to a speaker queue or enable continuation.

Capture the head entry ID when Play next is pressed, and validate ownership, the expected head, turn, and previous playback identity before starting. A concurrent reorder/removal must not cause the server to choose a different new head silently.

Recommended behaviour: after verified, durably recorded playback start, mark the entry played and move it into the participant’s collapsed history; the next unplayed entry becomes top. Preserve the entry itself. A failed/optimistically projected/uncertain start does not consume anything. Pause/resume/reveal do not consume additional entries. Stop/skip should offer a simple explicit way to put that choice back at the top if desired.

Audio commands and preparation bookkeeping are not one atomic transaction. Tie idempotent played bookkeeping to the exact confirmed playback ID. If bookkeeping fails or a crash occurs between stages, retain the entry and flag it for review; do not guess whether it was played, erase it, or retry audio automatically. Do not use the current browser `played` callback as the authority for deleting a saved entry.

Natural completion continues to advance the participant rotation once. It does **not** start the next song from that participant’s preparation list.

## Delivery plan

1. Confirm cross-event retention, played-history behaviour, and optional anonymous recovery. Agree on list limits and whether fully offline edits are required in the first release.
2. Implement and test independent owner/store/versioned persistence, backup/recovery, operation deduplication, and server-side private serializers before changing the participant UI.
3. Add durable capture/exact re-resolution and guarded artwork; test expiry, cache eviction, restart, token/server changes, and missing recordings without real speaker writes.
4. Add the compact Find music/My list panel, append/undo/reorder controls, save indicators, and owner-targeted updates. Test touch/keyboard/320px layouts and unchanged player responsiveness.
5. Connect **Play next** to the existing guarded controller and non-destructive played bookkeeping. Test start failures, crash gaps, concurrent edits, stop/pause/reveal, and natural completion.
6. Provide a safe upgrade path for current page-local preparation: existing open pages hold the only copy today, so a restart before capture cannot recover it. Offer capture before restart where feasible, or explicitly warn the owner; never claim an ordinary reload can migrate a value that only lived in the old page.
7. Deploy only after explicit restart approval, preserving existing state/credentials and keeping turn/ownership/exact-recording safety rules intact. The separate manual playback switch was removed at the owner's request; music still starts only on explicit Play.

### Acceptance cases

- Add/reorder/restore while somebody else is playing; their audio and player state do not change.
- Refresh/restart/speaker changes preserve all acknowledged entries and order, including after the old 12-hour browse-reference expiry and 5,000-entry cache eviction.
- Two tabs editing concurrently cannot lose additions, duplicate retried requests, or overwrite a newer order silently.
- Disk-write failure, timeouts, disconnected SSE, and reload during Saving leave either a confirmed saved entry or a visible recoverable pending draft—not false success.
- Provider/token/server changes retain entries and never route a stale selection silently to the wrong source.
- Actual playback remains current-participant-only, exact-recording-only, single-track, and explicitly initiated. Failed starts do not consume entries; successful entries remain recoverable in history.
- No private list data or edit broadcasts reach the host, display, another participant, unauthorized artwork requests, errors, or logs.
- A fresh event does not overwrite the library. A new device cannot obtain a library by typing a matching nickname; approved recovery restores the rightful owner only.

Implementation/tests issued no real speaker commands. The owner subsequently approved deployment and explicitly confirmed restart with a paused track. Deployment retained the persistent volume, session/order, settings/token/destination, guest URL, and existing private library; app playback ownership/reveal was cleared without stop/play/volume commands. Configured playback remains available for a fresh explicit Play. A protected data backup and rollback image are retained; future restarts still require fresh approval.
