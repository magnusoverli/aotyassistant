import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { CatalogueReferences } from '../src/catalogue-references.js';

test('stable artwork references remain scoped to owner, kind and catalogue lifetime', () => {
  const references = new CatalogueReferences(); const id = `image:${'a'.repeat(64)}`;
  const image = references.seal(id, 'image', 'owner-a');
  assert.equal(references.seal(id, 'image', 'owner-a'), image);
  assert.notEqual(references.seal(id, 'image', 'owner-b'), image);
  assert.equal(references.unseal(image, 'image', 'owner-a'), id);
  assert.throws(() => references.unseal(image, 'image', 'owner-b'));
  assert.throws(() => references.unseal(image, 'track', 'owner-a'));
  assert.throws(() => new CatalogueReferences().unseal(image, 'image', 'owner-a'));
  assert.notEqual(references.seal('track', 'track', 'owner-a'), references.seal('track', 'track', 'owner-a'));
});

test('references carry only the id and expiry, so catalogue responses stay small', () => {
  const references = new CatalogueReferences(); const context = `${randomUUID()}:${randomUUID()}`;
  const reference = references.seal(`ma:${'a'.repeat(64)}`, 'track', context);
  assert.ok(reference.length < 200, `${reference.length} characters`);
  assert.equal(references.unseal(reference, 'track', context), `ma:${'a'.repeat(64)}`);
  const tampered = `${reference.slice(0, -2)}${reference.endsWith('AA') ? 'BA' : 'AA'}`;
  assert.throws(() => references.unseal(tampered, 'track', context));
});

test('artwork reference reuse is bounded and refreshes capabilities before they expire', t => {
  t.mock.timers.enable({ apis: ['Date'], now: 1000 });
  const references = new CatalogueReferences(); const first = references.seal('first', 'image', 'owner');
  t.mock.timers.tick(12 * 60 * 60_000 - 30_000);
  const renewed = references.seal('first', 'image', 'owner'); assert.notEqual(renewed, first);
  t.mock.timers.tick(30_001);
  assert.throws(() => references.unseal(first, 'image', 'owner'));
  assert.equal(references.unseal(renewed, 'image', 'owner'), 'first');
  for (let index = 0; index < 2048; index++) references.seal(String(index), 'image', 'owner');
  assert.notEqual(references.seal('first', 'image', 'owner'), renewed, 'Old memoized URLs can be evicted.');
  assert.equal(references.unseal(renewed, 'image', 'owner'), 'first', 'Eviction does not revoke otherwise valid references.');
});
