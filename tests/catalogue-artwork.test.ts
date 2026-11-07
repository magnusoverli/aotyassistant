import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MusicAssistantClient } from '../src/music-assistant.js';

const artistId = '11111111-1111-4111-8111-111111111111';
const albumId = '22222222-2222-4222-8222-222222222222';
const imageId = 'a'.repeat(64);
const image = { type: 'thumb', proxy_id: imageId };
const artist = (provider: string) => ({ item_id: 'artist', provider, media_type: 'artist', name: 'Metallica',
  uri: `${provider}://artist/artist`, external_ids: [['musicbrainz_artistid', artistId]] });
const album = (provider: string) => ({ item_id: 'album', provider, media_type: 'album', name: 'ReLoad',
  uri: `${provider}://album/album`, artists: [{ name: 'Metallica' }], external_ids: [['musicbrainz_albumid', albumId]] });

test('artist results retain artist names and artwork without album subtitles or matching reads', async () => {
  const client = new MusicAssistantClient('http://localhost:8095', 'PRIVATE', 8000, { async read(_path, command, args = {}) {
    if (command === 'music/search') {
      assert.deepEqual(args, { search_query: 'Metallica', media_types: ['artist'], limit: 20 });
      return { artists: ['spotify', 'tidal'].map(provider => ({ ...artist(provider), external_ids: [], image })) };
    }
    throw new Error(`Unexpected catalogue read: ${command}`);
  } });
  const result = (await client.artists('Metallica')).items;
  assert.equal(result.length, 1);
  assert.equal(result[0]!.name, 'Metallica');
  assert.equal(result[0]!.description, undefined);
  assert.ok(!JSON.stringify(result).includes('ReLoad'));
});

test('grouped artists and albums keep artwork from a later source without extra detail reads', async () => {
  const client = new MusicAssistantClient('http://localhost:8095', 'PRIVATE', 8000, { async read(_path, command, args = {}) {
    if (command === 'music/search') return { artists: [artist('spotify'), { ...artist('tidal'), metadata: { images: [image] } }] };
    assert.equal(command, 'music/artists/artist_albums');
    const provider = (args as { provider_instance_id_or_domain: string }).provider_instance_id_or_domain;
    return [{ ...album(provider), ...(provider === 'tidal' ? { image } : {}) }];
  } });
  const found = (await client.artists('Metallica')).items[0]!;
  assert.equal(found.artwork, `image:${imageId}`);
  assert.equal(found.sources![0]!.artwork, undefined, 'Keep exact source metadata separate.');
  const release = (await client.albums(found.id)).items[0]!;
  assert.equal(release.artwork, `image:${imageId}`);
});

test('library artwork survives replacement of inherited mappings by real provider rows', async () => {
  const source = artist('spotify');
  const client = new MusicAssistantClient('http://localhost:8095', 'PRIVATE', 8000, { async read() {
    return { artists: [{ ...source, provider: 'library', item_id: '12', uri: 'library://artist/12', image,
      provider_mappings: [{ item_id: source.item_id, provider_instance: source.provider, provider_domain: source.provider }] }, source] };
  } });
  assert.equal((await client.artists('Metallica')).items[0]!.artwork, `image:${imageId}`);
});

test('lightweight artist and album items obtain cached full-item artwork without changing browse identity', async () => {
  let details = 0;
  const client = new MusicAssistantClient('http://localhost:8095', 'PRIVATE', 8000, { async read(_path, command, args = {}) {
    if (command === 'music/search') return { artists: [artist('spotify')] };
    if (command === 'music/artists/artist_albums') return [album('spotify')];
    assert.equal(command, 'music/item_by_uri'); details++;
    const { uri, allow_update_metadata } = args as { uri: string; allow_update_metadata: boolean };
    assert.equal(allow_update_metadata, false);
    return { ...(uri.includes('/artist/') ? artist('spotify') : album('spotify')), metadata: { images: [image] } };
  } });
  const found = (await client.artists('Metallica')).items[0]!;
  const release = (await client.albums(found.id)).items[0]!;
  assert.equal(found.artwork, `image:${imageId}`);
  assert.equal(release.artwork, `image:${imageId}`);
  assert.equal((await client.artists('Metallica')).items[0]!.id, found.id);
  assert.equal((await client.albums(found.id)).items[0]!.id, release.id);
  assert.equal(details, 2);
});

test('malformed optional image entries do not erase valid artwork siblings', async () => {
  const client = new MusicAssistantClient('http://localhost:8095', 'PRIVATE', 8000, { async read() {
    return { artists: [{ ...artist('spotify'), metadata: { images: [null, { proxy_id: 'invalid' }, image] } }] };
  } });
  assert.equal((await client.artists('Metallica')).items[0]!.artwork, `image:${imageId}`);
});

test('nullable MA image lists preserve explicitness when grouping recordings', async () => {
  const client = new MusicAssistantClient('http://localhost:8095', 'PRIVATE', 8000, { async read() {
    return { tracks: [true, false].map((explicit, index) => ({ item_id: 'track', provider: index ? 'tidal' : 'spotify',
      name: 'Recording', artists: [{ name: 'Metallica' }], album: { name: 'Album' }, duration: 180,
      external_ids: [['isrc', 'USABC9100001']], metadata: { images: null, explicit } })) };
  } });
  assert.equal((await client.search('Recording')).length, 2, 'A null artwork list must not erase clean/explicit edition differences.');
});

test('missing artwork reads are bounded, concurrent and cached even when the provider fails', async () => {
  let reads = 0; let active = 0; let maximum = 0;
  const artists = Array.from({ length: 12 }, (_, i) => ({ ...artist('spotify'), item_id: String(i), uri: `spotify://artist/${i}`, name: `Artist ${i}`, external_ids: [] }));
  const client = new MusicAssistantClient('http://localhost:8095', 'PRIVATE', 8000, { async read(_path, command) {
    if (command === 'music/search') return { artists };
    assert.equal(command, 'music/item_by_uri'); reads++; active++; maximum = Math.max(maximum, active);
    await new Promise(resolve => setImmediate(resolve)); active--;
    throw new Error('PRIVATE upstream failure');
  } });
  assert.equal((await client.artists('Artist')).items.length, 12);
  assert.equal(reads, 8); assert.equal(maximum, 2);
  assert.equal((await client.artists('Artist')).items.length, 12);
  assert.equal(reads, 12, 'Only the four uncached items need detail reads.');
});

test('wrong media kinds or unrelated detail identities never become artist portraits', async () => {
  for (const detail of [{ ...album('spotify'), image }, { ...artist('spotify'), item_id: 'other', external_ids: [], image }]) {
    const client = new MusicAssistantClient('http://localhost:8095', 'PRIVATE', 8000, { async read(_path, command) {
      return command === 'music/search' ? { artists: [artist('spotify')] } : detail;
    } });
    assert.equal((await client.artists('Metallica')).items[0]!.artwork, undefined);
  }
});
