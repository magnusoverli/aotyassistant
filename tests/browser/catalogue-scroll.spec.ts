import { expect, type Page } from '@playwright/test';
import { test } from './app-fixture';

async function expectListStart(page: Page) {
  await expect.poll(() => page.evaluate(() => {
    const heading = document.getElementById('music-results-title')!.getBoundingClientRect();
    const first = document.querySelector('.catalogue-results .track-row')!.getBoundingClientRect();
    const header = document.querySelector('header')!;
    const list = document.querySelector('.preparation-list')!;
    const obstruction = Math.max(0,
      getComputedStyle(header).position === 'sticky' ? header.getBoundingClientRect().bottom : 0,
      innerWidth < 1100 && getComputedStyle(list).position === 'sticky' ? list.getBoundingClientRect().bottom : 0);
    return heading.top >= obstruction && heading.bottom < innerHeight && first.top < innerHeight;
  }), { message: 'The new list starts visibly below any sticky controls' }).toBe(true);
}

for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 1000 }, { width: 390, height: 440 }]) {
  test(`new catalogue lists start at the top; history restores each position at ${viewport.width}×${viewport.height}`, async ({ page, isolatedApp }) => {
    await page.setViewportSize(viewport);
    const post = (path: string, data: unknown) => page.request.post(path, { data, headers: { Origin: isolatedApp.origin } });
    await post('/api/host/integrations/save', { url: isolatedApp.musicAssistantOrigin, accessToken: 'browser-test-token', revision: 0 });
    await post('/api/participant/join', { nickname: 'Browsing listener' });
    // Extend actual fixture responses so each browse level requires scrolling.
    await page.route('**/api/participant/browse', async route => {
      const response = await route.fetch(); const data = await response.json();
      const kind = route.request().postDataJSON().kind as 'artists' | 'albums' | 'tracks';
      const item = data[kind][0];
      data[kind] = Array.from({ length: 24 }, (_, i) => ({ ...item, [kind === 'tracks' ? 'title' : 'name']: `${kind} ${i + 1}` }));
      await route.fulfill({ response, json: data });
    });
    await page.route('**/api/participant/search', async route => {
      const response = await route.fetch(); const data = await response.json();
      data.tracks = Array.from({ length: 24 }, (_, i) => ({ ...data.tracks[0], title: `Song ${i + 1}` }));
      await route.fulfill({ response, json: data });
    });
    await page.goto('/participant');
    await page.getByRole('searchbox').fill('Fixture'); await page.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(page.locator('.catalogue-results .track-row')).toHaveCount(24);
    await expectListStart(page);
    const artist = page.getByRole('button', { name: 'View albums', exact: true }).nth(19);
    await artist.scrollIntoViewIfNeeded(); const artistScroll = await page.evaluate(() => scrollY);
    await artist.click(); await expect(page.getByRole('button', { name: 'View tracks', exact: true })).toHaveCount(24);
    await expectListStart(page);
    const album = page.getByRole('button', { name: 'View tracks', exact: true }).nth(19);
    await album.scrollIntoViewIfNeeded(); const albumScroll = await page.evaluate(() => scrollY);
    await album.click(); await expect(page.getByRole('button', { name: 'Add to my list', exact: true })).toHaveCount(24);
    await expectListStart(page);
    await page.locator('.catalogue-results .track-row').nth(12).scrollIntoViewIfNeeded();
    const trackScroll = await page.evaluate(() => scrollY);
    await page.goBack(); await expect(page.getByRole('button', { name: 'View tracks', exact: true })).toHaveCount(24);
    await expect.poll(() => page.evaluate(() => scrollY)).toBeCloseTo(albumScroll, 0);
    await page.goForward(); await expect(page.getByRole('button', { name: 'Add to my list', exact: true })).toHaveCount(24);
    await expect.poll(() => page.evaluate(() => scrollY)).toBeCloseTo(trackScroll, 0);
    await page.getByRole('button', { name: '← Albums' }).click();
    await page.getByRole('button', { name: '← Artists' }).click();
    await expect(page.getByRole('button', { name: 'View albums', exact: true })).toHaveCount(24);
    await expect.poll(() => page.evaluate(() => scrollY)).toBeCloseTo(artistScroll, 0);
    await page.getByRole('searchbox').fill('Fixture again'); await page.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(page.locator('.catalogue-results .track-row')).toHaveCount(24); await expectListStart(page);
    await page.getByRole('button', { name: 'Songs', exact: true }).click();
    await page.getByRole('searchbox').fill('Fixture'); await page.getByRole('searchbox').press('Enter');
    await expect(page.getByRole('button', { name: 'Add to my list', exact: true })).toHaveCount(24);
    await expectListStart(page);
    expect((await (await page.request.get('/api/participant/state')).json()).ownPlayback).toBeNull();
  });
}
