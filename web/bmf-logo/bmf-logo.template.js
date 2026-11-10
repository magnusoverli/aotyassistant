// <bmf-logo> - the animated Bjørgvin Mørkemusikk Forening logo as a drop-in web component.
//
//   <script type="module" src="bmf-logo.js"></script>
//   <bmf-logo style="width:480px;color:white" order="random" jitter="0.6" loop></bmf-logo>
//
// Every setting is an HTML attribute, so it can be changed at any time from the page
// (el.setAttribute("duration", 2) or el.configure({ duration: 2, loop: true })).
// Changing a setting restarts the animation. The logo takes the text colour of its parent.
//
// Settings (attribute: default)
//   order: random        which letters start first: random | center | edges | left | right
//   jitter: 0.5          0-1, how much random variation is mixed into start times and speeds
//   origin: random       where on each letter growth starts: random | base | top
//   sprouts: 2           how many points each letter grows from at once (1-4)
//   duration: 1.1        seconds one letter takes to grow
//   spread: 1.2          seconds between the first and the last letter starting
//   bloom-duration: 0.6  seconds the arrowheads take to pop in
//   loop                 present = replay forever (use as a loader)
//   hold: 1.6            loop only: seconds the finished logo stays visible
//   fade: 0.45           loop only: seconds of fade-out before the next round
//   continuous           present = continuously travelling reveal, instead of grow/hold/fade
//   coverage: 40         continuous only: percent of each outline drawn (5-95)
//   cycle-duration: 20   continuous only: seconds for a full trip around an outline (2-120)
//   seed                 a number = the same "random" growth every time; absent = different each time
//   paused               present = stay hidden until play() is called
//
// Methods: play(), finish() (jump to the finished logo), configure({...}).
// Event: "finish" fires each time the logo has fully grown.

const DATA = /*DATA*/null;
const SVG = "http://www.w3.org/2000/svg";
const DEFAULTS = { order: "random", jitter: 0.5, origin: "random", sprouts: 2, duration: 1.1, spread: 1.2,
                   "bloom-duration": 0.6, hold: 1.6, fade: 0.45, coverage: 40, "cycle-duration": 20 };
const ATTRS = [...Object.keys(DEFAULTS), "loop", "continuous", "seed", "paused"];
let uid = 0;

// Small seeded random generator, so a given seed always gives the same growth.
const rng = seed => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const el = (name, attrs, parent) => {
  const node = document.createElementNS(SVG, name);
  for (const k in attrs) node.setAttribute(k, attrs[k]);
  parent.appendChild(node);
  return node;
};

class BmfLogo extends HTMLElement {
  static observedAttributes = ATTRS;
  #run = 0; #anims = []; #timer = 0; #queued = false; #all; #masked; #maskId; #noise; #letters = []; #blooms = [];

  constructor() {
    super();
    const root = this.attachShadow({ mode: "open" });
    const id = "bmf-grow-" + ++uid;
    // Constructed styles work with the app's style-src 'self' policy; no inline style tag.
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(`:host{display:block}svg{display:block;width:100%;height:auto;fill:currentColor}
      .grow{fill:none;stroke:#fff;stroke-width:5.8;stroke-linecap:round;stroke-linejoin:round}
      .bloom{transform-box:fill-box;transform-origin:center}`);
    root.adoptedStyleSheets = [sheet];
    const svg = el("svg", { viewBox: `0 0 ${DATA.w} ${DATA.h}`, role: "img", "aria-label": "Bjørgvin Mørkemusikk Forening" }, root);
    const defs = el("defs", {}, svg);
    // Distort only the reveal ink, not the artwork: softly irregular tips still end in the exact logo.
    const filter = el("filter", { id: `${id}-organic`, x: "-20%", y: "-20%", width: "140%", height: "140%",
      "color-interpolation-filters": "sRGB" }, defs);
    this.#noise = el("feTurbulence", { type: "fractalNoise", baseFrequency: "0.13 0.19", numOctaves: 2, seed: 1, result: "noise" }, filter);
    el("feDisplacementMap", { in: "SourceGraphic", in2: "noise", scale: 2.2, xChannelSelector: "R", yChannelSelector: "G" }, filter);
    const mask = el("mask", { id, maskUnits: "userSpaceOnUse", x: 0, y: 0, width: DATA.w, height: DATA.h }, svg);
    this.#all = el("g", {}, svg);
    this.#maskId = id;
    this.#masked = el("g", {}, this.#all);
    // Each letter is revealed by its own outline, drawn as a growing line inside a mask.
    for (const letter of DATA.letters) {
      // Clip each letter's reveal ink to its own artwork so wider strokes cannot reveal neighbours.
      const clipId = `${id}-letter-${this.#letters.length}`;
      const clip = el("clipPath", { id: clipId }, defs);
      el("path", { d: letter.d }, clip);
      const clipped = el("g", { "clip-path": `url(#${clipId})` }, mask);
      const growth = el("g", { filter: `url(#${id}-organic)` }, clipped);
      const strokes = letter.subs.map(s => ({ ...s, node: el("path", { class: "grow", pathLength: 1, d: s.d }, growth) }));
      el("path", { d: letter.d }, this.#masked);
      this.#letters.push({ cx: letter.cx, strokes, revealWidth: letter.revealWidth });
    }
    for (const b of DATA.blooms) this.#blooms.push(el("path", { class: "bloom", d: b.d }, this.#all));
  }

  connectedCallback() { this.#restart(); }
  disconnectedCallback() { this.#stop(); }
  attributeChangedCallback() { if (this.isConnected) this.#restart(); }

  configure(settings) {
    for (const [k, v] of Object.entries(settings)) {
      if (v === false || v == null) this.removeAttribute(k);
      else this.setAttribute(k, v === true ? "" : v);
    }
  }
  play() { this.#stop(); this.#play(); }
  finish() { this.#stop(); }

  #num(name) { const v = parseFloat(this.getAttribute(name)); return Number.isFinite(v) ? v : DEFAULTS[name]; }
  #stop() {
    this.#run++;
    clearTimeout(this.#timer);
    this.#anims.forEach(a => a.cancel());
    this.#anims = [];
    this.#all.style.opacity = "";
    this.#masked.removeAttribute("mask");
  }
  // Several settings usually change together, so restart once after they have all been applied.
  #restart() {
    if (this.#queued) return;
    this.#queued = true;
    queueMicrotask(() => {
      this.#queued = false;
      this.#stop();
      if (this.hasAttribute("paused")) this.#all.style.opacity = 0;
      else if (this.isConnected) this.#play();
    });
  }

  #play() {
    const run = this.#run;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return; // show the finished logo, no motion
    this.#masked.setAttribute("mask", `url(#${this.#maskId})`);
    const seed = parseFloat(this.getAttribute("seed"));
    const rand = rng(Number.isFinite(seed) ? seed : (Math.random() * 2 ** 32) | 0);
    this.#noise.setAttribute("seed", 1 + Math.floor(rand() * 10000));
    const order = this.getAttribute("order") || DEFAULTS.order;
    const origin = this.getAttribute("origin") || DEFAULTS.origin;
    const jitter = Math.min(1, Math.max(0, this.#num("jitter")));
    const sprouts = Math.min(4, Math.max(1, Math.round(this.#num("sprouts"))));
    const duration = Math.max(0.05, this.#num("duration")), spread = Math.max(0, this.#num("spread"));
    const continuous = this.hasAttribute("continuous");
    const coverage = Math.min(95, Math.max(5, this.#num("coverage"))) / 100;
    const cycle = Math.min(120, Math.max(2, this.#num("cycle-duration")));
    const add = (node, frames, start, len, easing, iterations = 1) =>
      this.#anims.push(node.animate(frames, { delay: start * 1000, duration: len * 1000, easing, iterations, fill: "both" }));

    let end = 0;
    for (const letter of this.#letters) {
      const side = letter.cx / DATA.w, mid = Math.abs(side - 0.5) * 2;
      const rank = order === "center" ? mid : order === "edges" ? 1 - mid : order === "left" ? side
                 : order === "right" ? 1 - side : rand();
      if (continuous) {
        const seconds = cycle * (1 + (rand() - .5) * .45 * jitter);
        const step = 1 / sprouts;
        for (const s of letter.strokes) {
          const originAt = origin === "base" ? 0 : origin === "top" ? s.top : rand();
          const at = originAt + rank * step;
          const ink = { strokeDasharray: `${step * coverage} ${step * (1 - coverage)}`,
            strokeWidth: 5.8 * (1 + (rand() - .5) * .35 * jitter) };
          // An integer outline-length shift rejoins exactly, with no reset, fade or hidden beat.
          add(s.node, [{ ...ink, strokeDashoffset: -at }, { ...ink, strokeDashoffset: -at - 1 }],
            0, seconds, "linear", Infinity);
        }
        continue;
      }
      const start = (rank * (1 - jitter) + rand() * jitter) * spread;
      const len = duration * (1 + (rand() - 0.5) * 0.9 * jitter);
      end = Math.max(end, start + len);
      for (const s of letter.strokes) {
        // Rounded sprouts advance in unequal, smooth pulses. Every stage grows forward;
        // the fixed seed drives widths, pulse timing and the softly irregular reveal edge.
        const at = origin === "base" ? 0 : origin === "top" ? s.top : rand();
        const step = 1 / sprouts;
        const width = 5.8 * (1 + (rand() - 0.5) * .35 * jitter);
        const frames = [0, .15, .35, .6, .82, 1].map((offset, i, offsets) => {
          const amount = i === 0 ? 0 : i === offsets.length - 1 ? 1 : offset + (rand() - .5) * .16 * jitter;
          return { offset, strokeDasharray: `${step * amount} ${step * (1 - amount)}`,
            strokeDashoffset: step * amount / 2 - at,
            strokeWidth: i === 0 ? 0 : width + (Math.max(width, letter.revealWidth) - width) * amount ** 3,
            easing: "ease-in-out" };
        });
        add(s.node, frames, start, len, "linear");
      }
    }
    // Continuous mode keeps arrowheads steady and never schedules an intro finish/hold/fade.
    if (continuous) return;
    const bloom = Math.max(0.05, this.#num("bloom-duration"));
    this.#blooms.forEach((node, i) => {
      const start = Math.max(0, end - 0.45 + (rand() - 0.5) * 0.3 * jitter);
      add(node, [{ transform: "scale(0)", opacity: 0 }, { transform: "scale(1)", opacity: 1 }], start, bloom, "cubic-bezier(.3,1.5,.5,1)");
      if (i === this.#blooms.length - 1) end = Math.max(end, start + bloom);
    });

    Promise.all(this.#anims.map(a => a.finished)).then(() => {
      if (run !== this.#run) return;
      this.dispatchEvent(new Event("finish"));
      if (!this.hasAttribute("loop")) return;
      this.#timer = setTimeout(() => {
        const out = this.#all.animate([{ opacity: 1 }, { opacity: 0 }], { duration: this.#num("fade") * 1000, easing: "ease-in", fill: "forwards" });
        this.#anims.push(out);
        out.finished.then(() => { if (run === this.#run) { this.#stop(); this.#play(); } }, () => {});
      }, this.#num("hold") * 1000);
    }, () => {});
  }
}

if (!customElements.get("bmf-logo")) customElements.define("bmf-logo", BmfLogo);
export { BmfLogo };
