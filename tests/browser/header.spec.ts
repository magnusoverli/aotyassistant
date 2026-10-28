import { expect, type Page } from '@playwright/test';
import { test } from './app-fixture';
import { openNavigation } from './navigation-helpers';

const noOverflow = async (page: Page) => expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);

test('header logout works across routes, retries explicitly and signs out only this browser', async ({ page, browser, isolatedApp }) => {
  const headers = { Origin: isolatedApp.origin };
  const joinPath = '/api/participant/preparations/join';
  const joined = await page.request.post(joinPath, { headers, data: { nickname: 'Logout listener', pin: '0042' } });
  expect(joined.ok()).toBe(true); const user = (await joined.json()).user;
  const originalList = await (await page.request.post('/api/participant/preparations/init', { headers, data: {} })).json();
  const other = await browser.newContext({ baseURL: isolatedApp.origin });
  try {
    expect((await other.request.post(joinPath, { headers, data: { userId: user.id, pin: '0042' } })).ok()).toBe(true);
    const before = await (await page.request.get('/api/host/state')).json();
    const menu = page.getByRole('navigation', { name: 'Primary navigation' });
    const logout = menu.getByRole('button', { name: 'Log out', exact: true });
    for (const path of ['/participant', '/', '/display', '/host/settings', '/host']) {
      await page.goto(path); await openNavigation(page); await expect(logout).toBeVisible();
      await noOverflow(page);
    }
    let writes = 0;
    await page.route('**/api/participant/logout', async route => {
      writes++;
      if (writes === 1) await route.fulfill({ status: 503, json: { error: 'Temporary storage failure.' } });
      else await route.continue();
    });
    await logout.click(); await expect(menu.getByRole('alert')).toContainText('Log out was not confirmed');
    await expect(page).toHaveURL('/host'); await expect(logout).toBeEnabled(); expect(writes).toBe(1);
    await logout.click(); await expect(page).toHaveURL('/join'); expect(writes).toBe(2);
    await openNavigation(page); await expect(logout).toBeHidden();
    expect((await (await page.request.get('/api/participant/identity')).json()).current).toBeNull();
    expect((await (await other.request.get('/api/participant/identity')).json()).current.id).toBe(user.id);
    const after = await (await page.request.get('/api/host/state')).json();
    expect(after.rotation).toEqual(before.rotation); expect(after.turnId).toBe(before.turnId);
    expect((await page.request.post(joinPath, { headers, data: { userId: user.id, pin: '0042' } })).ok()).toBe(true);
    const restored = await (await page.request.post('/api/participant/preparations/init', { headers, data: {} })).json();
    expect(restored.ownerId).toBe(originalList.ownerId);
  } finally { await other.close(); }
});

test('shared mobile header is compact across routes while desktop sizing and touch targets stay unchanged', async ({ page, isolatedApp }) => {
  await page.request.post('/api/participant/join', { data: { pin: '1234', nickname: 'Header listener' }, headers: { Origin: isolatedApp.origin } });
  for (const path of ['/', '/host', '/host/settings', '/participant', '/join', '/display']) {
    await page.goto(path);
    await expect(page.locator('.rotation-seat')).toHaveCount(1);
    for (const width of [1440, 1100, 1099, 701, 700, 390, 320, 1100]) {
      await page.setViewportSize({ width, height: 844 });
      const mobile = width < 1100;
      const barHeight = mobile ? '44px' : '72px';
      await expect(page.locator('.header-inner')).toHaveCSS('height', barHeight);
      await expect(page.locator('.brand-subtitle')).toBeHidden();
      await expect(page.locator('.order-bar')).toHaveCSS('height', mobile ? '49px' : '89px');
      await expect(page.locator('.brand-mark')).toHaveCSS('width', mobile ? width <= 380 ? '28px' : '30px' : '38px');
      await expect(page.locator('.brand strong')).toHaveCSS('font-size', mobile ? '14px' : '16px');
      await expect(page.locator('.rotation-seat strong')).toHaveCSS('font-size', mobile ? '13px' : '14px');
      await expect(page.locator('.header-menu-toggle')).toHaveCSS('color', mobile ? 'rgb(188, 201, 188)' : 'rgb(161, 176, 163)');
      await expect(page.locator('.header-menu-toggle')).toHaveCSS('border-top-color', mobile ? 'rgb(74, 91, 78)' : 'rgb(48, 61, 51)');
      const divider = await page.locator('.app-header').evaluate(node => {
        const line = getComputedStyle(node, '::after');
        return { content: line.content, width: line.width, top: line.top, border: line.borderTopWidth, pointerEvents: line.pointerEvents };
      });
      if (mobile) expect(divider).toEqual({ content: '""', width: `${width}px`, top: barHeight, border: '1px', pointerEvents: 'none' });
      else expect(divider.content).toBe('none');
      await expect(page.locator('.app-header')).toHaveCSS('border-bottom-width', '1px');
      await expect(page.locator('.order-bar')).toHaveCSS('border-top-color', mobile ? 'rgba(0, 0, 0, 0)' : 'rgb(48, 61, 51)');
      const menu = (await page.locator('.header-menu-toggle').boundingBox())!;
      expect(menu.height).toBeGreaterThanOrEqual(mobile ? 40 : 44); expect(menu.width).toBeGreaterThanOrEqual(44);
      if (mobile) {
        const extension = await page.locator('.header-menu-toggle').evaluate(node => {
          const hit = getComputedStyle(node, '::before');
          return { content: hit.content, top: parseFloat(hit.top), bottom: parseFloat(hit.bottom) };
        });
        expect(extension.content).toBe('""');
        expect(menu.height - extension.top - extension.bottom).toBeGreaterThanOrEqual(44);
      }
      if (mobile) expect((await page.locator('.rotation-seat').boundingBox())!.height).toBe(40);
      await noOverflow(page);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    {
      const menu = (await page.locator('.header-menu-toggle').boundingBox())!;
      await page.mouse.click(menu.x + menu.width / 2, menu.y - 1);
      await expect(page.locator('#app-navigation')).toBeVisible();
      await page.keyboard.press('Escape');
    }
    await openNavigation(page);
    await expect(page.getByRole('navigation', { name: 'Primary navigation' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.header-menu-toggle')).toBeFocused();
  }
});

test('tabbing out of the menu exposes the focused join field and Escape works outside the header', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/join');
  const navigation = page.locator('#app-navigation'); const menu = page.locator('.header-menu-toggle');
  await expect(page.getByLabel('Display name')).toBeVisible();
  await openNavigation(page);
  await navigation.getByRole('link', { name: 'Room display', exact: true }).focus();
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('Display name')).toBeFocused();
  await expect(navigation).toBeHidden(); await expect(menu).toHaveAttribute('aria-expanded', 'false');
  await openNavigation(page);
  await page.locator('body').dispatchEvent('keydown', { key: 'Escape', bubbles: true });
  await expect(navigation).toBeHidden(); await expect(menu).toBeFocused();
});

test('every page uses the shared header with centralized navigation, current-page semantics, and no duplicate body navigation', async ({ page }) => {
  const session = await (await page.request.get('/api/host/state')).json();
  for (const [path, current] of [['/', null], ['/host', 'Host desk'], ['/host/settings', 'Settings'], ['/participant', 'Your music'], [session.joinUrl, null], [session.displayUrl, 'Room display']] as const) {
    await page.setViewportSize({ width: 1440, height: 1000 }); await page.goto(path);
    await expect(page.getByRole('banner')).toHaveCount(1); await expect(page.locator('header[data-header="shared"]')).toHaveCount(1);
    await expect(page.getByRole('main')).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Menu', exact: true })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Primary navigation' })).toBeHidden();
    await openNavigation(page);
    const navigation = page.getByRole('banner').getByRole('navigation', { name: 'Primary navigation' });
    await expect(navigation).toBeVisible(); await expect(navigation.locator('.primary-links > li > a')).toHaveCount(4);
    await expect(navigation.locator('button:visible, .mode-badge')).toHaveCount(0);
    expect(await navigation.locator('a').evaluateAll(links => links.map(link => ({ text: link.textContent, href: link.getAttribute('href') })))).toEqual([
      { text: 'Host desk', href: '/host' }, { text: 'Settings', href: '/host/settings' },
      { text: 'Your music', href: '/participant' }, { text: 'Room display', href: '/display' },
    ]);
    if (current) await expect(navigation.getByRole('link', { name: current, exact: true })).toHaveAttribute('aria-current', 'page');
    else await expect(navigation.locator('[aria-current="page"]')).toHaveCount(0);
    const brand = page.locator('a.brand');
    await expect(brand).toHaveAttribute('href', '/');
    await expect(brand).toHaveAccessibleName('Listening Room');
    await expect(page.locator('.host-sidebar, .host-nav, .session-navigation, main .back-link, main .display-link')).toHaveCount(0);
    const html = await page.getByRole('banner').innerHTML(); expect(html).not.toContain('#access='); expect(html).not.toContain('#invite=');
    await expect(navigation.locator('a[href*="#"]')).toHaveCount(0);
    for (const width of [1920, 1440, 1200, 1100, 390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      await expect(page.locator('header .header-menu-toggle')).toBeVisible();
      await openNavigation(page); await expect(navigation).toBeVisible(); await noOverflow(page);
      if (width >= 1100) {
        expect(await page.locator('.header-inner').evaluate(node => Math.abs(node.getBoundingClientRect().width - document.documentElement.clientWidth))).toBeLessThan(1);
        expect(await page.locator('.listening-order').evaluate(node => Math.abs(node.getBoundingClientRect().width - document.documentElement.clientWidth))).toBeLessThan(1);
      }
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
  const launch = page.locator('.host-invitations').getByRole('link', { name: 'Open room display' });
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
  await post('/api/participant/join', { pin: '1234', nickname: 'Live listener' });
  await expect(page.locator('.rotation-seat')).toHaveCount(1);
  await expect(settings).toBeFocused(); await expect(menu).toHaveAttribute('aria-expanded', 'true');
  expect(await page.evaluate(() => (window as any).headerRef === document.querySelector('header') && (window as any).settingsLinkRef === document.querySelector('header a[href="/host/settings"]'))).toBe(true);
  await page.keyboard.press('Escape'); await expect(navigation).toBeHidden(); await expect(menu).toBeFocused();
  await openNavigation(page); const room = navigation.getByRole('link', { name: 'Room display', exact: true }); await room.focus();
  const updated = await (await page.request.get('/api/host/state')).json(); await post('/api/host/remove', { id: updated.current.id, revision: updated.revision });
  await expect(page.locator('.rotation-seat')).toHaveCount(0);
  await expect(room).toBeFocused();
  await page.keyboard.press('Escape'); await expect(menu).toBeFocused();
  await menu.click(); await page.mouse.click(2, 730); await expect(navigation).toBeHidden();
  await page.setViewportSize({ width: 1440, height: 900 }); await expect(menu).toBeVisible(); await expect(navigation).toBeHidden();
  await openNavigation(page); await settings.focus();
  await page.setViewportSize({ width: 320, height: 740 }); await expect(navigation).toBeVisible(); await expect(settings).toBeFocused();
  await page.keyboard.press('Escape'); await expect(menu).toBeFocused();
  await openNavigation(page); await page.screenshot({ path: 'test-results/shared-header-menu-320.png', fullPage: true });
  await navigation.getByRole('link', { name: 'Your music', exact: true }).click();
  await expect(page).toHaveURL('/participant'); await expect(navigation).toBeHidden(); await noOverflow(page);
  await page.goto('/host'); const skip = page.getByRole('link', { name: 'Skip to content', exact: true }); await skip.focus(); await skip.press('Enter');
  await expect(page.locator('#main-content')).toBeFocused();
});

test('fullscreen is a display-only header control without writes and gracefully hides when unsupported', async ({ page, browser, isolatedApp }) => {
  const writes: string[] = []; page.on('request', request => { if (request.method() === 'POST') writes.push(new URL(request.url()).pathname); });
  for (const path of ['/', '/host', '/host/settings', '/participant', '/join', '/display']) {
    await page.goto(path);
    const fullscreen = page.locator('.header-fullscreen');
    if (path !== '/display') { await expect(fullscreen).toHaveCount(0); continue; }
    await expect(page.locator('.header-meta .header-fullscreen')).toBeVisible();
    await expect(page.locator('#app-navigation .header-fullscreen')).toHaveCount(0);
    await expect(fullscreen).toHaveText('Full screen'); await fullscreen.click();
    await expect(fullscreen).toHaveText('Exit full screen'); await expect(fullscreen).toHaveAttribute('aria-pressed', 'true');
    await fullscreen.click(); await expect(fullscreen).toHaveText('Full screen'); await expect(fullscreen).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('.header-menu-toggle')).toBeVisible();
    await page.keyboard.press('Escape');
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator('.header-meta .header-fullscreen')).toBeVisible();
    await fullscreen.click(); await expect(fullscreen).toHaveText('Exit full screen');
    await fullscreen.click(); await expect(fullscreen).toHaveText('Full screen');
    await page.setViewportSize({ width: 1440, height: 1000 });
    await expect(page.locator('.header-meta .header-fullscreen')).toBeVisible();
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
    const joined = await participantContext.request.post(isolatedApp.origin + '/api/participant/join', { data: { pin: '1234', nickname: 'A listener <literal>' }, headers: { Origin: isolatedApp.origin } }); expect(joined.ok()).toBe(true);
    session = await (await host.request.get('/api/host/state')).json();
    const playing = await participantContext.request.post(isolatedApp.origin + '/api/participant/play', { data: { turnId: session.turnId, previousPlaybackId: null, trackId: 'demo:aurora' }, headers: { Origin: isolatedApp.origin } }); const own = await playing.json();
    const tv = await displayContext.newPage(); await tv.goto(session.displayUrl); await expect(tv.getByRole('heading', { name: 'Track details hidden.' })).toBeVisible();
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
  await openNavigation(page); await page.keyboard.press('Escape'); await expect(page.getByLabel('Display name')).toBeVisible();
  expect(writes).toEqual([]);
  await page.getByLabel('Display name').fill('Keyboard listener'); await page.getByLabel('4-digit PIN', { exact: true }).fill('1234'); await page.getByRole('button', { name: 'Join room' }).click();
  await expect(page).toHaveURL('/participant'); await expect(page.getByRole('banner')).toContainText('Keyboard listener');
  await expect(page.locator('.list-save-status')).toHaveText('Private · Saved ✓');
  expect(writes).toEqual(['/api/participant/preparations/join', '/api/participant/preparations/init']);
});
