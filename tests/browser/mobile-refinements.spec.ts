import { expect } from '@playwright/test';
import { test } from './app-fixture';

test('mobile shortcuts expose preparation and source choices fit narrow screens', async ({ page, isolatedApp }) => {
  const post = (path: string, data: unknown) => page.request.post(path, { data, headers: { Origin: isolatedApp.origin } });
  await post('/api/host/integrations/save', { url: isolatedApp.musicAssistantOrigin, accessToken: 'browser-test-token', revision: 0 });
  await isolatedApp.engine.join('Current'); await post('/api/participant/join', { nickname: 'Waiting' });
  await page.setViewportSize({ width: 320, height: 568 }); await page.goto('/participant');
  const shortcuts = page.getByRole('navigation', { name: 'Your music shortcuts' });
  await expect(shortcuts).toBeInViewport();
  await shortcuts.getByRole('button', { name: 'My list', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Close list', exact: true })).toBeInViewport();
  await page.getByRole('button', { name: 'Close list', exact: true }).click();
  await shortcuts.getByRole('link', { name: 'Find music', exact: true }).click();
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

test('off-screen playback offers a read-only return with confirmed status and retains browsing position', async ({ page, isolatedApp }) => {
  const post = (path: string, data: unknown) => page.request.post(path, { data, headers: { Origin: isolatedApp.origin } });
  await post('/api/participant/join', { nickname: 'Player' });
  await page.setViewportSize({ width: 320, height: 568 }); await page.goto('/participant');
  await page.getByRole('searchbox').fill('Northern'); await page.getByRole('searchbox').press('Enter');
  // Keep a genuine scrolled browsing viewport; click Play only once while the request is held.
  await page.locator('.catalogue-results').evaluate(node => node.scrollIntoView({ block: 'start', behavior: 'instant' }));
  await expect(page.locator('.playback-card')).not.toBeInViewport();
  const before = await page.evaluate(() => scrollY);
  let release!: () => void; const held = new Promise<void>(resolve => { release = resolve; });
  let plays = 0;
  await page.route('**/api/participant/play', async route => { plays++; await held; await route.continue(); });
  try {
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    const shortcut = page.getByRole('complementary', { name: 'Playback shortcut' });
    await expect(shortcut).toBeInViewport(); await expect(shortcut).toContainText('Starting…');
    await expect(shortcut).not.toContainText('Playing');
    expect(await page.evaluate(() => scrollY)).toBe(before);
    release(); await expect(shortcut).toContainText('Playing · Hidden');
    expect(await page.evaluate(() => scrollY)).toBe(before);
    await shortcut.getByRole('link', { name: 'Go to player', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Reveal song', exact: true })).toBeInViewport();
    await expect(shortcut).toBeHidden(); expect(plays).toBe(1);
    await page.getByRole('button', { name: 'Reveal song', exact: true }).click();
    await expect(page.locator('.privacy-tag').first()).toContainText('Visible on room display');
    await page.locator('.catalogue-results').evaluate(node => node.scrollIntoView({ block: 'start', behavior: 'instant' }));
    await expect(shortcut).toContainText('Playing · Revealed');
    const state = await (await page.request.get('/api/participant/state')).json();
    await post('/api/participant/finish', { turnId: state.turnId });
    await expect(shortcut).toBeHidden();
  } finally { release(); }
});

test('a failed start offers the visible error rather than claiming playback or retrying it', async ({ page, isolatedApp }) => {
  await page.request.post('/api/participant/join', { data: { nickname: 'Player' }, headers: { Origin: isolatedApp.origin } });
  await page.setViewportSize({ width: 320, height: 568 }); await page.goto('/participant');
  await page.getByRole('searchbox').fill('Northern'); await page.getByRole('searchbox').press('Enter');
  await page.locator('.catalogue-results').evaluate(node => node.scrollIntoView({ block: 'start', behavior: 'instant' }));
  let plays = 0;
  await page.route('**/api/participant/play', async route => { plays++; await route.fulfill({ status: 503, json: { error: 'The speaker could not start this song.' } }); });
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  const shortcut = page.getByRole('complementary', { name: 'Playback shortcut' });
  await expect(shortcut).toBeInViewport(); await expect(shortcut).toContainText('Check playback');
  await expect(shortcut).not.toContainText('Playing');
  await shortcut.getByRole('link', { name: 'Review status', exact: true }).click();
  await expect(page.locator('.app-content > .error')).toBeInViewport(); expect(plays).toBe(1);
});
