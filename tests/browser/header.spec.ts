import { expect, type Page } from '@playwright/test';
import { test } from './app-fixture';
import { openNavigation } from './navigation-helpers';

const noOverflow = async (page: Page) => expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);

test('tabbing out of the menu exposes the focused join field and Escape works outside the header', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/join');
  const navigation = page.locator('#app-navigation'); const menu = page.locator('.header-menu-toggle');
  await expect(page.getByLabel('What should we call you?')).toBeVisible();
  await openNavigation(page);
  await navigation.getByRole('link', { name: 'Room display', exact: true }).focus();
  await page.keyboard.press('Tab');
  await expect(navigation.getByRole('button', { name: 'Full screen' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('What should we call you?')).toBeFocused();
  await expect(navigation).toBeHidden(); await expect(menu).toHaveAttribute('aria-expanded', 'false');
  await openNavigation(page);
  await page.locator('body').dispatchEvent('keydown', { key: 'Escape', bubbles: true });
  await expect(navigation).toBeHidden(); await expect(menu).toBeFocused();
});

test('every page uses the shared header with centralized navigation, current-page semantics, and no duplicate body navigation', async ({ page }) => {
  const session = await (await page.request.get('/api/host/state')).json();
  for (const [path, current] of [['/', null], ['/host', 'Host desk'], ['/host/settings', 'Settings'], ['/participant', 'My music'], [session.joinUrl, null], [session.displayUrl, 'Room display']] as const) {
    await page.setViewportSize({ width: 1440, height: 1000 }); await page.goto(path);
    await expect(page.getByRole('banner')).toHaveCount(1); await expect(page.locator('header[data-header="shared"]')).toHaveCount(1);
    await expect(page.getByRole('main')).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Menu', exact: true })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Primary navigation' })).toBeHidden();
    await openNavigation(page);
    await expect(page.getByRole('button', { name: 'Full screen', exact: true })).toBeEnabled();
    const navigation = page.getByRole('banner').getByRole('navigation', { name: 'Primary navigation' });
    await expect(navigation).toBeVisible(); await expect(navigation.locator('.primary-links > li > a')).toHaveCount(4);
    expect(await navigation.locator('a').evaluateAll(links => links.map(link => ({ text: link.textContent, href: link.getAttribute('href') })))).toEqual([
      { text: 'Host desk', href: '/host' }, { text: 'Settings', href: '/host/settings' },
      { text: 'My music', href: '/participant' }, { text: 'Room display', href: '/display' },
    ]);
    if (current) await expect(navigation.getByRole('link', { name: current, exact: true })).toHaveAttribute('aria-current', 'page');
    else await expect(navigation.locator('[aria-current="page"]')).toHaveCount(0);
    const brand = page.locator('a.brand');
    await expect(brand).toHaveAttribute('href', '/');
    await expect(brand).toHaveAccessibleName(`Albums of the Year ${await brand.locator('.brand-subtitle').textContent()}`);
    await expect(page.locator('.host-sidebar, .host-nav, .session-navigation, main .back-link, main .display-link')).toHaveCount(0);
    const html = await page.getByRole('banner').innerHTML(); expect(html).not.toContain('#access='); expect(html).not.toContain('#invite=');
    await expect(navigation.locator('a[href*="#"]')).toHaveCount(0);
    for (const width of [1440, 1200, 1100, 390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      await expect(page.locator('header .header-menu-toggle')).toBeVisible();
      await openNavigation(page); await expect(navigation).toBeVisible(); await noOverflow(page);
    }
  }
  await page.setViewportSize({ width: 1440, height: 1000 }); await page.goto('/host/settings');
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  await openNavigation(page);
  await expect(page.getByRole('banner').getByRole('link', { name: 'Room display' })).toHaveAttribute('href', '/display');
  await page.keyboard.press('Escape');
  await page.screenshot({ path: 'test-results/shared-header-settings-desktop.png', fullPage: true });
  await openNavigation(page);
  await page.getByRole('banner').getByRole('link', { name: 'Host desk', exact: true }).click();
  await expect(page).toHaveURL('/host');
  const launch = page.locator('.host-invitations').getByRole('link', { name: 'Open public display' });
  await expect(launch).toHaveAttribute('href', session.displayUrl); await expect(launch).toHaveAttribute('rel', 'noopener noreferrer');
  await expect(page.locator('.host-invitations').getByRole('link', { name: 'Open guest invitation' })).toHaveAttribute('href', session.joinUrl);
});

test('mobile header supports keyboard menus, stable focus across live updates, outside/Escape closing, resize, and skip navigation', async ({ page, isolatedApp }) => {
  const post = (path: string, data: unknown) => page.request.post(path, { data, headers: { Origin: isolatedApp.origin } });
  await page.setViewportSize({ width: 320, height: 740 }); await page.goto('/host');
  const menu = page.locator('header .header-menu-toggle'); const navigation = page.locator('#app-navigation');
  await expect(menu).toHaveAttribute('aria-expanded', 'false'); await expect(navigation).toBeHidden();
  await menu.focus(); await menu.press('Enter'); await expect(menu).toHaveAttribute('aria-expanded', 'true');
  await menu.press('Tab'); await expect(navigation.getByRole('link', { name: 'Host desk', exact: true })).toBeFocused();
  await page.keyboard.press('Tab'); const settings = navigation.getByRole('link', { name: 'Settings', exact: true }); await expect(settings).toBeFocused();
  await page.evaluate(() => { (window as any).headerRef = document.querySelector('header'); (window as any).settingsLinkRef = document.querySelector('header a[href="/host/settings"]'); });
  await post('/api/participant/join', { nickname: 'Live listener' });
  await expect(page.locator('.host-people .person-row')).toHaveCount(1);
  await expect(settings).toBeFocused(); await expect(menu).toHaveAttribute('aria-expanded', 'true');
  expect(await page.evaluate(() => (window as any).headerRef === document.querySelector('header') && (window as any).settingsLinkRef === document.querySelector('header a[href="/host/settings"]'))).toBe(true);
  await page.keyboard.press('Escape'); await expect(navigation).toBeHidden(); await expect(menu).toBeFocused();
  await openNavigation(page); const room = navigation.getByRole('link', { name: 'Room display', exact: true }); await room.focus();
  const updated = await (await page.request.get('/api/host/state')).json(); await post('/api/host/remove', { id: updated.current.id, revision: updated.revision });
  await expect(page.locator('.host-people .person-row')).toHaveCount(0);
  await expect(room).toBeFocused();
  await page.keyboard.press('Escape'); await expect(menu).toBeFocused();
  await menu.click(); await page.mouse.click(2, 730); await expect(navigation).toBeHidden();
  await page.setViewportSize({ width: 1440, height: 900 }); await expect(menu).toBeVisible(); await expect(navigation).toBeHidden();
  await openNavigation(page); await settings.focus();
  await page.setViewportSize({ width: 320, height: 740 }); await expect(navigation).toBeVisible(); await expect(settings).toBeFocused();
  await page.keyboard.press('Escape'); await expect(menu).toBeFocused();
  await openNavigation(page); await page.screenshot({ path: 'test-results/shared-header-menu-320.png', fullPage: true });
  await navigation.getByRole('link', { name: 'My music', exact: true }).click();
  await expect(page).toHaveURL('/participant'); await expect(navigation).toBeHidden(); await noOverflow(page);
  await page.goto('/host'); const skip = page.getByRole('link', { name: 'Skip to content', exact: true }); await skip.focus(); await skip.press('Enter');
  await expect(page.locator('#main-content')).toBeFocused();
});

test('fullscreen uses the same control on every page without writes and gracefully hides when unsupported', async ({ page, browser, isolatedApp }) => {
  const writes: string[] = []; page.on('request', request => { if (request.method() === 'POST') writes.push(new URL(request.url()).pathname); });
  for (const path of ['/', '/host', '/host/settings', '/participant', '/join', '/display']) {
    await page.goto(path);
    if (path !== '/display') await openNavigation(page);
    const fullscreen = page.locator('.header-fullscreen');
    await expect(fullscreen).toHaveText('Full screen'); await fullscreen.click();
    await expect(fullscreen).toHaveText('Exit full screen'); await expect(fullscreen).toHaveAttribute('aria-pressed', 'true');
    await fullscreen.click(); await expect(fullscreen).toHaveText('Full screen'); await expect(fullscreen).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('.header-menu-toggle')).toBeVisible();
  }
  expect(writes).toEqual([]);
  const context = await browser.newContext();
  try {
    await context.addInitScript(() => Object.defineProperty(document, 'fullscreenEnabled', { get: () => false }));
    const unsupported = await context.newPage();
    for (const path of ['/', '/host', '/host/settings', '/participant', '/join', '/display']) {
      await unsupported.goto(isolatedApp.origin + path);
      await expect(unsupported.locator('.header-fullscreen')).toBeHidden();
      await openNavigation(unsupported); await expect(unsupported.getByRole('navigation', { name: 'Primary navigation' })).toBeVisible();
    }
  } finally { await context.close(); }
});

test('display header stays mounted through menus/fullscreen/reveal/removal without restarting record motion or disclosing private data', async ({ browser, page: host, isolatedApp }) => {
  const post = (path: string, data: unknown) => host.request.post(path, { data, headers: { Origin: isolatedApp.origin } });
  let session = await (await host.request.get('/api/host/state')).json(); const participantContext = await browser.newContext(); const displayContext = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  try {
    const joined = await participantContext.request.post(isolatedApp.origin + '/api/participant/join', { data: { nickname: 'A listener <literal>' }, headers: { Origin: isolatedApp.origin } }); expect(joined.ok()).toBe(true);
    session = await (await host.request.get('/api/host/state')).json();
    const playing = await participantContext.request.post(isolatedApp.origin + '/api/participant/play', { data: { turnId: session.turnId, previousPlaybackId: null, trackId: 'demo:aurora' }, headers: { Origin: isolatedApp.origin } }); const own = await playing.json();
    const tv = await displayContext.newPage(); await tv.goto(session.displayUrl); await expect(tv.getByRole('heading', { name: 'Keep them guessing.' })).toBeVisible();
    await tv.evaluate(() => { (window as any).headerRef = document.querySelector('header'); (window as any).recordRef = document.querySelector('.room-record'); (window as any).spinRef = document.querySelector('.room-record')!.getAnimations()[0]; });
    await openNavigation(tv); await expect(tv.getByRole('navigation', { name: 'Primary navigation' })).toBeVisible();
    expect(await tv.getByRole('banner').innerHTML()).not.toContain('Northern Lights'); expect(await tv.getByRole('banner').innerHTML()).not.toContain('#access=');
    await tv.getByRole('button', { name: 'Full screen', exact: true }).click(); await expect(tv.getByRole('button', { name: 'Exit full screen', exact: true })).toBeVisible();
    await tv.getByRole('button', { name: 'Exit full screen', exact: true }).click();
    await participantContext.request.post(isolatedApp.origin + '/api/participant/reveal', { data: { turnId: session.turnId, playbackId: own.ownPlayback.id }, headers: { Origin: isolatedApp.origin } });
    await expect(tv.getByRole('heading', { name: 'Northern Lights', exact: true })).toBeVisible();
    expect(await tv.evaluate(() => (window as any).headerRef === document.querySelector('header') && (window as any).recordRef === document.querySelector('.room-record') && (window as any).spinRef === document.querySelector('.room-record')!.getAnimations()[0])).toBe(true);
    expect(await tv.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 2)).toBe(true);
    session = await (await host.request.get('/api/host/state')).json(); await post('/api/host/remove', { id: session.current.id, revision: session.revision });
    await expect(tv.getByRole('heading', { name: 'Nothing playing.' })).toBeVisible();
    expect(await tv.evaluate(() => (window as any).headerRef === document.querySelector('header'))).toBe(true);
  } finally { await participantContext.close(); await displayContext.close(); }
});

test('skip navigation preserves a stable join URL and menu access never triggers playback or settings mutations', async ({ page }) => {
  const session = await (await page.request.get('/api/host/state')).json();
  const writes: string[] = []; page.on('request', request => { if (request.method() === 'POST') writes.push(new URL(request.url()).pathname); });
  await page.setViewportSize({ width: 320, height: 740 }); await page.goto(session.joinUrl);
  const skip = page.getByRole('link', { name: 'Skip to content', exact: true }); await skip.focus(); await skip.press('Enter');
  expect(page.url()).toBe(session.joinUrl); await expect(page.locator('#main-content')).toBeFocused();
  await openNavigation(page); await page.keyboard.press('Escape'); await expect(page.getByLabel('What should we call you?')).toBeVisible();
  expect(writes).toEqual([]);
  await page.getByLabel('What should we call you?').fill('Keyboard listener'); await page.getByRole('button', { name: 'Join room' }).click();
  await expect(page).toHaveURL('/participant'); await expect(page.getByRole('banner')).toContainText('Keyboard listener');
  expect(writes).toEqual(['/api/participant/join']);
});
