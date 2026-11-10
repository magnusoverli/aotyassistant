import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DisplaySize, displaySizeKey } from '../web/display-size';

test('a display preference survives reloads without changing another browser’s size', () => {
  const values = new Map<string, string>();
  const storage = () => ({ getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } });
  const display = new DisplaySize(storage);
  assert.equal(display.current, 1);
  display.set(1.5);
  assert.equal(new DisplaySize(storage).current, 1.5);
  assert.equal(new DisplaySize(() => ({ getItem: () => null, setItem() {} })).current, 1);
  display.set(1); assert.equal(new DisplaySize(storage).current, 1);
  for (const invalid of ['garbage', 'Infinity', '0', '-1', '1000', '1.1']) {
    values.set(displaySizeKey, invalid);
    assert.equal(new DisplaySize(storage).current, 1);
  }
});

test('blocked storage keeps sizing usable in memory and invalid input cannot replace the preference', () => {
  const display = new DisplaySize(() => { throw new Error('Storage blocked'); });
  assert.equal(display.current, 1);
  display.set(1.25); assert.equal(display.current, 1.25);
  for (const invalid of [NaN, Infinity, -1, 0, 1000]) display.set(invalid);
  assert.equal(display.current, 1.25);
});
