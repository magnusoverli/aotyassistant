# UI/UX implementation progress

Started 18 October 2026. Source: [UI/UX audit](ui-ux-audit.md) and [reproductions](ui-ux-audit-evidence.md).

**Latest milestone:** Batch 1 completed and verified on 18 October 2026. Remaining work replanned into **six batches (2–7)** following the owner's direction to simplify implementation and user flows. Accessibility-specific work is outside the remaining scope.

**0.2.9 release checkpoint:** the owner requested a testable release before continuing. Release scope is the completed Batch 1. Initial Batch 2 edits are saved locally in `/tmp/opencode/aoty-batch2-in-progress.patch` (with a source snapshot alongside it) for resumption after this checkpoint. Screenshots are local/ignored artifacts, not tracked deliverables.

Release checks rerun at version 0.2.9: build/typecheck, 194 unit/controller tests and all 70 Chromium browser tests passed. Publication uses the `v0.2.9` workflow, with the store manifest pushed after image availability is verified.

## Delivery plan

This sequence supersedes the audit's four implementation phases and the earlier estimate of 7–9 remaining batches. The audit remains supporting evidence, not a requirement to implement all 90 recommendations. Scope below is deliberate; related audit IDs do not imply every sub-suggestion will be implemented.

| Batch | Status | Outcome |
| --- | --- | --- |
| 1 — Confirmed defects | Complete | Trustworthy status, recovery, independent search, consistent replacement, cross-tab list discovery |
| 2 — Participant workspace | Next | One compact mobile layout for waiting, choosing and playing |
| 3 — Finding music | Pending | Clear results, source choices and predictable Back navigation |
| 4 — Keeping music | Pending | Simple list management, uploads and recovery |
| 5 — Hosting | Pending | Invite people, see the current turn, manage the order |
| 6 — Setup and recovery | Pending | Short first setup and calm connected summaries |
| 7 — Finish and verify | Pending | Cohesive entry/display/error pages and end-to-end verification |

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

S09 is **partially addressed**: complete failures now have task-local Retry and retain the existing distinction from empty results. Shortened coverage copy and preserved explanatory disclosures remain pending.

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

**Outcome:** the phone screen immediately communicates whose turn it is and what to do next.

- [ ] Compact the shared header and adopt **My music / Room display / Host desk / Settings**. Put Full screen in the menu outside the display.
- [ ] Use one turn summary: “Sam’s turn · You’re next” or “Your turn”, with a Listening order disclosure. Remove the participant's duplicate header turn chip and seat-heavy summary.
- [ ] Build waiting, idle-current and playing layouts together. Keep search and list available in all three states.
- [ ] Replace the mobile list card with one summary row: count, next pick when space permits, and Open. Empty lists take one line. Expanding reveals the existing list in normal page flow.
- [ ] Let the mobile header scroll away. Only the collapsed list companion may stick while browsing; unstick it on short screens. Keep the expanded list nonsticky. Retain the desktop supporting pane with a content-driven breakpoint.
- [ ] Use the same companion for a quiet “Your turn · Go to player” link when appropriate. Keep one player; no second transport strip, bottom sheet or forced scrolling.
- [ ] Player hierarchy: song → Pause/Resume → Reveal song → secondary Finish turn. Show Hidden on room display / Revealing… / Visible on room display. Keep volume in a small disclosure on phones.
- [ ] Place Pass turn beside the idle turn summary. During playback, explain briefly that Finish stops the song and passes the turn. Keep replacement confirmation from Batch 1.
- [ ] Remove the empty Results panel before searching. Apply readable type and consistent spacing to these touched components.

**Implementation:** `web/app-header.ts`, `web/navigation.ts`, `web/main.ts`, `web/visuals.ts`, `web/preparation-panel.ts`, `web/style.css`. Retain one preparation panel/controller and one player controller; use classes and small render helpers for state differences.

**Done when:** at 390×844 the ordinary waiting/search view exposes the first useful result and action without a full list card ahead of it. Aim for a 56–72px header and 56–88px collapsed companion, allowing text to grow. At 320px and short landscape heights, actions remain reachable. Turn changes preserve browsing and never start music.

**Audit links:** G01–G02, W01/W03–W08, L01–L03, P01/P03–P05, V01/V03/V04 (ordinary phone usability only).

## Batch 3 — Finding music

**Outcome:** find an artist, open an album, choose a song and return without losing context.

- [ ] Label modes Artists / Songs; use a mode-specific search hint and phone Search key.
- [ ] Simplify rows to artwork, title/name, necessary supporting identity and actions. Keep distinguishing version/source information visible where it affects the choice.
- [ ] Give artist and album rows one clear browse action. Keep any source selector separate.
- [ ] Replace matching jargon with “Choose a source” and friendly service names. Use existing safe edition/availability details when available; require the same exact source selection as today.
- [ ] Support browser Back/Forward through search → artist → album. Retain query, selected source and per-level scroll within the current document.
- [ ] Keep a small in-memory browse stack; browser history stores only a local entry key. Clear invalid snapshots when membership/catalogue identity changes. Reload uses a fresh workspace; server validation still governs expired results.
- [ ] Finish local loading/error/empty states. Keep partial-source caveats under Details, preserve its open state, and provide explicit read-only Retry where useful.

**Implementation:** `web/main.ts`, `web/catalogue-controller.ts`, `web/catalogue-sources.ts`. Add a narrowly scoped browse-history helper if needed; use the existing page routing and catalogue lifetime rules.

**Done when:** both in-page and browser Back restore the previous browse level and position; pending/failed requests cannot replace a newer catalogue context. Ambiguous recordings still require a source choice, and no operation silently substitutes a recording.

**Audit links:** S02–S07, S09. S08 is already complete.

## Batch 4 — Keeping music

**Outcome:** save, arrange, upload and recover songs with minimal management UI.

- [ ] Keep upcoming songs as the main list. Use “Your next pick” and contextual “Play this song”; while waiting show “Ready for your turn” rather than a prominent disabled Play action.
- [ ] Keep Edit order with existing move controls. Show removal feedback with nearby Undo; label history actions Add back and explain when they append to the end.
- [ ] Put History and List access in separate inline disclosures below the upcoming list, outside its desktop scroll container.
- [ ] Keep a short Needs attention indicator in the collapsed companion for failed saves, unavailable sources or uncertain playback, opening the existing explanation.
- [ ] Explain retained changes plainly: “Save not confirmed. Your change is kept.” Keep explicit retry/reconciliation and show which edit needs attention.
- [ ] Simplify List access into backup key, use a key, and other devices. Add Copy with a selectable-text fallback; distinguish creating from replacing a key. Keep this user-opened rather than adding backup reminders.
- [ ] Make Upload a song an explicitly opened inline section. Show supported formats before selection and distinguish Uploading → Processing → Review → Add to my list.
- [ ] Keep upload cancellation calm; confirm replacement only when another file would discard meaningful draft work. Preserve read-only recovery of uncertain uploads.

**Implementation:** `web/preparation-panel.ts`, `web/preparation-controller.ts`, `web/upload-panel.ts`, `web/style.css`. Reuse controllers, disclosures, saved-entry semantics and native confirmation. Keep storage schemas unchanged.

**Done when:** list editing, history and recovery are usable at phone width; compact mode exposes unresolved problems. Upload completion is visibly different from saving. Refresh, removal/undo and recovery preserve acknowledged songs and retained edits without autoplay.

**Audit links:** L02–L04, L06–L10, U01–U05. L05's additional announcements/touch-drag implementation are excluded; existing move buttons remain the phone interaction.

## Batch 5 — Hosting

**Outcome:** the host sees the next useful action, even with a long roster.

- [ ] Empty room: lead with Invite people and any required setup link. Omit empty statistics and irrelevant playback controls.
- [ ] Active room: show current person, metadata-free Choosing a song / Playing / Paused / Unavailable status, next person and volume. Consolidate participant counts.
- [ ] Keep an Invite link near the top that jumps to the invitation section. Add Copy join link with selectable-URL fallback; retain QR and Open display.
- [ ] Rename advance to Skip turn. Confirm stopping/passing when audio is active or paused, using authoritative state and existing stale-action guards.
- [ ] Show move/remove tools only in Manage people mode. Confirm removing the current participant with its actual consequence.
- [ ] Give the page a clear Host desk title and concise action feedback.

**Implementation:** host rendering in `web/main.ts`, shared styles, and a minimal metadata-free playback status in `src/model.ts`/`src/engine.ts` if required. Use an anchor for invitation access and the existing host mutations.

**Done when:** invitation access takes one action from the top with 0, 1 or 30 people. Playing/paused skipping and current-person removal are deliberate. Host responses and DOM contain no private music.

**Audit links:** H01–H06 (ordinary structure/feedback portions). Native sharing and a separate invitation modal are excluded.

## Batch 6 — Setup and recovery

**Outcome:** first setup is a short page; a working installation shows summaries.

- [ ] Organise settings as Music connection → Speaker → Guest access, ending with a Host desk link. Expand the incomplete step and show healthy steps as summaries with Change.
- [ ] Distinguish saved credentials from confirmed health. Keep Reconnect, manual tokens and disconnect secondary unless needed.
- [ ] Show the saved speaker by default. Save speaker is enabled only for a changed selection. Add local Find speakers again with pending/error feedback.
- [ ] Make sign-in states explicit: waiting, connected, cancelled and expired. Preserve working configuration when sign-in is cancelled.
- [ ] Separate guest sharing from uploaded-file networking. Keep manual address overrides under Advanced; show the old/new link and cookie-access consequence before an origin change.
- [ ] Explain playback-blocked changes beside the affected control, with a return link. Use existing ownership facts or a small server-provided status rather than inferring from button state.
- [ ] Shorten playback recovery to what may still be playing, what recovery will do and its explicit action. Preserve current ownership checks and confirmation.
- [ ] Apply one prioritised room-level connection notice and local task errors. On returning to a stale tab, revalidate with reads; never replay writes.

**Implementation:** `web/settings.ts`, `web/addressing-panel.ts`, existing request/connection handling and minimal safe backend status additions where necessary. Keep the current authorization/discovery flows and inline forms.

**Done when:** test fresh, healthy, disconnected, no-speaker, failed-discovery and playback-blocked states. Healthy setup requires no unnecessary saves/reconnects. Read-only retry preserves drafts and cannot change speakers or start sound.

**Audit links:** C01–C09, P06–P07, V05/V09. Speaker naming in participant/host controls uses only an explicitly role-safe server field if included.

## Batch 7 — Finish and verify

**Outcome:** complete the small remaining surfaces and verify the whole simplified application.

- [ ] Simplify Home to Join room, My music, Room display and secondary Host desk, with existing authoritative membership checks on entry. Add one short explanation on Join.
- [ ] Use useful route titles, the existing record icon and matching browser theme colour. Keep private track names out of titles/history.
- [ ] Provide small themed page-not-found and wrong-address/error pages with a concrete next link. Preserve JSON for API errors.
- [ ] Keep the public display's stage. Make its QR clickable with a quiet join-link fallback; tune current/next and essential secondary text for across-room readability.
- [ ] Use the compact shared header and existing Full screen for display presentation. Keep the current record animation/reduced-motion behaviour.
- [ ] Consolidate redundant CSS encountered across completed batches and align common headings, buttons and notices. Add shared helpers only for repeated, stable patterns.
- [ ] Run the complete join → search → save → play → reveal → finish journey, host setup/invite/manage journey and upload/recovery journey, including long content and a returning tab.

**Implementation:** `web/main.ts`, `web/index.html`, `web/public-room.ts`, shared styles, and existing HTTP/address fallback handlers. Keep this a finishing pass, not a framework or rendering rewrite.

**Done when:** build, typecheck and complete unit/browser suites pass; review representative 320px, 390px, tablet, desktop and display layouts with long content and short phone heights. Record remaining real-device observations separately from confirmed automated results.

**Audit links:** G04–G05/G09, J01, D02–D03, V01/V10 (visual consistency portions).

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
