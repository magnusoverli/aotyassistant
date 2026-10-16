import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RecordLabelDeck, recordLabels, recordLabelStorageKey } from '../web/record-labels.js';

function storage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
}

test('the record sticker pool has at least 150 distinct, compact, room-friendly alternatives', () => {
  assert.equal(recordLabels.length, 180);
  assert.equal(new Set(recordLabels.map(label => label.toLocaleLowerCase())).size, recordLabels.length);
  for (const label of recordLabels) { assert.ok(label.trim()); assert.ok(label.length <= 24, label); }
});

test('each entire shuffle bag is used before repeats, with no immediate repetition across exhaustion', () => {
  let draws = 0;
  const deck = new RecordLabelDeck(undefined, () => draws++ < recordLabels.length - 1 ? .999 : 0);
  let previous = '';
  for (let cycle = 0; cycle < 3; cycle++) {
    const seen = new Set<string>();
    for (let i = 0; i < recordLabels.length; i++) {
      const label = deck.label(`${cycle}:${i}`, 'Alex');
      assert.equal(label.owner, 'Alex'); assert.notEqual(label.caption, previous); assert.ok(!seen.has(label.caption));
      seen.add(label.caption); previous = label.caption;
    }
    assert.deepEqual(seen, new Set(recordLabels));
  }
});

test('the current playback keeps its sticker through refresh/reconnect and a renamed listener does not consume another phrase', () => {
  const saved = storage(); const deck = new RecordLabelDeck(saved, () => .5);
  const first = deck.label('public-playback-1', 'Alex'); const snapshot = saved.getItem(recordLabelStorageKey);
  for (let i = 0; i < 20; i++) assert.deepEqual(deck.label('public-playback-1', 'Alex'), first);
  assert.equal(saved.getItem(recordLabelStorageKey), snapshot);
  assert.deepEqual(deck.label('public-playback-1', 'Bård'), { ...first, owner: 'Bård' });
  assert.equal(saved.getItem(recordLabelStorageKey), snapshot);
  const restored = new RecordLabelDeck(saved, () => 0);
  assert.deepEqual(restored.label('public-playback-1', 'Alex'), first);
  assert.notEqual(restored.label('public-playback-2', 'Sam').caption, first.caption);
});

test('shuffle history survives browser reloads and new event identities without storing names or music metadata', () => {
  const saved = storage(); const seen = new Set<string>();
  for (let i = 0; i < recordLabels.length; i++) {
    const label = new RecordLabelDeck(saved, () => .25).label(`session-${i}:turn:playback:person`, 'Private nickname <img src=x> $&');
    assert.ok(!seen.has(label.caption)); seen.add(label.caption);
  }
  const raw = saved.getItem(recordLabelStorageKey)!;
  assert.ok(raw.length < 4096); assert.ok(!raw.includes('Private nickname')); assert.ok(!raw.includes('img src')); assert.ok(!raw.includes('caption'));
  assert.deepEqual(new RecordLabelDeck(saved).label('session-179:turn:playback:person', '$& <svg>'), { owner: '$& <svg>', caption: [...seen].at(-1) });
});

test('blocked or malformed browser storage falls back safely without breaking the display', () => {
  const broken = new RecordLabelDeck({ getItem() { throw new Error('Blocked'); }, setItem() { throw new Error('Blocked'); } }, () => 0);
  const seen = new Set<string>();
  for (let i = 0; i < recordLabels.length; i++) { const label = broken.label(`playback-${i}`); assert.equal(label.owner, 'Mystery DJ'); seen.add(label.caption); }
  assert.equal(seen.size, recordLabels.length);
  for (const raw of ['not json', 'null', '{}', 'x'.repeat(20_000), JSON.stringify({ version: 1, size: recordLabels.length, remaining: [0, 0], current: null }),
    JSON.stringify({ version: 1, size: recordLabels.length, remaining: [-1], current: null }),
    JSON.stringify({ version: 1, size: recordLabels.length, remaining: [0], current: { identity: 'old', index: 0 } })]) {
    const deck = new RecordLabelDeck({ getItem: () => raw, setItem() {} }, () => 0);
    assert.ok(recordLabels.includes(deck.label('new').caption));
  }
});

test('a failed storage write cannot rewind the in-memory bag to an older persisted history', () => {
  const saved = storage(); new RecordLabelDeck(saved, () => .5).label('old-playback', 'Alex');
  const deck = new RecordLabelDeck({ getItem: saved.getItem, setItem() { throw new Error('Read-only storage'); } }, () => 0);
  const seen = new Set<string>();
  for (let i = 0; i < recordLabels.length - 1; i++) {
    const caption = deck.label(`fresh-${i}`, 'Sam').caption; assert.ok(!seen.has(caption)); seen.add(caption);
  }
});
