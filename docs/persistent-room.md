# One persistent listening room

Status: **implemented, tested and deployed to the development instance**. Refresh open tabs. Public room: `http://192.168.5.147:3000/display`; join: `http://192.168.5.147:3000/join` (development addresses, not application defaults).

The app has one room, created automatically at startup. There are no sessions, admission, Create/Start/End buttons, expiring invitations or display credentials.

- `/display` opens directly in any browser on the configured LAN origin, including a fresh browser with no cookies. The shared header uses this same permanent URL. Old `#access=…` fragments are stripped and ignored.
- `/join` asks only for a nickname. Its permanent QR/link does not expire. Old invitation fragments are stripped and ignored.
- Participants join at the end of the rotation. The first join into an empty room gets the first turn. Joining does not play music; **Play**/**Play next** remains explicit.
- Participants/order/current person remain across restarts, until removed. A returning browser with a valid membership cookie retains its identity. The membership cookie lasts a year; clearing/losing it requires joining again. A nickname is not an identity or a private-list recovery key.
- The host still reorders/removes people and advances/skips turns. Removing a participant invalidates their room controls, not their private music. They may join again using the public link; removal is not a permanent ban. Removing everyone leaves the same room open.
- The public display exposes only names/order, filtered progress and explicitly revealed metadata/artwork. It never receives private lists, unrevealed tracks, provider identities, integration tokens or control authority. Public artwork still checks exact revealed playback identity before and after I/O. Display access requires no cookie, including for SSE and revealed artwork.
- Private-library credentials/recovery remain separate from room membership. Only the current participant can play, control, reveal or finish; stale turns/playback/destinations remain rejected.

## Storage and development upgrade

`DATA_DIR/state.json` uses schema 3 with a `room` object: identity, revision, turn, membership/order/current participant and playback. There are no runtime lifecycle phases, invitations or display secrets. Restart keeps the room/membership but clears playback/reveal and changes the turn nonce, as before; it does not automatically resume music.

**At the owner's direction, old development event records (schema 1/2) are discarded, not migrated.** The first boot creates a fresh empty persistent room; old participants must join again. Private lists, uploaded audio, recovery keys and integration/address settings are separate files and are left intact. Unsupported/corrupt current-format records still report an error instead of silently deleting saved data.

The owner permits playback interruption and deployment/restarts on this development instance; no migration preservation plan or separate idle-playback approval is required for this work.

Removed APIs return 404: `/api/host/create`, `/api/host/start`, `/api/host/end`, `/api/host/admit`, `/api/host/invitation`, `/api/display/auth`. Refresh old tabs after deployment. Clients use `roomId`, not `sessionId`/`phase`.

## Checks

Tests cover fresh direct display/join links, stale fragments/cookies, filtered HTTP/SSE and reveal-gated artwork, private lists/uploads/recovery, rejoining/removal, current-turn authority, persistent room/order after restart, empty/full/concurrent joins and removal of lifecycle actions. Container smoke checks the packaged app, persistence and private-list recovery. No existing-room migration is implemented or required.

The original room deployment passed typecheck/build, **139 backend/controller tests**, **35 browser workflows** and both container smokes. Its schema-3 room had no session fields; deployed backend hashes matched the tested build. All six live pages returned 200; a fresh public browser and an obsolete display cookie/fragment opened successfully. Desktop public-room and 320px host captures were inspected without overflow. The saved MA token and private-library/upload storage were retained.

The **2026-10-16 audit-fix deployment** supersedes that image after **160 backend/controller tests**, **37 browser workflows** and both container suites passed. Room membership/order, saved music and settings were retained; live health/pages/browser checks pass. Current image, backup and integration status are recorded in the [codebase audit deployment record](codebase-audit.md#development-deployment--2026-10-16).
