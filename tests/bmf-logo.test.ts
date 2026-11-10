import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

/** Exercise the shipped module's animation lifecycle without a browser or a rendering claim. */
function fixture(reduced = false) {
  type Effect = { frames: Keyframe[]; options: KeyframeAnimationOptions; cancelled: boolean; cancel(): void; finished: Promise<void> };
  const effects: Effect[] = [];
  class Element {
    attributes = new Map<string, string>(); children: Element[] = []; style: Record<string, unknown> = {}; isConnected = false;
    setAttribute(key: string, value: unknown) { this.attributes.set(key, String(value)); this.attributeChangedCallback(); }
    getAttribute(key: string) { return this.attributes.get(key) ?? null; }
    hasAttribute(key: string) { return this.attributes.has(key); }
    removeAttribute(key: string) { this.attributes.delete(key); this.attributeChangedCallback(); }
    attributeChangedCallback() {}
    appendChild(child: Element) { this.children.push(child); return child; }
    attachShadow() { return new Element(); }
    animate(frames: Keyframe[], options: KeyframeAnimationOptions) {
      const effect: Effect = { frames, options, cancelled: false, cancel() { this.cancelled = true; }, finished: new Promise(() => {}) };
      effects.push(effect); return effect;
    }
  }
  type Logo = Element & { configure(settings: Record<string, unknown>): void; play(): void; finish(): void; disconnectedCallback(): void };
  const source = readFileSync(new URL('../web/bmf-logo/bmf-logo.js', import.meta.url), 'utf8');
  const Constructor = runInNewContext(source.replace('export { BmfLogo };', 'BmfLogo;'), {
    HTMLElement: Element, CSSStyleSheet: class { replaceSync() {} },
    document: { createElementNS: () => new Element() }, customElements: { get: () => undefined, define() {} },
    matchMedia: () => ({ matches: reduced }), queueMicrotask, clearTimeout,
    setTimeout: () => { throw new Error('No hold/fade timer should be scheduled in this fixture.'); },
  }) as new () => Logo;
  return { logo: new Constructor(), effects };
}

test('continuous reveal uses partial masks with seamless indefinite travel and cleans up on removal', () => {
  const { logo, effects } = fixture();
  logo.configure({ continuous: true, loop: false, coverage: 40, 'cycle-duration': 20, jitter: 0, sprouts: 2, seed: 7 });
  logo.play();
  const travelling = effects.filter(effect => effect.options.iterations === Infinity);
  assert.ok(travelling.length > 0, 'Continuous motion runs even when intro looping is off.');
  for (const effect of travelling) {
    const [first, last] = effect.frames;
    assert.equal(effect.options.duration, 20_000);
    assert.equal(effect.options.easing, 'linear');
    const [ink, gap] = String(first!.strokeDasharray).split(' ').map(Number);
    assert.ok(Math.abs(ink! / (ink! + gap!) - .4) < 1e-9);
    assert.equal(first!.strokeDasharray, last!.strokeDasharray);
    assert.ok(Math.abs(Number(first!.strokeDashoffset) - Number(last!.strokeDashoffset) - 1) < 1e-9);
  }
  assert.equal(effects.length, travelling.length, 'Only travelling strokes run; there is no solid-mask fill.');
  logo.disconnectedCallback(); assert.ok(effects.every(effect => effect.cancelled));
});

test('replaying a fixed continuous seed is repeatable and switching back cancels every infinite effect', () => {
  const { logo, effects } = fixture();
  logo.configure({ continuous: true, coverage: 65, 'cycle-duration': 45, jitter: .5, seed: 7 });
  logo.play(); const first = effects.slice();
  const pattern = JSON.stringify(first.map(({ frames, options }) => ({ frames, options })));
  logo.play();
  assert.ok(first.every(effect => effect.cancelled));
  const second = effects.slice(first.length);
  assert.equal(JSON.stringify(second.map(({ frames, options }) => ({ frames, options }))), pattern);
  logo.configure({ continuous: false }); logo.play();
  assert.ok(second.every(effect => effect.cancelled));
  const intro = effects.slice(first.length + second.length);
  assert.ok(intro.length > 0); assert.ok(intro.every(effect => effect.options.iterations === 1));
  logo.finish(); assert.ok(effects.every(effect => effect.cancelled));
});

test('reduced motion shows the complete logo without creating continuous effects', () => {
  const { logo, effects } = fixture(true);
  logo.configure({ continuous: true, coverage: 5 }); logo.play();
  assert.equal(effects.length, 0);
});

test('intro letters reveal by expanding strokes, never by fading in a solid mask', () => {
  const { logo, effects } = fixture();
  logo.configure({ duration: 30, seed: 7 }); logo.play();
  const reveals = effects.filter(effect => effect.frames.some(frame => frame.strokeDasharray !== undefined));
  assert.ok(reveals.length > 0);
  for (const effect of reveals) {
    assert.ok(effect.frames.every(frame => frame.opacity === undefined));
    assert.ok(Number(effect.frames.at(-1)!.strokeWidth) >= Number(effect.frames[1]!.strokeWidth));
    assert.equal(String(effect.frames.at(-1)!.strokeDasharray).split(' ')[1], '0');
  }
  const fades = effects.filter(effect => effect.frames.some(frame => frame.opacity !== undefined));
  assert.equal(fades.length, 2, 'Only the two arrowhead pops change opacity during the intro.');
  assert.ok(fades.every(effect => effect.frames.every(frame => frame.transform !== undefined)));
  logo.finish(); assert.ok(effects.every(effect => effect.cancelled));
});
