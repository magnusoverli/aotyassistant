import { expect } from '@playwright/test';
import { test } from './app-fixture';
import { closeSearch, openSearch } from './preparation-helpers';

test('participant searches privately with empty/errors but cannot play until a speaker is selected', async ({ browser, page: host, isolatedApp }) => {
  const post = (path: string, data: unknown) => host.request.post(path, { data, headers: { Origin: isolatedApp.origin } });
  let settings = await (await host.request.get('/api/host/integrations')).json();
  expect((await post('/api/host/integrations/save', { url: isolatedApp.musicAssistantOrigin, accessToken: 'browser-test-token', revision: settings.revision })).ok()).toBe(true);
  const aliceContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const waitingContext = await browser.newContext(); const tvContext = await browser.newContext();
  try {
    await host.goto('/host');
    const joinUrl = await host.getByRole('link', { name: 'Open guest invitation' }).getAttribute('href');
    const displayUrl = await host.getByRole('link', { name: 'Open room display' }).getAttribute('href');
    const alice = await aliceContext.newPage(); await alice.goto(joinUrl!);
    await alice.getByLabel('Display name').fill('Alice'); await alice.getByLabel('4-digit PIN', { exact: true }).fill('1234'); await alice.getByRole('button', { name: 'Join room' }).click();
    await expect(alice).toHaveURL(/\/participant$/);
    expect((await (await host.request.get('/api/host/state')).json()).playbackAvailable).toBe(false);
    const waiting = await waitingContext.newPage(); await waiting.goto(joinUrl!);
    await waiting.getByLabel('Display name').fill('Waiting listener'); await waiting.getByLabel('4-digit PIN', { exact: true }).fill('1234'); await waiting.getByRole('button', { name: 'Join room' }).click();
    const tv = await tvContext.newPage(); await tv.goto(displayUrl!);
    const responses: string[] = []; const requests: string[] = [];
    alice.on('request', request => requests.push(request.url()));
    alice.on('response', response => {
      if (/\/api\/participant\/(browse|search)$/.test(response.url())) void response.text().then(text => responses.push(text)).catch(() => {});
    });
    // Phones keep search behind the field under the playlist title; desktop shows it beside the list.
    await expect(alice.locator('#music-search-open')).toBeInViewport();
    await alice.setViewportSize({ width: 1440, height: 844 });
    await expect(alice.getByRole('searchbox', { name: 'Search catalogue' })).toBeInViewport();
    await alice.setViewportSize({ width: 390, height: 844 });
    await openSearch(alice);
    await expect(alice.getByText('Your search', { exact: true })).toBeHidden();
    await expect(alice.getByRole('searchbox', { name: 'Search catalogue' })).toBeInViewport();
    await expect(alice.getByText('Choose a speaker in host settings before playing. You can still prepare tracks.', { exact: true })).toBeVisible();
    await expect(alice.locator('.catalogue-panel').getByRole('link', { name: 'host settings', exact: true })).toHaveAttribute('href', '/host/settings');
    await expect(alice.getByRole('button', { name: 'Artists', exact: true })).toHaveCount(0);
    await expect(alice.getByRole('button', { name: 'Songs', exact: true })).toHaveCount(0);
    await alice.screenshot({ path: 'test-results/participant-catalogue.png', fullPage: true });
    await expect(alice.getByRole('searchbox', { name: 'Search catalogue' })).toHaveAttribute('placeholder', 'Search for an artist');
    await alice.getByRole('searchbox', { name: 'Search catalogue' }).fill('fixture'); await alice.getByRole('searchbox', { name: 'Search catalogue' }).press('Enter');
    // A search lists matching artists only: songs are chosen from an artist's album, never searched for.
    await expect(alice.getByRole('button', { name: 'View albums by Fixture artist', exact: true })).toBeVisible();
    await expect(alice.getByRole('heading', { name: 'Artists', exact: true })).toHaveCount(0);
    await expect(alice.getByRole('heading', { name: 'Songs', exact: true })).toHaveCount(0);
    await expect(alice.locator('.catalogue-results .track-row:not(.browse-row)')).toHaveCount(0);
    await alice.getByRole('button', { name: 'View albums' }).click();
    await alice.getByRole('button', { name: 'View tracks' }).click();
    await expect(alice.getByText('Real catalogue fixture', { exact: true })).toBeVisible();
    // The album heading names the artist; phone song rows leave it out.
    await expect(alice.locator('.browse-heading')).toContainText('Fixture album'); await expect(alice.locator('.browse-heading')).toContainText('Fixture artist · 2025');
    await expect(alice.getByText('Original recording · 3:00', { exact: true })).toBeVisible(); // Phones show version and length; the heading has the album.
    await expect(alice.getByRole('button', { name: 'Choose a speaker', exact: true })).toBeDisabled();
    await expect(waiting.getByText('Real catalogue fixture')).toHaveCount(0);
    await expect(tv.getByText('Real catalogue fixture')).toHaveCount(0);
    await expect(tv.getByRole('heading', { name: 'Nothing playing.' })).toBeVisible();
    expect(responses.join('')).not.toContain('browser-test-token');
    expect(responses.join('')).not.toContain('private-fixture-uri');
    expect(responses.join('')).not.toContain('secret-search-art');
    expect(requests.some(url => url.startsWith(isolatedApp.musicAssistantOrigin))).toBe(false);
    expect(requests.some(url => url.endsWith('/api/participant/search'))).toBe(false);
    const searches = isolatedApp.calls.filter(call => call.command === 'music/search').map(call => JSON.stringify(call.args.media_types));
    expect(searches.length).toBeGreaterThan(0); expect(searches.every(types => types === '["artist"]')).toBe(true);
    // The old song search is gone from the server too.
    expect((await alice.request.post('/api/participant/search', { headers: { Origin: isolatedApp.origin }, data: { turnId: 'x', query: 'fixture' } })).ok()).toBe(false);
    await alice.getByRole('searchbox', { name: 'Search catalogue' }).fill('empty'); await alice.getByRole('searchbox', { name: 'Search catalogue' }).press('Enter');
    await expect(alice.getByText('No artists found. Try another search.')).toBeVisible();
    await expect(alice.getByText('Real catalogue fixture', { exact: true })).toHaveCount(0);
    await alice.getByRole('searchbox', { name: 'Search catalogue' }).fill('failure'); await alice.getByRole('searchbox', { name: 'Search catalogue' }).press('Enter');
    await expect(alice.getByRole('alert')).toContainText('Music Assistant did not accept');
    await expect(alice.locator('.catalogue-results').getByRole('alert')).toContainText('Music Assistant did not accept');
    await expect(alice.locator('.catalogue-results').getByRole('button', { name: 'Try again', exact: true })).toBeEnabled();
    await expect(alice.getByText('PRIVATE FIXTURE ERROR')).toHaveCount(0);
    await closeSearch(alice);
    await expect(alice.getByRole('button', { name: 'Pass turn' })).toBeEnabled();
  } finally {
    await aliceContext.close(); await waitingContext.close(); await tvContext.close();
  }
});
