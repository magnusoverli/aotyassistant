# Incremental UI updates — 0.3.15

The browser uses persistent DOM components rather than rebuilding the main workspace after a state change. Backend snapshots remain authoritative; rendering does not change playback, reveal, membership, or private-list authorization rules.

## Component boundaries

- **Participant workspace:** the hero, search form, results container, private list, upload disclosure, and player retain their nodes. Searches update results; a source choice updates its own row. Membership loss clears the participant/player node stores and catalogue rows before showing the entry screen.
- **Catalogue rows:** `CatalogueRow` owns a result's artwork, source selector, and actions. Rows are keyed by kind and opaque result ID. Unchanged rows stay attached; rows outside the current results are evicted. Handlers always use the current exact source.
- **Player:** transport, reveal, progress, volume, title, and output are patched independently. Pause, resume, reveal, and server acknowledgements retain the player card, controls, and unchanged images. Optimistic state remains private; public reveal still requires server confirmation.
- **Private list:** list chrome, recovery inputs, keyed upcoming rows, and visible history rows retain their nodes. Closed history remains lazy and expanded history remains paginated. Add acknowledgements update only matching controls. Upload review inputs keep their selection during list notifications.
- **Uploads:** progress, processing, cancellation, and review update the upload panel directly. Only changed image URLs replace images; metadata fields are not recreated when progress or list state changes.
- **Settings:** connection, active speaker, guest addresses, recovery, and notices use independent persistent nodes. Speaker options are keyed by ID. Refresh toggles the existing button's `aria-busy` state for the discovery lifetime, including errors. Same-task settings notifications are coalesced; request dispatch and authoritative state changes remain immediate.
- **Host, entry, header, and display:** invitation content is keyed separately from speaker/player state; entry forms survive private-list checks; listening-order seats are keyed by participant ID; unchanged header/display text and attributes are not rewritten.

## Rendering rules

`web/view-nodes.ts` provides small framework-free primitives:

- `ViewNodes.get()` / `.el()` retain named nodes within one component. Keys must be unique within that component and always represent the same node/type.
- `text`, `attr`, and `prop` write only changed values. In particular, setting an already-current input value or restoring its selection unnecessarily can interrupt text composition.
- `children()` uses `syncChildren()` to retain children already in position. Never append a live cached subtree to a temporary fragment or staging parent: that detaches it even if it is subsequently reused.
- Dynamic caches must be pruned to current items (`ViewNodes.retain()` or the row maps), and private result caches cleared at identity boundaries.
- Cached controls must read current state or have their handlers updated; avoid capturing an obsolete turn ID, selected source, list revision, or disabled state.

Calling a component's update method is not itself a DOM replacement. The important contract is that an unrelated change neither replaces nor temporarily detaches its nodes. New search results, actual membership transitions, and removed items legitimately change their own content.

## Verification

Production build/typecheck, **245 backend/controller tests**, all **118 Chromium workflows**, and the four-workflow before/after audit pass for this implementation.

`tests/browser/incremental-rendering.spec.ts` observes node identity **and ancestor removals** across search, source selection, Play/Pause/Resume/Reveal, upload progress, list events during text editing, speaker discovery success/failure, live speaker rename, tab revalidation, and membership changes. The normal browser suite continues to cover privacy, recovery, geometry, scrolling, and keyboard workflows.

```sh
npm run typecheck
npm test
npm run test:browser
```

The same instrumented Chromium audit, using synthetic Music Assistant and controlled upload-progress events, measured:

| Action | Before | After |
| --- | ---: | ---: |
| Search: workspace replacements | 2 | 0 |
| Choose one source: workspace replacements | 1 | 0 |
| One upload progress notification: workspace replacements | 1 | 0 |
| Pause: player-card replacements | 3 | 0 |
| Refresh speakers: settings-workspace replacements | 4 | 0 |
| Unchanged visible-tab recheck: workspace replacements | 2 | 0 |

All retained regions stayed continuously attached in the follow-up audit. Upload-title selection remained at characters 2–5 during a private-list notification (previously it jumped to the end). These are DOM-operation measurements, not frame-rate or physical-phone benchmarks. The audit source and before/after logs are retained under `/tmp/opencode/ui-render-review/`; the node-retention contracts also run in the repository's browser suite.
