import { expect } from '@playwright/test';
import { test } from './app-fixture';

test('host desk prioritizes the current turn with a slim volume panel and responsive invitation sidebar', async ({ page, isolatedApp }) => {
  await isolatedApp.engine.join('Host layout listener');
  await page.goto('/host');
  await expect(page.locator('.host-live')).toBeVisible();
  await expect(page.getByRole('main', { name: 'Host desk', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Room display', exact: true })).toHaveCount(0);
  expect(await page.locator('.host-workspace').evaluate(node => Array.from(node.children).map(child => child.className))).toEqual([
    'host-live panel', 'panel host-audio', 'panel host-people',
  ]);
  await expect(page.getByRole('button', { name: 'Skip turn' })).toBeEnabled();
  await expect(page.locator('.host-invitations img')).toBeVisible();

  for (const width of [1440, 1100, 800, 701, 700, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    const workspace = (await page.locator('.host-workspace').boundingBox())!;
    const sidebar = (await page.locator('.host-invitations').boundingBox())!;
    const audio = (await page.locator('.host-audio').boundingBox())!;
    if (width > 700) {
      expect(sidebar.x).toBeGreaterThanOrEqual(workspace.x + workspace.width);
      expect(Math.abs(sidebar.y - workspace.y)).toBeLessThan(1);
    } else {
      expect(sidebar.y).toBeGreaterThanOrEqual(workspace.y + workspace.height);
    }
    expect(audio.height).toBeLessThan(125);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    if (width === 1440 || width === 390) await page.screenshot({ path: `test-results/host-layout-${width}.png`, fullPage: true });
  }
});

test('unavailable host volume links directly to speaker settings without changing playback', async ({ page, isolatedApp }) => {
  await isolatedApp.engine.join('Volume listener');
  const writes: string[] = [];
  page.on('request', request => { if (request.method() === 'POST') writes.push(new URL(request.url()).pathname); });
  await page.route('**/api/host/events', route => route.abort());
  await page.route('**/api/host/state', async route => {
    const response = await route.fetch();
    const state = await response.json();
    await route.fulfill({ response, json: { ...state, volume: { ...state.volume, available: false } } });
  });
  await page.goto('/host');
  const settings = page.locator('.host-audio').getByRole('link', { name: 'Check speaker settings', exact: true });
  await expect(settings).toHaveAttribute('href', '/host/settings');
  await expect(page.locator('.host-audio').getByRole('slider')).toBeDisabled();
  for (const width of [1440, 800, 701, 390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(settings).toBeVisible();
    expect((await page.locator('.host-audio').boundingBox())!.height).toBeLessThan(150);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  }
  await settings.click();
  await expect(page).toHaveURL('/host/settings');
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  expect(writes).toEqual([]);
});
