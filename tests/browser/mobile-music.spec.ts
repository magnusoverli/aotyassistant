import { randomUUID } from 'node:crypto';
import { expect } from '@playwright/test';
import { test, catalogueTrack } from './app-fixture';
import { dragSong } from './preparation-helpers';

const songs = Array.from({ length: 8 }, (_, index) => `Collection song ${index} with a deliberately long title`);

for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 844 }, { width: 844, height: 390 }, { width: 1099, height: 844 }]) {
  test(`phone search fills the screen, finds songs by artist and album, and returns to the edited list at ${viewport.width}×${viewport.height}`, async ({ page, isolatedApp }) => {
    await page.setViewportSize(viewport);
    await isolatedApp.connect(); isolatedApp.addTracks(songs.map(title => ({ title, artist: 'A long artist name', album: 'An album', duration: 600 })));
    const post = (path: string, data: unknown) => page.request.post(path, { data, headers: { Origin: isolatedApp.origin } });
    await post('/api/participant/join', { pin: '1234', nickname: 'Mobile music' });
    await post('/api/participant/preparations/init', {});
    await page.goto('/participant');
    const collection = page.locator('#music-collection'); const list = page.locator('.preparation-list');
    const input = page.getByRole('searchbox', { name: 'Search catalogue', exact: true });
    const opener = page.locator('#music-search-open'); const done = page.locator('.search-sheet-done');
    const summary = page.locator('.search-sheet-status');
    const artistButton = page.getByRole('button', { name: 'View albums by Fixture artist', exact: true });
    const albumButton = page.getByRole('button', { name: 'View tracks on Fixture album', exact: true });
    await expect(collection).toBeVisible(); await expect(page.locator('.list-count')).toHaveText('0 tracks');
    // Phones: a one-line "Playlist" header, with no track count or save status, then the search field.
    await expect(list.getByRole('heading', { name: 'Playlist', exact: true })).toBeVisible();
    expect(await page.locator('.list-count').evaluate(node => node.closest('h2'))).toBeNull();
    await expect(page.locator('.list-count')).toBeHidden(); await expect(page.locator('.list-save-status')).toBeHidden();
    await expect(list.locator('.list-heading')).toHaveCSS('border-bottom-width', '1px');
    await expect(opener).toBeVisible(); await expect(opener).toHaveText('Search for an artist');
    // Search stays out of the page until it is opened.
    await expect(input).toBeHidden(); await expect(page.locator('.catalogue-panel')).toBeHidden();
    expect(await collection.evaluate(node => ['.preparation-list', '.catalogue-panel'].every(selector => node.querySelector(selector)?.parentElement === node))).toBe(true);
    expect(await page.locator('#participant-player').evaluate(node => node.parentElement?.id)).not.toBe('music-collection');
    expect((await page.locator('#participant-player').boundingBox())!.height).toBe(230);
    const player = await page.locator('#participant-player').elementHandle();
    // Where the page is when search opens (Playwright scrolls the field into view to tap it): Done returns there.
    await opener.scrollIntoViewIfNeeded(); const pageScroll = await page.evaluate(() => scrollY);

    // Open: search is the whole page, ready to type, with Done and a playlist summary at the top.
    await opener.click();
    await expect(input).toBeVisible(); await expect(input).toBeFocused(); await expect(done).toBeVisible();
    for (const hidden of ['.app-header', '#participant-player', '.preparation-list']) await expect(page.locator(hidden)).toBeHidden();
    await expect(summary).toContainText('Playlist'); await expect(summary).toContainText('0 tracks');
    await expect(page.locator('.catalogue-results')).toContainText('Search for an artist, then choose an album and a song.');
    expect(await page.evaluate(() => scrollY)).toBe(0);
    await input.fill('Fixture artist'); await input.press('Enter');
    // Searching lowers the keyboard and lists artists only, never songs.
    await expect(artistButton).toBeVisible(); await expect(input).not.toBeFocused();
    await expect(page.locator('.catalogue-results .track-row:not(.browse-row)')).toHaveCount(0);
    await artistButton.click(); await albumButton.click();
    const rows = page.locator('.catalogue-results .track-row:not(.browse-row)'); await expect(rows).toHaveCount(1 + songs.length);
    const row = (index: number) => rows.filter({ has: page.getByText(songs[index]!, { exact: true }) });
    // Compact rows: the add button is a round icon whose name is still "Add to list".
    const add = row(0).getByRole('button', { name: 'Add to list', exact: true });
    expect((await add.boundingBox())!.width).toBe(44);
    expect((await row(0).boundingBox())!.height).toBeLessThan(90);
    // The field, Done and summary stay pinned at the top while the results scroll.
    await row(5).scrollIntoViewIfNeeded();
    const fieldTop = () => input.evaluate(node => node.getBoundingClientRect().top); const pinned = await fieldTop();
    expect(pinned).toBeLessThan(40);
    let release!: () => void; const held = new Promise<void>(resolve => { release = resolve; });
    await page.route('**/api/participant/preparations/add', async route => { await held; await route.continue(); });
    try {
      await add.click(); await expect(list).toHaveAttribute('data-save-state', 'saving');
      release(); await expect(summary).toContainText('1 track'); await expect(summary).toContainText(`Added: ${songs[0]}`);
      expect(await fieldTop()).toBe(pinned);
    } finally { release(); await page.unroute('**/api/participant/preparations/add'); }
    await expect(row(0).getByRole('button', { name: 'Added ✓', exact: true })).toBeVisible();
    await row(1).getByRole('button', { name: 'Add to list', exact: true }).click();
    await expect(summary).toContainText('2 tracks');

    // A failed save says so in the summary; Retry is in the list after Done.
    await page.route('**/api/participant/preparations/add', route => route.fulfill({ status: 503, json: { error: 'Saved music could not be confirmed.' } }));
    await row(2).getByRole('button', { name: 'Add to list', exact: true }).click();
    await expect(summary).toContainText('Needs attention');
    await page.unroute('**/api/participant/preparations/add');

    // Done returns to the page where it was, showing the list again.
    await done.click();
    await expect(input).toBeHidden(); await expect(page.locator('#participant-player')).toBeVisible(); await expect(opener).toBeFocused();
    expect(await page.evaluate(() => scrollY)).toBe(pageScroll);
    expect(await player!.evaluate(node => node === document.querySelector('#participant-player'))).toBe(true);
    await expect(list).toHaveClass(/needs-attention/); await expect(collection.locator('.list-preview')).toHaveText('Needs attention');
    await list.getByRole('button', { name: 'Retry save', exact: true }).click();
    await expect(page.locator('.list-count')).toHaveText('3 tracks'); await expect(list).not.toHaveClass(/needs-attention/);
    await dragSong(page, songs[1]!, songs[0]!);
    await expect(list.locator('.saved-track strong').first()).toContainText('Collection song 1');

    // Reopening shows the last search; Back steps out of an album and an artist, then closes search.
    await opener.click(); await expect(input).toHaveValue('Fixture artist'); await expect(artistButton).toBeVisible();
    await artistButton.click(); await albumButton.click(); await expect(rows).toHaveCount(1 + songs.length);
    await page.goBack(); await expect(albumButton).toBeVisible();
    await page.goBack(); await expect(artistButton).toBeVisible();
    await page.goBack(); await expect(input).toBeHidden(); await expect(list).toBeVisible();
    expect((await (await page.request.get('/api/participant/state')).json()).ownPlayback).toBeNull();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/mobile-music-${viewport.width}.png` });
  });
}

test('a new search inside phone search replaces the last one, so Back leaves search instead of replaying queries', async ({ page, isolatedApp }) => {
  await isolatedApp.connect(); await page.setViewportSize({ width: 390, height: 844 });
  await page.request.post('/api/participant/join', { data: { pin: '1234', nickname: 'Searcher' }, headers: { Origin: isolatedApp.origin } });
  await page.goto('/participant');
  const input = page.getByRole('searchbox', { name: 'Search catalogue', exact: true });
  await page.locator('#music-search-open').click();
  await input.fill('empty'); await input.press('Enter');
  await expect(page.locator('.catalogue-results')).toContainText('No artists found. Try another search.');
  await input.fill('Fixture artist'); await input.press('Enter');
  await expect(page.getByRole('button', { name: 'View albums by Fixture artist', exact: true })).toBeVisible();
  await page.locator('.search-clear').click(); await expect(input).toHaveValue(''); await expect(input).toBeFocused();
  await page.goBack(); await expect(input).toBeHidden(); await expect(page.locator('.preparation-list')).toBeVisible();
});

test('the unified collection retains its desktop panes and actual row nodes after editing and resizing', async ({ page, isolatedApp }) => {
  const post = (path: string, data: unknown) => page.request.post(path, { data, headers: { Origin: isolatedApp.origin } });
  await post('/api/participant/join', { pin: '1234', nickname: 'Music layout' });
  let library = await (await post('/api/participant/preparations/init', {})).json();
  await isolatedApp.connect(); isolatedApp.addTracks([{ title: 'Late Summer' }, { title: 'Night Bus Home' }]);
  for (const title of ['Real catalogue fixture', 'Late Summer', 'Night Bus Home']) library = (await (await post('/api/participant/preparations/add', { trackId: (await catalogueTrack(page.request, isolatedApp.origin, title)).id,
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
  await expect(page.locator('.saved-track').first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Playlist', exact: true })).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 1000 });
  expect(await desktop()).toEqual(before);
  expect(await row!.evaluate(node => node === document.querySelector('.saved-track'))).toBe(true);
  await expect(page.locator('.catalogue-title')).toBeVisible(); await expect(page.locator('.list-save-status')).toBeVisible();
  await expect(page.getByRole('button', { name: /^(Open|Close) list$/ })).toHaveCount(0);
});
