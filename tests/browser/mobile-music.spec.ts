import { randomUUID } from 'node:crypto';
import { expect } from '@playwright/test';
import { test } from './app-fixture';

for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 844 }, { width: 844, height: 390 }, { width: 1099, height: 844 }]) {
  test(`combined mobile music edits its always-visible list in place at ${viewport.width}×${viewport.height}`, async ({ page, isolatedApp }) => {
    await page.setViewportSize(viewport);
    const post = (path: string, data: unknown) => page.request.post(path, { data, headers: { Origin: isolatedApp.origin } });
    await post('/api/participant/join', { nickname: 'Mobile music' });
    await post('/api/participant/preparations/init', {});
    for (let index = 0; index < 8; index++) isolatedApp.demo.catalogue.push({ id: `demo:collection-${index}`, title: `Collection song ${index} with a deliberately long title`, artist: 'A long artist name', album: 'An album', duration: 600 });
    await page.goto('/participant');
    const collection = page.locator('#music-collection'); const list = page.locator('.preparation-list');
    const input = page.getByRole('searchbox', { name: 'Search catalogue', exact: true });
    await expect(collection).toBeVisible(); await expect(page.locator('.list-count')).toHaveText('0 tracks');
    await expect(list.getByRole('heading', { name: 'Your playlist', exact: true })).toBeVisible();
    expect(await page.locator('.list-count').evaluate(node => node.closest('h2'))).toBeNull();
    await expect(page.locator('.list-count')).toBeVisible();
    await expect(page.getByRole('button', { name: /^(Open|Close) list$/ })).toHaveCount(0);
    await expect(page.locator('.music-list-dialog')).toHaveCount(0);
    expect(await collection.evaluate(node => ['.preparation-list', '.catalogue-panel'].every(selector => node.querySelector(selector)?.parentElement === node))).toBe(true);
    expect(await page.locator('#participant-player').evaluate(node => node.parentElement?.id)).not.toBe('music-collection');
    expect((await page.locator('#participant-player').boundingBox())!.height).toBe(272);
    const player = await page.locator('#participant-player').elementHandle();
    await input.fill('Collection'); await page.getByRole('button', { name: 'Search', exact: true }).click();
    const rows = page.locator('.catalogue-results .track-row'); await expect(rows).toHaveCount(8);
    const add = rows.first().getByRole('button', { name: 'Add to list', exact: true });
    await add.scrollIntoViewIfNeeded();
    const formY = () => input.evaluate(node => node.getBoundingClientRect().top + scrollY);
    const beforeAdd = await formY();
    let release!: () => void; const held = new Promise<void>(resolve => { release = resolve; });
    await page.route('**/api/participant/preparations/add', async route => { await held; await route.continue(); });
    try {
      await add.click(); await expect(list).toHaveAttribute('data-save-state', 'saving');
      expect(await formY()).toBe(beforeAdd);
      release(); await expect(page.locator('.list-count')).toHaveText('1 track');
      expect(await formY()).toBe(beforeAdd);
    } finally { release(); await page.unroute('**/api/participant/preparations/add'); }
    await expect(list.locator('.saved-track').first()).toBeVisible();
    const row = await list.locator('.saved-track').first().elementHandle();
    await rows.nth(1).getByRole('button', { name: 'Add to list', exact: true }).click();
    await expect(page.locator('.list-count')).toHaveText('2 tracks'); expect(await formY()).toBe(beforeAdd);
    await list.getByRole('button', { name: 'Edit order', exact: true }).click();
    await list.getByRole('button', { name: /^Move Collection song 1 .* up$/ }).click();
    await expect(list.locator('.saved-track strong').first()).toContainText('Collection song 1');
    await list.getByRole('button', { name: 'Done', exact: true }).click();
    expect(await row!.evaluate(node => node.isConnected && node.closest('#music-collection') !== null)).toBe(true);
    await expect(input).toHaveValue('Collection');
    const button = rows.last().getByRole('button', { name: 'Add to list', exact: true });
    await button.focus(); await button.scrollIntoViewIfNeeded();
    await expect(list).toBeInViewport();
    await expect.poll(() => button.evaluate(node => {
      const box = node.getBoundingClientRect();
      return box.top >= document.querySelector('.preparation-list')!.getBoundingClientRect().bottom && box.bottom <= innerHeight;
    })).toBe(true);
    expect(await player!.evaluate(node => node === document.querySelector('#participant-player'))).toBe(true);

    // Save recovery is also inline, without an editor dialog or another list view.
    await page.route('**/api/participant/preparations/add', route => route.fulfill({ status: 503, json: { error: 'Saved music could not be confirmed.' } }));
    await rows.nth(2).getByRole('button', { name: 'Add to list', exact: true }).click();
    await expect(list).toHaveClass(/needs-attention/); await expect(collection.locator('.list-preview')).toHaveText('Needs attention');
    await expect(list.getByRole('button', { name: 'Retry save', exact: true })).toBeVisible();
    await page.unroute('**/api/participant/preparations/add');
    await list.getByRole('button', { name: 'Retry save', exact: true }).click();
    await expect(page.locator('.list-count')).toHaveText('3 tracks'); await expect(list).not.toHaveClass(/needs-attention/);
    await expect(input).toHaveValue('Collection');
    expect((await (await page.request.get('/api/participant/state')).json()).ownPlayback).toBeNull();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/mobile-music-${viewport.width}.png` });
  });
}

test('the unified collection retains its desktop panes and actual row nodes after editing and resizing', async ({ page, isolatedApp }) => {
  const post = (path: string, data: unknown) => page.request.post(path, { data, headers: { Origin: isolatedApp.origin } });
  await post('/api/participant/join', { nickname: 'Music layout' });
  let library = await (await post('/api/participant/preparations/init', {})).json();
  for (const trackId of ['demo:aurora', 'demo:summer', 'demo:night']) library = (await (await post('/api/participant/preparations/add', { trackId,
    operation: { id: randomUUID(), issuedAt: Date.now(), revision: library.revision } })).json()).view;
  await page.setViewportSize({ width: 1440, height: 1000 }); await page.goto('/participant');
  await expect(page.locator('.list-count')).toHaveText('3 tracks');
  await expect(page.getByRole('heading', { name: 'Your playlist', exact: true })).toBeVisible();
  await expect(page.locator('.list-count')).toBeVisible();
  const desktop = () => page.evaluate(() => ['#participant-player', '.catalogue-panel', '.preparation-list'].map(selector => {
    const rect = document.querySelector(selector)!.getBoundingClientRect(); return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  }));
  const before = await desktop(); const row = await page.locator('.saved-track').first().elementHandle();
  await expect(page.locator('#music-collection')).toHaveCSS('display', 'grid');
  await expect(page.locator('#music-collection')).toHaveCSS('border-top-width', '1px');
  await expect(page.locator('.catalogue-panel')).toHaveCSS('border-top-width', '0px');
  await expect(page.locator('.preparation-list')).toHaveCSS('border-top-width', '0px');
  await expect(page.locator('.preparation-list')).toHaveCSS('border-left-width', '1px');
  expect(before[2]!.x).toBeGreaterThanOrEqual(before[1]!.x + before[1]!.width);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Edit order', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Done', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  expect(await desktop()).toEqual(before);
  expect(await row!.evaluate(node => node === document.querySelector('.saved-track'))).toBe(true);
  await expect(page.locator('.catalogue-title')).toBeVisible(); await expect(page.locator('.list-save-status')).toBeVisible();
  await expect(page.getByRole('button', { name: /^(Open|Close) list$/ })).toHaveCount(0);
});
