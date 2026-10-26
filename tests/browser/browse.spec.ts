import { expect } from '@playwright/test';
import { test } from './app-fixture';
import { saveChoice, showFind } from './preparation-helpers';

test('non-current participant browses an artist, prepares a track, then plays/reveals only on their turn', async ({ browser, page: host, isolatedApp }) => {
  const post = (path: string, data: unknown) => host.request.post(path, { data, headers: { Origin: isolatedApp.origin } });
  let settings = await (await host.request.get('/api/host/integrations')).json();
  await post('/api/host/integrations/save', { url: isolatedApp.musicAssistantOrigin, accessToken: 'browser-test-token', revision: settings.revision });
  settings = await (await host.request.get('/api/host/integrations')).json(); await post('/api/host/integrations/check', { revision: settings.revision });
  await post('/api/host/integrations/destination', { id: 'sonos:room', revision: settings.revision });
  const firstContext = await browser.newContext(); const secondContext = await browser.newContext({ viewport: { width: 390, height: 844 } }); const tvContext = await browser.newContext();
  try {
    await host.goto('/host');
    const join = await host.getByRole('link', { name: 'Open guest invitation' }).getAttribute('href');
    const display = await host.getByRole('link', { name: 'Open room display' }).getAttribute('href');
    const first = await firstContext.newPage(); await first.goto(join!); await first.getByLabel('Display name').fill('First'); await first.getByRole('button', { name: 'Join room' }).click();
    const second = await secondContext.newPage(); await second.goto(join!); await second.getByLabel('Display name').fill('Second'); await second.getByRole('button', { name: 'Join room' }).click();
    await showFind(second);
    await expect(second.getByRole('button', { name: 'Artists', exact: true })).toBeEnabled();
    await expect(second.getByRole('button', { name: 'Artists', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(second.getByRole('searchbox', { name: 'Search catalogue' })).toHaveAttribute('placeholder', 'Artist name');
    // Returning to the page also starts in artist mode, without an automatic search.
    await second.getByRole('button', { name: 'Songs', exact: true }).click();
    await expect(second.getByRole('button', { name: 'Songs', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await second.reload();
    await expect(second.getByRole('button', { name: 'Artists', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(second.locator('.catalogue-results .track-row')).toHaveCount(0);
    await second.getByRole('searchbox', { name: 'Search catalogue' }).fill('Fixture'); await second.getByRole('button', { name: 'Search', exact: true }).click();
    await second.getByRole('button', { name: 'View albums', exact: true }).click(); await second.getByRole('button', { name: 'View tracks', exact: true }).click();
    await saveChoice(second);
    await expect(second.getByRole('button', { name: /^(Play first selection|Play pick)$/ })).toBeDisabled();
    await expect(first.getByText('Real catalogue fixture', { exact: true })).toHaveCount(0);
    const tv = await tvContext.newPage(); await tv.goto(display!); await expect(tv.getByText('Real catalogue fixture')).toHaveCount(0);
    const privateState = await (await second.request.get('/api/participant/state')).json();
    const forged = await second.request.post(isolatedApp.origin + '/api/participant/play', { headers: { Origin: isolatedApp.origin }, data: { turnId: privateState.turnId, previousPlaybackId: null, trackId: 'forged' } });
    expect(forged.status()).toBe(403);
    await host.getByRole('button', { name: 'Skip turn' }).click();
    await expect(second.getByRole('button', { name: /^(Play first selection|Play pick)$/ })).toBeEnabled();
    await second.getByRole('button', { name: /^(Play first selection|Play pick)$/ }).click();
    await expect(second.getByRole('heading', { name: 'Real catalogue fixture (Original recording)', exact: true })).toBeVisible();
    await expect(second.getByRole('searchbox', { name: 'Search catalogue' })).toBeVisible();
    await showFind(second);
    await expect(second.getByRole('searchbox', { name: 'Search catalogue' })).toHaveValue('Fixture');
    await expect(second.getByRole('button', { name: 'Artists', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(second.getByRole('button', { name: 'Add to list', exact: true })).toBeVisible();
    await second.getByRole('button', { name: 'Pause', exact: true }).click();
    await expect(second.getByRole('searchbox', { name: 'Search catalogue' })).toBeVisible();
    await second.screenshot({ path: 'test-results/participant-change-song.png', fullPage: true });
    await second.getByRole('button', { name: 'Resume', exact: true }).click();
    await expect(tv.getByRole('heading', { name: 'Track details hidden.' })).toBeVisible();
    await second.getByRole('button', { name: 'Reveal details' }).click();
    await expect(tv.getByRole('heading', { name: 'Real catalogue fixture (Original recording)', exact: true })).toBeVisible();
    await expect(first.getByText('Real catalogue fixture')).toHaveCount(0);
    await second.getByRole('button', { name: 'Pause', exact: true }).click(); await second.getByRole('button', { name: 'Resume', exact: true }).click();
    await second.getByRole('button', { name: 'Finish turn' }).click();
    await expect(first.getByRole('heading', { name: 'Your turn.' })).toBeVisible();
    await expect(tv.getByRole('heading', { name: 'Nothing playing.' })).toBeVisible();
  } finally {
    await firstContext.close(); await secondContext.close(); await tvContext.close();
  }
});
