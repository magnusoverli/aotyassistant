import { expect } from '@playwright/test';
import { test } from './app-fixture';

test('mobile selections remain accessible and source choices fit narrow screens without shortcuts', async ({ page, isolatedApp }) => {
  const post = (path: string, data: unknown) => page.request.post(path, { data, headers: { Origin: isolatedApp.origin } });
  await post('/api/host/integrations/save', { url: isolatedApp.musicAssistantOrigin, accessToken: 'browser-test-token', revision: 0 });
  await isolatedApp.engine.join('Current'); await post('/api/participant/join', { pin: '1234', nickname: 'Waiting' });
  await page.setViewportSize({ width: 320, height: 568 }); await page.goto('/participant');
  const shortcuts = page.getByRole('navigation', { name: 'Your music shortcuts' });
  await expect(shortcuts).toBeHidden();
  await expect(page.locator('.turn-distance')).toBeHidden();
  await expect(page.locator('.preparation-list')).toBeVisible();
  await expect(page.getByRole('button', { name: /^(Open|Close) list$/ })).toHaveCount(0);
  await page.getByRole('searchbox').scrollIntoViewIfNeeded();
  await expect(page.getByRole('searchbox')).toBeInViewport();
  await page.getByRole('searchbox').fill('Metallica'); await page.getByRole('searchbox').press('Enter');
  const select = page.getByRole('combobox', { name: 'Source for Metallica', exact: true });
  await expect(select).toBeVisible();
  const box = (await select.boundingBox())!;
  expect(box.width).toBeGreaterThan(230); expect(box.x + box.width).toBeLessThanOrEqual(320);
  await expect(page.getByRole('button', { name: 'View albums' })).toBeDisabled();
  await select.selectOption({ label: 'Tidal' });
  await page.getByRole('button', { name: 'View albums' }).click();
  await expect(page.getByText('tidal exclusive', { exact: true })).toBeVisible();
  expect(isolatedApp.calls.filter(call => call.command === 'player_queues/play_media')).toHaveLength(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('mobile removes the turn-status row without changing desktop geometry or the accessible heading', async ({ page, isolatedApp }) => {
  await isolatedApp.engine.join('Current');
  await page.request.post('/api/participant/join', { data: { pin: '1234', nickname: 'Waiting' }, headers: { Origin: isolatedApp.origin } });
  await page.setViewportSize({ width: 1100, height: 1000 }); await page.goto('/participant');
  const hero = page.locator('.participant-hero');
  const distance = page.locator('.turn-distance');
  await expect(distance).toBeVisible(); await expect(distance).toHaveText('You’re next');
  const desktop = await hero.boundingBox();
  for (const width of [1099, 700, 390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(distance).toBeHidden();
    await expect(page.getByRole('navigation', { name: 'Your music shortcuts' })).toBeHidden();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Current’s turn.');
    expect(await hero.evaluate(node => node.getBoundingClientRect().height)).toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.setViewportSize({ width: 1100, height: 1000 });
  await expect(distance).toBeVisible();
  expect(await hero.boundingBox()).toEqual(desktop);
});
