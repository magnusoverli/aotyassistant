import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { ListDrag } from '../web/list-drag.js';

// Controlled event sequences, including Android's cancelled pointer stream.
// Native gesture arbitration still needs verification on physical devices.
class Element extends EventTarget {
  children: Element[] = []; dataset: { entryId?: string } = {}; parent?: Element;
  classList = new class extends Set<string> { remove(token: string) { this.delete(token); } }();
  captures = new Set<number>(); captureRequests = 0;
  style = { transform: '', removeProperty: () => { this.style.transform = ''; } };
  constructor(readonly tag: string, readonly top = 0) { super(); }
  closest(selector: string): Element | null {
    if (selector === '[data-entry-id]' ? this.dataset.entryId : selector.split(', ').includes(this.tag)) return this;
    return this.parent?.closest(selector) ?? null;
  }
  getBoundingClientRect() { return { top: this.top, height: 60 }; }
  setPointerCapture(id: number) { this.captureRequests++; this.captures.add(id); }
  hasPointerCapture(id: number) { return this.captures.has(id); }
  releasePointerCapture(id: number) { this.captures.delete(id); }
}

function fixture(t: TestContext) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let frames = 0;
  const restore: (() => void)[] = [];
  const globals = { Element, HTMLElement: Element, navigator: {}, requestAnimationFrame: () => ++frames, cancelAnimationFrame: () => {} };
  for (const [key, value] of Object.entries(globals)) {
    const original = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
    restore.push(() => { if (original) Object.defineProperty(globalThis, key, original); else Reflect.deleteProperty(globalThis, key); });
  }
  const list = new Element('ol');
  const rows = ['a', 'b', 'c'].map((id, index) => {
    const row = new Element('li', index * 60); row.dataset.entryId = id; row.parent = list; return row;
  });
  list.children = rows;
  const commits: { id: string; ids: string[] }[] = [];
  const drag = new ListDrag(list as unknown as HTMLElement, list as unknown as HTMLElement, {
    enabled: () => true, commit: (id, ids) => { commits.push({ id, ids }); },
  });
  t.after(() => { drag.cancel(); for (const reset of restore) reset(); });
  function send(type: string, fields: Record<string, unknown> = {}, target = rows[2]!, cancelable = true) {
    const event = new Event(type, { cancelable });
    for (const [key, value] of Object.entries({ target, ...fields })) Object.defineProperty(event, key, { value });
    list.dispatchEvent(event); return event;
  }
  function touch(type: string, y = 150, identifier = 0, cancelable = true) {
    const point = { identifier, clientX: 20, clientY: y };
    return send(type, { changedTouches: [point], touches: type === 'touchend' || type === 'touchcancel' ? [] : [point] }, rows[2], cancelable);
  }
  function pointer(type: string, pointerType = 'touch', y = 150) {
    return send(type, { pointerType, pointerId: 7, isPrimary: true, button: 0, clientX: 20, clientY: y });
  }
  return { list, rows, commits, drag, send, touch, pointer };
}

test('held touch reorders once even when Android cancels pointer events before pickup', t => {
  const f = fixture(t);
  f.pointer('pointerdown'); f.touch('touchstart');
  f.pointer('pointercancel'); f.pointer('lostpointercapture');
  t.mock.timers.tick(349); assert.equal(f.list.classList.has('is-sorting'), false);
  t.mock.timers.tick(1); assert.equal(f.list.classList.has('is-sorting'), true);
  assert.equal(f.list.captureRequests, 0, 'Touch must not depend on capturing a cancelled pointer.');
  assert.equal(f.touch('touchmove', 30).defaultPrevented, true);
  assert.deepEqual(f.commits, [], 'Preview does not save.');
  f.pointer('pointerup');
  assert.equal(f.touch('touchend', 30).defaultPrevented, true);
  assert.deepEqual(f.commits, [{ id: 'c', ids: ['c', 'a', 'b'] }]);
  assert.equal(f.drag.busy, false); assert.equal(f.list.classList.has('is-sorting'), false);
  assert.ok(f.rows.every(row => row.style.transform === ''));
});

test('a swipe before pickup remains native scrolling and cannot later reorder', t => {
  const f = fixture(t); f.touch('touchstart');
  assert.equal(f.touch('touchmove', 153).defaultPrevented, false);
  assert.equal(f.touch('touchmove', 175).defaultPrevented, false);
  t.mock.timers.tick(500); f.touch('touchend', 30);
  assert.equal(f.drag.busy, false); assert.equal(f.list.classList.has('is-sorting'), false);
  assert.deepEqual(f.commits, []);
});

test('a quick tap and a hold without a move do not save', t => {
  const f = fixture(t); f.touch('touchstart');
  assert.equal(f.touch('touchend').defaultPrevented, false);
  t.mock.timers.tick(500); assert.equal(f.drag.busy, false);
  f.touch('touchstart'); t.mock.timers.tick(350); f.touch('touchend');
  assert.deepEqual(f.commits, []);
});

test('touch cancellation, native scrolling, and multitouch discard a preview', t => {
  const f = fixture(t);
  for (const cancel of [
    () => f.touch('touchcancel'),
    () => f.touch('touchmove', 30, 0, false),
    () => f.send('touchstart', { touches: [{ identifier: 0 }, { identifier: 1 }], changedTouches: [{ identifier: 1 }] }),
  ]) {
    f.touch('touchstart'); t.mock.timers.tick(350); f.touch('touchmove', 30);
    cancel(); f.touch('touchend', 30);
    assert.equal(f.drag.busy, false); assert.equal(f.list.classList.has('is-sorting'), false);
  }
  assert.deepEqual(f.commits, []);
});

test('unrelated touch ends cannot drop a held row and row controls do not start dragging', t => {
  const f = fixture(t); f.touch('touchstart'); t.mock.timers.tick(350);
  f.touch('touchend', 30, 9); assert.equal(f.drag.busy, true);
  f.touch('touchcancel');
  const button = new Element('button'); button.parent = f.rows[2];
  f.send('touchstart', { touches: [{}], changedTouches: [{ identifier: 0, clientX: 20, clientY: 150 }] }, button);
  t.mock.timers.tick(350); assert.equal(f.drag.busy, false); assert.deepEqual(f.commits, []);
});

test('mouse dragging still captures, previews, and saves on release', t => {
  const f = fixture(t); f.pointer('pointerdown', 'mouse');
  assert.equal(f.list.captureRequests, 1);
  f.pointer('pointermove', 'mouse', 30);
  assert.equal(f.list.classList.has('is-sorting'), true);
  f.pointer('pointerup', 'mouse', 30);
  assert.deepEqual(f.commits, [{ id: 'c', ids: ['c', 'a', 'b'] }]);
  assert.equal(f.list.captures.size, 0);
});
