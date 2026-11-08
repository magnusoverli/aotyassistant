import { test } from 'node:test';
import assert from 'node:assert/strict';
import { albumReference, artistNames, bestMatch, findSong, normalized, type SongFinder } from '../src/list-import.js';
import type { CatalogueTrack } from '../src/model.js';
import type { SharedSong } from '../src/shared-list.js';

const song = (fields: Partial<SharedSong> = {}): SharedSong => ({ rank: 1, artist: 'The National', album: 'Trouble Will Find Me',
  title: 'Sea of Love', trackNumber: 3, duration: 241, albumLinks: [], ...fields });
let next = 0;
const track = (fields: Partial<CatalogueTrack> = {}): CatalogueTrack => ({ id: `ma:${next++}`, title: 'Sea of Love', artist: 'The National',
  album: 'Trouble Will Find Me', version: '', provider: 'spotify', duration: 241, available: true, ...fields });

test('titles and artists are compared the way services write them', () => {
  assert.equal(normalized('Beyoncé – “Halo”'), 'beyonce halo');
  assert.equal(normalized('Song (Remastered 2011) - Single Version', true), 'song');
  assert.equal(normalized('Song feat. Someone', true), 'song');
  assert.deepEqual(artistNames('The National & Taylor Swift'), ['national', 'taylor swift']);
  assert.deepEqual(artistNames('Bon Iver, The National'), ['bon iver', 'national']);
});

test('album links name a Music Assistant provider and album', () => {
  const cases: [string, string | undefined, string | undefined][] = [
    ['https://open.spotify.com/album/4aawyAB9vmqN3uQ7FjRGTy?si=x', 'spotify', '4aawyAB9vmqN3uQ7FjRGTy'],
    ['https://open.spotify.com/intl-de/album/4aawyAB9vmqN3uQ7FjRGTy', 'spotify', '4aawyAB9vmqN3uQ7FjRGTy'],
    ['https://tidal.com/browse/album/123456', 'tidal', '123456'],
    ['https://listen.tidal.com/album/123456', 'tidal', '123456'],
    ['https://open.qobuz.com/album/0886447783652', 'qobuz', '0886447783652'],
    ['https://www.qobuz.com/us-en/album/some-album-artist/u2l0i9gqklp4a', 'qobuz', 'u2l0i9gqklp4a'],
    ['https://music.apple.com/us/album/some-album/1440857781', 'apple_music', '1440857781'],
    ['https://www.deezer.com/en/album/302127', 'deezer', '302127'],
    ['https://artist.bandcamp.com/album/name', undefined, undefined],
    ['http://open.spotify.com/album/4aawyAB9vmqN3uQ7FjRGTy', undefined, undefined],
    ['not a url', undefined, undefined],
  ];
  for (const [url, provider, itemId] of cases) {
    const reference = albumReference({ service: 'any', url });
    assert.deepEqual(reference && [reference.provider, reference.itemId], provider && [provider, itemId], url);
  }
});

test('the best match needs the same title and artist, and a similar length', () => {
  const exact = track();
  assert.equal(bestMatch(song(), [track({ artist: 'Someone Else' }), exact]), exact);
  assert.equal(bestMatch(song(), [track({ duration: 300 })]), undefined, 'a much longer recording is another version');
  assert.equal(bestMatch(song(), [track({ title: 'Sea of Love (Live)' })]), undefined, 'a live recording is not the original');
  assert.equal(bestMatch(song(), [track({ version: 'Acoustic' })]), undefined);
  assert.equal(bestMatch(song({ title: 'Sea of Love (Live)' }), [track()]), undefined, 'nor the other way round');
  const live = track({ title: 'Sea of Love - Live' });
  assert.equal(bestMatch(song({ title: 'Sea of Love (Live)' }), [live]), live);
  assert.equal(bestMatch(song(), [track({ available: false })]), undefined);
  const remaster = track({ title: 'Sea of Love - 2023 Remaster', duration: 243 });
  assert.equal(bestMatch(song(), [remaster]), remaster);
  // On equal titles, the album and closer length win.
  const other = track({ album: 'A Compilation', duration: 250 }); const original = track({ duration: 240 });
  assert.equal(bestMatch(song(), [other, original]), original);
  assert.equal(bestMatch(song({ artist: 'Taylor Swift' }), [track({ artist: 'Taylor Swift, The National' })])?.artist, 'Taylor Swift, The National');
  assert.equal(bestMatch(song({ artist: 'X' }), [track({ artist: 'X' })])?.artist, 'X');
});

test('a song is found on its linked album first, then by searching', async () => {
  const calls: string[] = [];
  const onAlbum = track({ title: 'Sea Of Love' });
  const finder: SongFinder = {
    serviceAlbumTracks: async (provider, itemId) => { calls.push(`${provider}:${itemId}`); if (provider === 'tidal') throw new Error('Not connected'); return [track({ title: 'Demons' }), onAlbum]; },
    search: async query => { calls.push(`search:${query}`); return []; },
  };
  const links = [{ service: 'tidal', url: 'https://tidal.com/browse/album/1' }, { service: 'spotify', url: 'https://open.spotify.com/album/4aawyAB9vmqN3uQ7FjRGTy' }];
  assert.equal(await findSong(finder, song({ albumLinks: links })), onAlbum);
  assert.deepEqual(calls, ['tidal:1', 'spotify:4aawyAB9vmqN3uQ7FjRGTy']);
});

test('a renamed track on its album is found by position when the lengths agree', async () => {
  const third = track({ title: 'Sea of Love (Single Edit)', duration: 239 });
  const tracks = [track({ title: 'I Should Live in Salt' }), track({ title: 'Demons' }), third];
  const finder: SongFinder = { serviceAlbumTracks: async () => tracks, search: async () => [] };
  const links = [{ service: 'spotify', url: 'https://open.spotify.com/album/4aawyAB9vmqN3uQ7FjRGTy' }];
  assert.equal(await findSong(finder, song({ title: 'Totally different name', albumLinks: links })), third);
  assert.equal(await findSong(finder, song({ title: 'Totally different name', duration: 300, albumLinks: links })), undefined);
});

test('searching tries the title without extras, and failures are reported only when nothing was checked', async () => {
  const queries: string[] = []; const found = track({ title: 'Song', artist: 'Band' });
  const finder: SongFinder = { serviceAlbumTracks: async () => [], search: async query => { queries.push(query); return query.endsWith(' song') ? [found, track({ title: 'Song' })] : []; } };
  assert.equal(await findSong(finder, song({ artist: 'Band', title: 'Song (Remastered)', album: '', duration: null })), found);
  assert.deepEqual(queries, ['Band Song (Remastered)', 'Band song']);
  queries.length = 0;
  assert.equal(await findSong(finder, song({ artist: 'Someone Else', title: 'Song', album: '', duration: null })), undefined, 'the artist must match');
  assert.deepEqual(queries, ['Someone Else Song'], 'a title without extras is searched once');
  const failing: SongFinder = { serviceAlbumTracks: async () => [], search: async () => { throw new Error('Music Assistant is offline'); } };
  await assert.rejects(findSong(failing, song()), /offline/);
});
