# Shared page-layout system — plan and progress

Started 18 October 2026. Baseline: release 0.3.2.

**Status: implemented and verified for release 0.3.3, 18 October 2026.**

## Goal

Every application route and server-rendered fallback uses explicit shared layouts and presentation rules. Pages supply content; layouts own geometry; components own their appearance; feature controllers own state. Preserve the forest-green, cream and gold theme and the existing TypeScript/DOM architecture.

## Design

- **Foundation:** one source for colours, typography, spacing, controls and card surfaces, served to both the application and static error pages.
- **Shell:** persistent `AppHeader`, centralized navigation, common header/content envelope and aligned global notices.
- **Workspace:** host, settings and joined participant share a 1320px desktop envelope, 360px secondary column and 22px gap. Below 1100px, stack within 720px with 18px gutters and 14px gaps.
- **Compact:** home, join, participant entry/recovery and server fallbacks share a 660px envelope. Home uses an explicit branded heading variant.
- **Display:** public-room content and connecting state share a display layout with viewing-distance typography and viewport-height behavior.
- **Composition:** small DOM helpers create page frames and named grid slots. Participant DOM order remains player → search → list → results, with desktop grid placement alongside the player.
- **Components:** shared heading, panel, field, action-group and notice presentation. Use explicit compact/highlighted variants rather than route-dependent styling. Parents own spacing between children.
- **CSS ownership:** ordered foundation/layout/component/feature layers with shallow selectors. Remove superseded route geometry and account for the precedence of existing unlayered rules during migration.
- **Responsive behavior:** page breakpoints belong to layout CSS. Use natural component wrapping; add container queries only where needed. Scroll/short-screen JavaScript follows CSS layout state instead of repeating viewport-width thresholds.
- **Fallbacks:** static server HTML consumes the same foundation and compact presentation through ingress-aware asset URLs, without depending on application JavaScript.

## Implementation checklist

- [x] Save plan and progress tracker.
- [x] 1. Introduce shared foundation, layout helpers and CSS ownership.
- [x] 2. Migrate host/settings to shared workspace composition.
- [x] 3. Migrate participant composition and layout-dependent scrolling.
- [x] 4. Unify compact pages, display frames, repeated components and server fallbacks.
- [x] 5. Remove obsolete overrides and add cross-page layout contracts.
- [x] 6. Complete verification and record results.

## Verification contract

- Matching workspace edges, columns and gutters across host/settings/participant.
- Matching join-form geometry on `/join` and unjoined `/participant`.
- Header/menu alignment and consistent card/form presentation.
- Viewports on either side of responsive boundaries, phone and desktop sizes.
- Loading, empty, disconnected and error states retain the appropriate layout.
- Participant list ordering, stable player geometry and browse/history scroll preservation.
- Static fallback styling and asset delivery through direct access and Home Assistant ingress, with JavaScript disabled.
- Build, typecheck, unit/controller suite, browser workflows and `git diff --check`.
- Screenshots stay local/ignored.

## Progress log

### Plan saved

- Confirmed independent layout construction in `web/main.ts`, `web/settings.ts` and `web/public-room.ts`.
- Confirmed inherited route selectors change shared join-form presentation.
- Confirmed three participant JavaScript checks duplicate the 1100px layout breakpoint.
- Plan saved before implementation.

### Shared layouts and components implemented

- `web/page-layout.ts` creates explicit workspace/compact/display frames and sidebar/music compositions with named slots. Both entry routes now use the same 660px compact frame.
- `web/ui-components.ts` shares panels, page/section headings, fields, action groups and notices. Field presentation is independent of the containing route; highlighted and compact panels are explicit variants.
- `web/public/assets/ui-foundation.css` imports `ui-layouts.css` and `ui-components.css`. These live together under public assets so the application build and JavaScript-free server fallbacks use identical source rules, including relative imports through ingress.
- `web/style.css` imports the foundation and contains feature styling in an explicit cascade layer. Removed the old `error.css`, independent route widths, inherited card/form styles and superseded heading rules.
- Participant scrolling reads the CSS layout mode; short-screen behavior uses viewport height plus the CSS stacking rule. Playback-only updates retain their existing local rendering path.
- Host/settings use shared sidebar composition. Participant keeps player → search → list → results DOM order with named desktop grid placement. Display connecting/live views both use the display frame.
- Added cross-route geometry/theme tests, responsive-boundary tests, entry loading/failure/offline checks, and JavaScript-disabled direct/ingress fallback coverage.
- Initial verification: build/typecheck, 195 unit/controller tests, 28 existing targeted browser workflows and 6 layout/ingress workflows passed. Final verification follows the last CSS cleanup.

### Maintenance rules

- New page/state: choose a `pageFrame` variant; do not add route-level widths or gutters.
- New composition: use `workspaceGrid` and named slots; feature code controls content order.
- Shared appearance: change the foundation/components, or add a named variant when a real repeated use needs it.
- Feature CSS owns internals (player geometry, public artwork, list disclosure), not overrides of generic cards/fields/headings on a whole route.
- Page responsive thresholds belong to layout CSS. JavaScript reads `stackedLayout()` when behavior depends on stacking.
- Use wrapping before adding component breakpoints. No container queries were needed for the migrated components.
- Extend browser contracts when adding a new layout/state. Screenshots remain ignored.

### Final verification — 18 October 2026

- Production build and TypeScript checks passed.
- **195 unit/controller tests passed.**
- **90 Chromium browser workflows passed**, including the four new cross-page contracts and expanded ingress fallback coverage.
- Reviewed desktop settings/participant and phone host/entry/fallback captures. Adjusted plain success text to use the theme colour, reserving bordered success surfaces for explicit notice components.
- After that final CSS-only adjustment, rebuilt and reran **9 settings, Home Assistant and shared-layout workflows; all passed**.
- `git diff --check` passed. Screenshots remain ignored; the only tracked image is the existing `icon.png`.
- Verification logs: `/tmp/opencode/aoty-shared-layout-unit.log`, `/tmp/opencode/aoty-shared-layout-browser.log`, `/tmp/opencode/aoty-shared-layout-final-targeted.log`.
- Release 0.3.3 verification reran the production build, typecheck, all **195 unit/controller tests** and all **90 Chromium workflows** successfully. Release logs: `/tmp/opencode/aoty-0.3.3-unit.log` and `/tmp/opencode/aoty-0.3.3-browser.log`.
- Publication uses the `v0.3.3` image workflow; anonymously verify amd64/arm64 manifests and image configurations before pushing the versioned Home Assistant store manifest to `main`.

## Completion criterion

A shared layout/component change updates every consumer. Intentional differences are named variants, and cross-page browser checks catch drift. Playback, private-list, exact-source, ingress and uncertain-write behavior retain their existing controllers and contracts.

## References

- [CSS custom properties](https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_cascading_variables/Using_CSS_custom_properties)
- [Cascade layers](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@layer)
- [Container queries](https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_containment/Container_queries)
