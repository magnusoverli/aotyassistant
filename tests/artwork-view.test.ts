import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { ArtworkView } from '../web/media.js';

// Small DOM/image harness: load/decode completion is controlled independently
// so races and element retention can be verified without a browser run.
class Element {
  children: Element[] = []; parent?: Element; className = ''; textContent = ''; title = '';
  classList = { toggle() {} };
  constructor(readonly tag: string) {}
  get parentElement() { return this.parent; }
  setAttribute() {}
  removeAttribute(_name: string) {}
  append(child: Element, ...rest: Element[]) {
    for (const node of [child, ...rest]) { node.remove(); this.children.push(node); node.parent = this; }
  }
  remove() { if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1); this.parent = undefined; }
  replaceWith(next: Element) {
    const parent = this.parent!; const index = parent.children.indexOf(this);
    next.remove(); parent.children[index] = next; next.parent = parent; this.parent = undefined;
  }
  querySelector(selector: string): Element | undefined {
    for (const child of this.children) {
      if (selector.startsWith('.') ? child.className.split(' ').includes(selector.slice(1)) : child.tag === selector) return child;
      const nested = child.querySelector(selector); if (nested) return nested;
    }
  }
}
class Image extends Element {
  src = ''; loading = ''; decoding = ''; alt = ''; cancelled = false;
  onload: (() => void) | null = null; onerror: (() => void) | null = null;
  decoded = (() => {
    let resolve!: () => void; let reject!: (error: Error) => void;
    const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
  })();
  decode = () => this.decoded.promise;
  constructor() { super('img'); }
  override removeAttribute(name: string) { if (name === 'src') { this.src = ''; this.cancelled = true; } }
  async finish() { this.onload?.(); this.decoded.resolve(); await Promise.resolve(); }
}
function fixture(t: TestContext, className = 'mini-record') {
  const images: Image[] = []; const original = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: {
    createElement(tag: string) { if (tag !== 'img') return new Element(tag); const image = new Image(); images.push(image); return image; },
    querySelector() { return null; },
  } });
  t.after(() => { if (original) Object.defineProperty(globalThis, 'document', original); else Reflect.deleteProperty(globalThis, 'document'); });
  const view = new ArtworkView('Test artwork', className);
  return { view, images, shown: () => view.element.querySelector('img') as unknown as Image | undefined };
}
const saved = '/api/participant/preparations/artwork/saved-entry/artwork';
const playback = '/api/participant/artwork/confirmed-reference';
const other = '/api/participant/artwork/another-cover';

test('confirmation retains the exact loaded image node and performs no new image request', async t => {
  const f = fixture(t); f.view.update(saved); const image = f.images[0]!; await image.finish();
  assert.equal(f.shown(), image); const src = image.src;
  assert.equal(image.loading, 'lazy', 'First loads remain lazy so long catalogue pages do not fetch every image at once.');
  for (let i = 0; i < 10; i++) f.view.update(playback, saved);
  assert.equal(f.images.length, 1); assert.equal(f.shown(), image); assert.equal(image.src, src);
  assert.ok(image.src.endsWith('?size=160'));
});

test('confirmation also shares an in-flight portrait instead of restarting its download', async t => {
  const f = fixture(t, 'artist-portrait'); f.view.update(saved); f.view.update(playback, saved);
  assert.equal(f.images.length, 1); assert.ok(f.images[0]!.src.endsWith('?size=160'));
  await f.images[0]!.finish(); assert.equal(f.shown(), f.images[0]);
});

test('a different cover replaces the old node only after loading and decoding', async t => {
  const f = fixture(t); f.view.update(saved); await f.images[0]!.finish();
  f.view.update(other); const replacement = f.images[1]!;
  assert.equal(replacement.loading, 'eager'); assert.equal(f.shown(), f.images[0]);
  replacement.onload!(); assert.equal(f.shown(), f.images[0], 'Loading alone must not remove visible pixels.');
  replacement.decoded.resolve(); await Promise.resolve(); assert.equal(f.shown(), replacement);
  assert.equal(f.images[0]!.parent, undefined);
});

test('superseded decodes cannot replace the latest cover, including returning to the visible cover', async t => {
  const f = fixture(t); f.view.update(saved); await f.images[0]!.finish();
  f.view.update(other); const stale = f.images[1]!; stale.onload!();
  f.view.update(playback, saved); assert.equal(stale.cancelled, true);
  stale.decoded.resolve(); await Promise.resolve(); assert.equal(f.shown(), f.images[0]);
  f.view.update(other); const replaced = f.images[2]!; replaced.onload!();
  f.view.update('/api/participant/artwork/latest'); const latest = f.images[3]!;
  await latest.finish(); replaced.decoded.resolve(); await Promise.resolve(); assert.equal(f.shown(), latest);
});

test('missing artwork and access teardown clear pixels and fence pending image events', async t => {
  const f = fixture(t); f.view.update(saved); await f.images[0]!.finish();
  f.view.update(other); const stale = f.images[1]!; stale.onload!();
  f.view.update(undefined); assert.equal(f.shown(), undefined); assert.equal(stale.cancelled, true);
  stale.decoded.resolve(); await Promise.resolve(); assert.equal(f.shown(), undefined);
  f.view.update(playback, saved); const next = f.images[2]!; next.onload!(); f.view.clear();
  next.decoded.resolve(); await Promise.resolve(); assert.equal(f.shown(), undefined);
});

test('a failed saved-image request can use the new playback URL once, without retrying on every render', async t => {
  const f = fixture(t); f.view.update(saved); f.view.update(playback, saved); f.images[0]!.onerror!();
  assert.equal(f.images.length, 2); assert.ok(f.images[1]!.src.startsWith(playback));
  f.images[1]!.onerror!(); f.view.update(playback, saved); assert.equal(f.images.length, 2);
  assert.equal(f.shown(), undefined);
});

test('a changed image that cannot decode clears the previous cover rather than mislabelling it', async t => {
  const f = fixture(t); f.view.update(saved); await f.images[0]!.finish();
  f.view.update(other); f.images[1]!.onload!(); f.images[1]!.decoded.reject(new Error('Unsupported image'));
  await Promise.resolve(); assert.equal(f.shown(), undefined);
  f.view.update(other); assert.equal(f.images.length, 2);
});
