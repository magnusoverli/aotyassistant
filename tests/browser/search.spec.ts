import { expect } from '@playwright/test';
import { test } from './app-fixture';
import { showFind } from './preparation-helpers';

test('participant searches privately with empty/errors but cannot play until a speaker is selected', async ({ browser, page: host, isolatedApp }) => {
  const post = (path: string, data: unknown) => host.request.post(path, { data, headers: { Origin: isolatedApp.origin } });
  let settings = await (await host.request.get('/api/host/integrations')).json();
  expect((await post('/api/host/integrations/save', { url: isolatedApp.musicAssistantOrigin, accessToken: 'browser-test-token', revision: settings.revision })).ok()).toBe(true);
  const aliceContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const waitingContext = await browser.newContext(); const tvContext = await browser.newContext();
  try {
    await host.goto('/host');
    const joinUrl = await host.getByRole('link', { name: 'Open guest invitation' }).getAttribute('href');
    const displayUrl = await host.getByRole('link', { name: 'Open public display' }).getAttribute('href');
    const alice = await aliceContext.newPage(); await alice.goto(joinUrl!);
    await alice.getByLabel('What should we call you?').fill('Alice'); await alice.getByRole('button', { name: 'Join room' }).click();
    await expect(alice).toHaveURL(/\/participant$/);
    const waiting = await waitingContext.newPage(); await waiting.goto(joinUrl!);
    await waiting.getByLabel('What should we call you?').fill('Waiting listener'); await waiting.getByRole('button', { name: 'Join room' }).click();
    const tv = await tvContext.newPage(); await tv.goto(displayUrl!);
    const responses: string[] = []; const requests: string[] = [];
    alice.on('request', request => requests.push(request.url()));
    alice.on('response', response => {
      if (response.url().includes('/api/participant/search')) void response.text().then(text => responses.push(text)).catch(() => {});
    });
    await showFind(alice);
    await expect(alice.getByText('Private search', { exact: true })).toBeVisible();
    await expect(alice.getByText('Choose a speaker in host settings before playing. You can still prepare tracks.', { exact: true })).toBeVisible();
    await expect(alice.getByRole('button', { name: 'Search artists', exact: true })).toBeVisible();
    await expect(alice.getByRole('searchbox', { name: 'Search catalogue' })).toBeInViewport();
    await alice.screenshot({ path: 'test-results/participant-catalogue.png', fullPage: true });
    await alice.getByRole('searchbox', { name: 'Search catalogue' }).fill('fixture'); await alice.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(alice.getByText('Real catalogue fixture', { exact: true })).toBeVisible();
    await expect(alice.getByText('Fixture artist · Fixture album · Original recording · spotify')).toBeVisible();
    await expect(alice.getByRole('button', { name: 'Choose a speaker', exact: true })).toBeDisabled();
    await expect(waiting.getByText('Real catalogue fixture')).toHaveCount(0);
    await expect(tv.getByText('Real catalogue fixture')).toHaveCount(0);
    await expect(tv.getByRole('heading', { name: 'Nothing playing.' })).toBeVisible();
    expect(responses.join('')).not.toContain('browser-test-token');
    expect(responses.join('')).not.toContain('private-fixture-uri');
    expect(responses.join('')).not.toContain('secret-search-art');
    expect(requests.some(url => url.startsWith(isolatedApp.musicAssistantOrigin))).toBe(false);
    await alice.getByRole('searchbox', { name: 'Search catalogue' }).fill('empty'); await alice.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(alice.getByText('No tracks found. Try a different title or artist,')).toBeVisible();
    await expect(alice.getByText('Real catalogue fixture', { exact: true })).toHaveCount(0);
    await alice.getByRole('searchbox', { name: 'Search catalogue' }).fill('failure'); await alice.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(alice.getByRole('alert')).toContainText('Music Assistant did not accept');
    await expect(alice.getByText('PRIVATE FIXTURE ERROR')).toHaveCount(0);
    await expect(alice.getByRole('button', { name: 'Finish my turn' })).toBeEnabled();
    // The demo catalogue is not used as a silent fallback after an upstream failure.
    await expect(alice.getByText('Northern Lights', { exact: true })).toHaveCount(0);
  } finally {
    await aliceContext.close(); await waitingContext.close(); await tvContext.close();
  }
});
