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
  const joined = await host.request.post('/api/participant/join', { headers: { Origin: isolatedApp.origin }, data: { pin: '1234', nickname: 'Layout listener' } });
  expect(joined.ok()).toBe(true);
  await expect(host.locator('.host-live')).toBeVisible();
  expect(await geometry(host, ['main', '.host-workspace', '.host-invitations'])).toEqual(empty);
  const settings = await context.newPage(); const participant = await context.newPage();
  await settings.goto('/host/settings'); await expect(settings.locator('#ma-url')).toBeVisible();
  await participant.goto('/participant'); await expect(participant.locator('.playback-card')).toBeVisible();
  for (const width of widths) {
    for (const page of [host, settings, participant]) await page.setViewportSize({ width, height: 1000 });
    const frame = await geometry(host, ['main']);
    const settingsFrame = (await geometry(settings, ['main']))[0]!;
    expect(settingsFrame.width).toBeLessThanOrEqual(width);
    expect(await geometry(participant, ['main'])).toEqual(frame.map(item => width < 1100
      ? { ...item, padding: item.padding.replace(/^\S+/, '10px') } : item));
    const columns = (await geometry(host, ['.host-workspace', '.host-invitations'])).map(({ x, width }) => ({ x, width }));
    for (const [page, selectors] of [[participant, ['.catalogue-panel', '.preparation-list']]] as const) {
      if (page === participant && width >= 1100) continue; // The collection now owns its desktop split, not the host sidebar grid.
      const expected = page === participant && width < 1100 ? columns.map(column => ({ x: column.x + 1, width: column.width - 2 })) : columns;
      expect((await geometry(page, [...selectors])).map(({ x, width }) => ({ x, width }))).toEqual(expected);
    }
    const card = await appearance(host, '.qr-card');
    await expect.poll(() => appearance(settings, '.settings-connection')).toEqual({ ...card, padding: width <= 550 ? '18px' : '24px' });
    expect(await appearance(participant, '#music-collection')).toEqual({ ...card, padding: '0px' });
    const player = (await participant.locator('.playback-card').boundingBox())!;
    const music = (await participant.locator('.music-workspace').boundingBox())!;
    const search = (await participant.locator('.catalogue-panel').boundingBox())!;
    const list = (await participant.locator('.preparation-list').boundingBox())!;
    expect(player.x).toBeCloseTo(music.x, 2);
    expect(player.width).toBeCloseTo(music.width, 2);
    if (width >= 1100) {
      expect(search.y).toBeGreaterThanOrEqual(player.y + player.height);
      expect(list.y).toBeGreaterThanOrEqual(player.y + player.height);
      expect(search.y).toBeCloseTo(list.y, 2);
      expect(search.x + search.width).toBeCloseTo(list.x, 2);
      expect(search.width + list.width).toBeCloseTo(music.width - 2, 2);
    }
    else {
      expect(list.y).toBeGreaterThanOrEqual(player.y + player.height);
      expect(search.y).toBeGreaterThanOrEqual(list.y + list.height);
    }
    for (const page of [host, settings, participant]) {
      await alignedMenu(page);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
  }
  await context.setOffline(true);
  await expect(host.locator('.app-content > .connection')).toBeVisible();
  // Mobile keeps the connection message inside the fixed player; desktop keeps
  // the existing full-width notice shared with the host workspace.
  await expect(participant.locator('.player-mobile-notice')).toHaveText('Connection lost');
  await expect(participant.locator('.app-content > .connection')).toBeHidden();
  await participant.setViewportSize({ width: 1100, height: 1000 });
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
      // The participant's mobile header is shorter; the form's own spacing is shared.
      return { y: node.getBoundingClientRect().y - node.closest('main')!.getBoundingClientRect().y, gap: style.gap, margin: style.margin, controlGap: button.y - input.bottom };
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
