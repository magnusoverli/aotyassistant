import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DisplaySize, displaySizeKey } from '../web/display-size';

function memory(values = new Map<string, string>()) {
  return { values, storage: () => ({ getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } }) };
}

test('a screen follows the room until it chooses its own size, which survives reloads in that browser only', () => {
  const { values, storage } = memory();
  const screen = new DisplaySize(storage);
  assert.equal(screen.current, undefined);
  screen.set('back');
  assert.equal(new DisplaySize(storage).current, 'back');
  assert.equal(new DisplaySize(memory().storage).current, undefined, 'Another browser keeps following the room.');
  screen.set('sofa'); assert.equal(new DisplaySize(storage).current, 'sofa', 'A screen can pin the default size against a larger room setting.');
  screen.set(undefined);
  assert.equal(new DisplaySize(storage).current, undefined); assert.equal(values.has(displaySizeKey), false);
});

test('sizes saved by 2.0.12 carry over; its 100% default and unreadable values follow the room', () => {
  for (const [saved, distance] of [['0.85', 'close'], ['1.25', 'room'], ['1.5', 'back']] as const) {
    assert.equal(new DisplaySize(memory(new Map([[displaySizeKey, saved]])).storage).current, distance);
  }
  for (const saved of ['1', 'garbage', '', ' ', 'Infinity', '0', '-1', '1000', '1.1', 'Sofa']) {
    assert.equal(new DisplaySize(memory(new Map([[displaySizeKey, saved]])).storage).current, undefined, saved);
  }
});

test('blocked storage keeps a choice for the page and invalid input cannot replace it', () => {
  const screen = new DisplaySize(() => { throw new Error('Storage blocked'); });
  assert.equal(screen.current, undefined);
  screen.set('room'); assert.equal(screen.current, 'room');
  for (const invalid of ['huge', 1.5, null, '']) screen.set(invalid as never);
  assert.equal(screen.current, 'room');
  screen.set(undefined); assert.equal(screen.current, undefined);
});
