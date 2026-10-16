import { expect } from '@playwright/test';
import { test } from './app-fixture';
import { showFind } from './preparation-helpers';

test('multi-provider artists, releases and tracks stay grouped with explicit exact source and catalogue access', async ({ page, isolatedApp }) => {
  const post = (path: string, data: unknown) => page.request.post(path, { data, headers: { Origin: isolatedApp.origin } });
  await post('/api/host/integrations/save', { url: isolatedApp.musicAssistantOrigin, accessToken: 'browser-test-token', revision: 0 });
  await page.goto('/host');
  const join = await page.getByRole('link', { name: 'Open guest invitation' }).getAttribute('href'); await page.goto(join!);
  await page.getByLabel('What should we call you?').fill('Multi source listener'); await page.getByRole('button', { name: 'Join room' }).click(); await showFind(page);
  const privateResponses: string[] = [];
  page.on('response', response => {
    if (/\/api\/participant\/(browse|search)$/.test(response.url())) void response.text().then(text => privateResponses.push(text)).catch(() => {});
  });
  await page.getByRole('searchbox', { name: 'Search catalogue' }).fill('multi-provider'); await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.locator('.catalogue-results .track-row')).toHaveCount(2); // Same name, different MB artist remains separate.
  const artist = page.locator('.catalogue-results .track-row').first();
  await expect(artist).toContainText('spotify + tidal');
  await expect(artist.getByRole('combobox', { name: 'Source for Metallica' })).toHaveValue('');
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.screenshot({ path: 'test-results/multi-provider-artists-mobile.png', fullPage: true });
  await artist.getByRole('button', { name: 'View albums' }).click();
  await expect(page.locator('.catalogue-results .track-row')).toHaveCount(3);
  await expect(page.getByText('spotify exclusive', { exact: true })).toBeVisible(); await expect(page.getByText('tidal exclusive', { exact: true })).toBeVisible();
  const release = page.locator('.catalogue-results .track-row').filter({ hasText: 'The same release' });
  await expect(release.getByRole('combobox', { name: 'Source for The same release' })).toBeVisible();
  await release.getByRole('button', { name: 'View tracks' }).click();
  const recording = page.locator('.catalogue-results .track-row');
  await expect(recording).toHaveCount(1);
  await expect(recording.getByRole('button', { name: 'Add to my list' })).toBeDisabled();
  await expect(recording.getByRole('button', { name: 'Choose a source' })).toBeDisabled();
  const source = recording.getByRole('combobox', { name: 'Source for The same recording' });
  await source.selectOption({ label: 'spotify' });
  await expect(recording.getByText('Unavailable through this source')).toBeVisible();
  await expect(recording.getByRole('button', { name: 'Unavailable', exact: true })).toBeDisabled();
  // It does not silently switch to the playable Tidal mapping.
  await expect(source.locator('option:checked')).toHaveText('spotify');
  await source.focus();
  await source.selectOption({ label: 'tidal' });
  await expect(source).toBeFocused();
  await expect(recording.getByText('Unavailable through this source')).toHaveCount(0);
  await expect(recording.getByRole('button', { name: 'Add to my list' })).toBeEnabled();
  await recording.getByRole('button', { name: 'Add to my list' }).click();
  await expect(page.locator('.saved-track .saved-source')).toHaveText('tidal');
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.evaluate(() => { (document.activeElement as HTMLElement | null)?.blur(); window.scrollTo({ top: 0, behavior: 'instant' }); });
    await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/multi-provider-exact-source-${width === 390 ? 'mobile' : 'desktop'}.png`, fullPage: true });
  }
  await page.getByRole('button', { name: '← Artists', exact: true }).click();
  await artist.getByRole('combobox', { name: 'Source for Metallica' }).selectOption({ label: 'tidal' });
  const before = isolatedApp.calls.length;
  await artist.getByRole('button', { name: 'View albums' }).click();
  await expect(page.locator('.catalogue-results .track-row')).toHaveCount(2);
  expect(isolatedApp.calls.slice(before).filter(c => c.command === 'music/artists/artist_albums').map(c => c.args.provider_instance_id_or_domain)).toEqual(['tidal']);
  expect(isolatedApp.calls.some(c => c.command.startsWith('player_queues/play_media'))).toBe(false);
  const json = privateResponses.join('');
  for (const secret of ['private-multi', 'private-other', 'browser-test-token', 'musicbrainz_', 'spotify://', 'tidal://']) expect(json).not.toContain(secret);
  // Track mode still separates Live from the original, and starts with no source selected.
  await page.getByRole('button', { name: 'Search tracks', exact: true }).click(); await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.locator('.catalogue-results .track-row')).toHaveCount(2);
  await expect(page.locator('.catalogue-results').getByText(/Live/)).toBeVisible();
});

test('partial provider browse is explicit, and full failure is not shown as an empty catalogue', async ({ page, isolatedApp }) => {
  const post = (path: string, data: unknown) => page.request.post(path, { data, headers: { Origin: isolatedApp.origin } });
  await post('/api/host/integrations/save', { url: isolatedApp.musicAssistantOrigin, accessToken: 'browser-test-token', revision: 0 });
  await page.goto('/host'); const join = await page.getByRole('link', { name: 'Open guest invitation' }).getAttribute('href'); await page.goto(join!);
  await page.getByLabel('What should we call you?').fill('Source failures'); await page.getByRole('button', { name: 'Join room' }).click(); await showFind(page);
  const search = async (query: string) => { await page.getByRole('searchbox', { name: 'Search catalogue' }).fill(query); await page.getByRole('button', { name: 'Search', exact: true }).click(); };
  await search('multi-provider-partial');
  await expect(page.locator('.catalogue-results .catalogue-notice')).toHaveCount(0);
  await page.locator('.catalogue-help summary').click();
  await expect(page.locator('.catalogue-help p')).toBeVisible();
  await expect(page.locator('.catalogue-help')).toContainText('Music Assistant may omit failed sources');
  await page.getByRole('button', { name: 'View albums' }).first().click();
  await expect(page.locator('.catalogue-notice')).toContainText('Could not load tidal');
  await expect(page.locator('.catalogue-notice')).toContainText('Results are incomplete');
  await expect(page.getByText('spotify exclusive', { exact: true })).toBeVisible();
  await expect(page.getByText('tidal exclusive', { exact: true })).toHaveCount(0);
  await search('multi-provider-failure'); await page.getByRole('button', { name: 'View albums' }).first().click();
  await expect(page.getByRole('alert')).toContainText('None of the selected music sources could be loaded');
  await expect(page.locator('.catalogue-results .track-row')).toHaveCount(2); // Artist choices retained for retry.
  await expect(page.getByText(/No albums returned/)).toHaveCount(0); await expect(page.getByText('PRIVATE SOURCE FAILURE')).toHaveCount(0);
});

test('real-world ID-less artist searches use one unverified display row and require an exact source to browse', async ({ page, isolatedApp }) => {
  const post = (path: string, data: unknown) => page.request.post(path, { data, headers: { Origin: isolatedApp.origin } });
  await post('/api/host/integrations/save', { url: isolatedApp.musicAssistantOrigin, accessToken: 'browser-test-token', revision: 0 });
  await page.goto('/host'); const join = await page.getByRole('link', { name: 'Open guest invitation' }).getAttribute('href'); await page.goto(join!);
  await page.getByLabel('What should we call you?').fill('Metadata listener'); await page.getByRole('button', { name: 'Join room' }).click(); await showFind(page);
  const search = async (query: string) => { await page.getByRole('searchbox', { name: 'Search catalogue' }).fill(query); await page.getByRole('button', { name: 'Search', exact: true }).click(); };
  await page.setViewportSize({ width: 390, height: 1000 });
  for (const name of ['Metallica', 'Iron Maiden', 'Megadeth', 'Slayer', 'Metallica']) {
    await search(name);
    await expect(page.locator('.catalogue-results .track-row')).toHaveCount(1);
    await expect(page.locator('.catalogue-results strong')).toHaveText(name);
    await expect(page.getByText('Same-name matches · choose a source to browse', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'View albums', exact: true })).toBeDisabled();
    await expect(page.getByRole('combobox', { name: `Source for ${name}`, exact: true })).toHaveValue('');
  }
  expect(isolatedApp.calls.filter(c => c.command === 'music/artists/artist_albums')).toHaveLength(0);
  const response = await (await post('/api/participant/browse', { kind: 'artists', value: 'Metallica' })).json();
  const group = response.artists[0]; expect(group.matchKind).toBe('metadata'); expect(group.sources).toHaveLength(2);
  const before = isolatedApp.calls.length;
  expect((await post('/api/participant/browse', { kind: 'albums', value: group.id })).status()).toBe(422);
  expect(isolatedApp.calls.length).toBe(before);
  expect(JSON.stringify(response)).not.toMatch(/private-instance|private-multi|spotify:\/\/|external_ids/);
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page.screenshot({ path: 'test-results/metadata-artists-mobile.png', fullPage: true });
  const source = page.getByRole('combobox', { name: 'Source for Metallica', exact: true });
  await expect(source.locator('option')).toHaveText(['Choose exact source', 'spotify', 'tidal']);
  await source.selectOption({ label: 'tidal' }); await page.getByRole('button', { name: 'View albums', exact: true }).click();
  await expect(page.getByText('tidal exclusive', { exact: true })).toBeVisible();
  await expect(page.getByText('spotify exclusive', { exact: true })).toHaveCount(0);
  expect(isolatedApp.calls.filter(c => c.command === 'music/artists/artist_albums').map(c => c.args.provider_instance_id_or_domain)).toEqual(['tidal']);
  await page.getByRole('button', { name: '← Artists', exact: true }).click();
  await source.selectOption({ label: 'spotify' }); await page.getByRole('button', { name: 'View albums', exact: true }).click();
  await expect(page.getByText('spotify exclusive', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Search tracks', exact: true }).click(); await search('multi-provider-metadata');
  await expect(page.locator('.catalogue-results .track-row')).toHaveCount(2); // Live remains distinct.
  const original = page.locator('.catalogue-results .track-row').first();
  await expect(original).toContainText('Metadata matches · choose an exact source');
  await expect(original.getByRole('button', { name: 'Add to my list', exact: true })).toBeDisabled();
  await expect(original.getByRole('button', { name: 'Choose a source', exact: true })).toBeDisabled();
  await original.getByRole('combobox', { name: 'Source for The same recording', exact: true }).selectOption({ label: 'tidal' });
  await original.getByRole('button', { name: 'Add to my list', exact: true }).click();
  await expect(page.locator('.saved-track .saved-source')).toHaveText('tidal');
  expect(isolatedApp.calls.filter(c => c.command === 'player_queues/play_media')).toHaveLength(0);
});

test('metadata-only album groups cannot union browse, while verified artist groups still include both catalogues', async ({ page, isolatedApp }) => {
  const post = (path: string, data: unknown) => page.request.post(path, { data, headers: { Origin: isolatedApp.origin } });
  await post('/api/host/integrations/save', { url: isolatedApp.musicAssistantOrigin, accessToken: 'browser-test-token', revision: 0 });
  await page.goto('/host'); const join = await page.getByRole('link', { name: 'Open guest invitation' }).getAttribute('href'); await page.goto(join!);
  await page.getByLabel('What should we call you?').fill('Release choices'); await page.getByRole('button', { name: 'Join room' }).click(); await showFind(page);
  await page.getByRole('searchbox', { name: 'Search catalogue' }).fill('multi-provider-metadata-albums'); await page.getByRole('button', { name: 'Search', exact: true }).click();
  await page.getByRole('button', { name: 'View albums', exact: true }).first().click();
  await expect(page.locator('.catalogue-results .track-row')).toHaveCount(3);
  await expect(page.getByText('spotify exclusive', { exact: true })).toBeVisible(); await expect(page.getByText('tidal exclusive', { exact: true })).toBeVisible();
  const release = page.locator('.catalogue-results .track-row').filter({ hasText: 'The same release' });
  await expect(release).toContainText('Metadata matches · choose a source to browse');
  await expect(release.getByRole('button', { name: 'View tracks', exact: true })).toBeDisabled();
  await release.getByRole('combobox', { name: 'Source for The same release', exact: true }).selectOption({ label: 'tidal' });
  await release.getByRole('button', { name: 'View tracks', exact: true }).click();
  await expect(page.locator('.catalogue-results .track-row')).toHaveCount(1);
  expect(isolatedApp.calls.filter(c => c.command === 'music/albums/album_tracks').map(c => c.args.provider_instance_id_or_domain)).toEqual(['tidal']);
});

test('only the chosen exact source reaches simulated playback, and reveal remains guarded', async ({ browser, page, isolatedApp }) => {
  const post = (path: string, data: unknown) => page.request.post(path, { data, headers: { Origin: isolatedApp.origin } });
  await post('/api/host/integrations/save', { url: isolatedApp.musicAssistantOrigin, accessToken: 'browser-test-token', revision: 0 });
  await post('/api/host/integrations/destination', { id: 'sonos:room', revision: 1 });
  await page.goto('/host');
  const join = await page.getByRole('link', { name: 'Open guest invitation' }).getAttribute('href');
  const display = await page.getByRole('link', { name: 'Open public display' }).getAttribute('href');
  const tvContext = await browser.newContext();
  try {
    const tv = await tvContext.newPage(); await tv.goto(display!); await page.goto(join!);
    await page.getByLabel('What should we call you?').fill('Exact-source listener'); await page.getByRole('button', { name: 'Join room' }).click(); await showFind(page);
    await page.getByRole('button', { name: 'Search tracks', exact: true }).click();
    await page.getByRole('searchbox', { name: 'Search catalogue' }).fill('multi-provider'); await page.getByRole('button', { name: 'Search', exact: true }).click();
    const grouped = (await (await post('/api/participant/search', { turnId: (await (await page.request.get('/api/participant/state')).json()).turnId, query: 'multi-provider' })).json()).tracks[0];
    const state = await (await page.request.get('/api/participant/state')).json();
    const forged = await post('/api/participant/play', { turnId: state.turnId, previousPlaybackId: null, trackId: grouped.id });
    expect(forged.status()).toBe(422);
    expect(isolatedApp.calls.filter(c => c.command === 'player_queues/play_media')).toHaveLength(0);
    const original = page.locator('.catalogue-results .track-row').first();
    await original.getByRole('combobox', { name: 'Source for The same recording' }).selectOption({ label: 'tidal' });
    await original.getByRole('button', { name: 'Play', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'The same recording', exact: true })).toBeVisible();
    expect(isolatedApp.calls.filter(c => c.command === 'player_queues/play_media').map(c => c.args.media)).toEqual([['tidal://track/private-multi-track']]);
    await expect(tv.getByRole('heading', { name: 'Keep them guessing.' })).toBeVisible();
    await expect(tv.getByText('The same recording')).toHaveCount(0);
    await page.getByRole('button', { name: 'Reveal on the display' }).click();
    await expect(tv.getByRole('heading', { name: 'The same recording', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Finish my turn', exact: true }).click();
    await expect(tv.getByRole('heading', { name: 'Nothing playing.' })).toBeVisible();
    expect(isolatedApp.calls.filter(c => c.command === 'player_queues/play_media')).toHaveLength(1);
  } finally { await tvContext.close(); }
});
