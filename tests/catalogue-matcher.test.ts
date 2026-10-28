import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchCatalogue, sameTracklist } from '../src/catalogue-matcher.js';
import type { IdentityMedia } from '../src/catalogue-grouping.js';

const artist = (provider: string): IdentityMedia => ({ provider, item_id: `${provider}-artist`, name: 'Example artist', version: '' });
const album = (provider: string): IdentityMedia => ({ provider, item_id: `${provider}-album`, name: 'Example album', version: '', artists: [{ name: 'Example artist' }] });
const tracks = (provider: string): IdentityMedia[] => [1, 2].map(n => ({ provider, item_id: `${provider}-${n}`, name: `Song ${n}`, version: '',
  external_ids: [['isrc', `USABC261234${n}`]],
  artists: [{ name: 'Example artist' }], album: { name: 'Example album' }, duration: 180 + n, disc_number: 1, track_number: n }));

test('ID-less artists merge through corroborating releases and ordered recordings, with bounded concurrent reads', async () => {
  let reads = 0; let active = 0; let maximum = 0;
  const result = await matchCatalogue('artist', ['spotify', 'tidal'].map(artist), async (kind, item) => {
    reads++; active++; maximum = Math.max(maximum, active);
    await new Promise(resolve => setImmediate(resolve)); active--;
    return kind === 'artist' ? [album(item.provider)] : tracks(item.provider);
  });
  assert.equal(result.length, 1); assert.equal(result[0]!.length, 2);
  assert.equal(reads, 4); assert.equal(maximum, 2);
});

test('same-name unrelated artists, changed editions and ambiguous bridge candidates remain separate', async () => {
  const result = await matchCatalogue('artist', ['spotify', 'tidal', 'other'].map(artist), async (kind, item) =>
    kind === 'artist' ? [album(item.provider)] : tracks(item.provider).map(t => item.provider === 'other' ? { ...t, name: 'Unrelated song' } : t));
  assert.deepEqual(result.map(group => group.length), [2, 1]);
  assert.equal((await matchCatalogue('album', [album('spotify'), { ...album('tidal'), version: 'Deluxe' }], async () => tracks('spotify'))).length, 2);
  assert.equal(sameTracklist(tracks('spotify'), [...tracks('tidal'), { ...tracks('tidal')[0]!, track_number: 3 }]), false);
});

test('enrichment failures and exhausted budgets keep usable independent results rather than guessing', async () => {
  let reads = 0;
  const result = await matchCatalogue('artist', ['a', 'b', 'c', 'd'].map(artist), async () => { reads++; throw Error('offline'); }, 2);
  assert.equal(reads, 2); assert.equal(result.length, 4);
});

test('a shared compilation does not establish same-name artist identity', async () => {
  const result = await matchCatalogue('artist', ['spotify', 'tidal'].map(artist), async kind =>
    kind === 'artist' ? [{ ...album('library'), artists: [{ name: 'Various Artists' }] }] : tracks('library'));
  assert.equal(result.length, 2);
});

test('track equivalence tolerates small timing drift but preserves versions, explicitness and conflicting IDs', async () => {
  const a = tracks('spotify')[0]!; const b = { ...tracks('tidal')[0]!, duration: a.duration! + 1 };
  const load = async () => { throw Error('Track grouping must not fan out'); };
  assert.equal((await matchCatalogue('track', [a, b], load)).length, 1);
  for (const changed of [{ ...b, version: 'Live' }, { ...b, duration: 230 }, { ...b, album: { name: 'Other album' } },
    { ...b, metadata: { explicit: false } }]) {
    assert.equal((await matchCatalogue('track', [{ ...a, metadata: { explicit: true } }, changed], load)).length, 2);
  }
  assert.equal(sameTracklist([{ ...a, external_ids: [] }], [{ ...b, external_ids: [] }]), false, 'A title-only match cannot establish an album/artist identity.');
  assert.equal((await matchCatalogue('track', [{ ...a, external_ids: [] }, { ...b, external_ids: [] }], load)).length, 2);
});
