import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { MusicAssistantClient } from '../src/music-assistant.js';
import { IntegrationManager, IntegrationFileStore } from '../src/integrations.js';
import { AppError } from '../src/model.js';
import { groupCatalogueItems, presentCatalogueItems, sameCatalogueItem, sameMetadataPresentation, type IdentityMedia } from '../src/catalogue-grouping.js';
import { metadataOnly } from './fixtures/music-assistant.js';

const mbArtist = '11111111-1111-4111-8111-111111111111';
const mbRelease = '22222222-2222-4222-8222-222222222222';
const mbRecording = '33333333-3333-4333-8333-333333333333';
const other = '44444444-4444-4444-8444-444444444444';
function media(provider: string, kind: string, name: string, external: [string, string][] = []) {
  return { item_id: `${provider}-${kind}-PRIVATE`, provider, name, version: '', uri: `${provider}://${kind}/${provider}-${kind}-PRIVATE`,
    external_ids: external, provider_mappings: [{ item_id: `${provider}-${kind}-PRIVATE`, provider_domain: provider, provider_instance: provider, available: true }] };
}
const artist = (provider: string) => media(provider, 'artist', 'Metallica', [['musicbrainz_artistid', mbArtist]]);
const album = (provider: string, name = 'Black album') => ({ ...media(provider, 'album', name, [['musicbrainz_albumid', mbRelease]]),
  artists: [{ name: 'Metallica' }], year: 1991 });
const track = (provider: string) => ({ ...media(provider, 'track', 'Enter Sandman', [['musicbrainz_recordingid', mbRecording], ['isrc', 'USABC9100001']]),
  artists: [{ name: 'Metallica' }], album: { name: 'Black album', version: '', external_ids: [['musicbrainz_albumid', mbRelease]] as [string, string][] }, duration: 331, track_number: 1, disc_number: 1 });

test('group browsing starts the next provider while the first is still pending, retaining source order', async t => {
  let release!: () => void; let thirdStarted!: () => void;
  const slow = new Promise<void>(resolve => { release = resolve; }); t.after(() => release());
  const third = new Promise<void>(resolve => { thirdStarted = resolve; });
  const providers = ['alpha', 'beta', 'gamma']; let pending = 0; let maximum = 0;
  const client = new MusicAssistantClient('http://localhost:8095', 'SECRET', 8000, { async read(_path, command, args = {}) {
    if (command === 'music/search') return { artists: providers.map(artist) };
    const provider = (args as { provider_instance_id_or_domain: string }).provider_instance_id_or_domain;
    pending++; maximum = Math.max(maximum, pending);
    try {
      if (provider === 'alpha') await slow;
      if (provider === 'gamma') thirdStarted();
      return [{ ...album(provider, `${provider} release`), external_ids: [] }];
    } finally { pending--; }
  } });
  const group = (await client.artists('query')).items[0]!;
  const loading = client.albums(group.id);
  const timeout = setTimeout(() => { release(); }, 1000); t.after(() => clearTimeout(timeout));
  await third;
  assert.equal(pending, 1, 'The first provider remains pending when the third starts.');
  release(); const page = await loading;
  assert.equal(maximum, 2);
  assert.deepEqual(page.items.map(item => item.name), providers.map(provider => `${provider} release`));
});

function fixture() {
  const calls: { command?: string; args: Record<string, unknown> }[] = [];
  let failed = new Set<string>(); let empty = false; let sources = ['spotify', 'tidal'];
  let current = track('tidal');
  let pending = 0; let maxPending = 0;
  const client = new MusicAssistantClient('http://localhost:8095', 'PRIVATE-TOKEN', 8000, { async read(_path, command, args = {}) {
    const data = args as Record<string, unknown>; calls.push({ command, args: data });
    if (command === 'music/search') return (data.media_types as string[])[0] === 'artist'
      ? { artists: sources.map(artist) } : { tracks: sources.map(track) };
    if (command === 'music/item_by_uri') return current;
    const provider = data.provider_instance_id_or_domain as string;
    pending++; maxPending = Math.max(maxPending, pending);
    try {
      await new Promise(resolve => setImmediate(resolve));
      if (failed.has(provider)) throw new Error('PRIVATE upstream failure');
      if (empty) return [];
      if (command === 'music/artists/artist_albums') return [album(provider), { ...album(provider, `${provider} exclusive`), item_id: `${provider}-exclusive-PRIVATE`, uri: `${provider}://album/exclusive-PRIVATE`, external_ids: [] }];
      if (command === 'music/albums/album_tracks') return [track(provider)];
      throw new Error('Unexpected command');
    } finally { pending--; }
  } });
  return { client, calls, fail(providers: string[]) { failed = new Set(providers); }, empty() { empty = true; },
    sources(providers: string[]) { sources = providers; }, current(item: typeof current) { current = item; }, get maxPending() { return maxPending; } };
}

test('strong identities group artists across sources, not names or malformed/unsupported IDs', () => {
  const a = artist('spotify'); const b = artist('tidal');
  assert.equal(sameCatalogueItem('artist', a, b), true);
  assert.equal(sameCatalogueItem('artist', a, { ...b, external_ids: [] }), false);
  assert.equal(sameCatalogueItem('artist', a, { ...b, external_ids: [['musicbrainz_artistid', other]] }), false);
  assert.equal(sameCatalogueItem('artist', { ...a, external_ids: [['musicbrainz_artistid', 'bad']] }, { ...b, external_ids: [['musicbrainz_artistid', 'bad']] }), false);
  assert.equal(sameCatalogueItem('artist', { ...a, external_ids: [['unknown', 'same']] }, { ...b, external_ids: [['unknown', 'same']] }), false);
  assert.equal(sameCatalogueItem('artist', a, { ...b, name: 'Authoritative alias' }), true);
});

test('provider mappings are evidence, but domain-only collisions and conflicting bridge identities cannot over-merge', () => {
  const a = { ...artist('spotify'), external_ids: [] };
  const b = { ...artist('tidal'), external_ids: [], provider_mappings: [...a.provider_mappings, ...artist('tidal').provider_mappings] };
  assert.equal(sameCatalogueItem('artist', a, b), true);
  const local = { ...a, provider: 'local-A', item_id: 'same-path', provider_mappings: [{ item_id: 'same-path', provider_domain: 'filesystem_local', provider_instance: 'local-A', available: true }] };
  assert.equal(sameCatalogueItem('artist', local, { ...local, provider: 'local-B', provider_mappings: [{ ...local.provider_mappings[0]!, provider_instance: 'local-B' }] }), false);
  const first = artist('spotify'); const bridge = { ...b, provider_mappings: first.provider_mappings };
  const different = { ...artist('tidal'), external_ids: [['musicbrainz_artistid', other]] as [string, string][], provider_mappings: first.provider_mappings };
  assert.deepEqual(groupCatalogueItems('artist', [first, bridge, different]).map(group => group.length), [2, 1]);
});

test('album groups preserve release, year, edition, artist and explicit identity; release-group/barcode alone is insufficient', () => {
  const a = album('spotify'); const b = album('tidal');
  assert.equal(sameCatalogueItem('album', a, b), true);
  const alternatives: IdentityMedia[] = [{ ...b, version: 'Deluxe' }, { ...b, year: 2001 }, { ...b, external_ids: [['musicbrainz_albumid', other]] },
    { ...b, artists: [{ name: 'Another artist' }] }, { ...b, external_ids: [['musicbrainz_releasegroupid', mbRelease], ['barcode', '1234567890123']] }];
  for (const modified of alternatives) {
    assert.equal(sameCatalogueItem('album', a, modified), false);
  }
});

test('recording groups require exact edition/context guards even with matching ISRC or MB recording', () => {
  const a = track('spotify'); const b = track('tidal');
  assert.equal(sameCatalogueItem('track', a, b), true);
  const alternatives: IdentityMedia[] = [{ ...b, version: 'Live' }, { ...b, duration: 330 }, { ...b, track_number: 2 }, { ...b, disc_number: 2 },
    { ...b, album: { ...b.album, version: 'Remastered' } }, { ...b, album: { ...b.album, external_ids: [['musicbrainz_albumid', other]] } },
    { ...b, external_ids: [['musicbrainz_recordingid', other], ['isrc', 'USABC9100001']] }];
  for (const modified of alternatives) {
    assert.equal(sameCatalogueItem('track', a, modified), false);
  }
  assert.equal(sameCatalogueItem('track', { ...a, metadata: { explicit: true } }, { ...b, metadata: { explicit: false } }), false);
});

test('grouped artist and release browse unions all known catalogues including provider-exclusive albums', async () => {
  const f = fixture(); const artists = await f.client.artists('Metallica');
  assert.equal(artists.items.length, 1); const group = artists.items[0]!;
  assert.deepEqual(group.sources!.map(s => s.provider), ['spotify', 'tidal']);
  const albums = await f.client.albums(group.id);
  assert.deepEqual(albums.items.map(a => a.name), ['Black album', 'spotify exclusive', 'tidal exclusive']);
  const release = albums.items[0]!; assert.equal(release.sources!.length, 2);
  const tracks = await f.client.tracks(release.id); assert.equal(tracks.items.length, 1); assert.equal(tracks.items[0]!.sources!.length, 2);
  const tidal = group.sources!.find(s => s.provider === 'tidal')!;
  f.calls.length = 0; const exact = await f.client.albums(tidal.id);
  assert.equal(exact.items.length, 2); assert.equal(f.calls.length, 1); assert.equal(f.calls[0]!.args.provider_instance_id_or_domain, 'tidal');
  assert.ok(f.calls.every(call => !call.command?.startsWith('player')));
});

test('grouped browse exposes partial/empty failures, fails full failure and bounds concurrency/fanout without silent omissions', async () => {
  const f = fixture(); f.sources(Array.from({ length: 10 }, (_, i) => `provider${i}`));
  const group = (await f.client.artists('Metallica')).items[0]!;
  f.fail(['provider0']); f.empty();
  const page = await f.client.albums(group.id);
  assert.deepEqual(page.items, []); assert.equal(page.notices!.length, 2);
  assert.match(page.notices!.join(' '), /incomplete/); assert.match(page.notices!.join(' '), /first 8/);
  assert.equal(f.calls.filter(call => call.command === 'music/artists/artist_albums').length, 8); assert.equal(f.maxPending, 2);
  f.fail(Array.from({ length: 10 }, (_, i) => `provider${i}`));
  await assert.rejects(f.client.albums(group.id), error => error instanceof AppError && error.status === 502 && !error.message.includes('PRIVATE'));
  f.fail([]); f.calls.length = 0; await f.client.albums(group.sources![9]!.id); assert.equal(f.calls.length, 1);
});

test('display groups cannot be saved/played; chosen sources keep exact capture and never fall back', async () => {
  const f = fixture(); const group = (await f.client.search('Sandman'))[0]!;
  assert.equal(group.sources!.length, 2);
  await assert.rejects(f.client.resolveTrack(group.id), /Choose an exact music source/);
  await assert.rejects(f.client.captureTrack(group.id), /Choose an exact music source/);
  const tidal = group.sources!.find(source => source.provider === 'tidal')!;
  const saved = await f.client.captureTrack(tidal.id);
  assert.equal(saved.recording.provider, 'tidal'); assert.equal(saved.recording.uri, track('tidal').uri);
  const resolved = await f.client.resolveTrack(tidal.id); assert.equal(resolved.provider, 'tidal');
  f.current(track('spotify'));
  const count = f.calls.length; await assert.rejects(f.client.resolveTrack(tidal.id), /No alternative recording was substituted/);
  assert.equal(f.calls.length, count + 1);
});

test('nested source references/artwork remain participant-bound, opaque and revoked with credentials', async () => {
  const f = fixture();
  const manager = new IntegrationManager(new IntegrationFileStore(await mkdtemp('/tmp/opencode/aoty-multi-provider-')), () => f.client);
  await manager.init(); await manager.save('http://localhost:8095', 'PRIVATE-TOKEN', 0);
  const artists = await manager.browse('artists', 'Metallica', 'alice');
  const group = artists.artists![0]!;
  const json = JSON.stringify(artists);
  for (const privateValue of ['PRIVATE', mbArtist, 'spotify://', 'group:', 'ma:', 'external_ids', 'provider_mappings']) assert.ok(!json.includes(privateValue));
  assert.ok(group.sources!.every(s => s.id.startsWith('ref:')));
  await assert.rejects(manager.browse('albums', group.sources![0]!.id, 'bob'), /another participant/);
  const tracks = await manager.search('Sandman', 'alice');
  await assert.rejects(manager.captureSaved(tracks[0]!.id, 'alice'), /Choose an exact music source/);
  const tidal = tracks[0]!.sources!.find(s => s.provider === 'tidal')!;
  const saved = await manager.captureSaved(tidal.id, 'alice'); assert.equal(saved.source, 'music-assistant');
  const oldBinding = manager.sourceBindingId;
  await manager.save('http://localhost:8095', 'replacement-secret', 1);
  assert.equal(manager.sourceBindingId, oldBinding);
  await assert.rejects(manager.browse('albums', group.id, 'alice'), /expired/);
  await assert.rejects(manager.captureSaved(tidal.id, 'alice'), /expired/);
});

test('library provider mappings expose exact source choices, not a library fallback or duplicate mapping aliases', async () => {
  const spotify = track('spotify'); const tidal = track('tidal');
  const library = { ...spotify, provider: 'library', item_id: 'library-PRIVATE', uri: 'library://track/library-PRIVATE', provider_mappings: [...spotify.provider_mappings, ...tidal.provider_mappings] };
  const client = new MusicAssistantClient('http://localhost:8095', 'token', 8000, { async read() { return { tracks: [library, spotify, tidal] }; } });
  const result = await client.search('Sandman'); assert.equal(result.length, 1);
  assert.deepEqual(result[0]!.sources!.map(s => s.provider), ['spotify', 'tidal']);
});

test('private provider-instance aliases do not leak or duplicate real source rows', async () => {
  const spotify = track('spotify'); spotify.provider_mappings[0]!.provider_instance = 'spotify--PRIVATE-ACCOUNT';
  const library = { ...spotify, provider: 'library', item_id: 'library-PRIVATE', uri: 'library://track/library-PRIVATE' };
  const client = new MusicAssistantClient('http://localhost:8095', 'token', 8000, { async read() { return { tracks: [library, spotify] }; } });
  const result = await client.search('Sandman'); assert.equal(result.length, 1); assert.equal(result[0]!.sources, undefined);
  assert.equal(result[0]!.provider, 'spotify'); assert.ok(!JSON.stringify(result).includes('PRIVATE'));
});

test('mapping-only selections resolve exactly, while library URI fallback stays unavailable', async () => {
  const spotify = track('spotify'); const tidal = track('tidal');
  const mappings = [spotify.provider_mappings[0]!, tidal.provider_mappings[0]!].map(p => ({ ...p, provider_instance: `${p.provider_domain}--PRIVATE-ACCOUNT` }));
  const library = { ...spotify, provider: 'library', item_id: 'library-PRIVATE', uri: 'library://track/library-PRIVATE', provider_mappings: mappings };
  const client = new MusicAssistantClient('http://localhost:8095', 'token', 8000, { async read(_path, command, args = {}) {
    if (command === 'music/search') return { tracks: [library] };
    const uri = (args as { uri: string }).uri;
    const mapping = mappings.find(p => uri.startsWith(`${p.provider_instance}://`))!;
    return { ...tidal, provider: mapping.provider_instance, item_id: mapping.item_id, uri, provider_mappings: [mapping] };
  } });
  const group = (await client.search('Sandman'))[0]!;
  assert.deepEqual(group.sources!.map(s => s.provider), ['spotify', 'tidal']);
  assert.ok(!JSON.stringify(group).includes('PRIVATE'));
  const source = group.sources!.find(s => s.provider === 'tidal')!;
  const captured = await client.captureTrack(source.id); assert.equal(captured.recording.provider, mappings[1]!.provider_instance);
  assert.equal((await client.resolveTrack(source.id)).uri, captured.recording.uri);
  await assert.rejects(client.resolveRecording({ itemId: library.item_id, provider: 'library', uri: library.uri, version: '' }), /no exact source selection/);
});

test('stable source ordering survives upstream order changes, and items after the old early slice remain reachable', async () => {
  let reverse = false;
  const tracks = Array.from({ length: 24 }, (_, i) => ({ ...track(i % 2 ? 'tidal' : 'spotify'),
    item_id: `private-${i}`, uri: `${i % 2 ? 'tidal' : 'spotify'}://track/private-${i}`, provider_mappings: [],
    name: `Track ${Math.floor(i / 2)}`, external_ids: [['isrc', `USABC91${String(Math.floor(i / 2)).padStart(5, '0')}`]] }));
  const client = new MusicAssistantClient('http://localhost:8095', 'token', 8000, { async read() { return { tracks: reverse ? [...tracks].reverse() : tracks }; } });
  const first = await client.search('query'); assert.equal(first.length, 12); assert.equal(first[11]!.title, 'Track 11');
  reverse = true; const second = await client.search('query');
  assert.deepEqual(first[0]!.sources!.map(s => s.id), second.find(t => t.title === 'Track 0')!.sources!.map(s => s.id));
});

test('raw/result bounds fail explicitly instead of silently discarding provider choices', async () => {
  let oversized = false;
  const client = new MusicAssistantClient('http://localhost:8095', 'token', 8000, { async read() {
    if (oversized) return { tracks: Array.from({ length: 501 }, () => track('spotify')) };
    return { tracks: Array.from({ length: 11 }, (_, i) => ({ ...track('spotify'), item_id: `library-${i}`, provider: 'library', uri: `library://track/${i}`, external_ids: [],
      provider_mappings: Array.from({ length: 100 }, (_, j) => ({ item_id: `${i}-${j}`, provider_instance: `source-${j}`, provider_domain: 'spotify', available: true })) })) };
  } });
  await assert.rejects(client.search('query'), /too many source choices/);
  oversized = true; await assert.rejects(client.search('query'), /incompatible search response/);
});

test('same-name artist portraits cannot be copied by name into an unrelated album or track', async () => {
  const first = { ...artist('spotify'), image: { proxy_id: 'a'.repeat(64) } };
  const second = { ...first, item_id: 'other-private-artist', uri: 'spotify://artist/other-private-artist', external_ids: [['musicbrainz_artistid', other]], image: { proxy_id: 'b'.repeat(64) } };
  const client = new MusicAssistantClient('http://localhost:8095', 'token', 8000, { async read(_path, command) {
    if (command === 'music/search') return { artists: [first, second] };
    if (command === 'music/artists/artist_albums') return [album('spotify')];
    return [track('spotify')];
  } });
  const artists = await client.artists('Metallica'); assert.equal(artists.items.length, 2);
  const albums = await client.albums(artists.items[0]!.id); assert.equal(albums.items[0]!.artistArtwork, undefined);
  const tracks = await client.tracks(albums.items[0]!.id); assert.equal(tracks.items[0]!.artistArtwork, undefined);
});

test('deployed ID-less artist shapes share one metadata-only display row, never a canonical identity', async () => {
  for (const name of ['Metallica', 'Iron Maiden', 'Megadeth', 'Slayer']) {
    const artists = ['spotify', 'tidal'].map(provider => metadataOnly({ ...artist(provider), name }));
    assert.equal(sameCatalogueItem('artist', artists[0]!, artists[1]!), false);
    const calls: string[] = [];
    const client = new MusicAssistantClient('http://localhost:8095', 'token', 8000, { async read(_path, command) {
      calls.push(command!); return { artists };
    } });
    const page = await client.artists(name); assert.equal(page.items.length, 1);
    const group = page.items[0]!;
    assert.equal(group.matchKind, 'metadata'); assert.equal(group.name, name);
    assert.deepEqual(group.sources!.map(source => source.provider), ['spotify', 'tidal']);
    const before = calls.length;
    await assert.rejects(client.albums(group.id), error => error instanceof AppError && error.status === 422 && /Choose a source before browsing/.test(error.message));
    assert.equal(calls.length, before); // No guessed union, matching lookup or upstream request.
    assert.ok(!JSON.stringify(group).includes('private-instance'));
  }
});

test('metadata album/track presentation retains all exact choices and cannot browse, save or play a display reference', async () => {
  const calls: { command?: string; args: Record<string, unknown> }[] = [];
  const client = new MusicAssistantClient('http://localhost:8095', 'token', 8000, { async read(_path, command, args = {}) {
    const data = args as Record<string, unknown>; calls.push({ command, args: data });
    if (command === 'music/search') return (data.media_types as string[])[0] === 'artist'
      ? { artists: ['spotify', 'tidal'].map(artist) } : { tracks: ['spotify', 'tidal'].map(provider => metadataOnly(track(provider))) };
    const provider = data.provider_instance_id_or_domain as string;
    if (command === 'music/artists/artist_albums') return [metadataOnly(album(provider))];
    if (command === 'music/albums/album_tracks') return [metadataOnly(track(provider))];
    if (command === 'music/item_by_uri') return metadataOnly(track((data.uri as string).split('://')[0]!));
    throw new Error('Unexpected command');
  } });
  const artistGroup = (await client.artists('Metallica')).items[0]!;
  assert.equal(artistGroup.matchKind, 'identity');
  const albums = await client.albums(artistGroup.id); assert.equal(albums.items.length, 1);
  const release = albums.items[0]!; assert.equal(release.matchKind, 'metadata');
  let before = calls.length; await assert.rejects(client.tracks(release.id), /Choose a source before browsing/); assert.equal(calls.length, before);
  const tidalAlbum = release.sources!.find(a => a.provider === 'tidal')!;
  await client.tracks(tidalAlbum.id); assert.equal(calls.at(-1)!.args.provider_instance_id_or_domain, 'tidal');
  const group = (await client.search('Sandman'))[0]!; assert.equal(group.matchKind, 'metadata');
  before = calls.length;
  await assert.rejects(client.resolveTrack(group.id), /Choose an exact music source/);
  await assert.rejects(client.captureTrack(group.id), /Choose an exact music source/); assert.equal(calls.length, before);
  const spotify = await client.captureTrack(group.sources![0]!.id); const tidal = await client.captureTrack(group.sources![1]!.id);
  assert.notDeepEqual(spotify.recording, tidal.recording);
  assert.equal(spotify.recording.provider, 'spotify'); assert.equal(tidal.recording.provider, 'tidal');
});

test('metadata display grouping preserves known conflicts/editions and does not arbitrarily pair ambiguous provider results', () => {
  const unknownSpotify = metadataOnly(artist('spotify')); const unknownTidal = metadataOnly(artist('tidal'));
  const otherSpotify = { ...unknownSpotify, item_id: 'another-private-spotify', uri: 'spotify://artist/another-private-spotify', provider_mappings: [] };
  const ambiguous = presentCatalogueItems('artist', [unknownSpotify, unknownTidal, otherSpotify]);
  assert.equal(ambiguous.length, 1); assert.equal(ambiguous[0]!.matchKind, 'metadata'); assert.equal(ambiguous[0]!.items.length, 3);
  const knownA = { ...artist('spotify'), item_id: 'known-A', uri: 'spotify://artist/known-A', provider_mappings: [] };
  const knownB = { ...artist('tidal'), item_id: 'known-B', uri: 'tidal://artist/known-B', provider_mappings: [], external_ids: [['musicbrainz_artistid', other]] as [string, string][] };
  const conflicted = presentCatalogueItems('artist', [unknownSpotify, knownA, unknownTidal, knownB]);
  assert.equal(conflicted.length, 3);
  assert.deepEqual(conflicted.find(group => group.matchKind === 'metadata')!.items, [unknownSpotify, unknownTidal]);
  for (const input of [[unknownSpotify, knownA, knownB], [knownB, unknownSpotify, knownA]]) assert.equal(presentCatalogueItems('artist', input).length, 3);
  const unknownQobuz = metadataOnly(artist('qobuz'));
  const verifiedUnion = presentCatalogueItems('artist', [artist('spotify'), artist('tidal'), unknownQobuz]);
  assert.equal(verifiedUnion.length, 2); assert.equal(verifiedUnion[0]!.matchKind, 'identity'); assert.equal(verifiedUnion[0]!.items.length, 2);
  const mapped = { ...unknownSpotify, provider: 'library', provider_mappings: [...unknownSpotify.provider_mappings, ...unknownTidal.provider_mappings] };
  assert.equal(presentCatalogueItems('artist', [mapped, unknownQobuz]).length, 2);
  assert.equal(sameMetadataPresentation('artist', { ...unknownSpotify, artist_type: 'singer' }, { ...unknownTidal, artist_type: 'author' }), false);
  const a = metadataOnly(album('spotify')); const b = metadataOnly(album('tidal'));
  for (const modified of [{ ...b, version: 'Deluxe' }, { ...b, year: 2025 }, { ...b, artists: [{ name: 'Different artist' }] },
    { ...b, album_type: 'single' }]) {
    assert.equal(sameMetadataPresentation('album', { ...a, album_type: 'album' }, modified), false);
  }
  const first = metadataOnly(track('spotify')); const second = metadataOnly(track('tidal'));
  assert.equal(sameMetadataPresentation('track', first, second), true); assert.equal(sameCatalogueItem('track', first, second), false);
  const alternatives: IdentityMedia[] = [{ ...second, duration: 330 }, { ...second, duration: 0 }, { ...second, version: 'Remaster' },
    { ...second, album: { ...second.album, version: 'Deluxe' } }, { ...second, disc_number: 2 }, { ...second, track_number: 2 },
    { ...second, artists: [{ name: 'Metallica', external_ids: [['musicbrainz_artistid', other]] }] }];
  for (const modified of alternatives) assert.equal(sameMetadataPresentation('track', { ...first, artists: [{ name: 'Metallica', external_ids: [['musicbrainz_artistid', mbArtist]] }] }, modified), false);
  assert.equal(sameMetadataPresentation('track', { ...first, metadata: { explicit: true } }, { ...second, metadata: { explicit: false } }), false);
  assert.equal(sameMetadataPresentation('album', { ...a, external_ids: [['musicbrainz_releasegroupid', mbRelease]] },
    { ...b, external_ids: [['musicbrainz_releasegroupid', other]] }), false);
  assert.equal(sameMetadataPresentation('album', { ...a, external_ids: [['barcode', '0123456789012']] },
    { ...b, external_ids: [['barcode', '0123456789013']] }), false);
  assert.equal(sameMetadataPresentation('track', { ...first, external_ids: [['musicbrainz_trackid', mbRecording]] },
    { ...second, external_ids: [['musicbrainz_trackid', other]] }), false);
  assert.equal(presentCatalogueItems('artist', [unknownSpotify, otherSpotify]).length, 2); // Same-provider ambiguity is not paired away.
});

test('metadata group references remain opaque, participant-bound and revoked while retaining exact saved identities', async () => {
  const client = new MusicAssistantClient('http://localhost:8095', 'token', 8000, { async read(_path, command) {
    if (command === 'music/search') return { artists: ['spotify', 'tidal'].map(provider => metadataOnly(artist(provider))) };
    return [];
  } });
  const manager = new IntegrationManager(new IntegrationFileStore(await mkdtemp('/tmp/opencode/aoty-metadata-')), () => client);
  await manager.init(); await manager.save('http://localhost:8095', 'token', 0);
  const group = (await manager.browse('artists', 'Metallica', 'alice')).artists![0]!;
  assert.equal(group.matchKind, 'metadata');
  for (const secret of ['display:', 'PRIVATE', 'private-instance', 'spotify://', 'provider_mappings']) assert.ok(!JSON.stringify(group).includes(secret));
  await assert.rejects(manager.browse('albums', group.id, 'bob'), /another participant/);
  await assert.rejects(manager.browse('albums', group.id, 'alice'), /Choose a source before browsing/);
  const source = group.sources!.find(a => a.provider === 'tidal')!;
  assert.deepEqual((await manager.browse('albums', source.id, 'alice')).albums, []);
  await manager.save('http://localhost:8095', 'new-token', 1);
  await assert.rejects(manager.browse('albums', source.id, 'alice'), /expired/);
  await assert.rejects(manager.browse('albums', group.id, 'alice'), /expired/);
});

test('mapping-only instance/domain URI aliases still fail closed without trying another source', async () => {
  const tidal = metadataOnly(track('tidal')); const calls: string[] = [];
  const library = { ...tidal, provider: 'library', item_id: 'private-library-track', uri: 'library://track/private-library-track' };
  const client = new MusicAssistantClient('http://localhost:8095', 'token', 8000, { async read(_path, command) {
    calls.push(command!);
    if (command === 'music/search') return { tracks: [library] };
    return tidal; // Same domain mapping, but not the requested exact instance/URI identity.
  } });
  const selected = (await client.search('Sandman'))[0]!;
  assert.equal(selected.provider, 'tidal');
  const before = calls.length;
  await assert.rejects(client.captureTrack(selected.id), /No alternative recording was substituted/);
  assert.deepEqual(calls.slice(before), ['music/item_by_uri']);
});
