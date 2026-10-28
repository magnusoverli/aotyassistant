import { expect } from '@playwright/test';
import { test } from './app-fixture';
import { showFind } from './preparation-helpers';

test('equivalent artists, releases and tracks are selectable without provider dropdowns', async ({ page, isolatedApp }) => {
  const post = (path: string, data: unknown) => page.request.post(path, { data, headers: { Origin: isolatedApp.origin } });
  await post('/api/host/integrations/save', { url: isolatedApp.musicAssistantOrigin, accessToken: 'browser-test-token', revision: 0 });
  await page.goto('/host');
  const join = await page.getByRole('link', { name: 'Open guest invitation' }).getAttribute('href'); await page.goto(join!);
  await page.getByLabel('Display name').fill('Multi source listener'); await page.getByRole('button', { name: 'Join room' }).click(); await showFind(page);
  const privateResponses: string[] = [];
  page.on('response', response => {
    if (/\/api\/participant\/(browse|search)$/.test(response.url())) void response.text().then(text => privateResponses.push(text)).catch(() => {});
  });
  await page.getByRole('searchbox', { name: 'Search catalogue' }).fill('multi-provider'); await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.locator('.catalogue-results .track-row')).toHaveCount(2); // Same name, different MB artist remains separate.
  const artist = page.locator('.catalogue-results .track-row').first();
  await expect(artist.getByRole('combobox')).toHaveCount(0);
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.screenshot({ path: 'test-results/multi-provider-artists-mobile.png', fullPage: true });
  await artist.getByRole('button', { name: 'View albums' }).click();
  await expect(page.locator('.catalogue-results .track-row')).toHaveCount(3);
  await expect(page.getByText('spotify exclusive', { exact: true })).toBeVisible(); await expect(page.getByText('tidal exclusive', { exact: true })).toBeVisible();
  const release = page.locator('.catalogue-results .track-row').filter({ hasText: 'The same release' });
  await expect(release.getByRole('combobox')).toHaveCount(0);
  await release.getByRole('button', { name: 'View tracks' }).click();
  const recording = page.locator('.catalogue-results .track-row');
  await expect(recording).toHaveCount(1);
  await expect(recording.getByRole('combobox')).toHaveCount(0);
  await expect(recording.getByRole('button', { name: 'Add to list' })).toBeEnabled();
  await recording.getByRole('button', { name: 'Add to list' }).click();
  await expect(page.locator('.saved-track .saved-source')).toHaveText('tidal');
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.evaluate(() => { (document.activeElement as HTMLElement | null)?.blur(); window.scrollTo({ top: 0, behavior: 'instant' }); });
    await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/multi-provider-transparent-${width === 390 ? 'mobile' : 'desktop'}.png`, fullPage: true });
  }
  await page.getByRole('button', { name: '← Albums', exact: true }).click();
  await page.getByRole('button', { name: '← Artists', exact: true }).click();
  const before = isolatedApp.calls.length;
  await artist.getByRole('button', { name: 'View albums' }).click();
  await expect(page.locator('.catalogue-results .track-row')).toHaveCount(3);
  expect(isolatedApp.calls.slice(before).filter(c => c.command === 'music/artists/artist_albums').map(c => c.args.provider_instance_id_or_domain).sort()).toEqual(['spotify', 'tidal']);
  expect(isolatedApp.calls.some(c => c.command.startsWith('player_queues/play_media'))).toBe(false);
  const json = privateResponses.join('');
  for (const secret of ['private-multi', 'private-other', 'browser-test-token', 'musicbrainz_', 'spotify://', 'tidal://']) expect(json).not.toContain(secret);
  // Track mode still separates Live from the original.
  await page.getByRole('button', { name: 'Songs', exact: true }).click(); await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.locator('.catalogue-results .track-row')).toHaveCount(2);
  await expect(page.locator('.catalogue-results .result-details').filter({ hasText: /Live/ })).toBeVisible();
});

test('partial provider browse is explicit, and full failure is not shown as an empty catalogue', async ({ page, isolatedApp }) => {
  const post = (path: string, data: unknown) => page.request.post(path, { data, headers: { Origin: isolatedApp.origin } });
  await post('/api/host/integrations/save', { url: isolatedApp.musicAssistantOrigin, accessToken: 'browser-test-token', revision: 0 });
  await page.goto('/host'); const join = await page.getByRole('link', { name: 'Open guest invitation' }).getAttribute('href'); await page.goto(join!);
  await page.getByLabel('Display name').fill('Source failures'); await page.getByRole('button', { name: 'Join room' }).click(); await showFind(page);
  const search = async (query: string) => { await page.getByRole('searchbox', { name: 'Search catalogue' }).fill(query); await page.getByRole('button', { name: 'Search', exact: true }).click(); };
  await search('multi-provider-partial');
  await expect(page.locator('.catalogue-results .catalogue-notice')).toHaveCount(0);
  await page.locator('.catalogue-help summary').click();
  await expect(page.locator('.catalogue-help p')).toBeVisible();
  await expect(page.locator('.catalogue-help')).toContainText('search coverage is unconfirmed');
  await page.getByRole('button', { name: 'View albums' }).first().click();
  await expect(page.locator('.catalogue-help')).toContainText('Could not load tidal');
  await expect(page.locator('.catalogue-help')).toContainText('Results are incomplete');
  await expect(page.locator('.catalogue-help')).toHaveJSProperty('open', true);
  await expect(page.getByText('spotify exclusive', { exact: true })).toBeVisible();
  await expect(page.getByText('tidal exclusive', { exact: true })).toHaveCount(0);
  await search('multi-provider-failure'); await page.getByRole('button', { name: 'View albums' }).first().click();
  await expect(page.getByRole('alert')).toContainText('None of the selected music sources could be loaded');
  await expect(page.locator('.catalogue-results .track-row')).toHaveCount(2); // Artist choices retained for retry.
  await expect(page.getByText(/No albums returned/)).toHaveCount(0); await expect(page.getByText('PRIVATE SOURCE FAILURE')).toHaveCount(0);
});

test('ambiguous ID-less artists and recordings remain directly selectable as separate musical results', async ({ page, isolatedApp }) => {
  const post = (path: string, data: unknown) => page.request.post(path, { data, headers: { Origin: isolatedApp.origin } });
  await post('/api/host/integrations/save', { url: isolatedApp.musicAssistantOrigin, accessToken: 'browser-test-token', revision: 0 });
  await page.goto('/host'); const join = await page.getByRole('link', { name: 'Open guest invitation' }).getAttribute('href'); await page.goto(join!);
  await page.getByLabel('Display name').fill('Metadata listener'); await page.getByRole('button', { name: 'Join room' }).click(); await showFind(page);
  const search = async (query: string) => { await page.getByRole('searchbox', { name: 'Search catalogue' }).fill(query); await page.getByRole('button', { name: 'Search', exact: true }).click(); };
  await page.setViewportSize({ width: 390, height: 1000 });
  for (const name of ['Metallica', 'Iron Maiden', 'Megadeth', 'Slayer', 'Metallica']) {
    await search(name);
    await expect(page.locator('.catalogue-results .track-row')).toHaveCount(2);
    await expect(page.locator('.catalogue-results strong')).toHaveText([name, name]);
    await expect(page.getByRole('button', { name: 'View albums', exact: true }).first()).toBeEnabled();
    await expect(page.locator('.catalogue-results').getByRole('combobox')).toHaveCount(0);
  }
  const response = await (await post('/api/participant/browse', { kind: 'artists', value: 'Metallica' })).json();
  const group = response.artists[0]; expect(group.sources).toBeUndefined();
  expect((await post('/api/participant/browse', { kind: 'albums', value: group.id })).status()).toBe(200);
  expect(JSON.stringify(response)).not.toMatch(/private-instance|private-multi|spotify:\/\/|external_ids/);
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page.screenshot({ path: 'test-results/metadata-artists-mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'View albums', exact: true }).nth(1).click();
  await expect(page.getByText('tidal exclusive', { exact: true })).toBeVisible();
  await expect(page.getByText('spotify exclusive', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '← Artists', exact: true }).click();
  await page.getByRole('button', { name: 'View albums', exact: true }).first().click();
  await expect(page.getByText('spotify exclusive', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Songs', exact: true }).click(); await search('multi-provider-metadata');
  await expect(page.locator('.catalogue-results .track-row')).toHaveCount(3); // Unconfirmed copies and Live remain distinct.
  const original = page.locator('.catalogue-results .track-row').nth(1);
  await expect(original.getByRole('combobox')).toHaveCount(0);
  await expect(original.getByRole('button', { name: 'Add to list', exact: true })).toBeEnabled();
  await original.getByRole('button', { name: 'Add to list', exact: true }).click();
  await expect(page.locator('.saved-track .saved-source')).toHaveText('tidal');
  expect(isolatedApp.calls.filter(c => c.command === 'player_queues/play_media')).toHaveLength(0);
});

test('unconfirmed releases remain separate while verified artist groups include both catalogues', async ({ page, isolatedApp }) => {
  const post = (path: string, data: unknown) => page.request.post(path, { data, headers: { Origin: isolatedApp.origin } });
  await post('/api/host/integrations/save', { url: isolatedApp.musicAssistantOrigin, accessToken: 'browser-test-token', revision: 0 });
  await page.goto('/host'); const join = await page.getByRole('link', { name: 'Open guest invitation' }).getAttribute('href'); await page.goto(join!);
  await page.getByLabel('Display name').fill('Release choices'); await page.getByRole('button', { name: 'Join room' }).click(); await showFind(page);
  await page.getByRole('searchbox', { name: 'Search catalogue' }).fill('multi-provider-metadata-albums'); await page.getByRole('button', { name: 'Search', exact: true }).click();
  await page.getByRole('button', { name: 'View albums', exact: true }).first().click();
  await expect(page.locator('.catalogue-results .track-row')).toHaveCount(4);
  await expect(page.getByText('spotify exclusive', { exact: true })).toBeVisible(); await expect(page.getByText('tidal exclusive', { exact: true })).toBeVisible();
  const releases = page.locator('.catalogue-results .track-row').filter({ hasText: 'The same release' });
  await expect(releases).toHaveCount(2);
  const release = releases.nth(1);
  await expect(release.getByRole('combobox')).toHaveCount(0);
  const before = isolatedApp.calls.length;
  await release.getByRole('button', { name: 'View tracks', exact: true }).click();
  await expect(page.locator('.catalogue-results .track-row')).toHaveCount(1);
  expect(isolatedApp.calls.slice(before).filter(c => c.command === 'music/albums/album_tracks').map(c => c.args.provider_instance_id_or_domain)).toEqual(['tidal']);
});

test('Play automatically selects the available equivalent once, and reveal remains guarded', async ({ browser, page, isolatedApp }) => {
  const post = (path: string, data: unknown) => page.request.post(path, { data, headers: { Origin: isolatedApp.origin } });
  await post('/api/host/integrations/save', { url: isolatedApp.musicAssistantOrigin, accessToken: 'browser-test-token', revision: 0 });
  await post('/api/host/integrations/destination', { id: 'sonos:room', revision: 1 });
  await page.goto('/host');
  const join = await page.getByRole('link', { name: 'Open guest invitation' }).getAttribute('href');
  const display = await page.getByRole('link', { name: 'Open room display' }).getAttribute('href');
  const tvContext = await browser.newContext();
  try {
    const tv = await tvContext.newPage(); await tv.goto(display!); await page.goto(join!);
    await page.getByLabel('Display name').fill('Exact-source listener'); await page.getByRole('button', { name: 'Join room' }).click(); await showFind(page);
    await page.getByRole('button', { name: 'Songs', exact: true }).click();
    await page.getByRole('searchbox', { name: 'Search catalogue' }).fill('multi-provider'); await page.getByRole('button', { name: 'Search', exact: true }).click();
    expect(isolatedApp.calls.filter(c => c.command === 'player_queues/play_media')).toHaveLength(0);
    const original = page.locator('.catalogue-results .track-row').first();
    await expect(original.getByRole('combobox')).toHaveCount(0);
    await original.getByRole('button', { name: 'Play', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'The same recording', exact: true })).toBeVisible();
    await expect.poll(() => isolatedApp.calls.filter(c => c.command === 'player_queues/play_media').map(c => c.args.media)).toEqual([['tidal://track/private-multi-track']]);
    await expect(tv.getByRole('heading', { name: 'Track details hidden.' })).toBeVisible();
    await expect(tv.getByText('The same recording')).toHaveCount(0);
    await page.getByRole('button', { name: 'Reveal details' }).click();
    await expect(tv.getByRole('heading', { name: 'The same recording', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Finish turn', exact: true }).click();
    await expect(tv.getByRole('heading', { name: 'Nothing playing.' })).toBeVisible();
    expect(isolatedApp.calls.filter(c => c.command === 'player_queues/play_media')).toHaveLength(1);
  } finally { await tvContext.close(); }
});
