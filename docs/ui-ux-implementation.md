# UI/UX implementation progress

Started 18 October 2026. Source: [UI/UX audit](ui-ux-audit.md) and [reproductions](ui-ux-audit-evidence.md).

**Latest milestone:** all scoped batches 1–7 completed and verified on 18 October 2026. Batches 2–7 comprise release **0.3.0**, following the 0.2.9 checkpoint. The owner's direction is simple implementation and simple user flows. Accessibility-specific work is outside scope.

**0.2.9 release checkpoint:** published with completed Batch 1 only. Batches 2–7 follow in 0.3.0. Screenshots are local/ignored artifacts, not tracked deliverables.

Release checks rerun at version 0.2.9: build/typecheck, 194 unit/controller tests and all 70 Chromium browser tests passed. [0.2.9 is published](https://github.com/magnusoverli/aotyassistant/releases/tag/v0.2.9); amd64/arm64 manifests and image configurations were downloaded anonymously before completing publication.

## Delivery plan

### Mobile refinements — 19 October 2026

Follow-up to the owner's fresh, interactive mobile UI review. All six findings and the compact listening-order follow-up are included in release **0.3.11**.

- **Task priority:** a compact mobile player retains its geometry through waiting, starting, playing, paused and stopped states. Short landscape layouts place controls beside the track/progress so the whole player fits comfortably. Find music and My list shortcuts are immediately available; the list shortcut opens the existing inline list. The compact turn toolbar replaces the duplicated mobile headline, while the shared names-only listening order stays visible.
- **Source selection:** artist/album browse actions wrap beneath the identity on narrow phones. Source prompts/selects span the row instead of being squeezed between artwork and a button. Exact-source requirements and distinct recordings are retained.
- **Playback handoff:** `web/player-return.ts` supplies a mobile navigation link when the player is off-screen, with Starting versus authoritative Playing/Paused/Stopped and Hidden/Revealed status. It preserves browsing position and performs no playback mutation. Failures lead to the actual error; the link hides when its target is visible and while typing in a field. Bottom clearance allows the final content to scroll above the shortcut.
- **Setup spacing:** discovery, detected-server selection, URL and Connect use a consistent form stack; the advanced token form retains its own submit behavior.
- **Hosting:** link copying precedes the smaller QR on stacked layouts. The mobile Manage/Done control sits beside Host desk. Management expands the shared horizontal list's entries to keep the reorder/removal controls comfortably sized.
- **Listening order follow-up:** the owner-approved compact strip is 55px high on stacked layouts, with 130–150px entries, no avatars and short Now/Next/You labels. Two entries fit fully at 320px; additional people remain horizontally scrollable. Desktop keeps the avatar cards and inline management control. Live-update focus/scroll preservation and names-only privacy are retained.
- **Type and touch:** mobile menu labels, source explanations, saved metadata and player labels are larger. Volume sliders and upload/source-help disclosures have at least 44px hit heights.

Visual review uses the current app in an interactive Chromium browser at 390px/320px and 844×390 landscape, with isolated demo/MA services. Existing automated layout checks also cover desktop, tablet and short phone heights. Verification: production build/typecheck, **227 backend/controller tests**, the full **107-workflow Chromium suite**, and **11 focused rechecks** after the final landscape refinement passed. The focused pass includes a new landscape geometry case, bringing the suite to 108 workflows. New regression cases cover direct preparation access, readable source selection, pending versus confirmed playback, reveal status, read-only return navigation, failures and no automatic retry. The clock test now waits for the authoritative pause correction before asserting a frozen value.

Actual iOS/Android keyboards, native file pickers, Safari and Home Assistant's mobile wrapper still require physical-device review. Screenshots remain outside the repository.

Compact-order follow-up verification: manual review at 320px and 390px, including host management; production build/typecheck and **17 targeted Chromium workflows** passed. Checks cover two complete mobile entries, the heading-level management control, 44px management targets, shared-route consistency, live updates, public display and stable player geometry.

**0.3.11 release verification:** production build/typecheck, **227 backend/controller tests** and the full **108-workflow Chromium suite** passed. Publication uses the versioned image workflow and anonymous amd64/arm64 verification before the Home Assistant store-branch update.

**Subsequent owner-requested scope:** the [shared page-layout plan and progress tracker](shared-page-layout.md) extends the original batches with a common layout/component foundation. Its explicit shared-layout work supersedes the earlier restriction against a stylesheet-organisation project for this follow-up.

This sequence supersedes the audit's four implementation phases and the earlier estimate of 7–9 remaining batches. The audit remains supporting evidence, not a requirement to implement all 90 recommendations. Scope below is deliberate; related audit IDs do not imply every sub-suggestion will be implemented.

| Batch | Status | Outcome |
| --- | --- | --- |
| 1 — Confirmed defects | Complete | Trustworthy status, recovery, independent search, consistent replacement, cross-tab list discovery |
| 2 — Participant workspace | Complete | One compact mobile layout for waiting, choosing and playing |
| 3 — Finding music | Complete | Clear results, source choices and predictable Back navigation |
| 4 — Keeping music | Complete | Simple list management, uploads and recovery |
| 5 — Hosting | Complete | Invite people, see the current turn, manage the order |
| 6 — Setup and recovery | Complete | Short first setup and calm connected summaries |
| 7 — Finish and verify | Complete | Cohesive entry/display/error pages and end-to-end verification |

### Design and implementation rules

- Keep the forest-green, cream and gold palette. Create breathing room by removing repetition and secondary detail before adding padding.
- Give each state one obvious next action. Put occasional controls in ordinary inline disclosures; use a normal page flow on phones.
- Use the existing TypeScript/DOM modules and controllers. Keep UI state beside the feature that owns it. Extract a helper only when actual duplication or complexity warrants it.
- Use native buttons, forms, selects, details and the existing `confirm()` for consequential actions. Retain existing interaction support as components change.
- Prefer a small CSS cleanup within the components being changed. Introduce shared values only for repeated type/spacing/control rules; avoid a separate design-system or stylesheet-reorganisation project.
- Keep the existing server contracts wherever sufficient. Add a small role-safe status field only when the UI needs a fact the server already knows.
- Accessibility audits, screen-reader work, speech-input checks, forced-colour work and compliance targets are not delivery requirements. Readable text, comfortable phone controls and usable short screens remain ordinary usability goals.

### Target flows

**Guest:** Join → find a song → save it or explicitly play on your turn → reveal → finish. Search and saved music remain available throughout.

**Host:** Connect music → choose a speaker → share the room. After setup: current turn → people/order → invite.

**Returning guest:** Open My music → continue. If access was lost: open List access → enter a recovery key → join if needed.

**Failure:** A short message beside the affected task explains what happened and the next action. Keep unresolved work visible; unrelated tasks remain usable.

## Batch 1 — Confirmed defects and entry legibility — complete

| Audit reference | Work | Status |
| --- | --- | --- |
| G03, W02 | Server-reported playback availability replaces `LIVE · SONOS`; settings identifies Music Assistant without claiming health. Idle participants are described as having a turn. | Complete |
| G06, G07 | Menu closes when focus leaves; page-level Escape dismisses and returns focus. Brand accessible name includes its visible subtitle. | Complete |
| J02, J03 | `/join` and `/participant` both offer optional recovery and explicit success acknowledgement. Saved tracks remain absent before joining. | Complete |
| J04 | Whitespace-only names are rejected beside the field without a request; server errors stay in the form with associated text and retained input. | Complete |
| S01 | Mobile search, settings, recovery and other inputs/selects/textareas use at least `1rem` text. | Complete |
| S08 | Search/browse use an independent loading lane and local errors with read-only retry. Turn/player controls remain usable during delayed search. | Complete |
| P02 | Direct and prepared Play share one replacement guard for playing and paused songs; first play needs no confirmation. | Complete |
| V11 | Existing tabs discover first-list creation via a content-free storage notice and authoritative read; later updates use the private event stream. Focus rechecks missing access if storage is unavailable. | Complete |

S09 is completed by Batch 3: task-local Retry, distinct empty/failure states, and shortened coverage copy with a persistent Details disclosure.

### Implementation notes

- `src/engine.ts`, `src/model.ts`, `web/navigation.ts`: a role-safe availability boolean; no speaker identity, music metadata, or credentials added to public/host views.
- `web/app-header.ts`: persistent-header focus handling and natural accessible naming.
- `web/main.ts`, `web/join-panel.ts`: independent catalogue task state, shared play guard, shared entry/recovery and local join errors.
- `web/preparation-controller.ts`, `web/preparation-panel.ts`: recovery acknowledgement and first-save discovery across tabs; notices contain only a random change token.
- `web/style.css`: mobile input legibility using the existing palette.

### Verification

- `npm run build` — passed.
- `npm run typecheck` — passed.
- `npm test` — **194 passed** (audit baseline: 193).
- Targeted Chromium browser checks — **29 passed**.
- Complete Chromium browser suite — **70 passed** (audit baseline: 63).
- `git diff --check` — passed.

New regression coverage checks menu focus/Escape, truthful readiness, recovery through both entry routes with no pre-join titles, field-local validation, playing/paused replacement cancellation and acceptance, delayed search with Pause/Finish, and first-save synchronization without extra writes/reload/private broadcast data. Existing privacy, exact-source, upload, Ingress, reveal, turn and layout checks also pass.

Checks use isolated synthetic services/data. Physical phone keyboard checks remain useful for mobile usability. The revised scope excludes additional accessibility-specific validation.

## Batch 2 — Participant workspace

Implemented: compact navigation, one turn summary, inline mobile list with short-screen unstick, separate player actions and hidden-until-needed results. Focused journey/geometry checks and the final complete browser suite pass. Existing presentation assertions now exercise the revised controls and disclosures.

**Outcome:** the phone screen immediately communicates whose turn it is and what to do next.

- [x] Compact the shared header and adopt **My music / Room display / Host desk / Settings**. Put Full screen in the menu outside the display.
- [x] Use one turn summary: “Sam’s turn · You’re next” or “Your turn”, with a Listening order disclosure. Remove the participant's duplicate header turn chip and seat-heavy summary.
- [x] Build waiting, idle-current and playing layouts together. Keep search and list available in all three states.
- [x] Replace the mobile list card with one summary row: count, next pick when space permits, and Open. Empty lists take one line. Expanding reveals the existing list in normal page flow.
- [x] Let the mobile header scroll away. Only the collapsed list companion may stick while browsing; unstick it on short screens. Keep the expanded list nonsticky. Retain the desktop supporting pane with a content-driven breakpoint.
- [x] Use the same companion for a quiet “Your turn · Go to player” link when appropriate. Keep one player; no second transport strip, bottom sheet or forced scrolling.
- [x] Player hierarchy: song → Pause/Resume → Reveal song → secondary Finish turn. Show Hidden on room display / Revealing… / Visible on room display. Keep volume in a small disclosure on phones.
- [x] Place Pass turn beside the idle turn summary. During playback, explain briefly that Finish stops the song and passes the turn. Keep replacement confirmation from Batch 1.
- [x] Remove the empty Results panel before searching. Apply readable type and consistent spacing to these touched components.

**Implementation:** `web/app-header.ts`, `web/navigation.ts`, `web/main.ts`, `web/visuals.ts`, `web/preparation-panel.ts`, `web/style.css`. Retain one preparation panel/controller and one player controller; use classes and small render helpers for state differences.

**Done when:** at 390×844 the ordinary waiting/search view exposes the first useful result and action without a full list card ahead of it. Aim for a 56–72px header and 56–88px collapsed companion, allowing text to grow. At 320px and short landscape heights, actions remain reachable. Turn changes preserve browsing and never start music.

**Audit links:** G01–G02, W01/W03–W08, L01–L03, P01/P03–P05, V01/V03/V04 (ordinary phone usability only).

## Batch 3 — Finding music

Implemented: Artists/Songs, clearer identities/service names, separate source controls, local Details and memory-only Back/Forward snapshots. Build/typecheck and the focused browser history journey pass. Browser history stores only a local key; metadata remains in the active document.

**Outcome:** find an artist, open an album, choose a song and return without losing context.

- [x] Label modes Artists / Songs; use a mode-specific search hint and phone Search key.
- [x] Simplify rows to artwork, title/name, necessary supporting identity and actions. Keep distinguishing version/source information visible where it affects the choice.
- [x] Give artist and album rows one clear browse action. Keep any source selector separate.
- [x] Replace matching jargon with “Choose a source” and friendly service names. Use existing safe edition/availability details when available; require the same exact source selection as today.
- [x] Support browser Back/Forward through search → artist → album. Retain query, selected source and per-level scroll within the current document.
- [x] Keep a small in-memory browse stack (40 snapshots); browser history stores only a local entry key. Clear invalid snapshots when membership/catalogue identity changes. Reload uses a fresh workspace; server validation still governs expired results.
- [x] Finish local loading/error/empty states. Keep partial-source caveats under Details, preserve its open state, and provide explicit read-only Retry where useful.

**Implementation:** `web/main.ts`, `web/catalogue-controller.ts`, `web/catalogue-sources.ts`. Add a narrowly scoped browse-history helper if needed; use the existing page routing and catalogue lifetime rules.

**Done when:** both in-page and browser Back restore the previous browse level and position; pending/failed requests cannot replace a newer catalogue context. Ambiguous recordings still require a source choice, and no operation silently substitutes a recording.

**Audit links:** S02–S07, S09. S08 is already complete.

## Batch 4 — Keeping music

Implemented: contextual list playback, nearby Undo, separate History/List access, recovery-key lifecycle and copy fallback, explicit upload disclosure/review/cancellation and draft-replacement guard. Build/typecheck, all 194 unit/controller tests and four focused browser journeys pass.

**Outcome:** save, arrange, upload and recover songs with minimal management UI.

- [x] Keep upcoming songs as the main list. Use “Your next pick” and contextual “Play this song”; while waiting show “Ready for your turn” rather than a prominent disabled Play action.
- [x] Keep Edit order with existing move controls. Show removal feedback with nearby Undo; label history actions Add back and explain when they append to the end.
- [x] Put History and List access in separate inline disclosures below the upcoming list, outside its desktop scroll container.
- [x] Keep a short Needs attention indicator in the collapsed companion for failed saves, unavailable sources or uncertain playback, opening the existing explanation.
- [x] Explain retained changes plainly: “Save not confirmed. Your change is kept.” Keep explicit retry/reconciliation and show which edit needs attention.
- [x] Simplify List access into backup key, use a key, and other devices. Add Copy with a selectable-text fallback; distinguish creating from replacing a key. Keep this user-opened rather than adding backup reminders.
- [x] Make Upload a song an explicitly opened inline section. Show supported formats before selection and distinguish Uploading → Processing → Review → Add to my list.
- [x] Keep upload cancellation calm; confirm replacement only when another file would discard meaningful draft work. Preserve read-only recovery of uncertain uploads.

**Implementation:** `web/preparation-panel.ts`, `web/preparation-controller.ts`, `web/upload-panel.ts`, `web/style.css`. Reuse controllers, disclosures, saved-entry semantics and native confirmation. Keep storage schemas unchanged.

**Done when:** list editing, history and recovery are usable at phone width; compact mode exposes unresolved problems. Upload completion is visibly different from saving. Refresh, removal/undo and recovery preserve acknowledged songs and retained edits without autoplay.

**Audit links:** L02–L04, L06–L10, U01–U05. L05's additional announcements/touch-drag implementation are excluded; existing move buttons remain the phone interaction.

## Batch 5 — Hosting

Implemented: empty-room invitations, metadata-free playback status, top invitation anchor/copy fallback, Manage people, guarded skip/current-person removal and action feedback. The focused 30-person browser journey passes.

**Outcome:** the host sees the next useful action, even with a long roster.

- [x] Empty room: lead with Invite people and any required setup link. Omit empty statistics and irrelevant playback controls.
- [x] Active room: show current person, metadata-free Choosing a song / Playing / Paused / Unavailable status, next person and volume. Consolidate participant counts.
- [x] Keep an Invite link near the top that jumps to the invitation section. Add Copy join link with selectable-URL fallback; retain QR and Open display.
- [x] Rename advance to Skip turn. Confirm stopping/passing when audio is active or paused, using authoritative state and existing stale-action guards.
- [x] Show move/remove tools only in Manage people mode. Confirm removing the current participant with its actual consequence.
- [x] Give the page a clear Host desk title and concise action feedback.

**Implementation:** host rendering in `web/main.ts`, shared styles, and a minimal metadata-free playback status in `src/model.ts`/`src/engine.ts` if required. Use an anchor for invitation access and the existing host mutations.

**Done when:** invitation access takes one action from the top with 0, 1 or 30 people. Playing/paused skipping and current-person removal are deliberate. Host responses and DOM contain no private music.

**Audit links:** H01–H06 (ordinary structure/feedback portions). Native sharing and a separate invitation modal are excluded.

## Batch 6 — Setup and recovery

Release **0.3.12** fixes the speaker picker for empty/offline inventories and removes unavailable saved speakers from its choices. Release verification: build/typecheck, **227 backend/controller tests** and all **111 Chromium workflows** passed, including read-only rediscovery and stale-selection rejection.

The 0.3.10 release combines automatic speaker selection with corrected 160px Music Assistant thumbnails and reveal-gated 1024px display covers. Release verification: build/typecheck, 227 backend/controller tests and all 104 Chromium workflows passed.

Implemented: ordered setup and healthy connection summaries, an always-visible speaker selector with automatic application, local speaker retry, sign-in cancellation/expiry, address-change confirmation, ownership-based blocked controls and read-only stale-tab revalidation. Focused browser checks cover draft preservation, blocked settings and sign-in states; backend cancellation invalidates the callback without replacing saved configuration.

**Outcome:** first setup is a short page; a working installation shows summaries.

- [x] Organise settings as Music connection → Speaker → Guest access. Keep host navigation in the menu rather than a duplicate footer link. Expand incomplete connection setup and show a healthy connection as a summary with Change.
- [x] Distinguish saved credentials from confirmed health. Keep Reconnect, manual tokens and disconnect secondary unless needed.
- [x] Keep the Speaker or group menu visible in its card and list only available speakers from successful discovery. Label unavailable/unchecked saved speakers separately, show an explicit empty state, and retain Find speakers again for read-only recovery. Apply changed selections automatically with pending/error feedback, restore the saved selection only when it remains available, and disable changes during owned playback. No Change/Save speaker buttons.
- [x] Make sign-in states explicit: waiting, connected, cancelled and expired. Preserve working configuration when sign-in is cancelled.
- [x] Separate guest sharing from uploaded-file networking. Keep manual address overrides under Advanced; show the old/new link and cookie-access consequence before an origin change.
- [x] Explain playback-blocked changes beside the affected control, with a return link. Use existing ownership facts or a small server-provided status rather than inferring from button state.
- [x] Shorten playback recovery to what may still be playing, what recovery will do and its explicit action. Preserve current ownership checks and confirmation.
- [x] Apply one prioritised room-level connection notice and local task errors. On returning to a stale tab, revalidate with reads; never replay writes.

**Implementation:** `web/settings.ts`, `web/addressing-panel.ts`, existing request/connection handling and minimal safe backend status additions where necessary. Keep the current authorization/discovery flows and inline forms.

**Done when:** test fresh, healthy, disconnected, no-speaker, failed-discovery and playback-blocked states. Healthy setup requires no unnecessary saves/reconnects. Read-only retry preserves drafts and cannot change speakers or start sound.

**Audit links:** C01–C09, P06–P07, V05/V09. Speaker naming in participant/host controls uses only an explicitly role-safe server field if included.

## Batch 7 — Finish and verify

Implemented: Home/Join entry copy, route titles/record favicon/theme colour, themed HTML errors with JSON API errors preserved, linked display QR/URL and larger essential display labels. Removed obsolete turn-chip/stat/finish-strip styles. Responsive captures reviewed and existing presentation assertions reconciled with the new disclosures and labels.

**Outcome:** complete the small remaining surfaces and verify the whole simplified application.

- [x] Simplify Home to Join room, My music, Room display and secondary Host desk, with existing authoritative membership checks on entry. Add one short explanation on Join.
- [x] Use useful route titles, the existing record icon and matching browser theme colour. Keep private track names out of titles/history.
- [x] Provide small themed page-not-found and wrong-address/error pages with a concrete next link. Preserve JSON for API errors.
- [x] Keep the public display's stage. Make its QR clickable with a quiet join-link fallback; tune current/next and essential secondary text for across-room readability.
- [x] Use the compact shared header and existing Full screen for display presentation. Keep the current record animation/reduced-motion behaviour.
- [x] Consolidate redundant CSS encountered across completed batches and align common headings, buttons and notices. Add shared helpers only for repeated, stable patterns.
- [x] Run the complete join → search → save → play → reveal → finish journey, host setup/invite/manage journey and upload/recovery journey, including long content and a returning tab.

**Implementation:** `web/main.ts`, `web/index.html`, `web/public-room.ts`, shared styles, and existing HTTP/address fallback handlers. Keep this a finishing pass, not a framework or rendering rewrite.

**Done when:** build, typecheck and complete unit/browser suites pass; review representative 320px, 390px, tablet, desktop and display layouts with long content and short phone heights. Record remaining real-device observations separately from confirmed automated results.

**Audit links:** G04–G05/G09, J01, D02–D03, V01/V10 (visual consistency portions).

### Final verification — 18 October 2026

- `npm run build` and `npm run typecheck` — passed.
- `npm test` — **195 passed**.
- Complete Chromium suite (`npx playwright test --workers=2`) — **79 passed**, including all existing flows and nine new simplified-flow checks.
- `git diff --check` — passed.
- Reviewed local captures at 320px and 390px phone widths, 390×440 short height, 999px tablet, 1440px desktop and 1366×768 display. Geometry checks also cover 1920×1080 display and other intermediate widths, long music/nicknames, one private list, and 30-person invitation access.
- Verified exact-source choices, private role boundaries, reveal gating, explicit playback/replacement, uncertain-save retention, recovery, upload review, Ingress, sign-in cancellation and read-only retries.
- New screenshots are ignored under `test-results/`; the only tracked PNG is the existing application `icon.png` asset.

Physical phone keyboards, touch behaviour and across-room TV readability remain real-device observations for the owner; the checks above use isolated synthetic services and Chromium. Release 0.3.0 uses the tagged image-publication workflow; public amd64/arm64 image verification precedes the store-branch update. Installation is a separate step.

### Owner testing follow-up — 0.3.1, 18 October 2026

- New search, artist and album results show their beginning below sticky controls; Back/Forward retains each list's previous position.
- Volume stays visible in the player; the generic “Updating player…” message and its controller getter are removed.
- The participant player remains visible at a stable size through idle, starting, playing, paused, stopped and waiting states. Pass/Finish turn stays in the player, and unavailable controls remain in place but disabled.
- Playback-only updates preserve the existing search/list DOM. Long titles, artist artwork and track replacement do not shift the workspace; starting feedback uses the existing status line.
- Release verification: build/typecheck, **195 unit/controller tests**, **86 Chromium workflows**, and `git diff --check` pass. Seven new browser cases cover list/history scrolling and player geometry at desktop, phone and short-height sizes. Screenshots remain ignored local artifacts.

### Layout consistency follow-up — 0.3.2, 18 October 2026

- Top-align the participant's private list with the persistent player in the same desktop grid.
- Share workspace dimensions between host, settings and participant pages: 1320px desktop container, 360px sidebar, 22px gaps; below 1100px, use a single column capped at 720px with 18px side padding and 14px gaps.
- Align interactive-page headers, host/settings headings, card surfaces and spacing; remove conflicting per-page width and breakpoint overrides.
- Release verification: build/typecheck, **195 unit/controller tests**, **86 Chromium workflows**, and `git diff --check` pass. Reviewed desktop/mobile captures; existing layout checks now verify matching host/settings column geometry and the shared responsive breakpoint. Screenshots remain ignored.

## Explicitly deferred or excluded

- **New product capabilities:** self-leave/rename and duplicate-name management (J05–J06), album search (S12), discussion hold/changed natural ending (P08), display wake lock (D05).
- **Extra navigation/persistence:** restoring transient searches across full route navigation/reload (G08); Back within the active browse flow is included in Batch 3.
- **Additional interaction machinery:** custom confirmation dialogs (V08), phone drag-and-drop (L05), a separate presentation mode (D01), animation-off setting (D04), native Share, bottom sheets, duplicate mini-players and backup prompts.
- **Unproven optimisations:** cross-query saved-result matching (S10), pagination/virtualisation (S11), general keyed-DOM/rendering rewrites or a performance project (V07). Investigate only if implementation or realistic checks expose a concrete blocker.
- **Accessibility-specific follow-up:** dedicated portions of V02–V04/V06/V10, H06 and D06, plus specialist audits and device/assistive-technology research. Preserve existing controls, focus/caret behaviour and reduced-motion support while doing the scoped redesign.

## Batch completion and progress tracking

- Work in order, completing and verifying one batch before opening the next. Batch 2 establishes the shared layout; Batches 3–4 fill it out; Batches 5–6 simplify host tasks; Batch 7 finishes the application.
- Update checkboxes and the roadmap after each batch. Record changed behaviour, verification results and any specifically deferred item. A related audit ID is complete only when its agreed scope is delivered.
- Use realistic synthetic data in the application itself, rather than a separate prototype codebase. Review phone/desktop captures for substantial layout changes.
- Run build/typecheck and relevant existing tests. Add regression coverage for meaningful state/history/privacy/playback behaviour; update obsolete presentation expectations intentionally. Avoid tests for every label or CSS property.
- Broaden to the full suite for shared/state changes and final completion. Real-device phone/display observations supplement these checks; no accessibility certification or research gate is required.

## Delivery guardrails

Retain the permanent room, private lists and exact sources, server-confirmed reveal, deliberate playback, retained uncertain writes, and existing role boundaries. Test against isolated synthetic services and data. Update this log with each completed batch and its actual check results.
