import { randomUUID } from 'node:crypto';
import { expect, type Browser, type Page } from '@playwright/test';
import { test } from './app-fixture';
import type { DemoAdapter } from '../../src/playback';

async function workspace(browser: Browser, host: Page, origin: string, demo: DemoAdapter, count = 24) {
  const post = (path: string, data: unknown) => host.request.post(path, { data, headers: { Origin: origin } });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  const joined = await context.request.post(origin + '/api/participant/join', { data: { nickname: 'Workspace listener' }, headers: { Origin: origin } });
  expect(joined.ok()).toBe(true);
  const request = async (path: string, data: unknown) => context.request.post(origin + '/api/participant/preparations' + path, { data, headers: { Origin: origin } });
  let library = await (await request('/init', {})).json();
  for (let index = 0; index < count; index++) {
    const track = { id: `demo:workspace-${index}`, title: `Workspace selection ${String(index + 1).padStart(2, '0')}${index === 0 ? ' — a long title that still needs to be readable and kept' : ''}`, artist: 'An artist with a deliberately long name', album: 'A very long album name for a narrow sidebar', duration: 60 };
    demo.catalogue.push(track);
    const response = await request('/add', { trackId: track.id, operation: { id: randomUUID(), issuedAt: Date.now(), revision: library.revision } });
    expect(response.ok()).toBe(true); library = (await response.json()).view;
  }
  const page = await context.newPage(); await page.goto(origin + '/participant');
  await expect(page.locator('.list-save-status')).toHaveText('Private · Saved ✓');
  return { page, context, post, request, async close() { await context.close(); } };
}

test('participant typography, surfaces and desktop alignment match the host pages, with uploads beside search', async ({ browser, page: host, isolatedApp }) => {
  const r = await workspace(browser, host, isolatedApp.origin, isolatedApp.demo, 3); const page = r.page;
  const typography = (node: Element) => {
    const style = getComputedStyle(node);
    return { family: style.fontFamily, weight: style.fontWeight, size: style.fontSize, spacing: style.letterSpacing };
  };
  const surface = (node: Element) => {
    const style = getComputedStyle(node);
    return { background: style.backgroundColor, image: style.backgroundImage, border: style.borderColor, radius: style.borderRadius, padding: style.padding };
  };
  try {
    await host.setViewportSize({ width: 1440, height: 1000 }); await host.goto('/host/settings');
    await expect(host.getByRole('button', { name: 'Find Music Assistant', exact: true })).toBeEnabled();
    const sectionStyle = await host.locator('.settings-connection h2').evaluate(typography);
    await expect(page.getByRole('heading', { name: 'Your turn.', exact: true })).toBeVisible();
    expect((await page.locator('.participant-hero h1').evaluate(typography)).size).toBe('28px');
    expect(await page.locator('.catalogue-panel h2').evaluate(typography)).toEqual(sectionStyle);
    expect(await page.locator('.preparation-list h2').evaluate(typography)).toEqual(sectionStyle);
    await host.goto('/host'); await expect(host.locator('.host-people')).toBeVisible();
    expect(await page.locator('.catalogue-panel').evaluate(surface)).toEqual(await host.locator('.host-people').evaluate(surface));
    await page.locator('#list-upload').click();
    await expect(page.locator('.catalogue-panel').getByRole('button', { name: 'Choose audio file', exact: true })).toBeEnabled();
    await expect(page.locator('.music-upload')).toHaveCount(1);
    await page.getByRole('searchbox', { name: 'Search catalogue' }).fill('Workspace');
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(page.locator('.catalogue-results .count-tag')).toHaveText('3 tracks');
    expect((await page.getByRole('button', { name: 'Choose audio file', exact: true }).boundingBox())!.y).toBeLessThan((await page.locator('.catalogue-results').boundingBox())!.y);
    await page.screenshot({ path: 'test-results/participant-coherent-desktop.png', fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByRole('button', { name: 'Choose audio file', exact: true })).toBeVisible();
    await page.screenshot({ path: 'test-results/participant-coherent-mobile.png', fullPage: true });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.locator('.catalogue-results .track-row').first().getByRole('button', { name: 'Play', exact: true }).click();
    await expect(page.locator('.playback-card')).toBeVisible();
    expect((await page.locator('.playback-card').boundingBox())!.width).toBe((await page.locator('.catalogue-panel').boundingBox())!.width);
    await page.screenshot({ path: 'test-results/participant-coherent-playing-desktop.png', fullPage: true });
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      if (width < 1100) {
        await page.getByRole('button', { name: 'Open list', exact: true }).click();
        expect(await page.locator('.preparation-list').evaluate(node => getComputedStyle(node).position)).toBe('static');
        await page.getByRole('button', { name: 'Close list', exact: true }).click();
      }
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); window.scrollTo({ top: 0, behavior: 'instant' }); });
    await page.screenshot({ path: 'test-results/participant-coherent-playing-mobile.png', fullPage: true });
  } finally { await r.close(); }
});

test('search exposes pending/results feedback and restores keyboard focus without starting playback', async ({ browser, page: host, isolatedApp }) => {
  const r = await workspace(browser, host, isolatedApp.origin, isolatedApp.demo, 1); const page = r.page;
  let release!: () => void; const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/participant/search**', async route => { await pending; await route.continue(); });
  try {
    await page.getByRole('searchbox', { name: 'Search catalogue' }).fill('Summer');
    const search = page.locator('#catalogue-search-submit'); await search.focus(); await search.press('Enter');
    await expect(search).toHaveText('Searching…'); await expect(search).toBeDisabled();
    await expect(page.locator('.catalogue-results')).toHaveAttribute('aria-busy', 'true');
    release();
    await expect(search).toHaveText('Search'); await expect(search).toBeFocused();
    await expect(page.locator('.catalogue-results')).toHaveAttribute('aria-busy', 'false');
    await expect(page.locator('.catalogue-results .count-tag')).toHaveText('1 track');
    await expect(page.getByRole('status').filter({ hasText: /^1 track found\.$/ })).toHaveCount(1);
    await expect(page.getByRole('searchbox', { name: 'Search catalogue' })).toHaveValue('Summer');
    expect((await (await page.request.get('/api/participant/state')).json()).ownPlayback).toBeFalsy();
  } finally { release(); await r.close(); }
});

test('search and one private list share desktop/phone layouts, including long metadata and short viewports', async ({ browser, page: host, isolatedApp }) => {
  const r = await workspace(browser, host, isolatedApp.origin, isolatedApp.demo);
  const page = r.page;
  try {
    await page.getByRole('searchbox', { name: 'Search catalogue' }).fill('Workspace'); await page.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(page.locator('.catalogue-results .track-row')).toHaveCount(24);
    for (const [width, height] of [[1440, 1000], [1000, 800], [999, 800], [390, 844], [320, 700], [390, 440]]) {
      await page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); });
      await page.setViewportSize({ width: width!, height: height! });
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
      await expect(page.locator('.preparation-list')).toHaveCount(1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)).toBe(false);
      const layout = await page.evaluate(() => {
        const search = document.querySelector('.catalogue-panel')!.getBoundingClientRect(); const list = document.querySelector('.preparation-list')!.getBoundingClientRect();
        return { sideBySide: list.left >= search.right, previewRows: [...document.querySelectorAll('.saved-tracks[aria-label="Your prepared tracks"] > li')].filter(node => node.getClientRects().length > 0).length };
      });
      expect(layout.sideBySide).toBe(width! >= 1100);
      expect(layout.previewRows).toBe(width! >= 1100 ? 24 : 0);
      await page.screenshot({ path: `test-results/participant-workspace-${width}x${height}-initial.png` });
      if (width! < 1100) {
        await page.getByRole('button', { name: 'Open list', exact: true }).click();
        await expect(page.getByRole('button', { name: 'Close list', exact: true })).toHaveAttribute('aria-expanded', 'true');
        expect(await page.locator('.list-body').evaluate(node => getComputedStyle(node).overflowY)).toBe('visible');
        await expect(page.getByRole('searchbox', { name: 'Search catalogue' })).toBeVisible();
        await page.getByRole('button', { name: 'Close list', exact: true }).click();
      }
      // Keyboard focus must not be obscured by either sticky surface.
      const add = page.locator('.catalogue-results .track-row').nth(12).getByRole('button', { name: 'Add to my list', exact: true });
      await add.focus();
      await expect.poll(() => add.evaluate(node => {
        const rect = node.getBoundingClientRect(); const list = document.querySelector('.preparation-list')!.getBoundingClientRect();
        const header = document.querySelector('header')!.getBoundingClientRect();
        return rect.top >= Math.max(0, innerWidth < 1100 ? list.bottom : header.bottom) && rect.bottom <= innerHeight;
      }), { message: `Focused result is unobscured at ${width}×${height}` }).toBe(true);
      if (height! >= 600) await expect(page.locator('.preparation-list')).toBeInViewport();
      await page.screenshot({ path: `test-results/participant-workspace-${width}x${height}.png` });
    }
    expect((await (await page.request.get('/api/participant/state')).json()).ownPlayback).toBeFalsy();
  } finally { await r.close(); }
});

test('owner and room updates preserve search/caret, expanded list scroll, and the shared header', async ({ browser, page: host, isolatedApp }) => {
  const r = await workspace(browser, host, isolatedApp.origin, isolatedApp.demo); const page = r.page;
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: 'Open list', exact: true }).click();
    await page.locator('.list-body').evaluate(node => { node.scrollTop = 260; });
    const input = page.getByRole('searchbox', { name: 'Search catalogue' }); await input.fill('Still searching');
    await input.evaluate(node => (node as HTMLInputElement).setSelectionRange(2, 7));
    await page.locator('header').evaluate(node => { (node as HTMLElement).dataset.sameNode = 'yes'; });
    const before = await page.evaluate(() => ({ y: scrollY, list: document.querySelector('.list-body')!.scrollTop }));
    const saved = await (await page.request.get('/api/participant/preparations/state')).json();
    expect((await r.request('/add', { trackId: 'demo:aurora', operation: { id: randomUUID(), issuedAt: Date.now(), revision: saved.revision } })).ok()).toBe(true);
    await expect(page.locator('.list-count')).toHaveText(' · 25');
    let session = await (await host.request.get('/api/host/state')).json();
    session = await (await r.post('/api/host/reorder', { ids: session.active.map((person: { id: string }) => person.id), revision: session.revision })).json();
    await expect(input).toBeFocused(); await expect(input).toHaveValue('Still searching');
    expect(await input.evaluate(node => [(node as HTMLInputElement).selectionStart, (node as HTMLInputElement).selectionEnd])).toEqual([2, 7]);
    expect(await page.evaluate(() => ({ y: scrollY, list: document.querySelector('.list-body')!.scrollTop }))).toEqual(before);
    await expect(page.getByRole('button', { name: 'Close list', exact: true })).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('header')).toHaveAttribute('data-same-node', 'yes');
    await r.post('/api/host/remove', { id: session.current.id, revision: session.revision });
    await expect(page.getByRole('status').filter({ hasText: 'You’re no longer in the listening order.' })).toBeVisible();
    await expect(page.locator('.music-workspace, .preparation-list')).toHaveCount(0);
    expect((await (await page.request.get('/api/participant/preparations/state')).json()).upcoming).toHaveLength(25);
    await expect(page.getByRole('searchbox', { name: 'Search catalogue' })).toHaveCount(0);
  } finally { await r.close(); }
});

test('adding from results keeps compact list, query, focus and scroll without starting audio', async ({ browser, page: host, isolatedApp }) => {
  const r = await workspace(browser, host, isolatedApp.origin, isolatedApp.demo, 1); const page = r.page;
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    const input = page.getByRole('searchbox', { name: 'Search catalogue' }); await input.fill('Summer');
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    const add = page.getByRole('button', { name: 'Add to my list', exact: true }); await add.focus(); await expect(add).toBeFocused();
    const before = await page.evaluate(() => scrollY); const buttonTop = (await add.boundingBox())!.y; await add.press('Enter');
    const added = page.getByRole('button', { name: 'Added ✓', exact: true }); await expect(added).toBeFocused();
    await expect(added).toHaveAttribute('aria-disabled', 'true');
    await expect(page.locator('.list-count')).toHaveText(' · 2'); await expect(input).toHaveValue('Summer');
    await expect(page.getByRole('button', { name: 'Open list', exact: true })).toHaveAttribute('aria-expanded', 'false');
    expect(await page.evaluate(() => scrollY)).toBe(before);
    expect(Math.abs((await added.boundingBox())!.y - buttonTop)).toBeLessThanOrEqual(1);
    await expect(page.getByRole('status').filter({ hasText: 'Added Late Summer to your list.' })).toHaveCount(1);
    await added.press('Enter');
    expect((await (await page.request.get('/api/participant/preparations/state')).json()).upcoming).toHaveLength(2);
    expect((await (await page.request.get('/api/participant/state')).json()).ownPlayback).toBeFalsy();
  } finally { await r.close(); }
});
