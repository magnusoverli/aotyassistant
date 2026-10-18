# Complete UI/UX audit — Albums of the Year

**Reviewed:** 18 October 2026 · **Application:** 0.2.8 · **Code baseline:** `b33c266`

**Scope:** the entire implemented web application, including joining, private preparation, playback, the public display, hosting, connections, addresses, and recovery.

**Deliverable:** investigation and recommendations only. No application behaviour, styling, configuration, or production data was changed.

Subsequent implementation is tracked in the [implementation progress log](ui-ux-implementation.md).

## Read this first

**Keep the forest-green, cream, and warm-gold identity. Redesign the hierarchy around it.** The application already has a strong atmosphere and unusually careful privacy and playback safeguards. It does not need a new visual identity, a component-library skin, or a framework rewrite. It needs to make its sophisticated internal model feel simple to the people using it.

The central problem is that **too many supporting elements have the visual weight of primary tasks**. On a phone, a participant passes a two-row header, turn heading, seating summary, search card, upload action, and sticky private-list card before reaching results. During playback, another substantial card is added. Small text compensates for this density instead of the interface making clearer choices about what matters.

The target experience should feel like this:

> Scan → enter your name → choose music privately → know when it is your turn → play deliberately → reveal deliberately → pass the turn.

For the host:

> Connect music → choose a speaker → share the room → manage people, not songs.

### The ten highest-value changes

| Order | Recommendation | Why it matters |
| --- | --- | --- |
| 1 | Replace the large mobile sticky list with a compact, useful companion; put results immediately after search. | This gives the largest improvement to the everyday task: finding music. Keep the list available, not dominant. |
| 2 | Make the mobile header one compact row, with one turn-status location. Put Full screen in the menu outside the display. | Recover screen space without shrinking touch targets or removing useful status. |
| 3 | Design the participant workspace explicitly for waiting, ready-to-play, and playing states. | The next action should be obvious without hiding search or losing preparation. |
| 4 | Make status truthful: replace hard-coded `LIVE · SONOS` and idle “is sharing” wording. | “Connected”, “speaker selected”, and “playing” are different facts. |
| 5 | Make source choices understandable without exposing identity-matching terminology. | Preserve exact-recording safeguards; stop making users learn the implementation. |
| 6 | Treat active-track replacement consistently, whether started from results or the private list. | Direct result Play currently bypasses the replacement confirmation used by Play next. |
| 7 | Make hosting state-dependent: invitations first in an empty room; current turn and order first during use. | On a phone, the joining QR/link is otherwise below the roster—even when nobody has joined. |
| 8 | Turn settings into a short setup path and a calm connected summary. | A healthy connection currently gives Reconnect more visual prominence than its successful state. |
| 9 | Raise essential text sizes and strengthen control boundaries, while preserving the palette. | Readable does not mean crowded. Remove secondary information rather than miniaturising it. |
| 10 | Make recovery and failures task-local, actionable, and visible in compact layouts. | Safety is already strong; the explanation and recovery path should be equally strong. |

These are recommendations, not ten independent cosmetic tickets. Items 1–3 should be prototyped together; items 4–6 are correctness/trust improvements that should not wait for a redesign.

**Fix confirmed defects alongside the design work:** menu-obscured keyboard focus, misleading playback readiness, missing recovery on the QR entry route, inconsistent track-replacement confirmation, search disabling Finish, and stale first-save state in another open tab. [Reproduction details](ui-ux-audit-evidence.md#4-confirmed-interaction-findings-and-reproduction) make these independently actionable.

## Contents

1. [Method, evidence, and limitations](#1-method-evidence-and-limitations)
2. [What should be preserved](#2-what-should-be-preserved)
3. [User journeys and mental model](#3-user-journeys-and-mental-model)
4. [Recommended information architecture and layouts](#4-recommended-information-architecture-and-layouts)
5. [Complete recommendation register](#5-complete-recommendation-register)
6. [Terminology and example copy](#6-terminology-and-example-copy)
7. [Visual system: theme, typography, spacing, components](#7-visual-system-theme-typography-spacing-components)
8. [Modern techniques worth using—and avoiding](#8-modern-techniques-worth-usingand-avoiding)
9. [Implementation sequence](#9-implementation-sequence)
10. [Acceptance criteria and user research](#10-acceptance-criteria-and-user-research)
11. [Research references](#11-research-references)

## 1. Method, evidence, and limitations

### What was investigated

- Every frontend module in `web/`, the complete stylesheet, all six HTML routes, and relevant server-side validation, state, authorization, and error responses.
- Existing design decisions in `docs/participant-workspace.md`, `docs/persistent-room.md`, preparation/upload/addressing documentation, and the browser tests. Historical mockups were not treated as the current application.
- The application built from this checkout, using isolated temporary data and synthetic Music Assistant/speakers. No real music service, speaker, deployed room, or user library was modified.
- Existing functional tests, additional browser walkthroughs, rendered screenshots, DOM measurements, automated accessibility checks, keyboard behaviour, and text/viewport stress tests.
- Established usability guidance, WCAG 2.2, adaptive-layout patterns, and current browser-native implementation options. References are linked at the end; proposed design choices are distinguished from standards.

### Verification baseline

- `npm run build`: passed.
- `npm run typecheck`: passed.
- `npm test`: **193 passed**.
- Existing Playwright browser suite: **63 passed** in Chromium.

Passing these tests is valuable evidence of functional reliability, **not proof of excellent usability or accessibility compliance**. Several tests deliberately assert the current hierarchy, labels, sizes, and layout; an approved redesign must update those presentation assertions while retaining the privacy and playback guarantees.

Additional measurements, representative screenshots, coverage, and accessibility observations are recorded in [the evidence appendix](ui-ux-audit-evidence.md).

The register contains **90 recommendations**. It includes confirmed interaction defects as well as proposed refinements; its length is a record of coverage, not a suggestion to add 90 new features.

### How to interpret findings

- **Observed:** reproduced in the isolated running application or measured from its rendered interface.
- **Code:** confirmed in the implementation, but not necessarily reproduced on every browser/device.
- **Validate:** a design hypothesis or a real-device/user-research question, not a proven defect.
- **P1:** core task, trust, error prevention, or significant accessibility issue.
- **P2:** important clarity, efficiency, and consistency improvement.
- **P3:** refinement or optional capability after the foundations improve.
- **Effort:** S = local copy/style/component change; M = coordinated UI/state work; L = new product/API capability or substantial interaction work. These are relative sizes, not delivery estimates.

### Limits of this investigation

This is a comprehensive **expert/code/browser audit**, not a study with actual party guests. Chromium rendering does not prove Safari/iPhone keyboard, VoiceOver, TalkBack, TV-remote, native file-picker, or real-speaker behaviour. Simulating a short viewport is not equivalent to opening an iPhone keyboard. Synthetic catalogue artwork and responses do not represent every provider. Recommendations involving new capabilities or changed turn semantics need explicit product approval.

No claim is made that every combination of all states has been physically tested, or that the application is WCAG-conformant. Accessibility findings from automated checks require interpretation; manual issues such as faint input boundaries may not be caught by those checks at all.

## 2. What should be preserved

1. **The palette and mood.** Dark evergreen surfaces, warm gold actions, cream text, restrained record imagery: this is distinctive and appropriate for a shared listening evening.
2. **One permanent room.** No event creation, admission process, Start/End lifecycle, expiring invitation, or display authorization to explain.
3. **A nickname-only join.** No account, music-service login, or installation for guests.
4. **Separate jobs for participant, host, and display.** Do not make the host manage private music or turn the public display into an administration dashboard.
5. **Private preparation with durable saves.** Keep acknowledged Saved states, retained uncertain changes, reversible removal, history, and recovery.
6. **Deliberate audio actions.** Joining, searching, saving, expanding, reconnecting, restoring, changing speakers, or opening the display must never play music.
7. **Exact recordings and sources.** Do not improve “ease of use” by silently substituting providers, versions, or recordings.
8. **Server-confirmed public reveal and privacy filtering.** Do not merely hide private metadata with CSS or put it into a public page’s DOM, accessibility tree, cached response, or transition snapshot.
9. **The shared header implementation.** Centralised navigation, Escape dismissal, skip navigation, and a stable mounted header are good foundations. Shared implementation need not mean identical prominence on every role and screen.
10. **The public display’s restraint.** Large music artwork, current-first names, a quiet QR, stable record motion, no fake audio meter, and reduced-motion support are already strong.
11. **The ability to prepare while waiting or playing.** A redesign must not return to mutually exclusive search/list tools or reset a person’s browsing when their turn changes.
12. **Existing resilience work.** Turn/destination identity checks, optimistic private controls, no automatic retry of audio writes, preserved source failures, and fail-closed recovery are essential UX foundations, not technical clutter to remove.

## 3. User journeys and mental model

### 3.1 What users need to understand

There are only four essential concepts:

1. **The room:** the shared listening space and its display.
2. **Your turn:** who may play now, and how soon you are next.
3. **Your private list:** songs you may choose later; not the speaker queue and not an autoplay playlist.
4. **The reveal:** making the current song’s identity public on the display.

“Seat”, “circle”, “rotation”, “prepared choice”, “catalogue identity”, “source binding”, “destination”, and “recovery” are supporting concepts. They should not compete with those four in the primary interface.

### 3.2 Journey review

| Journey | Current strength | Friction / missing reassurance | Recommended outcome |
| --- | --- | --- | --- |
| Open `/` | A simple entry point exists. | It offers display/join buttons, refers to My seat without an equivalent body action, hides host access in Menu, and uses a different serif heading treatment. | A small, explicit role chooser: Join room, Open display, and a secondary Host desk link. Returning participation should be easy to resume. |
| Scan the joining QR | Permanent link; one name field. | No short explanation of the listening/reveal model. `/join` does not expose the optional recovery tools available at unjoined `/participant`. | One name form, one short functional explanation, optional saved-list recovery on both entry routes. No track previews before joining. |
| First person joins | Immediately obtains the first turn; no audio starts. | Lands in a full workspace with multiple primary-looking choices, an empty list card, and Finish my turn far below the work. | “Your turn” plus an obvious search/choose action and a small Pass turn action. |
| Join while someone else has a turn | Preparation is available immediately; up-next information is authoritative. | Repeated turn/seat status; “is sharing” even when idle; prominent private-list space before any results. | One compact turn summary, search first, a compact private-list companion. |
| Find an artist, album, song | Artist-first browsing and track search both work. | Source ambiguity, jargon, repeated metadata, deep browsing without browser-history integration, and results below unrelated cards. | Familiar artist → album → songs navigation; explicit but legible source choice; retained query and scroll on backtracking. |
| Save and order music | Durable, private, no autoplay; keyboard reorder alternatives exist. | Collapsed mobile rows conceal important details; history/recovery share a scroll container with the list; next-song labelling resembles a queue. | A clear private list, obvious next personal choice, compact preview, normal access to management and recovery. |
| Upload a song | Progress, metadata review, durable save, and cancellation are implemented. | Upload expands inside the search card, pushing everything below it; supported formats appear after file selection; cancellation language can sound like an unexpected failure. | A focused upload subflow with honest Uploading → Processing → Review → Add states, without obstructing search. |
| Your turn arrives while browsing | State updates without autoplay; query and scroll are preserved. | A top-of-page player/heading can be out of sight while the participant is deep in results. | A polite, visible, non-blocking “Your turn” cue with Go to player/Play next; never force-scroll. |
| Play, pause, reveal, finish | Responsive optimistic controls; public state remains confirmed. | Large player; competing Play/Play next actions; direct replacement differs from prepared replacement; Finish is beside Pause; no compact access after scrolling away. | A clear current-song hierarchy, consistent replacement guard, accessible compact controls, deliberate reveal and finish. |
| Song ends naturally | Advances exactly once and never autoplays the next song. | The room immediately conceals/clears the previous track. A late reveal or discussion moment can be missed. | Explain current behaviour clearly; test whether a discussion hold is desired before changing the product contract. |
| Host opens an empty room | Room is immediately ready. | Disabled advance, volume and duplicate zero-count summaries precede invitations on mobile. | Lead with Invite people and setup readiness. |
| Host manages an active room | Current person, ordering/removal, and volume are available. | Skip wording is long; no explicit current playback status; every row exposes administration controls; QR is buried on a long phone roster. | Current/next/status first; explicit invitation access; edit-order mode; guarded consequential actions. |
| Connect music and speakers | Browser sign-in and automatic discovery avoid token editing. | Configured is not health; primary Reconnect remains visible when healthy; no clear setup-complete handoff to sharing the room. | Connect → speaker → guest access → ready, then concise summaries with Change/Troubleshoot. |
| Recover from a failed save/play/connection | Existing work is kept; writes are not blindly replayed. | Technical wording, multiple banners, uncertainty about what was affected, and actions inside bounded/hidden regions. | One prioritised, task-local explanation: what happened, what was kept, and the safe next action. |
| Return on another day/device | Room and private list are durable. | Persistent membership may leave departed people in the order; no self-leave/rename flow; recovery success does not clearly tell the unjoined visitor what to do next. | Explain persistence, provide self-service participation management if approved, and acknowledge recovery before asking the person to join. |

### 3.3 Product decisions—not styling fixes

- **Natural completion:** retain automatic advancement for now. Investigate whether people want the revealed album to remain visible during discussion. A hold-to-discuss mode would affect turn/reveal semantics and cannot be slipped into a visual cleanup.
- **Self-service participation:** Leave room and Change name would reduce host housekeeping in a permanent room. These need dedicated, membership-authorised API behaviour; do not expose generic host mutations as the implementation shortcut.
- **Mobile list model:** prefer a compact inline companion first. Compare an optional list sheet only if testing shows users need a separate management surface. Do not assume a bottom sheet is inherently better or undo the useful combined workspace.
- **Host access:** it is intentionally open on a trusted LAN. Navigation grouping can reduce accidental administration, but is not authentication. Do not add accounts or reinstate repeated security banners as part of this audit’s proposed redesign.

## 4. Recommended information architecture and layouts

### 4.1 Navigation

Use one vocabulary consistently:

- **My music** — participant workspace. “My seat” is atmospheric but does not describe search, saved songs, and playback.
- **Room display** — `/display`, clearly distinct from joining the room.
- **Host desk** — people, turns, invitations, volume.
- **Settings** — the host’s music connection, speaker, and guest access.

Keep existing URLs; terminology improvements do not require route migrations. Group participant/display links first in a guest’s menu and host/settings under a quiet Host tools heading. Reverse the emphasis for the host. All remain reachable because open hosting is intentional.

### 4.2 Mobile: waiting and preparing

Conceptual layout, not a pixel-perfect replacement:

```text
[record mark] Albums of the Year                 [Menu]
Sam’s turn · You’re next                     [Order ▾]

Find music
[Artists] [Songs]
[Artist name                              ] [Search]
Upload a song                                  [link]

My list · 4   Next: Northern Lights            [Open]
─────────────────────────────────────────────────────
Artists / Albums / Songs                    [count]
[art] Title
      Artist / necessary version / source
                                        [Add] [Play*]
```

`*` Play appears only when permitted. A source chooser appears where required, not as a permanent explanatory lecture. If the list is empty, use a small link/empty prompt—not a reserved two-row card. The list preview can stick while browsing, but should be around one useful row, not a second large page header.

### 4.3 Mobile: your turn / playing

```text
[compact header]
Your turn                                     [Order]

[art] Northern Lights
      The Paper Satellites
      Hidden on the room display
[progress + time]
[Pause]                              [Reveal song]
[Volume ▾]                         Finish turn [link]

[Find music and the compact list remain below]
```

Prominence changes by state: before playing, Play is primary; while hidden playback is active, Reveal is primary; after reveal, ordinary transport remains clear and Finish turn is available but separated from Pause. Volume can be a small expandable control on phones, not removed. When the player scrolls out of view, prototype a small return-to-player/control strip rather than another full card.

Do not create a fixed top header, fixed bottom navigation, sticky list, and sticky player all at once. Establish one budget for persistent chrome. In short/keyboard-height viewports, simplify or suspend nonessential stickiness rather than clipping useful content.

### 4.4 Desktop

Keep the search/results plus private-list supporting-pane structure. Use a comfortable bounded width rather than stretching short content across every available pixel. Give track identity flexible width; reserve predictable action space. The desktop private list may scroll internally when long, but history/access management should not become a hidden second application inside it.

The current 999px → 1000px switch is abrupt. Choose the two-column threshold from the minimum usable widths of the search area and list, and check the actual component width inside Home Assistant—not just the outer browser width.

### 4.5 Host

- **Empty:** Invite people + connection/speaker readiness. No oversized zero-count statistics or disabled skip hero.
- **Active:** current person, truthful playback state, next person, volume, people/order, invite access.
- **Editing:** show move/remove controls on demand, with keyboard alternatives and clear completion feedback.
- **Phone invitation:** a persistent, small Invite button opens/reveals the existing invitation section. It must not require scrolling through 30 people.

### 4.6 Settings

First setup should read as a short checklist, not a new session wizard:

1. Connect Music Assistant.
2. Choose a speaker.
3. Confirm the guest link is shareable.
4. Open Host desk / Invite people.

Completed items collapse to summaries: server identity and connection health; selected speaker; guest address. Troubleshooting, alternate addresses, tokens, and disconnect stay available secondarily. Never auto-play a “test sound”; connectivity/file checks remain explicitly non-audible.

### 4.7 Public display

Preserve the current stage. Improvements should be small: genuinely readable across-room secondary information, a clickable QR/join fallback, presentation controls that can be intentionally reduced, and a local animation-off option. Do not add upcoming songs, host controls, provider names, or private preparation.

## 5. Complete recommendation register

The register below covers every implemented interface area. Some items are deliberate strengths to refine, not bugs. Related IDs are grouped into implementation work in section 9.

### A. Global shell, navigation, and entry

| ID | Priority / effort / evidence | Finding and recommendation | Implementation anchor |
| --- | --- | --- | --- |
| G01 | P1 · M · Observed | **Reduce mobile chrome.** The rendered header is 127px tall at 390px when Full screen is supported. Full screen receives a second row even on joining/home. Use a compact one-row variant; retain one turn cue and move secondary tools into Menu. Do not simply reduce font/button sizes. | `web/app-header.ts:39–41,98–103`; `web/style.css:39–54,393–401` |
| G02 | P2 · S/M · Code | **Make navigation describe destinations.** Replace My seat with My music, Listening room with Room display, and shorten Connections & settings to Settings. Group host tools without pretending to secure them. Preserve current-page semantics and direct links. | `web/navigation.ts:14–27` |
| G03 | P1 · M · Observed + Code | **Make readiness truthful.** `LIVE · SONOS` depends only on mode, not selected speaker, health, or actual device type. It appears before a speaker is chosen. Derive a compact status from real readiness; use Music connected / Choose speaker / Reconnecting as appropriate. Reserve Playing for confirmed playback. | `web/navigation.ts:20–27`; `src/model.ts:63–74` |
| G04 | P2 · S · Observed | **Improve home routing cues.** Home repeats the brand as an oversized serif heading, combines adjacent actions, and mentions My seat without a body link. Make a deliberate, restrained role chooser with Join room primary and Display/Host secondary. Keep returning membership checks authoritative. | `web/main.ts:522–525`; `web/style.css:326–331` |
| G05 | P2 · S · Code | **Give each page a useful browser title and icon.** All pages share one `<title>` and the document declares no favicon. Use My music / Host desk / Settings / Room display plus the brand, never private track names in public/history-facing titles. Reuse the existing record icon. | `web/index.html:3–7`; `web/navigation.ts` |
| G06 | P1 · S/M · Observed + Code | **Fix the menu’s keyboard lifecycle.** Tab from the last menu link reaches the name field completely behind the open menu; Escape from that field does not close it because the handler is only on the header. Close when focus leaves the disclosure, and allow Escape from the page to dismiss it. Keep ordinary navigation links; do not add ARIA menu roles without their keyboard contract. | `web/app-header.ts:43–51,89–95` |
| G07 | P1 · S · Observed | **Fix the brand’s accessible name.** Automated checks flag the visible subtitle as missing from the fixed `Albums of the Year · Home` accessible name. Move route/nickname text outside the home link or derive a matching name without overriding visible words. Test speech-input activation. | `web/app-header.ts:31–34,62` |
| G08 | P2 · S/M · Code | **Keep route transitions understandable.** Menu navigation and the brand cause document navigation and lose transient searches. Retain non-secret browsing state where useful and restore focus/scroll intentionally. Do not keep expiring references as permanent valid playback selections. | `web/main.ts:35–48,505–537`; `web/paths.ts` |
| G09 | P1 · S/M · Code | **Use themed fallback pages.** Unknown pages and many route-level failures return JSON; the wrong-address recovery HTML has no application styling. Provide small, dependency-light, accessible HTML error/recovery pages with the same theme and correct next action. Keep API errors JSON and keep secrets out. | `src/http.ts:209–227`; `src/addressing.ts:35–42` |

### B. Joining and participant identity

| ID | Priority / effort / evidence | Finding and recommendation | Implementation anchor |
| --- | --- | --- | --- |
| J01 | P2 · S · Observed | **Explain the model once, briefly.** The join form currently gives no purpose beyond Join room. Add one functional sentence, for example “Take turns sharing a song. Your choices stay private until you reveal them.” Avoid slogans, onboarding slides, and repeated banners. | `web/join-panel.ts:5–16` |
| J02 | P1 · M · Observed + Code | **Offer recovery on the QR entry route too.** Unjoined `/participant` appends saved-list access, but `/join` does not. Make both entry routes expose the same optional recovery disclosure, without showing saved tracks or joining automatically. | `web/main.ts:483–503,556–558`; `web/preparation-panel.ts:53–69` |
| J03 | P2 · S/M · Code | **Acknowledge successful pre-join recovery.** Recovery can succeed while the page remains the same join card. Show “Your list is recovered. Enter your name to join.” without exposing titles/counts before membership. Distinguish this from a failed key. | `web/preparation-panel.ts:53–69,161–175`; `web/preparation-controller.ts:168–176` |
| J04 | P1 · S/M · Code | **Keep join validation beside the field.** Use specific nickname errors, `aria-invalid`, and an associated message instead of only a global banner. Preserve the entered name and working native form submission. A whitespace-only name should not produce the generic Invalid request message. | `web/join-panel.ts:9–15`; `src/http.ts:140–144,225`; `src/engine.ts:179–182` |
| J05 | P2 · L · Validate | **Consider Change name and Leave room.** A persistent room accumulates people; current participants cannot fix a typo or remove themselves. Add explicit self-service actions only after approving membership-authorised behaviour, current-turn handling, and private-list preservation. Closing a tab must not silently remove someone. | `web/navigation.ts`; `src/engine.ts:176–210` |
| J06 | P2 · M · Code + Validate | **Make identity clear when names match.** Identical names produce identical initials/colour and ambiguous public/host rows. Keep IDs authoritative; show “you” consistently in personal views and offer an easy display-name refinement. Do not turn nickname uniqueness into account creation. | `web/visuals.ts:4–9,52–58`; `web/main.ts:280–298` |

### C. Turn status and participant workspace

| ID | Priority / effort / evidence | Finding and recommendation | Implementation anchor |
| --- | --- | --- | --- |
| W01 | P1 · M · Observed | **Use one turn summary.** Header chip, large hero, seat/countdown, and Circle repeat overlapping information. Combine current person + your distance in one calm region, with a stronger variation only for Your turn. Keep an accessible live announcement. | `web/main.ts:179–185,305–315`; `web/visuals.ts:34–44` |
| W02 | P1 · S/M · Observed | **Do not claim idle people are sharing.** The hero says “Alex is sharing” and the header tooltip says “currently sharing” based only on current turn. Use “Alex’s turn” while idle/unavailable; Sharing/Playing only when warranted by confirmed state. | `web/main.ts:312`; `web/navigation.ts:23` |
| W03 | P2 · S · Observed | **Replace Circle ↕ and de-emphasise seat numbers.** A ↕ symbol suggests reordering, not disclosure, and “seat” suggests a physical chair. Use Listening order with a chevron, and prioritise You’re next / N turns away over an absolute position. Never invent an ETA from concealed durations. | `web/visuals.ts:41–44`; `web/style.css:225–249` |
| W04 | P1 · M · Observed | **Put results next to their task.** On mobile, the full private-list companion interrupts search → results even when empty. Make the list a compact summary; remove the empty Results panel before the first search. Keep search, list, and playback available together. | `web/main.ts:390–404,464–465`; `web/preparation-panel.ts:75–91,138–157`; `web/style.css:503–543` |
| W05 | P1 · M · Observed | **Budget stickiness rather than clipping.** The list can consume up to 65% of the area below an already large header. Short viewports clip list content. Prefer a one-row preview, smaller/nonsticky behaviour when height is scarce, and a clearly scrollable full list. Preserve expansion intent and never cover focused result actions. | `web/style.css:479–484,514–546`; `web/main.ts:104–123` |
| W06 | P1 · M · Validate | **Make turn arrival visible wherever the person is.** Preserve the query/scroll, but add a short local notification with Go to player/Play next when the turn changes. Do not auto-scroll, autoplay, open a modal, or repeatedly announce each telemetry update. | `web/main.ts:157–185,505–537` |
| W07 | P2 · S/M · Code | **Keep a pass action near the turn.** With no selected playback, Finish my turn is after the entire workspace/results. Put a low-emphasis Pass turn action next to the turn summary. Keep only one accessible instance in that state. | `web/main.ts:318–319,466–468` |
| W08 | P2 · M · Observed + Validate | **Refine the medium-width transition.** The layout jumps from a 660px single column to a wide workspace at exactly 1000px; the list is fixed at 360px. Choose pane thresholds based on usable content width, including embedded HA widths. Preserve one authoritative list/controller. | `web/style.css:471–505` |

### D. Search, browsing, result rows, and sources

| ID | Priority / effort / evidence | Finding and recommendation | Implementation anchor |
| --- | --- | --- | --- |
| S01 | P1 · S/M · Observed | **Use readable mobile search controls.** Search text renders at 13px, while the nickname field correctly uses 16px. Raise search/settings/recovery inputs to at least 16px on phones to reduce reading strain and iOS focus-zoom risk. Do not disable pinch zoom. | `web/style.css:271,320,360` |
| S02 | P2 · S · Code | **Make search mode and label clear.** Artists-first is a good album-oriented default. Prefer concise Artists / Songs controls, a mode-specific visible or persistent label, and an appropriate placeholder. Add `enterkeyhint="search"`. Keep native submission and accessible pressed-state semantics, or implement real tabs completely if choosing tab roles. | `web/main.ts:352–369` |
| S03 | P1 · M · Observed | **Translate source matching into a user decision.** “Metadata matches”, “identities unverified”, and “Choose exact source” expose implementation concerns. Prefer “Choose where to browse/play this version” with Spotify/Tidal labels and a brief explanation only when ambiguity matters. Never hide a required choice or auto-substitute. | `web/catalogue-sources.ts:9–27`; `web/main.ts:361–362,438–444` |
| S04 | P1 · M · Code | **Disambiguate source options by useful facts.** Options currently show provider only, or `option 1/2` for duplicates; availability is learned after selection. Add safe source/edition/duration/availability cues where available. Use service display names, not lowercase domain strings. Keep separate recordings distinct; do not expose raw provider-instance IDs or URIs. | `web/catalogue-sources.ts:18–23`; `src/model.ts:11–20` |
| S05 | P1 · M · Observed | **Restructure song metadata.** A single dot-separated line combines artist, album, version, and provider, often wrapping into several tiny lines. The unavailable-source warning also becomes an extra flex-column sibling, squeezing identity on phones. Use a stable title/artist hierarchy, a distinguishing version/source line, a status below that identity, and optional details. Duration is available but not shown in result rows; include it privately when useful. | `web/main.ts:447–461`; `web/style.css:278–286` |
| S06 | P2 · M · Code | **Treat artist/album rows as navigation.** View albums/View tracks are repeated buttons, often wrapping below identity. Use a clear navigation row with a chevron or right-aligned action; keep the source selector a separate control, not inside an all-clickable ancestor. Preserve keyboard focus and visible selected source. | `web/main.ts:413–435` |
| S07 | P1 · M · Observed + Code | **Make browsing work with Back.** Artist/album navigation changes local variables, not browser history; browser Back leaves the workspace rather than returning one level. Preserve breadcrumb, query, prior results, source choice, and per-level scroll. Keep opaque/private references out of shareable URLs or use safe history state with expiry validation. | `web/main.ts:406–435`; `web/catalogue-controller.ts` |
| S08 | P1 · M · Observed + Code | **Scope busy states to their task.** Search/browse use the global `busy` lane: a delayed search disables Finish my turn while Pause remains usable. Keep player/turn actions independent; put loading and Retry in the results region. A read-only search may be cancelled; an uncertain audio mutation must not be replayed. | `web/main.ts:132–155,318,376–388,418–435` |
| S09 | P2 · S/M · Code | **Do not make failure look like an empty result.** Retain the existing distinction between partial results, true empty results, and complete failure. Shorten the primary sentence, attach Retry/try another source locally, and move longer coverage caveats behind a clear More details disclosure. Preserve disclosure state through refreshes. | `web/main.ts:397–445`; `web/catalogue-sources.ts` |
| S10 | P2 · M · Code + Validate | **Make Add acknowledgement durable and legible.** Existing Added ✓ and no focus theft are good. The acknowledgement map is keyed by transient result ID and clears on refresh/rebrowse, although server deduplication still protects the list. Where safe, indicate already-saved exact recordings and provide a small View in my list action without scrolling automatically. | `web/preparation-panel.ts:41–50`; `web/preparation-controller.ts:32–34,60–65,140` |
| S11 | P2 · M · Validate | **Handle large catalogues deliberately.** Results and album/track browsing render complete returned arrays; provider limits can reach thousands. Prototype incremental Show more or accessible paging, show what is actually loaded, and measure rendering before considering virtualisation. Do not silently truncate or claim complete source coverage. | `web/main.ts:413–463`; `src/music-assistant.ts` |
| S12 | P3 · M/L · Validate | **Evaluate album search and lightweight search recall.** This is an album-sharing app, but direct choices are artists or tracks. Test whether guests know the album more readily than its artist. Add album search only if provider/API support and user benefit justify it; recent private queries are optional and must not become shared analytics. | `web/main.ts:39,352–359`; `src/model.ts:18–29` |

### E. Private list, history, and recovery

| ID | Priority / effort / evidence | Finding and recommendation | Implementation anchor |
| --- | --- | --- | --- |
| L01 | P1 · M · Observed | **Shrink the mobile preview, not the song.** Two reserved preview rows plus title, status, padding, and Play next form a substantial sticky card. Use count + one useful next-song summary, with full management one explicit action away. The empty state should not reserve song-height space. | `web/style.css:519–546`; `web/preparation-panel.ts:80–91,106–110` |
| L02 | P1 · S/M · Observed | **Make “next” unmistakably personal.** My list + NEXT + Play next can imply the speaker queue or automatic succession. Prefer “Your next pick” and a contextual Play this song action when current. Explain once that adding never plays. While waiting, use “Ready for your turn” instead of a prominent unexplained disabled gold button in the expanded list. | `web/preparation-panel.ts:89,110,131–137` |
| L03 | P1 · M · Code | **Expose problems in the compact preview.** `.list-body` is height-bounded and unavailable-source copy shares the truncated artist line. Keep a small explicit Needs attention state outside the scrollable body, linking to the affected entry or retained edit. Never let a sticky header say only Saved while actionable problems are hidden. | `web/preparation-panel.ts:89–105,177–181`; `web/style.css:484,519–530` |
| L04 | P2 · M · Observed | **Give list management room.** Upcoming songs, reorder controls, history, recovery credentials, and device revocation share one narrow bounded list body. Move History and List access into purposeful secondary sections/surfaces; keep upcoming choices lightweight and preserve one data owner. | `web/preparation-panel.ts:138–175`; `web/style.css:479–497` |
| L05 | P2 · M · Observed + Code | **Improve reorder completion feedback.** Accessible up/down controls are already present. Add a polite “Moved X to position Y” announcement and preserve predictable focus as controls disappear at boundaries. Native HTML drag-and-drop is not a reliable mobile touch gesture; either add tested pointer support or treat the move buttons as the primary phone interaction. | `web/preparation-panel.ts:112–123`; `web/preparation-controller.ts` |
| L06 | P2 · S/M · Code | **Put Undo near the consequence.** Removal is reversible, but Undo last removal is down in list tools. Show a nearby persistent-enough “Removed X · Undo” acknowledgement. Do not require a confirmation for ordinary reversible removal. Restoring to the end should be explicit; “Undo” should ideally restore the original position if semantics are changed. | `web/preparation-panel.ts:127,139–151`; `src/preparations.ts` |
| L07 | P1 · M · Code | **Explain retained save/play uncertainty plainly.** Keep explicit idempotent Retry and conflict reconciliation. Replace implementation-led “draft retained” / “Apply to updated list” with a concrete description of the intended edit and latest list. Distinguish a save retry from retrying playback; never automatically retry Play. | `web/preparation-panel.ts:89–105`; `web/preparation-controller.ts:125–150` |
| L08 | P1 · M · Code + Validate | **Separate access recovery from routine list use.** “Keep or recover your list” mixes key creation, key replacement, device revocation, capacities, and importing another list. Prefer List access → Back up access / Use a recovery key / Other devices, with short consequence-specific confirmations. Offer a gentle, dismissible backup prompt after meaningful saving, never block joining or playback. | `web/preparation-panel.ts:161–175` |
| L09 | P2 · M · Code | **Make recovery keys practical to keep.** Provide Copy with a selectable-text fallback on non-secure LAN origins; clearly distinguish first key creation from replacing an existing key. Confirm saved access, allow hiding, and avoid secrets in URLs, logs, automatic downloads, telemetry, or public screenshots. More key controls are not a reason to expose the whole list before joining. | `web/preparation-panel.ts:165–174`; `web/preparation-controller.ts:160–175` |
| L10 | P2 · M · Code | **Explain history accurately.** Entries move to Played after confirmed playback starts, not after a full listen. “Previously played” or “Started” should not imply completion. Use Add back rather than ambiguous Restore where clearer; retain version/source identity and separate permanent file deletion from reversible list removal. | `web/preparation-panel.ts:141–150`; `src/preparation-http.ts:124–136` |

### F. Uploads

| ID | Priority / effort / evidence | Finding and recommendation | Implementation anchor |
| --- | --- | --- | --- |
| U01 | P2 · M · Observed | **Use a focused upload subflow.** Metadata review currently expands inside Find music before the list and results. Use an inline, explicitly opened upload section or dedicated secondary surface that preserves the search underneath. Keep one upload controller and visible unfinished work; avoid a full-screen wizard unless testing requires it. | `web/preparation-panel.ts:74,156–157`; `web/upload-panel.ts:138–157` |
| U02 | P1 · S/M · Code | **Describe acceptable files before selection.** The file input’s accept filter helps, but supported formats are displayed mainly after upload. Offer a concise “One audio file” hint before selection, with format details on request and a clear standalone-AAC message. Do not invent a file-size quota; none is configured. | `web/upload-panel.ts:26–28,134,146`; `src/uploads.ts:98` |
| U03 | P1 · M · Observed + Code | **Separate uploaded from saved.** Preserve the explicit review/Add step. Use a clear title such as Review uploaded song, show filename/format/duration when available, mark optional metadata, and use one unambiguous Add to my list action. Do not label transfer completion Saved—or make an already-saved list appear unsaved merely because another upload is awaiting review. | `web/upload-panel.ts:130–147`; `web/preparation-panel.ts:89` |
| U04 | P2 · S/M · Code | **Make progress and cancellation calm.** 100% transfer can still be processing. Show those as distinct phases; throttle screen-reader progress announcements. A deliberate Cancel should say Upload cancelled rather than only Upload interrupted. Recover uncertain completion through a read-only check before suggesting another upload. | `web/upload-panel.ts:86–99,115–136,159–162` |
| U05 | P2 · M · Code | **Protect a reviewed upload when choosing another.** Choosing a file automatically discards the previous staging upload before sending the new one. Ask only when meaningful reviewed/edited work would be replaced, with Keep draft / Choose another file. Keep actual network-loss and explicit-discard recovery paths distinct. | `web/upload-panel.ts:69–81,101–109` |

### G. Playback, reveal, and turn completion

| ID | Priority / effort / evidence | Finding and recommendation | Implementation anchor |
| --- | --- | --- | --- |
| P01 | P1 · M · Observed | **Use state-specific action hierarchy.** Pause, Finish, volume, Reveal, result Play, and list Play next all compete. Primary before playback: Play the chosen song. Primary during hidden playback: Reveal song. Keep finish available but visually separate from transport; never require a detour to settings for routine use. | `web/main.ts:316–342,457–459`; `web/preparation-panel.ts:131–137` |
| P02 | P1 · M · Observed + Code | **Guard replacements consistently.** Prepared playback asks “Replace the current track…”, but direct result Play replaces it without that check; both paths were reproduced. Use the same explicit Play instead confirmation for active/paused replacement regardless of origin; retain server-side turn/playback checks. No confirmation is needed for every first play. | `web/main.ts:79–85,458,471`; `web/player-controller.ts:76–80` |
| P03 | P1 · M · Observed + Validate | **Keep essential controls reachable after scrolling.** The full player can be above the current viewport while results remain far below. Prototype a small Go to player / Pause / Reveal strip with clear track context, or a return anchor. Respect one persistent-chrome budget and never render duplicate focusable players. | `web/main.ts:320–342`; `web/style.css:255–265` |
| P04 | P1 · S/M · Code | **Explain Finish before it surprises.** Finish stops app-owned music and advances, including while paused. Use Finish turn, with brief consequence/context when audio is active; consider a targeted confirmation only where accidental activation is likely. Idle users should see Pass turn. Do not reintroduce a duplicate Stop button by default. | `web/main.ts:318–337`; `src/engine.ts:196–203` |
| P05 | P1 · S/M · Observed | **Make reveal status and confirmation unmistakable.** Keep the existing server-confirmed public reveal. Label the control Reveal song and the state Hidden on room display / Revealing… / Visible on room display. Announce confirmed completion without shouting on every progress update. Do not offer a fake undo of a disclosure people already saw. | `web/main.ts:322,338–340`; `web/player-controller.ts:65,89` |
| P06 | P2 · M · Code | **Identify where sound goes.** Participants and host volume show Volume/% without the selected speaker name. Add a safe destination summary near first play/volume if product policy permits, not provider credentials or queue metadata. Explain unsupported volume locally rather than suggesting a broken slider. | `web/media.ts:34–54`; `src/model.ts:63–74` |
| P07 | P1 · M · Code | **Clarify ownership loss without implying the speaker stopped.** On disconnection/takeover, controls disable and public details hide. Explain “Playback controls lost; the speaker may still be playing. Ask the host to recover.” where true. Give the host a clear recovery link/action, but do not expose recovery controls to every participant. | `web/main.ts:516–518`; `web/public-room.ts:59–61`; `web/settings.ts:223–228` |
| P08 | P2 · M/L · Validate | **Research the reveal/discussion ending.** Natural-end advancement currently clears the prior reveal immediately. Test whether the room needs a deliberate discussion/reveal hold; keep current semantics until approved. Any change must preserve exactly-once advancement and must never autoplay the next person’s music. | `src/engine.ts`; `docs/persistent-room.md`; `web/public-room.ts:58–80` |

### H. Host desk and invitations

| ID | Priority / effort / evidence | Finding and recommendation | Implementation anchor |
| --- | --- | --- | --- |
| H01 | P1 · M · Observed | **Prioritise empty-room onboarding.** The empty host leads with a large waiting card, disabled skip, volume, and zero-count summaries; invitations are last on mobile. Lead with invitation and required setup readiness; omit irrelevant empty controls, not just disable them. | `web/main.ts:251–303`; `web/style.css:403–425` |
| H02 | P1 · M · Observed + Code | **Make the host’s current card operationally useful.** Add metadata-free Playing / Paused / Choosing a song / Unavailable status. Combine next person and participant count without duplicating large statistic cards and roster count. Do not reveal private music to the host. | `web/main.ts:265–278`; `src/model.ts:63–74` |
| H03 | P1 · S/M · Code | **Make skipping explicit and guarded.** Rename Advance / skip current turn to Skip turn. If app-owned music is active, confirm the stop/pass consequence; a stale or double click must still be rejected server-side. Keep safe, deliberate advancement when no audio is active. | `web/main.ts:274`; `src/engine.ts:196–203` |
| H04 | P1 · M · Code | **Hide administration until needed; protect removal.** Every roster row shows up/down/remove. Add Edit order/Manage people mode, clear keyboard controls, and a consequence-specific guard for removing the current participant. Ordinary reversible list removal and room membership removal are not the same action. | `web/main.ts:280–298` |
| H05 | P1 · M · Observed | **Make inviting usable on a host’s phone.** Keep a direct Invite access point above/near the roster. Add Copy join link and optional native Share, with selectable-URL fallback over HTTP. Separate opening the participant page from sharing the link; retain the QR for showing another device. | `web/main.ts:216–228,301–303`; `web/style.css:413` |
| H06 | P2 · S/M · Code | **Finish host structure and feedback.** Add a real Host desk h1, consistent sans-serif QR heading, and local announcements for reordered/removed people. Keep focus on a predictable remaining control after removal or movement. The existing named main landmark is good but is not a substitute for a useful heading hierarchy. | `web/main.ts:251–303`; `web/style.css:149`; `web/main.ts:529–535` |

### I. Connections, speakers, addresses, and recovery

| ID | Priority / effort / evidence | Finding and recommendation | Implementation anchor |
| --- | --- | --- | --- |
| C01 | P1 · M · Observed | **Make first setup a short path with a finish.** Present music connection, speaker, and shareable guest access as separate readiness steps; after success, provide a clear Return to host / Invite people handoff. This is setup guidance, not a room Create/Start lifecycle. | `web/settings.ts:110–231`; `web/addressing-panel.ts` |
| C02 | P1 · M · Observed | **Show a healthy connection as a summary.** Configured means token stored, not reachable/authorised/speaker ready. Show safe server identity/health and selected speaker. Make Reconnect/advanced/disconnect secondary actions unless authorization actually needs attention. | `web/settings.ts:118–130,197–220` |
| C03 | P1 · M · Code | **Support local retry instead of Refresh the page.** Speaker discovery failures require a page reload. Add Retry speaker discovery and clear pending/success/error states in that card, while retaining drafts and source identity. Read-only retries must never play, regroup, change volume, or mutate queues. | `web/settings.ts:72–75,216–218,242–249` |
| C04 | P2 · S/M · Observed + Code | **Simplify speaker editing.** A saved speaker still shows the full selector and an enabled Save destination even if unchanged. Default to “Speaker: Living room · Change”; show Save speaker only for an actual draft change. Keep unavailable saved speakers visible with a replacement path. | `web/settings.ts:197–215` |
| C05 | P1 · M · Code | **Make sign-in lifecycle explicit.** Preserve popup-blocked fallback, but show Waiting for sign-in / Connected / Cancelled / Expired distinctly, with Cancel/try again where appropriate. Keep original and callback tabs consistent through read-only refresh; never clear a good connection because sign-in was cancelled. | `web/settings.ts:25–30,56–69,184–186,251–255`; `src/ma-authorization.ts` |
| C06 | P2 · M · Observed | **Separate guest sharing from upload networking.** “Application addresses”, “Guest links”, “File access”, and “Application address reachable from Music Assistant” represent different jobs. Use Guest access and Uploaded-file playback, with healthy summaries and advanced overrides closed. Keep full addresses available for troubleshooting rather than always competing with speaker setup. | `web/addressing-panel.ts:59–112` |
| C07 | P1 · M · Code | **Keep address-change consequences concrete.** Switching origins affects cookies and private-list access. Before committing a change, show which link changes and advise keeping recovery keys; offer a safe old/new link handoff. Do not claim lists are deleted or automatically migrate browser credentials across origins. | `web/addressing-panel.ts:65–87`; `docs/application-addressing.md` |
| C08 | P1 · M · Code | **Show why settings changes are unavailable during playback.** Today settings mutations can look usable and then return Stop or finish first. Derive/read back an ownership-blocked state, explain it next to Change/Disconnect, and offer a return to the active turn. Never stop someone’s music just because settings were opened. | `web/settings.ts:124–128,209–212`; `src/integrations.ts:83,261,299` |
| C09 | P1 · M · Code | **Turn playback recovery into a short explanation, not a protocol lesson.** Say what may still be playing, what the recovery action will attempt, what it leaves untouched, and that it does not advance/start music. Put implementation detail in an optional explanation; preserve exact ownership checks and explicit confirmation. | `web/settings.ts:223–228`; `src/live-playback.ts` |

### J. Cross-cutting visual, accessibility, and resilience refinements

| ID | Priority / effort / evidence | Finding and recommendation | Implementation anchor |
| --- | --- | --- | --- |
| V01 | P1 · M · Observed | **Stop using tiny type to fit the UI.** Functional labels use 8–12px in chips, seat states, settings badges, list controls, and metadata. Establish a readable type scale and remove redundant content first. A small font is not automatically a WCAG failure, but it is a real usability problem. | `web/style.css:26,38,44,177,193,205,225,248,291–321,343` |
| V02 | P1 · S/M · Code + measured | **Strengthen meaningful input boundaries.** The search border `#40503a` against `#111b14` is about 2.04:1; generic borders are around 1.45–1.60:1 against adjacent surfaces. Where the boundary is needed to identify the control, target at least 3:1. Decorative card dividers do not all need 3:1. Keep the green palette. | `web/style.css:3–4,15,272–274,360`; WCAG 1.4.11 |
| V03 | P1 · M · Code + Validate | **Standardise comfortable targets.** Most important phone buttons already reach 44px, but some tools remain 34–38px and the volume interaction area is 32px high. Use 44–48px practical touch targets with spacing. Do not misstate the WCAG 2.2 AA minimum: it is 24px with exceptions, not 44px. | `web/style.css:97,215–216,293,307,317,431,494`; WCAG 2.5.8 |
| V04 | P1 · M · Code + Validate | **Test zoom, text spacing, safe areas, and native keyboards as first-class states.** The app has viewport-height handling and reduced motion, but no safe-area rules and many pixel-sized labels. Verify reflow at 320 CSS px, 200% text, 400% zoom-equivalent layouts, landscape, dynamic browser bars, notches, and keyboard dismissal. Suspend decorative stickiness rather than hiding actions. | `web/index.html:5`; `web/main.ts:104–123`; `web/style.css:9,503–575` |
| V05 | P1 · M · Code | **Unify notice hierarchy and language.** Global connection/uncertain-state/playback-issue banners can stack, while list and upload have separate messages. Use one highest-priority global issue and local task notices. Explain What happened / What was kept / Next action; map known error codes without leaking upstream payloads. Retain persistent unresolved warnings. | `web/main.ts:515–518`; `web/request.ts`; `web/settings.ts:114–116`; `web/preparation-panel.ts:92–105` |
| V06 | P1 · M · Code + Validate | **Preserve live-region and focus stability.** The header/display are stable, but participant content is rebuilt with `replaceChildren`; several source/help/upload controls have no stable focus key or preserved open state. Patch persistent regions where practical, preserve focused nodes/caret, and announce changes once. Test real screen readers; avoid duplicate turn/save announcements from remounted status elements. | `web/main.ts:505–537`; `web/upload-panel.ts:164`; `web/preparation-panel.ts:15–18,36–39,89` |
| V07 | P2 · M · Code + Validate | **Make long lists responsive without a rewrite.** Measure low-end-phone search/reorder latency and artwork requests during full renders. Retain stable row nodes and image frames before adding virtualisation or heavier state tools. Test 200 upcoming picks, retained history, and large provider result sets. | `web/main.ts:169–177,505–537`; `web/media.ts:5–11`; `web/preparation-panel.ts:108–153` |
| V08 | P2 · M · Code | **Provide purposeful themed confirmations.** Native confirm is safe but generic and visually disconnected; consequential dialogs need named actions and clear outcomes. Use native `<dialog>` with accessible naming, sensible initial focus, Escape, cancel, and focus restoration. Do not replace every minor action with a modal. | `web/main.ts:81`; `web/preparation-panel.ts:97,149,165–174`; `web/settings.ts:125,226` |
| V09 | P2 · M · Code + Validate | **Distinguish transport-offline from room-live failure.** `navigator.onLine` alone is not proof the LAN application is reachable. Make SSE/library connection health and safe read-only refresh explicit, including returning from a backgrounded phone tab. Revalidation may restore controls but must never replay a retained write or start audio. | `web/main.ts:196–212,565–577`; `web/preparation-controller.ts:88–100`; `web/participant-access.ts` |
| V10 | P3 · S/M · Code | **Align browser polish with the theme.** The theme-colour meta differs from the main background; serif home/QR headings and many surface/radius/spacing overrides weaken cohesion. Centralise theme, type, spacing, control, and notice tokens; add dark-mode forced-colour/focus checks. A light theme is not a prerequisite for this redesign. | `web/index.html:6`; `web/style.css`; `web/dom.ts` |
| V11 | P1 · M · Observed + Code | **Revalidate private access after first creation in another tab.** If two participant tabs open before a private list exists, saving the first song in one tab leaves the other at My list · 0. Bringing it forward and receiving a room update do not fix it; reload does. Add safe read-only revalidation on visibility/access changes and subscribe after discovery. Never merge owners or overwrite a pending edit to “fix” a stale view. | `web/preparation-controller.ts:67–94,101–111`; `web/main.ts:556–577` |

### K. Public display

| ID | Priority / effort / evidence | Finding and recommendation | Implementation anchor |
| --- | --- | --- | --- |
| D01 | P2 · M · Observed + Validate | **Keep the stage; improve its presentation shell.** The shared desktop header occupies 90px and includes administration navigation even on the TV. Offer an intentional Presentation view/compact chrome setting with discoverable keyboard/pointer access to controls. Do not hide every route control on a timer or turn the display into a different product. | `web/app-header.ts`; `web/style.css:108–183`; `web/public-room.ts` |
| D02 | P1 · S/M · Code | **Make the QR actionable on the same device.** It is currently an image, not a join link. Wrap it in an accessible link and add a restrained human-readable address or Join on this device fallback where useful. Keep a proper QR quiet zone and validate actual scan distance with a phone. | `web/public-room.ts:84–91`; `web/main.ts:187–192`; `web/style.css:153–155` |
| D03 | P2 · M · Observed + Validate | **Check the ten-foot typography, not just the screenshot.** Song/artist hierarchy is strong, but album, order labels, and remaining count can be very small at TV distance; long names are clamped. Prioritise current/next names and essential secondary text. The small personalised sticker/180 playful phrases can stay decorative; do not turn them into required reading or shrink everything to fit 100 people. | `web/style.css:142–171`; `web/public-turn-order.ts`; `web/record-labels.ts` |
| D04 | P1 · S/M · Code + Validate | **Offer a local animation-off control.** Reduced-motion preferences are already respected, and pause freezes motion. A spectator should also be able to disable the decorative ongoing motion without pausing the shared music. Put that setting quietly in the display menu and retain confirmed playback indicators. | `web/style.css:125–139,573–575`; WCAG 2.2.2 |
| D05 | P3 · M · Validate | **Optionally keep the display awake.** Offer an explicit Keep screen awake setting where supported over HTTPS. Handle rejection/visibility changes gracefully, release it when disabled, and do not imply it works on every HTTP LAN/TV browser. This is optional polish, not a reason to require installation. | `web/app-header.ts`; Screen Wake Lock API |
| D06 | P2 · S · Observed | **Correct the display’s heading hierarchy.** The Join room invitation uses h3 immediately after the main h1, before the Turn order h2. Use an appropriate h2 or a plain labelled invitation region. Keep its visual prominence quiet; heading level should not be chosen to get smaller type. This was an automated best-practice finding, not proof by itself of a WCAG failure. | `web/public-room.ts:88`; `web/public-turn-order.ts:28` |

## 6. Terminology and example copy

### Vocabulary contract

| Current / competing terms | Prefer | Notes |
| --- | --- | --- |
| My seat | My music | Describes the workspace’s actual job. |
| Listening room / public display / display | Room display | Use Room for the shared concept; Room display for the destination. |
| Circle ↕ / rotation / seat | Listening order / your turn | “Circle” may remain in occasional explanatory prose, not as a second navigation system. |
| Track / song / pick / prepared choice | Song in participant actions; version/recording when precision matters | Use technical distinctions only where they change the choice. |
| NEXT | Your next pick | Personal choice, not automatically queued audio. |
| Play next | Play this song, with visible next-pick context | Avoid suggesting enqueue or automatic succession. Test wording with guests. |
| Search artists / Search tracks | Artists / Songs | The field/button already communicates search. |
| Metadata matches / identities unverified | Choose a source to continue | Keep precise explanation available as secondary help. |
| Provider / source domain | Music service / source | Use Spotify/Tidal/Music Assistant/local-file friendly names. |
| Destination / Playback destination / Save destination | Speaker / Save speaker | Use Speaker or group when that distinction matters. |
| LIVE · SONOS | Music connected / Choose speaker / Playing | Derive the words from facts, not the mere presence of a token. |
| Advance / skip current turn | Skip turn | Explain the stop/pass effect only when relevant. |
| Finish my turn | Finish turn; Pass turn when nothing is playing | One action in one place per state. |
| Hidden from the room | Hidden on room display | Do not imply that external Sonos/MA interfaces are concealed. |
| Reveal on the display | Reveal song | Associate with the explicit room-display privacy state. |
| Not synced · draft retained | Save not confirmed | Follow with “Your change is kept on this device.” |
| Apply to updated list | Apply this change | Show the specific intended change and latest list. |
| Restore | Add back | State whether it returns at the end. |
| Keep or recover your list | List access | Separate backing up access, recovering, and managing devices. |
| Application addresses | Guest access / Uploaded-file playback | Separate the jobs, not necessarily the underlying configuration. |

### Good minimal messages

- **Join:** “Take turns sharing a song. Your choices stay private until you reveal them.”
- **Waiting:** “Sam’s turn · You’re next.”
- **Idle current turn:** “Your turn. Choose a song to play.”
- **Empty private list:** “Save songs here for your turn.”
- **Added:** “Added to your list. Nothing will play yet.” Use the second sentence only when the concept is new.
- **Reveal pending:** “Revealing…” followed by “Visible on room display” only after confirmation.
- **Save uncertainty:** “Save not confirmed. Your change is kept on this device.” Actions: Check save / Discard change, preserving current idempotency semantics.
- **Conflict:** “Your list changed on another device. Review the latest order before applying ‘Move Night Bus Home to the top’.”
- **Connection loss:** “Connection lost. Your saved songs are kept. Controls will return when the room reconnects.”
- **Playback ownership uncertainty:** “We can’t confirm control of the speaker. Music may still be playing. Ask the host to recover controls.”
- **Recovery success before joining:** “Your list is recovered. Enter your name to join the room.”
- **Empty speaker discovery:** “No speakers found. Add a speaker in Music Assistant, then try again.” Action: Find speakers again.

Do not repeat all of this copy on every screen. Good terminology lets most explanation disappear. Technical detail belongs in contextual help; urgent consequences and safe next actions must remain visible.

## 7. Visual system: theme, typography, spacing, components

### 7.1 Preserve the existing colours, clarify their roles

Current core colours are a good starting point:

| Role | Existing value | Direction |
| --- | --- | --- |
| Background | `#101713` | Keep. |
| Standard surface | `#18211b` | Keep; use fewer competing cards. |
| Main text | `#f2f0e6` | Keep. Approximately 15.93:1 against the background. |
| Secondary text | `#a1b0a3` | Keep, but make it readable in size and quantity. Approximately 7.27:1 against the standard panel. |
| Accent / key action | `#e9bd79` | Keep. Dark button ink has strong contrast, approximately 9.20:1. Reserve filled gold for the action that matters now. |
| Success/support | `#92c5a1` | Keep as a semantic supporting colour, not a second primary accent. |
| Decorative divider | `#303d33` | Fine for subtle grouping; not necessarily sufficient as a required form-control boundary. |

Ratios use solid CSS colours and WCAG relative luminance. Gradients, transparency, disabled states, artwork, and forced-colour rendering still require their own checks. There is no reason to desaturate the theme or turn every border gold.

Use a small surface hierarchy: page, ordinary content, active player/your turn, and exceptional notice. The private list can retain its green identity, but it should not demand the same attention as the player merely because both currently share the strongest gradient and border.

### 7.2 Type scale

Suggested starting tokens—not rigid requirements:

| Use | Phone | Wider screens |
| --- | --- | --- |
| Page heading | 28–32px | 32–40px |
| Section heading | 20–24px | 22–24px |
| Primary song/name text | 16px | 16–18px |
| Body and input text | 16px | 15–16px; inputs may remain 16px consistently |
| Secondary metadata/help | 14px | 13–14px |
| Occasional nonessential caption | 12px | 12px |
| Buttons | 14–16px | 14–16px |

Use relative units for tokens and allow browser/user text scaling. Avoid 8px state labels and badges. Tight negative tracking should be confined to large headings, not tiny labels. Use tabular numerals for times/volume; keep natural sentence case for most interface text. Retain one sans-serif system stack, or deliberately self-host one variable font if cross-device identity genuinely warrants the extra loading work. `Inter` is named in CSS but not bundled by the current document; actual rendering depends on installed/system fonts.

### 7.3 Spacing and “breathing room”

Breathing room is a hierarchy problem before it is a padding problem. Increasing every card’s padding would make the current mobile journey worse.

- Adopt a small spacing scale, for example 4 / 8 / 12 / 16 / 24 / 32 / 48.
- Keep 16–20px phone page gutters and around 16–20px content padding where cards are useful; do not repeatedly nest cards for related content.
- Separate tasks with clear section space; use smaller spacing inside a song’s identity/metadata group.
- Remove empty reserved rows, redundant card headings, and duplicated status before reducing legibility.
- Prefer row separators and alignment for song lists, not a card around every song.
- Bound instructional text to a comfortable reading width; let titles wrap naturally to a useful two-line maximum with an explicit details path where needed.
- Avoid making desktop page width a proxy for information density. Healthy settings summaries should look balanced, not leave a large empty left column next to a permanently expanded address form.

### 7.4 Component rules

Define shared tokens and a few reusable primitives rather than importing a full visual framework:

- Button: primary, secondary, quiet, destructive, pending; consistent target and focus ring.
- Input/Select: persistent label, hint, invalid state, associated error, mobile text size.
- Song identity row: artwork, title, artist, distinguishing details, actions.
- Status: readiness/turn/save states with text, not colour alone.
- Notice: success, warning, error; optional action and details; consistent persistence.
- Disclosure: clear label, chevron/state, preserved openness and focus.
- Confirmation dialog: consequence, explicit cancel and action, sensible focus.
- Empty/loading region: next action or task-specific progress, not a decorative placeholder dashboard.

Use a modest, consistent icon set if needed; do not mix decorative Unicode symbols (`↕`, `⋮⋮`, `Ⅱ`) as the only interaction cue. Keep visible labels for consequential actions and accessible names for icon-only controls.

## 8. Modern techniques worth using—and avoiding

| Technique | Appropriate use here | Guardrail |
| --- | --- | --- |
| CSS design tokens and cascade layers | Centralise the existing palette, spacing, type, target sizes, and semantic surfaces; separate base/component/state/adaptive rules. | Do not make a token migration a prerequisite for truthful labels and safety fixes. |
| Container queries | Adapt result/list rows to their actual pane width, including HA Ingress and the 360px sidebar. | Keep simple viewport breakpoints for page-level structure; test older supported browsers and fallbacks. |
| `dvh`/`svh`, VisualViewport, safe-area `env()` | Improve short screens, browser bars, keyboard-height layouts, and any compact player/list strip. Existing VisualViewport work is useful. | Test actual devices. Do not add `viewport-fit=cover` without safe-area padding or use `maximum-scale=1` to suppress zoom. |
| Native `<details>` | Secondary explanation, history, and simple disclosure. | Preserve state across renders; do not use it as a substitute for every action menu or bury critical failures. |
| Native Popover API | Lightweight action/source overflow menus with top-layer positioning and light dismissal. | It is non-modal, not a free accessibility solution. Retain appropriate semantics, focus behaviour, and feature-detected fallback. |
| Native `<dialog>` | Destructive/consequential confirmation, optional focused access-management surface. | Correct name, initial focus, Escape/cancel, return focus, and non-duplicated state. No modal for ordinary Add. |
| History API / stable browse state | Artist → album → song backtracking and reliable browser Back. | Store private reference state carefully; revalidate expiry and authorization; never auto-execute a recovered Play. |
| Keyed DOM updates and scoped loading lanes | Keep input nodes/caret, live regions, image frames, and list scroll stable during SSE and saves. | A framework rewrite is unnecessary. Preserve the useful existing controller boundaries. |
| View Transitions | Optional subtle transitions for user-requested navigation or list expansion once structure is stable. | Feature-detect, honour reduced motion, and exclude private/revoked content from snapshots. Do not restart the record or animate every telemetry update. |
| `content-visibility` / incremental rendering | Potential optimisation for genuinely long lists after measuring. | Verify focus/find-in-page/accessibility and scroll sizing. Start with simpler paging/stable nodes; virtualisation can remove useful content from assistive technology. |
| Clipboard / Web Share | Copy/share permanent guest links and privately copy a recovery key after explicit action. | Secure-context/platform dependent. HTTP LAN needs selectable-text fallback. Never silently share recovery credentials. |
| Screen Wake Lock | Explicit optional keep-awake for the display over supported HTTPS contexts. | It may be rejected/released; show truthful state. No effect on music or participant phone battery by default. |
| Privacy-conscious UX measurement | Task timing, completion/error counts, layout/performance tests, optional consented usability observations. | Do not send private song titles, queries, lists, keys, or guest identities to analytics/session replay. Synthetic regression data is sufficient for automation. |

**Do not prioritise:** glassmorphism, animated backgrounds, a new colour theme, custom everything, mandatory install/PWA, autoplay previews, a global command palette, service-specific Spotify UX, or AI recommendation features. None addresses the current core friction. Offline caching/background sync also needs exceptional caution: private/reveal-gated data and uncertain audio writes must not be cached or replayed by a generic service worker.

## 9. Implementation sequence

### Phase 1 — Trust and legibility, without changing the product model

**G03, G06–G07, J02–J04, W02, S01, S08–S09, P02, P04–P07, H03, C03, C08–C09, V02–V05, V11.**

- Correct misleading status/copy and inconsistent replacement handling.
- Fix brand naming/menu keyboard lifecycle, input size/boundaries, task-local errors, and visible recovery paths.
- Keep playback/list state contracts and existing role privacy exactly as they are.

Deliver these as small tested changes. Some require view-model additions; do not fake readiness based on client inference.

### Phase 2 — Prototype the mobile experience as a whole

**G01–G02, W01/W03–W08, S02–S07, L01–L04, P01/P03, H01/H02/H05, C01/C02/C04/C06.**

Build a clickable prototype with the existing palette and realistic long data. Compare the compact companion against the current design in complete join → search → save → turn → reveal tasks. Validate waiting/current/playing states and keyboard-height layouts before polishing isolated screens.

Important dependency: a smaller header alone will not solve a 200–300px sticky list; a smaller list alone will not solve oversized player/status regions. Resolve the persistent-chrome budget together.

### Phase 3 — Consistent components and secondary flows

**G04/G05/G08/G09, L05–L10, U01–U05, H04/H06, C05/C07, V01/V06–V10, D01–D04/D06.**

Create/standardise the small component vocabulary and styling tokens; refine upload/history/access management, host editing, settings summaries, fallback pages, and the display’s presentation controls. Refactor only where required to retain focus/state and reduce duplication.

### Phase 4 — Product decisions and optional polish

**J05/J06, S11/S12, P08, D05.**

Approve self-leave/rename, possible album search, large-catalogue rendering changes, discussion-ending semantics, and optional display wake lock only after confirming their value. These should not delay the core simplification.

### Implementation boundaries

- Keep `PlayerController`, `PreparationController`, catalogue lifetime, participant access, and public room responsibilities separate.
- Do not change storage schemas or credentials for a vocabulary/layout improvement.
- Where new readiness/speaker/error fields are needed, define minimal role-safe response types and test them at the server boundary.
- Do not add a host login, event/session lifecycle, automatic source substitution, or automatic next-song playback unless separately requested.
- Retain existing behavioural tests; revise presentation tests intentionally. Equal CSS values across host/participant cards are weaker than testing that the resulting hierarchy and tasks work.

## 10. Acceptance criteria and user research

### Concrete design acceptance targets

These are proposed product-quality targets, not WCAG rules:

1. On a 390×844 phone in the ordinary waiting/search state, the first useful result and its action are visible without first scrolling past a full private-list card. Test real source-choice rows, not only short demo data.
2. Aim for roughly 56–72px mobile header height, without reducing 44–48px practical targets. Turn information may be a small content row; it should not be repeated three times.
3. Aim for a roughly 56–88px compact list companion. If the next title cannot fit readably, show a clear count/Open action rather than squeezing tiny metadata into it.
4. During ordinary results browsing, persistent chrome should occupy no more than approximately one quarter of a normal phone viewport. In short/keyboard views, nonessential sticky surfaces should shrink, unstick, or collapse to a link.
5. At 320px and with enlarged text, every primary action remains reachable; no required source choice/version distinction is lost behind ellipsis without another access path.
6. Search, list editing, and read-only settings checks never disable unrelated valid player/turn actions.
7. Every disabled major action has an understandable nearby reason and, where appropriate, an enabled recovery/navigation action.
8. User-requested list/browse operations preserve relevant query, source choice, input caret, focus, and scroll; live updates never unexpectedly move the page.
9. Host invitations are reachable in one explicit action from the top of the host page regardless of roster length.
10. Healthy settings require reading a summary, not deciding whether to Reconnect or re-save an unchanged speaker.

Treat the pixel targets as prototype constraints to validate, not as another reason to clip text or force a large-type user into a fixed-height box.

### Regression and manual matrix

| Area | Required cases |
| --- | --- |
| Width/height | 320, 360, 390, 430, 600, 768, 999, 1000, 1280, 1440px; phone landscape and short keyboard viewports; actual HA embedded widths. |
| Text and content | 200% text, 400% zoom-equivalent reflow, WCAG text-spacing overrides, long/duplicate/Unicode names, long version/album/source labels, absent or failed artwork. |
| Joining | Fresh, returning, checking, offline, failed membership check, removed, full room, recovery before joining, retained unsynced edit/upload. |
| Preparation | Empty/one/many/200 picks, maximum retained history, reorder boundaries, remove/undo, played/removed, unavailable source, source change, expired browse reference, device revocation, lost acknowledgement, conflict, capacity/storage failure. |
| Search | Artists/songs, verified grouping, ambiguous matches, source selection, unavailable option, true empty, partial failure, complete failure, slow network, large catalogues, Back/Forward, return from background. |
| Upload | Every supported family, invalid/standalone AAC, large file, transfer vs processing, cancel, choose another, edited draft, reload, lost reply, add/save uncertainty, permanent-delete confirmation. |
| Playback | Current vs waiting, starting, slow/failed command, playing/paused, hidden/revealed, pending reveal, replacement from each origin, pass/finish, natural end, speaker change, ownership loss, indefinite pause, recovery. |
| Host/settings | Empty and 1/8/30/100 people; duplicate names; reorder/current removal; copy/share fallback; no server, discovery, popup blocked, cancelled/expired sign-in, invalid token, no/offline speaker, unchanged speaker, active-playback change block, address verification failure/switch. |
| Display | Empty/idle, hidden, revealed, paused, stopped, uncertain, long metadata, single listener, many listeners, 720p/1080p/4K and zoom/scaling, QR scan distance, optional motion-off, full-screen exit, keyboard/remote access. |
| Accessibility | Keyboard only; visible unobscured focus; screen-reader headings/regions; voice-input name matching; status announcement frequency; touch targets; forced colours; reduced motion; actual VoiceOver/Safari and TalkBack/Chrome. |
| Safety | No audio on join/save/recover/share/setup; no private data in host/display payloads, snapshots, logs, titles, URLs or analytics; no stale authority; no automatic write retries or source substitution; preserved permanent links and saved data. |

Keep the current automated suite and add task/geometry assertions plus a small, stable screenshot-regression set. Automated accessibility scans should run on meaningful expanded/error/playing states, not only the initial page. They cannot replace manual keyboard, contrast, speech-input, and screen-reader checks.

### User research to validate the direction

Recruit a small first round of approximately 5–8 people with mixed technical confidence and a mix of iPhone/Android, including people unfamiliar with Music Assistant. Include a host and at least one participant who uses larger text or assistive technology where possible. This is formative research, not statistical proof.

Give tasks without explaining the interface:

1. Join from the QR and describe what the room is for.
2. Find a particular album/song and save two choices while someone else has a turn.
3. Explain whether saving starts audio and who can see the choices.
4. Move the second choice to first; remove and undo one choice.
5. Resolve two apparently matching music-service results without changing the recording accidentally.
6. Notice that it is now your turn while deep in results; play, pause, reveal, and finish.
7. Upload a file, correct metadata, and explain when it is actually saved.
8. Recover a list on another device and join without assuming the key is an invitation.
9. As host, invite another person from a phone, change order, and skip a playing turn safely.
10. Interpret a lost connection/uncertain save and choose the safe recovery action.

Record unaided completion, wrong-turns, accidental audio/reveal attempts, requests for help, time to a successful first choice, and participants’ own explanation of privacy/next-song behaviour. Do not record private music data in remote analytics. Compare the prototype against the current layout; fix the largest misunderstandings before a second round.

**Definition of success:** people can explain the room in their own words, prepare without worrying that they will interrupt someone, find and reveal their song without coaching, and recover from ordinary failures without believing their work is lost. The interface gives them enough confidence to put the phone down and listen.

## 11. Research references

Research consulted for this audit; these support the principles and implementation choices, not the claim that one prescribed layout is universally optimal.

1. Nielsen Norman Group, [10 usability heuristics](https://www.nngroup.com/articles/ten-usability-heuristics/): system status, real-world language, control, consistency, recognition, minimalist design, and useful error recovery.
2. Nielsen Norman Group, [Progressive disclosure](https://www.nngroup.com/articles/progressive-disclosure/): defer rare complexity, but do not hide frequent actions or split interdependent tasks into unnecessary steps.
3. W3C, [WCAG 2.2](https://www.w3.org/TR/WCAG22/), particularly [Reflow](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html), [Text spacing](https://www.w3.org/WAI/WCAG22/Understanding/text-spacing.html), [Non-text contrast](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html), [Target size](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html), [Label in name](https://www.w3.org/WAI/WCAG22/Understanding/label-in-name.html), [Focus not obscured](https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html), and [Pause, stop, hide](https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide.html).
4. W3C APG, [Disclosure navigation](https://www.w3.org/WAI/ARIA/apg/patterns/disclosure/examples/disclosure-navigation/): ordinary links, Escape, and closing on focus leaving navigation.
5. GOV.UK Design System, [Error messages](https://design-system.service.gov.uk/components/error-message/): associate errors with fields, preserve entered information, explain a remedy.
6. Material Design, [Adaptive breakpoints](https://m3.material.io/foundations/layout/breakpoints) and [supporting panes](https://m3.material.io/foundations/layout/canonical-examples/supporting-pane): reorganise based on space and ergonomics, not simply shrink a desktop layout. The proposed design keeps this app’s theme, not Material’s visual styling.
7. MDN, [Container queries](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Containment/Container_queries), [CSS environment/safe-area values](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Values/env), and [VisualViewport](https://developer.mozilla.org/en-US/docs/Web/API/VisualViewport).
8. MDN, [Popover API](https://developer.mozilla.org/en-US/docs/Web/API/Popover_API), [`<dialog>`](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/dialog), and [View Transition API](https://developer.mozilla.org/en-US/docs/Web/API/View_Transition_API).
9. MDN, [Reduced motion](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/prefers-reduced-motion), [`content-visibility`](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/content-visibility), and [Screen Wake Lock API](https://developer.mozilla.org/en-US/docs/Web/API/Screen_Wake_Lock_API).
10. CSS-Tricks, [16px or larger text prevents iOS form zoom](https://css-tricks.com/16px-or-larger-text-prevents-ios-form-zoom/): practical mobile input guidance, not a WCAG minimum-font-size rule. Actual iOS behaviour still requires device verification.
