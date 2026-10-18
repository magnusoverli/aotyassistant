# UI/UX audit — evidence and coverage

Companion to [the complete UI/UX audit and recommendation register](ui-ux-audit.md). Reviewed 18 October 2026 against version **0.2.8**, commit **`b33c266`**.

## 1. Environment and safety

- Built and ran the actual application from this checkout, not the historical HTML mockup.
- Used isolated temporary data, separate browser contexts for people/host/display, the repository’s synthetic Music Assistant fixture, and synthetic upload analysis.
- No deployed instance, real speaker, user credentials, private list, or production data was accessed or changed. All synthetic servers/browsers used for the investigation were closed afterward.
- Node 24.22.0; Playwright 1.64.1; headless Chromium 156; axe-core 4.14.0. Temporary diagnostic dependencies were installed outside the project’s dependency manifest. Application/package/config files were not edited.
- Additional walkthrough: **36 instrumented state captures**, with **35 axe scans**, plus targeted interaction/size probes. Two extra screenshots in that walkthrough show scrolled sticky behaviour and menu/focus behaviour. Existing browser tests also generated screenshots across their own width/state matrix.
- Fourteen representative images are retained locally in the ignored `docs/ui-ux-audit-assets/` directory. Screenshots are not versioned. They contain only synthetic data; recovery-key screenshots and raw diagnostic response bodies are excluded from the report.

**Fixture limitations:** white catalogue thumbnails in some images are synthetic one-pixel fixture artwork, not evidence that production artwork is broken. The custom demo was configured with a long synthetic duration to avoid automatic completion during inspection; `60:00` in a player image is not the application’s normal demo duration. Loopback guest addresses/QRs are test addresses, not real invitations. Synthetic upload metadata is not proof of real codec/phone/speaker behaviour.

## 2. Baseline verification

| Check | Result |
| --- | --- |
| `npm run build` | Passed; client and server built successfully. |
| `npm run typecheck` | Passed. |
| `npm test` | **193 passed**, 0 failed. |
| `npx playwright test` | **63 passed**, 0 failed; Chromium, one worker. |

Existing suites cover entry/roles, navigation, search, multi-provider browsing, preparation durability/conflicts, uploads, optimistic controls, public reveal/privacy, host layout, integrations/addressing, and Home Assistant sign-in/Ingress. Their passing result does not contradict the findings below: they do not assert every keyboard transition, comprehensibility, task priority, or actual-device experience.

No application changes were made, so these are **baseline results**, not tests of a redesigned UI or fixes. Temporary audit probes were not added to the permanent test suite.

## 3. Measured mobile hierarchy

The following are rendered CSS-pixel measurements, with page scroll at zero unless stated. They are sample states, not universal dimensions.

| State | Viewport | Header height | List height | Results region starts at | Relevant implication |
| --- | --- | --- | --- | --- | --- |
| Waiting, demo, empty list | 390×844 | 127px | 218px | 710px | Empty preparation still occupies the same substantial preview area. |
| Waiting, demo, 12 saved songs / 19 results | 390×844 | 127px | 218px | 710px | First song starts near the bottom; its Add action is below the initial viewport. |
| Waiting, Music Assistant artist search, empty list | 390×844 | 127px | 218px | 805px | Search modes/help plus the empty list leave only the Results heading at the bottom. |
| Expanded 12-song list | 390×844 | 127px | 450px | 942px | Expanded list is a second substantial scrollable surface. |
| Expanded list, short viewport | 390×440 | 127px | 188px | 679px | The height cap reduces content area sharply; it does not make the overall task flow compact. |
| Current, playing, short demo title | 390×844 | 127px | 270px | 1206px | The player itself is about 424px high; search remains present, but results are far below. |
| Current, playing | 320×700 | 121px | 220px | 1120px | The narrow layout changes some preview content but remains vertically expensive. |
| Upload metadata review | 390×844 | 127px | 218px | 1377px | Expanded upload review sits inside Find music, ahead of list and results. |

At the scrolled-results position, the 390px waiting layout had:

- header: `top 0`, `bottom 127`;
- sticky list: `top 135`, `bottom 353`, height approximately `218`;
- approximately **345px / 41% of an 844px viewport** occupied by the header, gap, and sticky list;
- the first result action partly behind that sticky region at the particular scroll position measured.

The existing focus-visibility correction helps keyboard-focused result actions. It does not make the sticky region less dominant, and ordinary pointer scrolling can still put content behind it. The recommendation is to change the hierarchy and persistent-space budget, not merely add more scroll corrections.

Visible input text measurements:

| Field | Computed size |
| --- | --- |
| Nickname | 16px |
| Search catalogue | 13px |
| Settings fields | 13px |
| Private recovery key | 12px |
| Upload title/artist/album | 16px |

Search/settings/recovery are the inconsistent cases. The audit did **not** physically reproduce iOS input zoom; that remains a device check.

## 4. Confirmed interaction findings and reproduction

Use an isolated demo/test instance for playback reproduction. Do not test accidental replacement against an in-use room/speaker.

### G06 — menu covers keyboard focus and does not respond to Escape there

1. In a fresh/unjoined browser, open `/participant` at 390×844.
2. Open Menu.
3. Tab through the navigation to Listening room, then press Tab again.
4. Focus moves to `#nickname`, while the menu remains open above it.
5. Press Escape from the name field. The menu stays open.

Measured menu bounds: `y 126–336`; focused field: `y 253–301`. The field is **entirely covered**. The page cannot solve this by the implemented header-only Escape handler, because the event originates outside the header. This is a substantive keyboard/focus-obscuration defect, not only a stylistic preference. See `web/app-header.ts:43–51,89–95`.

### G03 — LIVE · SONOS without a playback destination

1. Save a valid synthetic Music Assistant connection.
2. Do not select a speaker.
3. Open settings or the participant page.

Observed: badge says `LIVE · SONOS`; integration state has `destination: null` and `playbackAvailable: false`. The label derives from mode, not readiness or actual speaker type. See `web/navigation.ts:27`.

### J02 — recovery differs between entry URLs

In a fresh browser, `/join` contains zero `#list-recovery` controls. Unjoined `/participant` contains one. The public QR points to `/join`, so a new-phone visitor following it does not get the same optional recovery path. See `web/main.ts:483–503,556–558`.

### P02 — two different replacement safety behaviours

1. Play Northern Lights in the demo.
2. Search for Late Summer and press its result-row Play.
3. Observe replacement with **zero confirmation dialogs**.
4. While that plays, press Play next from the saved list.
5. Observe **one replacement confirmation**.

Both are deliberate explicit Play actions, but the safeguards differ by where the action was initiated. See `web/main.ts:79–85,458,471`.

### S08 — searching disables an unrelated turn action

With a track playing, hold a search response pending in the browser test harness. Observed:

- Finish my turn: disabled;
- Pause: still enabled.

Search uses the global general-action busy flag; player buttons have a separate path. Keep valid turn/transport operations independent from read-only catalogue latency. See `web/main.ts:132–155,318,376–388`.

### V11 — first list creation does not appear in an already-open second tab

1. Join in one browser context, with no private list created yet.
2. Open two participant tabs in that same context. Both show My list · 0.
3. In the first tab, search and Add the first song using the ordinary UI.
4. First tab shows 1. The second continues to show 0.
5. Bring the second tab forward and trigger a room state/order update. It still shows 0.
6. Reload it: it shows 1 and the saved song.

The tab that initially received missing-library does not subscribe to that subsequently created owner’s stream or refresh on ordinary focus. This can look like lost preparation, despite correct durable storage. See `web/preparation-controller.ts:67–111` and `web/main.ts:556–577`.

### S07 — browser Back does not navigate artist/album levels

Artist → albums navigation leaves the URL `/participant` and adds no browsing history entry. Browser Back returned to the prior document in the test (in the isolated first-document case, `about:blank`), rather than the artist results. The in-page ← Artists/← Albums buttons do work; the issue is the mismatch with normal browser navigation, not a claim that backtracking is impossible.

## 5. Accessibility findings

### Automated checks

Across the 35 scanned walkthrough states:

| Rule | Observed where | Interpretation |
| --- | --- | --- |
| `label-content-name-mismatch` | Shared brand link across scanned pages | Fixed accessible name omits visible route/nickname subtitle. Serious rule classification; revise label structure and verify with speech input. |
| `page-has-heading-one` | Three host captures | Host has a named main landmark but no h1. Moderate **best-practice** finding, not an automatic WCAG failure solely for missing h1. |
| `heading-order` | Three public-display captures | Invitation h3 follows the main h1 before the Turn order h2. Moderate **best-practice** finding. |

Some colour-contrast checks were marked incomplete and require manual interpretation. No clean automated report should be described as full accessibility certification. The menu focus defect was found with a targeted keyboard probe, not by these axe scans.

### Manual contrast calculation

Ratios calculated from CSS colour values using WCAG relative luminance:

| Foreground / boundary | Adjacent background | Ratio | Comment |
| --- | --- | --- | --- |
| Main text `#f2f0e6` | `#101713` | 15.93:1 | Strong. |
| Secondary text `#a1b0a3` | `#18211b` | 7.27:1 | Strong solid-colour text contrast; small size still hurts readability. |
| Gold `#e9bd79` / dark ink `#18241b` | Each other | 9.20:1 | Strong primary-action contrast. |
| Generic boundary `#303d33` | `#101713` | 1.60:1 | Too faint if it alone identifies an interactive control. |
| Generic boundary `#303d33` | `#18211b` | 1.45:1 | Decorative dividers do not all need 3:1. |
| Search boundary `#40503a` | Input fill `#111b14` | 2.04:1 | Below 3:1 where required for control identification. |
| Secondary text `#a1b0a3` | Gradient endpoint `#2c3a29` | 5.31:1 | Still useful contrast; test actual gradient positions and opacity separately. |

These measurements support keeping the palette while strengthening specific affordances. They do not support replacing the entire dark theme.

### Text/spacing stress checks

Separate follow-up probes used a 320×700 viewport with (a) text-spacing overrides, (b) each rendered computed font size doubled, and (c) both together. The test context allowed diagnostic style injection; the production CSP was not changed. These are robustness probes, **not a substitute for native browser zoom, user text preferences, or a formal WCAG conformance evaluation**.

| Page/state | Spacing-only document width | Doubled-text document width | Combined document width |
| --- | --- | --- | --- |
| Join, unjoined | 320px | 320px | 320px |
| Participant entry, unjoined | 320px | 320px | 320px |
| Configured settings, no speaker | 320px | 340px | 450px |
| Host, one participant | 320px | 379px | 476px |
| Display, idle | 320px | 320px | 417px |

The doubled-text settings capture visibly clips the large settings heading horizontally. Main walkthroughs at ordinary text sizes did not show horizontal overflow in the measured states. This is why “fits at 320px” and “works with larger text” must be tested separately.

No claim is made that spacing-only checks above prove absence of all clipping/content loss, or that every expanded subflow passed a full text-resize audit.

## 6. Coverage matrix

**Walkthrough** = additionally exercised/instrumented for this audit. **Suite** = exercised by the existing passing browser tests. **Code** = implementation reviewed. **Device** = still needs physical/assistive-technology verification.

| Interface area / elements | Coverage | Notes |
| --- | --- | --- |
| Home heading, role links, brand, menu, fullscreen, skip link | Walkthrough, Suite, Code | Different home serif typography, adjacent role actions, subtitle/name issue reviewed. |
| Join label/input/submit, checking/offline/error/removed entry | Walkthrough, Suite, Code | Native field works; focused menu defect and recovery asymmetry confirmed. |
| Entry recovery, private key, revocation, unfinished upload | Walkthrough, Suite, Code | Successful recovery does not join. Raw key captures not retained here. |
| Participant hero, chip, seat/countdown, expanded circle | Walkthrough, Suite, Code | 1/many people, waiting/current; no private songs in roster. |
| Artist/song modes, search, loading, counts, notices, empty/error | Walkthrough, Suite, Code | Measured hierarchy and pending-search coupling. |
| Artist → album → songs, breadcrumbs, query/source retention | Walkthrough, Suite, Code | Browser history mismatch confirmed. |
| Verified/metadata-only groups, source select, unavailable/version rows | Walkthrough, Suite, Code | Exact-source safeguards preserved; language/layout reviewed. |
| Compact/expanded list, edit mode, handles/buttons, options | Walkthrough, Suite, Code | Browser lists included 0/1/3/12 and suite 24-item cases; no claim of a new 200-item phone benchmark. |
| Save states, lost reply, conflict, review, undo, played/removed | Walkthrough, Suite, Code | Lost acknowledgement was injected only into isolated synthetic data; retained error visibility reviewed. |
| Recovery creation/replacement/import, device access, capacities | Walkthrough, Suite, Code | Capacity/storage bounds also covered by unit/controller tests; not every capacity rendered in a live browser. |
| File picker, progress/processing/cancel, review inputs, Add/discard | Walkthrough, Suite, Code, Device | Synthetic upload analysis; native picker and real formats on phones remain device checks. |
| Playback art/title/artist/status/progress/time, pause/resume, volume | Walkthrough, Suite, Code, Device | Synthetic speaker/demo only. Real audible lifecycle remains outside this audit. |
| Reveal hidden/pending/confirmed, replace, finish, natural completion | Walkthrough, Suite, Code, Device | No autoplay; public state stays server-confirmed. |
| Host current/next/count, volume, ordered roster, move/remove/advance | Walkthrough, Suite, Code | Empty and 8-person screenshots; actual UI two-tab first-save probe. |
| Invitation QR and guest/display links | Walkthrough, Suite, Code, Device | Copy/share absence reviewed; physical QR scan distance not validated. |
| Music connection detection/manual token/browser sign-in | Walkthrough, Suite, Code | Own walkthrough used synthetic saved connection; existing HA suite exercises popup/Ingress authorization. |
| Saved/failed connection, speaker select/save, recovery | Walkthrough, Suite, Code | Misleading LIVE badge confirmed with no speaker. |
| Guest/file addresses, automatic check, overrides, wrong-origin page | Walkthrough, Suite, Code | Read-only file diagnostics remain non-audible. No live LAN address switched. |
| Display idle/hidden/revealed/paused/stopped/disconnected | Walkthrough, Suite, Code, Device | 1080p walkthrough; existing suite adds 720p/1366 and phone layouts, motion continuity and long metadata. |
| QR, current-first strip, single/many people, long names | Walkthrough, Suite, Code, Device | No private queue; ten-foot readability and TV remote still require actual-room checks. |
| Record fallback, 180 sticker phrases, shuffle/storage/motion | Suite, Code, representative walkthrough | Humour remains decorative, not functional instruction; preserve the no-repeat/stable-per-playback behaviour. |
| Typography, colours, surfaces, targets, focus, reduced motion | Walkthrough, Suite, Code, Device | Solid-colour contrast measured; real screen readers, forced colours, iOS/Android keyboards not certified. |
| Server error/unknown route, unsafe address and token failure copy | Suite, Code | HTML recovery currently unthemed; API JSON must remain separate from user-facing HTML fallback. |

Every frontend module was reviewed, including the shared shell/navigation/path helpers, participant access, catalogue/source controls, preparation/player controllers, upload UI, media/visual helpers, public room/order/record labels, settings/addressing, document, and stylesheet. Relevant response shapes, validation, privacy boundaries, and operational docs were also examined.

## 7. Screenshot index

All are local current-application captures from this audit, not redesign mockups. These files are intentionally excluded from Git; the observations and reproductions above are the versioned evidence.

| Screenshot | What to inspect |
| --- | --- |
| `home-mobile.png` | Serif heading, adjacent role buttons, Full screen in the entry header. |
| `search-mobile.png` | Header/status/search/list stack before the first result action. |
| `sticky-list-mobile.png` | Amount of the viewport occupied by persistent surfaces. |
| `player-mobile.png` | Pause/Finish proximity, volume/reveal hierarchy, continued search below. |
| `source-choice-mobile.png` | Empty-list space before results and exact-source decision language. |
| `upload-review-mobile.png` | File review inside the search region; downstream list/results displacement. |
| `unsynced-mobile.png` | Retained list scroll can leave detailed error/Retry outside the visible list area. |
| `menu-obscures-focus.png` | The name field is focused but entirely covered; Escape from it fails to dismiss. |
| `host-empty-desktop.png` | Control/zero-stat emphasis versus invitation readiness. |
| `host-mobile.png` | Administrative row controls and long scroll to the invitation. |
| `connected-without-speaker.png` | `LIVE · SONOS` despite the empty destination selector. |
| `settings-mobile.png` | Reconnect as primary; unchanged speaker editing; address card density. |
| `settings-enlarged-text.png` | Heading overflow; larger text is not the same as merely narrowing the viewport. |
| `display-hidden.png` | The strong existing green/gold identity and restrained stage worth preserving. |

## 8. Remaining validation

Before accepting implementation changes, run the task and regression matrix in [the audit’s acceptance section](ui-ux-audit.md#10-acceptance-criteria-and-user-research), including:

- Physical iPhone/Safari and Android/Chrome with real keyboards, larger text, browser bars, landscape, and safe areas.
- VoiceOver/TalkBack and keyboard/speech-input testing beyond automated rule scans.
- Real-room TV distance, QR scanning and remote-control navigation.
- Real Music Assistant/provider catalogues, long source/version labels and unsupported capabilities.
- Owner-led audible speaker lifecycle and interference/recovery tests.
- Formative usability sessions with guests and a host; observed comprehension of privacy, source selection, next pick, reveal, and finish.

The evidence supports a strong simplification direction and several concrete fixes. It does not replace those acceptance checks or authorise a change to the permanent-room, privacy, source-selection, or playback contracts.
