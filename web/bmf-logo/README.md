# Animated BMF logo: handoff

## Doom Room integration

Imported from the supplied BMF animation handoff. The template uses a constructed shadow
stylesheet so it works with the application's `style-src 'self'` policy. After editing the
template or artwork, run `node build.mjs` from this directory to regenerate `bmf-logo.js`.
Only the generated module is bundled at runtime.

Settings → Appearance provides a local preview and a **Save and replay on display** action.
Saved controls update connected displays through the existing room stream and persist in
`display-background.json` in the app's data directory. The background starts enabled and
looping, in room gold at 12% opacity. A blank seed chooses new patterns;
any fixed seed repeats the same organic growth pattern. Letter grow time in Settings
supports 0.2–60 seconds. The display vertically centres the logo between the play order and
the actual artwork top; the settings preview places it near the top. Both use 8% vertical
compression. Width is automatic: CSS fits the native SVG aspect ratio into both dimensions
of the contained area. PublicRoom observes the artwork position as the display resizes,
including fullscreen, and disconnects the observer on navigation.
Old width preferences are discarded on read without rewriting other saved settings. The `paused` attribute is a
programmatic start gate, not a saved appearance setting; use Replay preview to test intros.

**Continuous reveal** is optional and defaults off. It moves partial reveal strokes indefinitely,
keeping the arrowheads visible. **Visible outline** controls outline coverage (5–95%, default 40),
and **Continuous cycle time** controls a full outline trip (2–120 seconds, default 20). Jitter
varies speed, sprouts sets the number of travelling sections, and order sets starting phases.
These are outline percentages, not exact visible pixel percentages. Intro timings and `loop`
are ignored while continuous mode is on; reduced motion still shows the finished logo.

The Bjørgvin Mørkemusikk Forening logo as an animated web component. The letters grow in like vines
and the two side arrowheads pop in at the end. All animation settings are HTML attributes, so the
application can drive them from its own settings.

## What to ship

Only **`bmf-logo.js`** goes into the application. It is one self-contained ES module (about 27 KB, no
dependencies, artwork embedded). Everything else in this folder is reference or source.

| File | Purpose |
|---|---|
| `bmf-logo.js` | The component. Ship this. |
| `index.html` | Demo page with a control for every setting. Serve the folder over http to try it (module scripts do not load from `file://`). |
| `logo-static.svg` | Static vector logo (white fill). Use where no animation is wanted, and as the build input. |
| `bmf-logo.template.js`, `build.mjs` | Source. `node build.mjs` regenerates `bmf-logo.js` from the template and `logo-static.svg`. Edit the template, never `bmf-logo.js` directly. |

## Usage

```html
<script type="module" src="/path/to/bmf-logo.js"></script>
<bmf-logo style="width: 480px; color: white"></bmf-logo>
```

With a bundler or framework, `import "./bmf-logo.js";` once (it registers the `<bmf-logo>` element) and
then use the tag. It is a standard custom element, so it works in React, Vue, Svelte and plain HTML.
The module touches `HTMLElement` and `customElements` at import time, so with server-side rendering
import it on the client only.

- **Size:** the element is `display: block` and fills its width; height follows the logo's aspect ratio
  (575 : 268). Set a width on it or on its container.
- **Colour:** it uses `currentColor`. Set `color` on the element or a parent. The original logo is white
  and meant for dark backgrounds.
- **Reduced motion:** when the visitor has `prefers-reduced-motion: reduce`, the finished logo is shown
  with no animation, and the `finish` event does not fire.

## Settings

Each one is an attribute. Changing any attribute restarts the animation with the new values.

| Attribute | Default | Meaning |
|---|---|---|
| `order` | `random` | Which letters start first: `random`, `center`, `edges`, `left`, `right` |
| `jitter` | `0.5` | 0 to 1. Random variation mixed into start times and speeds |
| `origin` | `random` | Where on each letter growth starts: `random`, `base`, `top` |
| `sprouts` | `2` | 1 to 4. Number of points each letter grows from at once |
| `duration` | `1.1` | Seconds one letter takes to grow |
| `spread` | `1.2` | Seconds between the first and the last letter starting |
| `bloom-duration` | `0.6` | Seconds the arrowheads take to pop in |
| `loop` | absent | Present: replay forever (loader mode) |
| `hold` | `1.6` | Loop only. Seconds the finished logo stays visible |
| `fade` | `0.45` | Loop only. Seconds of fade-out before the next round |
| `continuous` | absent | Present: continuously travelling reveal instead of the intro loop |
| `coverage` | `40` | Continuous only. Percentage of each outline revealed (5–95) |
| `cycle-duration` | `20` | Continuous only. Seconds per full outline trip (2–120), varied by jitter |
| `seed` | absent | A number gives the same growth pattern every play. Absent: a new pattern each play |
| `paused` | absent | Present: stay hidden until `play()` is called |

Total intro length is roughly `spread + duration` seconds, plus a little for the arrowheads.

## Driving it from application settings

```js
const logo = document.querySelector("bmf-logo");

logo.configure({ order: "center", jitter: 0.2, duration: 1.8, loop: true }); // true adds, false/null removes
logo.setAttribute("sprouts", 3);   // equivalent, one at a time

logo.play();     // restart the animation
logo.finish();   // jump straight to the finished logo
logo.addEventListener("finish", () => { /* fully grown; fires once per round when looping */ });
```

Continuous mode does not emit `finish`: it has no completed growth round. `finish()` or removal
cancels its infinite animations, and removing `continuous` restores the intro behavior.

Typical loader pattern: render `<bmf-logo loop>` while loading, then remove the `loop` attribute or
remove the element when the content is ready.

## Notes for the implementer

- Rendering is inline SVG inside a shadow root, animated with the Web Animations API. No CSS needs to
  be added to the application.
- The growth effect is a mask: each letter's outline is drawn as a growing dashed stroke that reveals
  the filled letter. Rounded caps/joins, seeded width variation, unequal growth pulses and a static
  turbulence/displacement filter soften the reveal edge. Intro strokes widen to a geometry-derived
  width that reaches the letter's interior; each letter's reveal is clipped to its own artwork.
  There is no solid-mask opacity fade. `finish()` and reduced motion bypass the animated mask.
  The artwork is filled shapes, not centre-line strokes.
- Checked in Chromium only. Safari and Firefox have not been tested.
