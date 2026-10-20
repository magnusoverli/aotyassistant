import { expect, type Page } from '@playwright/test';
import { test } from './app-fixture';
import { saveChoice, showFind, showList } from './preparation-helpers';

test('speaker changes preserve private lists/browsing/images and token changes retain saved entries', async ({ browser, page: host, isolatedApp }) => {
  const post = (path: string, data: unknown) => host.request.post(path, { data, headers: { Origin: isolatedApp.origin } });
  let state = await (await host.request.get('/api/host/state')).json();
  let settings = await (await host.request.get('/api/host/integrations')).json();
  expect((await post('/api/host/integrations/save', { url: isolatedApp.musicAssistantOrigin, accessToken: 'browser-test-token', revision: settings.revision })).ok()).toBe(true);
  settings = await (await host.request.get('/api/host/integrations')).json();
  expect((await post('/api/host/integrations/destination', { id: 'sonos:room', revision: settings.revision })).ok()).toBe(true);
  const firstContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const secondContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const tvContext = await browser.newContext();
  try {
    const first = await firstContext.newPage(); const second = await secondContext.newPage();
    const join = async (page: Page, name: string) => {
      await page.goto(state.joinUrl); await page.getByLabel('Display name').fill(name); await page.getByRole('button', { name: 'Join room', exact: true }).click();
      await expect(page).toHaveURL(/\/participant$/);
    };
    await join(first, 'Alex'); state = await (await host.request.get('/api/host/state')).json();
    await join(second, 'Sam');
    const tv = await tvContext.newPage(); await tv.goto(state.displayUrl);
    const prepare = async (page: Page) => {
      await showFind(page);
      await page.getByRole('button', { name: 'Artists', exact: true }).click();
      await page.getByRole('searchbox', { name: 'Search catalogue' }).fill('Fixture'); await page.getByRole('button', { name: 'Search', exact: true }).click();
      await page.getByRole('button', { name: 'View albums', exact: true }).click();
      const response = page.waitForResponse(response => response.url().endsWith('/api/participant/browse') && response.request().postDataJSON().kind === 'tracks');
      await page.getByRole('button', { name: 'View tracks', exact: true }).click(); const result = await (await response).json();
      await saveChoice(page);
      await expect(page.getByAltText('Saved album artwork', { exact: true })).toHaveJSProperty('naturalWidth', 1);
      const saved = await (await page.request.get('/api/participant/preparations/state')).json(); await showFind(page);
      await page.evaluate(() => { (window as unknown as { destinationTestDocument: string }).destinationTestDocument = 'same-document'; });
      return { ...result.tracks[0], entryId: saved.upcoming[0].id, savedArtwork: saved.upcoming[0].artwork };
    };
    const firstTrack = await prepare(first); const secondTrack = await prepare(second);
    const beforeFirst = await (await first.request.get('/api/participant/state')).json();
    const beforeSecond = await (await second.request.get('/api/participant/state')).json();
    const cookieBefore = (await secondContext.cookies()).find(cookie => cookie.name === 'aoty_participant')!.value;
    await first.getByRole('searchbox', { name: 'Search catalogue' }).focus();
    await host.goto('/host/settings');
    await expect(host.getByLabel('Speaker or group', { exact: true })).toBeEnabled();
    await host.getByLabel('Speaker or group', { exact: true }).selectOption('sonos:bedroom');
    await expect(host.getByText('Active speaker: Bedroom', { exact: true })).toBeVisible();
    await expect(host.getByText('Bedroom is now the active speaker.', { exact: true })).toBeVisible();
    for (const page of [first, second]) {
      expect((await (await page.request.get('/api/participant/preparations/state')).json()).upcoming).toHaveLength(1);
      await expect(page.getByRole('searchbox', { name: 'Search catalogue' })).toHaveValue('Fixture');
      await expect(page.getByRole('button', { name: 'Artists', exact: true })).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByRole('button', { name: '← Albums', exact: true })).toBeVisible();
      expect(await page.evaluate(() => (window as unknown as { destinationTestDocument: string }).destinationTestDocument)).toBe('same-document');
    }
    await expect(first.getByRole('searchbox', { name: 'Search catalogue' })).toBeFocused();
    const afterFirst = await (await first.request.get('/api/participant/state')).json();
    const afterSecond = await (await second.request.get('/api/participant/state')).json();
    for (const [before, after] of [[beforeFirst, afterFirst], [beforeSecond, afterSecond]]) {
      expect(after.roomId).toBe(before.roomId); expect(after.me.id).toBe(before.me.id); expect(after.turnId).toBe(before.turnId);
      expect(after.catalogue.revision).toBe(before.catalogue.revision); expect(after.catalogue.playbackAvailable).toBe(true);
    }
    expect((await secondContext.cookies()).find(cookie => cookie.name === 'aoty_participant')!.value === cookieBefore).toBe(true);
    expect((await first.request.get(firstTrack.artwork)).status()).toBe(200);
    expect((await second.request.get(secondTrack.artwork)).status()).toBe(200);
    expect((await second.request.get(firstTrack.artwork)).status()).toBe(409);
    await expect(tv.getByText('Real catalogue fixture')).toHaveCount(0); await expect(host.getByText('Real catalogue fixture')).toHaveCount(0);
    // Old artist/album references must remain genuinely usable, not just visible in a stale UI.
    await second.getByRole('button', { name: '← Albums', exact: true }).click(); await second.getByRole('button', { name: 'View tracks', exact: true }).click();
    await expect(second.getByRole('button', { name: 'Add to list', exact: true })).toBeVisible();
    await showList(first); await showList(second);
    await expect(first.getByRole('button', { name: 'Play first selection', exact: true })).toBeEnabled();
    await expect(second.getByRole('button', { name: 'Play first selection', exact: true })).toBeDisabled();
    await first.getByRole('button', { name: 'Play first selection', exact: true }).click(); await expect(first.locator('.player-pending')).toHaveCount(0);
    expect((await (await first.request.get('/api/participant/state')).json()).ownPlayback.track.id).toBe(`prepared:${firstTrack.entryId}`);
    await expect(second.locator('.saved-track.is-next')).toBeVisible();
    await host.goto('/host');
    await first.getByRole('button', { name: 'Finish turn' }).click();
    await expect(second.getByRole('button', { name: 'Play first selection', exact: true })).toBeEnabled();
    await second.getByRole('button', { name: 'Play first selection', exact: true }).click(); await expect(second.locator('.player-pending')).toHaveCount(0);
    expect((await (await second.request.get('/api/participant/state')).json()).ownPlayback.track.id).toBe(`prepared:${secondTrack.entryId}`);
    await expect(tv.getByText('Real catalogue fixture')).toHaveCount(0);
    await second.getByRole('button', { name: 'Finish turn' }).click(); await expect(first.getByRole('heading', { name: 'Your turn.' })).toBeVisible();
    for (const page of [first, second]) {
      await showList(page); await page.locator('#list-history').click(); await page.getByRole('button', { name: 'Add back', exact: true }).click(); await expect(page.locator('.saved-track.is-next')).toBeVisible(); await showFind(page);
    }
    settings = await (await host.request.get('/api/host/integrations')).json();
    expect((await post('/api/host/integrations/save', { url: isolatedApp.musicAssistantOrigin, accessToken: 'fixture-token', revision: settings.revision })).ok()).toBe(true);
    for (const page of [first, second]) {
      await expect(page.getByRole('searchbox', { name: 'Search catalogue' })).toHaveValue(''); await showList(page); await expect(page.locator('.saved-track.is-next')).toBeVisible();
    }
    expect((await (await first.request.get('/api/participant/state')).json()).catalogue.revision).not.toBe(beforeFirst.catalogue.revision);
  } finally {
    await firstContext.close(); await secondContext.close(); await tvContext.close();
    settings = await (await host.request.get('/api/host/integrations')).json(); if (settings.tokenConfigured) await post('/api/host/integrations/clear', { revision: settings.revision });
  }
});
