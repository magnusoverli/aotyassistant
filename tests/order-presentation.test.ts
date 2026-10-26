import assert from 'node:assert/strict';
import { test } from 'node:test';
import { turnFirst, canonicalInsertion } from '../web/order-presentation';

test('turn-first presentation wraps the saved order without mutating it and handles missing or single participants', () => {
  const people = ['A', 'B', 'C', 'D'].map(id => ({ id }));
  assert.deepEqual(turnFirst(people, 'C').map(person => person.id), ['C', 'D', 'A', 'B']);
  assert.deepEqual(people.map(person => person.id), ['A', 'B', 'C', 'D']);
  assert.equal(turnFirst(people, 'A'), people);
  assert.equal(turnFirst(people, undefined), people);
  assert.equal(turnFirst(people, 'missing'), people);
  assert.deepEqual(turnFirst([], 'A'), []);
  assert.deepEqual(turnFirst([{ id: 'A' }], 'A'), [{ id: 'A' }]);
});

test('mobile drag insertions move only the selected participant in the saved order, including across its wrap', () => {
  const canonical = ['A', 'B', 'C', 'D', 'E'];
  assert.deepEqual(canonicalInsertion(canonical, 'E', ['C', 'D', 'A', 'E', 'B']), ['A', 'E', 'B', 'C', 'D']);
  assert.deepEqual(canonicalInsertion(canonical, 'B', ['C', 'B', 'D', 'E', 'A']), ['A', 'C', 'B', 'D', 'E']);
  assert.deepEqual(canonicalInsertion(canonical, 'A', ['C', 'D', 'E', 'B', 'A']), ['B', 'A', 'C', 'D', 'E']);
  assert.deepEqual(canonicalInsertion(['A', 'B', 'C'], 'A', ['B', 'C', 'A']), ['B', 'C', 'A']);
  assert.deepEqual(canonicalInsertion(['A'], 'A', ['A']), ['A']);
  assert.deepEqual(canonical, ['A', 'B', 'C', 'D', 'E']);
  assert.throws(() => canonicalInsertion(canonical, 'A', ['A', 'B', 'C', 'D', 'D']));
  assert.throws(() => canonicalInsertion(canonical, 'missing', canonical));
});
