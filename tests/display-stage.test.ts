import assert from 'node:assert/strict';
import { test } from 'node:test';
import { displayHasSideRail, fittingSeats, observeDisplayLayout } from '../web/display-stage';

test('the play order shows everyone who fits, otherwise reserves a summary and keeps Now and Next', () => {
  const size = { seat: 256, gap: 26, more: 136 };
  assert.equal(fittingSeats(0, 1804, size), 0);
  assert.equal(fittingSeats(6, 1804, size), 6);
  assert.equal(fittingSeats(7, 1804, size), 5);
  assert.equal(fittingSeats(20, 1804, size), 5);
  assert.equal(fittingSeats(20, 3000, size), 10);
  assert.equal(fittingSeats(20, 300, size), 2);
  assert.equal(fittingSeats(1, 100, size), 1);
  assert.equal(fittingSeats(2, 100, size), 2);
  assert.equal(fittingSeats(20, NaN, size), 20);
  assert.equal(fittingSeats(20, 1804, { ...size, seat: 0 }), 20);
});

test('fluid fractional measurements never overfill the order when the minimum pair fits', () => {
  for (const size of [{ seat: 192.25, gap: 12.75, more: 121.8 }, { seat: 345.6, gap: 26, more: 159.6 }]) {
    for (const total of [3, 6, 20, 100]) for (const width of [1024, 1200.5, 1804, 3000]) {
      const shown = fittingSeats(total, width, size);
      const used = shown * size.seat + (shown - 1) * size.gap + (shown < total ? size.more + size.gap : 0);
      assert.ok(used <= width + .5, `${shown}/${total} participants need ${used}, have ${width}`);
    }
  }
});

test('QR coordination follows CSS changes, avoids duplicate renders and stops on navigation', () => {
  const names = ['window', 'document', 'getComputedStyle', 'ResizeObserver'] as const;
  const original = names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
  const window = new EventTarget(); const document = Object.assign(new EventTarget(), { body: {} });
  let rail = '0'; let resize = () => {}; let disconnected = false;
  class Observer {
    constructor(callback: () => void) { resize = callback; }
    observe() {}
    disconnect() { disconnected = true; }
  }
  const values = { window, document, ResizeObserver: Observer, getComputedStyle: () => ({ getPropertyValue: () => rail }) };
  try {
    for (const name of names) Object.defineProperty(globalThis, name, { configurable: true, value: values[name] });
    const lifetime = new AbortController(); let changes = 0;
    observeDisplayLayout(() => changes++, lifetime.signal);
    assert.equal(displayHasSideRail(), false);
    window.dispatchEvent(new Event('resize')); assert.equal(changes, 0);
    rail = ' 1 '; resize(); assert.equal(changes, 1); assert.equal(displayHasSideRail(), true);
    window.dispatchEvent(new Event('resize')); assert.equal(changes, 1);
    rail = '0'; document.dispatchEvent(new Event('fullscreenchange')); assert.equal(changes, 2);
    lifetime.abort(); assert.equal(disconnected, true);
    rail = '1'; resize(); window.dispatchEvent(new Event('resize')); assert.equal(changes, 2);
  } finally {
    for (const [name, descriptor] of original) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name);
    }
  }
});
