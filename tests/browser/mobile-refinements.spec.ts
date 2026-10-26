import { expect } from '@playwright/test';
import { test } from './app-fixture';

test('mobile selections remain accessible and source choices fit narrow screens without shortcuts', async ({ page, isolatedApp }) => {
  const post = (path: string, data: unknown) => page.request.post(path, { data, headers: { Origin: isolatedApp.origin } });
  await post('/api/host/integrations/save', { url: isolatedApp.musicAssistantOrigin, accessToken: 'browser-test-token', revision: 0 });
  await isolatedApp.engine.join('Current'); await post('/api/participant/join', { nickname: 'Waiting' });
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
  await expect(page.getByRole('button', { name: 'View albums', exact: true })).toBeDisabled();
  await select.selectOption({ label: 'Tidal' });
  await page.getByRole('button', { name: 'View albums', exact: true }).click();
  await expect(page.getByText('tidal exclusive', { exact: true })).toBeVisible();
  expect(isolatedApp.calls.filter(call => call.command === 'player_queues/play_media')).toHaveLength(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('mobile removes the turn-status row without changing desktop geometry or the accessible heading', async ({ page, isolatedApp }) => {
  await isolatedApp.engine.join('Current');
  await page.request.post('/api/participant/join', { data: { nickname: 'Waiting' }, headers: { Origin: isolatedApp.origin } });
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

test('off-screen playback offers a read-only return with confirmed status and retains browsing position', async ({ page, isolatedApp }) => {
  for (let index = 1; index <= 2; index++) isolatedApp.demo.catalogue.push({ ...isolatedApp.demo.catalogue[0]!, id: `demo:shortcut-${index}`, title: `Northern extra ${index}` });
  const post = (path: string, data: unknown) => page.request.post(path, { data, headers: { Origin: isolatedApp.origin } });
  await post('/api/participant/join', { nickname: 'Player' });
  await page.setViewportSize({ width: 320, height: 568 }); await page.goto('/participant');
  await page.getByRole('searchbox').fill('Northern'); await page.getByRole('searchbox').press('Enter');
  // Keep a genuine scrolled browsing viewport; click Play only once while the request is held.
  await page.locator('.catalogue-results').evaluate(node => node.scrollIntoView({ block: 'start', behavior: 'instant' }));
  const play = page.getByRole('button', { name: 'Play', exact: true }).first();
  // Keep focus from starting a browser smooth scroll during the playback-position assertion.
  await play.evaluate(node => (node as HTMLButtonElement).focus({ preventScroll: true }));
  await expect.poll(() => play.evaluate(node => node.getBoundingClientRect().top >= document.querySelector('.preparation-list')!.getBoundingClientRect().bottom + 11)).toBe(true);
  await expect(page.locator('.playback-card')).not.toBeInViewport();
  const before = await page.evaluate(() => scrollY);
  let release!: () => void; const held = new Promise<void>(resolve => { release = resolve; });
  let plays = 0;
  await page.route('**/api/participant/play', async route => { plays++; await held; await route.continue(); });
  try {
    // It is already visible and focused; avoid automation's scroll-margin adjustment.
    await play.evaluate(node => (node as HTMLButtonElement).click());
    const shortcut = page.getByRole('complementary', { name: 'Playback shortcut' });
    await expect(shortcut).toBeInViewport(); await expect(shortcut).toContainText('Starting…');
    await expect(shortcut).not.toContainText('Playing');
    expect(await page.evaluate(() => scrollY)).toBe(before);
    release(); await expect(shortcut).toContainText('Playing · Hidden');
    expect(await page.evaluate(() => scrollY)).toBe(before);
    await shortcut.getByRole('link', { name: 'Go to player', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Reveal details', exact: true })).toBeInViewport();
    await expect(shortcut).toBeHidden(); expect(plays).toBe(1);
    await page.getByRole('button', { name: 'Reveal details', exact: true }).click();
    await expect(page.locator('.privacy-tag').first()).toContainText('Visible on room display');
    await page.locator('.catalogue-results').evaluate(node => node.scrollIntoView({ block: 'start', behavior: 'instant' }));
    await expect(shortcut).toContainText('Playing · Revealed');
    const state = await (await page.request.get('/api/participant/state')).json();
    await post('/api/participant/finish', { turnId: state.turnId });
    await expect(shortcut).toBeHidden();
  } finally { release(); }
});

test('a failed start offers the visible error rather than claiming playback or retrying it', async ({ page, isolatedApp }) => {
  for (let index = 1; index <= 2; index++) isolatedApp.demo.catalogue.push({ ...isolatedApp.demo.catalogue[0]!, id: `demo:shortcut-${index}`, title: `Northern extra ${index}` });
  await page.request.post('/api/participant/join', { data: { nickname: 'Player' }, headers: { Origin: isolatedApp.origin } });
  await page.setViewportSize({ width: 320, height: 568 }); await page.goto('/participant');
  await page.getByRole('searchbox').fill('Northern'); await page.getByRole('searchbox').press('Enter');
  await expect(page.getByRole('button', { name: 'Play', exact: true }).first()).toBeVisible();
  await page.locator('.catalogue-results').evaluate(node => node.scrollIntoView({ block: 'start', behavior: 'instant' }));
  let plays = 0;
  await page.route('**/api/participant/play', async route => { plays++; await route.fulfill({ status: 503, json: { error: 'The speaker could not start this song.' } }); });
  await page.getByRole('button', { name: 'Play', exact: true }).first().click();
  const shortcut = page.getByRole('complementary', { name: 'Playback shortcut' });
  await expect(shortcut).toBeInViewport(); await expect(shortcut).toContainText('Check playback');
  await expect(shortcut).not.toContainText('Playing');
  await shortcut.getByRole('link', { name: 'Review status', exact: true }).click();
  const details = page.getByRole('dialog', { name: 'Player details' });
  await expect(details).toBeVisible(); await expect(details).toContainText('The speaker could not start this song.'); expect(plays).toBe(1);
});
