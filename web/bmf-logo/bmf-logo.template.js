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
//   seed                 a number = the same "random" growth every time; absent = different each time
//   paused               present = stay hidden until play() is called
//
// Methods: play(), finish() (jump to the finished logo), configure({...}).
// Event: "finish" fires each time the logo has fully grown.

const DATA = /*DATA*/null;
const SVG = "http://www.w3.org/2000/svg";
const DEFAULTS = { order: "random", jitter: 0.5, origin: "random", sprouts: 2, duration: 1.1, spread: 1.2,
                   "bloom-duration": 0.6, hold: 1.6, fade: 0.45 };
const ATTRS = [...Object.keys(DEFAULTS), "loop", "seed", "paused"];
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
  #run = 0; #anims = []; #timer = 0; #queued = false; #all; #letters = []; #blooms = [];

  constructor() {
    super();
    const root = this.attachShadow({ mode: "open" });
    const id = "bmf-grow-" + ++uid;
    // Constructed styles work with the app's style-src 'self' policy; no inline style tag.
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(`:host{display:block}svg{display:block;width:100%;height:auto;fill:currentColor}
      .grow{fill:none;stroke:#fff;stroke-width:5.8;stroke-linejoin:miter;stroke-miterlimit:8}.solid{fill:#fff}
      .bloom{transform-box:fill-box;transform-origin:center}`);
    root.adoptedStyleSheets = [sheet];
    const svg = el("svg", { viewBox: `0 0 ${DATA.w} ${DATA.h}`, role: "img", "aria-label": "Bjørgvin Mørkemusikk Forening" }, root);
    const mask = el("mask", { id, maskUnits: "userSpaceOnUse", x: 0, y: 0, width: DATA.w, height: DATA.h }, svg);
    this.#all = el("g", {}, svg);
    const masked = el("g", { mask: `url(#${id})` }, this.#all);
    // Each letter is revealed by its own outline, drawn as a growing line inside a mask.
    for (const letter of DATA.letters) {
      const strokes = letter.subs.map(s => ({ ...s, node: el("path", { class: "grow", pathLength: 1, d: s.d }, mask) }));
      const solid = el("path", { class: "solid", d: letter.d }, mask);
      el("path", { d: letter.d }, masked);
      this.#letters.push({ cx: letter.cx, strokes, solid });
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
    const seed = parseFloat(this.getAttribute("seed"));
    const rand = rng(Number.isFinite(seed) ? seed : (Math.random() * 2 ** 32) | 0);
    const order = this.getAttribute("order") || DEFAULTS.order;
    const origin = this.getAttribute("origin") || DEFAULTS.origin;
    const jitter = Math.min(1, Math.max(0, this.#num("jitter")));
    const sprouts = Math.min(4, Math.max(1, Math.round(this.#num("sprouts"))));
    const duration = Math.max(0.05, this.#num("duration")), spread = Math.max(0, this.#num("spread"));
    const add = (node, frames, start, len, easing) =>
      this.#anims.push(node.animate(frames, { delay: start * 1000, duration: len * 1000, easing, fill: "both" }));

    let end = 0;
    for (const letter of this.#letters) {
      const side = letter.cx / DATA.w, mid = Math.abs(side - 0.5) * 2;
      const rank = order === "center" ? mid : order === "edges" ? 1 - mid : order === "left" ? side
                 : order === "right" ? 1 - side : rand();
      const start = (rank * (1 - jitter) + rand() * jitter) * spread;
      const len = duration * (1 + (rand() - 0.5) * 0.9 * jitter);
      end = Math.max(end, start + len);
      for (const s of letter.strokes) {
        // "sprouts" evenly spaced dashes grow outwards from their centres until they meet.
        const at = origin === "base" ? 0 : origin === "top" ? s.top : rand();
        const step = 1 / sprouts;
        add(s.node, [{ strokeDasharray: `0 ${step}`, strokeDashoffset: -at },
                     { strokeDasharray: `${step} 0`, strokeDashoffset: step / 2 - at }], start, len, "cubic-bezier(.45,0,.2,1)");
      }
      // Fills in the few spots wider than the growing line (junctions, serifs) as the letter completes.
      add(letter.solid, [{ opacity: 0 }, { opacity: 1 }], start + len * 0.7, len * 0.3, "ease-in");
    }
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
