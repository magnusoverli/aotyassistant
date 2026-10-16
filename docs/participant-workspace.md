# Participant search + private list workspace

Status: **implemented and deployed to the development instance on 2026-10-15**, alongside uploads and verified address setup. The participant page shows search and the private list together. Existing session/participants, two private libraries and MA credentials/destination were retained. List ownership, persistence and playback authority are unchanged; no speaker command was issued.

**Version 0.2.5 UI update:** typography, surfaces and desktop alignment now match the host pages. Uploads are beside search, and result counts, pending feedback, keyboard focus and a speaker-settings link improve navigation. Update the installed app and refresh participant pages to load these refinements; publishing does not restart running installations.

## Implementation

- `web/preparation-panel.ts` replaces the exclusive tabs with one list region and responsive inline expansion. There are no duplicate mobile/desktop lists or owners.
- `web/main.ts` separates search controls from results, keeps the workspace visible during playback, and restores independent list scroll along with query, breadcrumbs, focus, and page scroll. The player and Finish my turn remain above the workspace.
- `web/style.css` gives wider screens a search/list split and phones a compact sticky companion. The existing shared header, colors, artwork, and typography are reused.
- The preparation/player controllers and backend contracts are unchanged. Upload controls now sit inside Find music, before results; list-only recovery views retain a separate upload card. Upload behavior is unchanged.

## Layout

The private workspace uses the host pages’ sans-serif headings, dark green cards and restrained gold actions, while retaining private artwork. It introduces no taglines, extra global navigation, or shared speaker queue.

### Wider screens

- At 1000px and wider, the participant page expands to at most 1500px with a flexible search column and a 360px list column. Playback and finish-turn controls align with the search column.
- Keep search and results on the left; place **My list · N** on the right, sticky below the shared header.
- Keep next-at-top ordering and the full upcoming list available. Cap a long list to the available height with its own scroll, while retaining normal page scrolling for search results.
- Keep player/reveal/volume controls independent and readily accessible. Do not collapse the list when playback begins, hide it inside Choose another song, or automatically close a search the participant is using.

### Phones and narrower screens

- Keep a single-column, normally scrolling page—no two squeezed columns or viewport-locked application shell.
- Put a compact **My list · N** companion after the search controls, before results. Show the first two upcoming tracks, with only the first marked NEXT.
- At 360px and below or a visual viewport shorter than 600px, show one upcoming track plus the count. Visual viewport height also bounds expansion when a keyboard reduces usable space.
- Let that compact companion stick below the shared header while results scroll. It is not a fixed overlay and does not cover result actions.
- **View all** expands the same list inline into a bounded, scrollable region. Search remains available; no full-screen modal, no tab switch, and no duplicate list/controller.
- **Edit order** reveals accessible move buttons/handles only on demand. Keep Played/Removed history and recovery behind a secondary disclosure.

An always-expanded full list on a phone would push results out of reach; a bottom modal would make searching and list management mutually exclusive again. The bounded inline companion is the better compromise. It makes upcoming choices visible without claiming all 200 entries can fit on one screen.

## Preserved interactions

- One obvious **Add** action per result; acknowledge success with Added ✓, update the list count, and announce the added title without stealing focus.
- Appending never scrolls the page/list to the bottom or changes the search query, artist/album breadcrumb, or current selection. Offer explicit navigation to the added item if needed rather than moving the participant automatically.
- Use the same authoritative list data for preview, full list, reordering, pending/conflict/review states, and future asset-backed upload entries.
- Saved means a durable server acknowledgement. Do not show a local animation as proof of a save; keep drafts and failed-save feedback visible.
- Retain one explicit Play next action, current-participant-only. Adding, expanding, moving, or restoring an entry never starts or replaces audio. Waiting members may still browse and prepare.
- Preserve keyboard focus, selections, search/list scroll, open/edit state and the header through owner/room SSE updates. Added acknowledgements stay focusable but cannot resubmit additions. Use named regions without a modal focus trap.
- Test the mobile keyboard and safe areas explicitly; the search field and at least one result action must remain reachable. Avoid automatically closing a manually expanded list just because focus changes.
- Account for the sticky companion when focusing/scrolling result actions; keyboard navigation must never put a focused Add button underneath it. Deliberate search focus may scroll the form into the usable area on a short viewport, but additions/SSE updates must not move the page.

## Validation

`tests/browser/participant-workspace.spec.ts` exercises the real application with isolated storage and synthetic music: desktop/phone breakpoints, long metadata/lists, bounded expansion, focused actions around the sticky list, owner/session updates, input selections, scroll preservation, and additions without autoplay. Existing workflows cover artist browsing, reordering/removal/undo/history/recovery, failed saves/conflicts, uploads, playback, privacy, and the shared header.

Validation passed: **typecheck/build, 122 backend/controller tests, and 31 browser workflows**. Application captures at **1440×1000**, **1000×800**, **999×800**, **390×844**, **320×700**, and simulated **390×440** exercise both sides of the workspace breakpoint, long lists/missing artwork, compact/expanded lists, and unobscured focused result actions without horizontal overflow. Desktop, phone, short-height and 320px full-list captures were visually inspected. The preview reserves row space so saving a second choice does not push the active result down the page. Play next/Edit order are above the full list, not after all entries.

## Acceptance boundaries

`PreparationController` and `PlayerController` remain separate. One authoritative list is rendered across responsive layouts, rather than parallel mobile/desktop copies. No backend/schema or shared-header changes were needed. Simulated short viewports are not proof of native phone-keyboard/safe-area behavior; real device checks remain owner-led acceptance work.

Before deployment, verify:

- 1440px desktop and 320/390px phones, including short/keyboard-height and reduced-motion views.
- The next selection remains visible while browsing results; expanded list scrolling cannot trap or cover search.
- Adding tracks preserves input focus, query/breadcrumbs, and page/list scroll. Long titles, missing artwork, 0/1/200 entries, and unavailable sources remain readable.
- Reorder/remove/undo/history/recovery and save/conflict/review failures remain usable in both layouts.
- Non-current/current/removed/offline states do not reveal another participant's list or bypass room membership.
- Play/pause/resume/reveal/volume stay responsive; no automatic audio writes or changed public display behavior.

The owner permits development restarts and playback interruption. The earlier standalone mockup is historical design material, not the application implementation or its validation. The current [persistent room](persistent-room.md) has no session lifecycle or display authorization.
