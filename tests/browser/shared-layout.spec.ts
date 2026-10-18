import { expect, type Page } from '@playwright/test';
import { test } from './app-fixture';

const widths = [1440, 1100, 1099, 1000, 999, 701, 700, 390, 320];

async function geometry(page: Page, selectors: string[]) {
  return page.evaluate(selectors => selectors.map(selector => {
    const node = document.querySelector(selector)!;
    const rect = node.getBoundingClientRect(); const style = getComputedStyle(node);
    return { x: rect.x, width: rect.width, padding: style.padding };
  }), selectors);
}

async function appearance(page: Page, selector: string) {
  return page.locator(selector).evaluate(node => {
    const style = getComputedStyle(node);
    return { font: style.fontFamily, size: style.fontSize, color: style.color,
      background: style.backgroundColor, border: style.borderColor, radius: style.borderRadius, padding: style.padding };
  });
}

async function alignedMenu(page: Page) {
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  const toggle = (await page.locator('.header-menu-toggle').boundingBox())!;
  const menu = (await page.locator('.primary-navigation').boundingBox())!;
  expect(Math.abs(toggle.x + toggle.width - menu.x - menu.width)).toBeLessThan(1);
  await page.getByRole('button', { name: 'Close', exact: true }).click();
}

test('workspace geometry and standard cards stay shared across routes, empty rooms and responsive boundaries', async ({ page: host, context, isolatedApp }) => {
  await host.goto('/host'); await expect(host.locator('.host-page.is-empty')).toBeVisible();
  const empty = await geometry(host, ['main', '.host-workspace', '.host-invitations']);
  const joined = await host.request.post('/api/participant/join', { headers: { Origin: isolatedApp.origin }, data: { nickname: 'Layout listener' } });
  expect(joined.ok()).toBe(true);
  await expect(host.locator('.host-live')).toBeVisible();
  expect(await geometry(host, ['main', '.host-workspace', '.host-invitations'])).toEqual(empty);
  const settings = await context.newPage(); const participant = await context.newPage();
  await settings.goto('/host/settings'); await expect(settings.locator('#ma-url')).toBeVisible();
  await participant.goto('/participant'); await expect(participant.locator('.playback-card')).toBeVisible();
  for (const width of widths) {
    for (const page of [host, settings, participant]) await page.setViewportSize({ width, height: 1000 });
    const frame = await geometry(host, ['main']);
    expect(await geometry(settings, ['main'])).toEqual(frame);
    expect(await geometry(participant, ['main'])).toEqual(frame);
    const columns = (await geometry(host, ['.host-workspace', '.host-invitations'])).map(({ x, width }) => ({ x, width }));
    for (const [page, selectors] of [[settings, ['.settings-connection', '.settings-output']], [participant, ['.playback-card', '.preparation-list']]] as const) {
      expect((await geometry(page, [...selectors])).map(({ x, width }) => ({ x, width }))).toEqual(columns);
    }
    const card = await appearance(host, '.qr-card');
    await expect.poll(() => appearance(settings, '.settings-connection')).toEqual(card);
    expect(await appearance(participant, '.catalogue-panel')).toEqual(card);
    const player = (await participant.locator('.playback-card').boundingBox())!;
    const search = (await participant.locator('.catalogue-panel').boundingBox())!;
    const list = (await participant.locator('.preparation-list').boundingBox())!;
    if (width >= 1100) expect(Math.abs(player.y - list.y)).toBeLessThan(1);
    else {
      expect(search.y).toBeGreaterThanOrEqual(player.y + player.height);
      expect(list.y).toBeGreaterThanOrEqual(search.y + search.height);
    }
    for (const page of [host, settings, participant]) {
      await alignedMenu(page);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
  }
  await context.setOffline(true);
  await expect(host.locator('.app-content > .connection')).toBeVisible();
  await expect(participant.locator('.app-content > .connection')).toBeVisible();
  for (const page of [host, participant]) {
    const [message, grid] = await geometry(page, ['.app-content > .connection', '.workspace-grid']);
    expect(message!.x).toBeCloseTo(grid!.x, 0); expect(message!.width).toBeCloseTo(grid!.width, 0);
  }
});

test('both entry routes render the same form geometry and compact frame as home', async ({ page: join, context }) => {
  const participant = await context.newPage(); const home = await context.newPage();
  await join.goto('/join'); await participant.goto('/participant'); await home.goto('/');
  for (const page of [join, participant]) await expect(page.locator('#nickname')).toBeVisible();
  for (const width of widths) {
    for (const page of [join, participant, home]) await page.setViewportSize({ width, height: 844 });
    const selectors = ['main', '.join-panel', '.join-panel > form', '#nickname', '#join-room-submit'];
    expect(await geometry(participant, selectors)).toEqual(await geometry(join, selectors));
    expect(await geometry(home, ['main'])).toEqual(await geometry(join, ['main']));
    const positions = (page: Page) => page.locator('.join-panel > form').evaluate(node => {
      const style = getComputedStyle(node);
      const input = node.querySelector('input')!.getBoundingClientRect();
      const button = node.querySelector('button')!.getBoundingClientRect();
      return { y: node.getBoundingClientRect().y, gap: style.gap, margin: style.margin, controlGap: button.y - input.bottom };
    });
    expect(await positions(participant)).toEqual(await positions(join));
    expect(await appearance(participant, '#nickname')).toEqual(await appearance(join, '#nickname'));
    for (const page of [join, participant, home]) await alignedMenu(page);
    if ([1440, 390].includes(width)) await join.screenshot({ path: `test-results/shared-entry-${width}.png`, fullPage: true });
  }
});

test('checking, failed and offline entry keep the compact frame and card presentation', async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/participant/state', async route => { await gate; await route.fulfill({ status: 503, json: { error: 'Please try again.' } }); });
  try {
    await page.goto('/participant'); await expect(page.locator('.entry-status h1')).toHaveText('Checking your place in the room…');
    const frame = await geometry(page, ['main']); const card = await appearance(page, '.entry-status');
    release(); await expect(page.locator('.entry-status h1')).toHaveText('Can’t reach the room.');
    expect(await geometry(page, ['main'])).toEqual(frame); expect(await appearance(page, '.entry-status')).toEqual(card);
    await page.unroute('**/api/participant/state');
    await page.getByRole('button', { name: 'Retry', exact: true }).click(); await expect(page.locator('#nickname')).toBeVisible();
    expect(await geometry(page, ['main'])).toEqual(frame); expect(await appearance(page, '.join-panel')).toEqual(card);
    await context.setOffline(true); await expect(page.locator('.entry-status h1')).toHaveText('You’re offline.');
    expect(await geometry(page, ['main'])).toEqual(frame); expect(await appearance(page, '.entry-status')).toEqual(card);
  } finally { release(); }
});

test('static fallback pages share compact geometry and theme without application JavaScript', async ({ page, browser, isolatedApp }) => {
  const fallbackContext = await browser.newContext({ javaScriptEnabled: false });
  const fallback = await fallbackContext.newPage();
  try {
    await page.goto('/join'); await expect(page.locator('#nickname')).toBeVisible();
    const response = await fallback.goto(isolatedApp.origin + '/missing-page'); expect(response!.status()).toBe(404);
    await expect(fallback.locator('h1')).toHaveText('Page not found');
    for (const width of [1440, 1099, 390, 320]) {
      for (const p of [page, fallback]) await p.setViewportSize({ width, height: 844 });
      expect(await geometry(fallback, ['main'])).toEqual(await geometry(page, ['main']));
      expect(await appearance(fallback, '.panel')).toEqual(await appearance(page, '.join-panel'));
      expect(await appearance(fallback, 'h1')).toEqual(await appearance(page, '.join-panel h1'));
      expect(await fallback.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
    await fallback.screenshot({ path: 'test-results/shared-fallback-320.png', fullPage: true });
  } finally { await fallbackContext.close(); }
});
