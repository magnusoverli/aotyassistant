import { expect, type Page } from '@playwright/test';
import { test } from './app-fixture';

async function fits(page: Page) {
  const bounds = await page.evaluate(() => ({ width: innerWidth, height: innerHeight,
    contentWidth: document.documentElement.scrollWidth, contentHeight: document.documentElement.scrollHeight,
    headerHeight: document.querySelector('header')!.getBoundingClientRect().height }));
  expect(bounds.contentWidth).toBeLessThanOrEqual(bounds.width + 1);
  expect(bounds.contentHeight).toBeLessThanOrEqual(bounds.height + 2);
  expect(bounds.headerHeight).toBeLessThan(bounds.height * .3);
  await expect(page.locator('.rotation-seat.is-current')).toBeInViewport({ ratio: 1 });
  await expect(page.locator('.rotation-seat.is-next')).toBeInViewport({ ratio: 1 });
}

for (const screen of [
  { width: 1920, height: 1080, density: 1, name: '1080p', font: 28 },
  { width: 3840, height: 2160, density: 1, name: 'native 4K', font: 56 },
  { width: 1920, height: 1080, density: 2, name: 'OS-scaled 4K', font: 28 },
]) test(`the ${screen.name} display has readable names and keeps Now and Next visible across turns`, async ({ browser, isolatedApp }) => {
  for (let i = 0; i < 20; i++) await isolatedApp.engine.join(`Listener ${i} with a long name`);
  const saved = isolatedApp.engine.view({ kind: 'host' }).rotation;
  const context = await browser.newContext({ viewport: { width: screen.width, height: screen.height }, deviceScaleFactor: screen.density });
  try {
    const page = await context.newPage(); await page.goto(isolatedApp.origin + '/display');
    await expect(page.locator('.rotation-seat')).toHaveCount(20);
    expect(await page.locator('.rotation-seat strong').first().evaluate(node => parseFloat(getComputedStyle(node).fontSize))).toBeCloseTo(screen.font, 1);
    await fits(page);
    for (let turn = 0; turn < 3; turn++) {
      await page.locator('.rotation-list').evaluate(node => { node.scrollLeft = node.scrollWidth; });
      await isolatedApp.engine.advance(isolatedApp.engine.view({ kind: 'host' }).turnId!);
      const state = isolatedApp.engine.view({ kind: 'host' });
      await expect(page.locator('.rotation-seat').first().locator('strong')).toHaveText(state.current!.nickname);
      await expect(page.locator('.rotation-seat').nth(1).locator('strong')).toHaveText(state.next!.nickname);
      await expect(page.locator('.rotation-list')).toHaveJSProperty('scrollLeft', 0);
      await fits(page); expect(state.rotation).toEqual(saved);
    }
  } finally { await context.close(); }
});

test('display size is local, survives reloads, and follows SPA display navigation without replacing the shell', async ({ page, browser, isolatedApp }) => {
  await isolatedApp.engine.join('First'); await isolatedApp.engine.join('Next');
  await page.setViewportSize({ width: 1920, height: 1080 }); await page.goto('/display');
  const header = await page.locator('header').elementHandle();
  const order = await page.locator('.rotation-list').elementHandle();
  const before = isolatedApp.engine.view({ kind: 'host' });
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.getByLabel('Display size', { exact: true }).selectOption('1.5');
  expect(await page.locator('.rotation-seat strong').first().evaluate(node => parseFloat(getComputedStyle(node).fontSize))).toBeCloseTo(42, 1);
  expect(await header!.evaluate(node => node === document.querySelector('header'))).toBe(true);
  expect(await order!.evaluate(node => node === document.querySelector('.rotation-list'))).toBe(true);
  expect(isolatedApp.engine.view({ kind: 'host' }).revision).toBe(before.revision);
  await fits(page);
  await page.reload(); await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await expect(page.getByLabel('Display size', { exact: true })).toHaveValue('1.5');
  await page.getByRole('navigation').getByRole('link', { name: 'Host desk', exact: true }).click();
  await expect(page.locator('body')).toHaveAttribute('data-view', 'host');
  await expect(page.locator('.rotation-seat strong').first()).toHaveCSS('font-size', '14px');
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await expect(page.getByLabel('Display size', { exact: true })).toBeHidden();
  await page.getByRole('navigation').getByRole('link', { name: 'Room display', exact: true }).click();
  await expect(page.locator('body')).toHaveAttribute('data-view', 'display');
  expect(await page.locator('.rotation-seat strong').first().evaluate(node => parseFloat(getComputedStyle(node).fontSize))).toBeCloseTo(42, 1);
  const other = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  try {
    const display = await other.newPage(); await display.goto(isolatedApp.origin + '/display');
    await expect(display.locator('.rotation-seat')).toHaveCount(2);
    expect(await display.locator('.rotation-seat strong').first().evaluate(node => parseFloat(getComputedStyle(node).fontSize))).toBeCloseTo(28, 1);
  } finally { await other.close(); }
});

test('long playback details fit both QR placements at laptop, 1080p, ultrawide and 4K sizes', async ({ page, isolatedApp }) => {
  const credential = await isolatedApp.engine.join('A listener with a long name'); await isolatedApp.engine.join('Next listener');
  const track = isolatedApp.demo.catalogue[0]!;
  track.title = 'A very long track title that wraps across the available playback space';
  track.artist = 'An artist with a long display name'; track.album = 'A long album title';
  const turn = isolatedApp.engine.view({ kind: 'host' }).turnId!;
  await isolatedApp.engine.play(credential, turn, null, track.id);
  const playbackId = isolatedApp.engine.view({ kind: 'participant', credential }).ownPlayback!.id;
  await isolatedApp.engine.control(credential, turn, playbackId, 'pause');
  await isolatedApp.engine.reveal(credential, turn, playbackId);
  await page.goto('/display');
  for (const placement of ['bottom-right', 'play-order']) {
    const settings = await (await page.request.get('/api/host/background-settings')).json();
    settings.settings.qrPlacement = placement;
    expect((await page.request.post('/api/host/background-settings', { data: settings, headers: { Origin: isolatedApp.origin } })).ok()).toBe(true);
    const qr = page.locator(placement === 'play-order' ? '.order-qr' : '.room-invitation');
    await expect(qr).toBeVisible();
    for (const [width, height] of [[1366, 768], [1920, 1080], [3440, 1440], [3840, 2160]]) {
      await page.setViewportSize({ width: width!, height: height! });
      for (const size of ['1', '1.5']) {
        await page.getByRole('button', { name: 'Menu', exact: true }).click();
        await page.getByLabel('Display size', { exact: true }).selectOption(size); await page.keyboard.press('Escape');
        await fits(page); await expect(qr).toBeInViewport({ ratio: 1 });
        const info = await page.locator('.track-info').evaluate(node => ({ height: node.clientHeight, content: node.scrollHeight }));
        expect(info.content).toBeLessThanOrEqual(info.height + 1);
        const picture = (await page.locator('.room-visual').boundingBox())!;
        const details = (await page.locator('.track-info').boundingBox())!;
        const invitation = (await qr.boundingBox())!;
        expect(picture.x + picture.width).toBeLessThan(details.x);
        if (placement === 'bottom-right') expect(details.x + details.width).toBeLessThanOrEqual(invitation.x);
      }
    }
  }
});

test('phone displays keep compact defaults and a larger display preference cannot resize other routes', async ({ page, isolatedApp }) => {
  await isolatedApp.engine.join('First listener'); await isolatedApp.engine.join('Next listener');
  const settings = await (await page.request.get('/api/host/background-settings')).json();
  settings.settings.qrPlacement = 'play-order';
  expect((await page.request.post('/api/host/background-settings', { data: settings, headers: { Origin: isolatedApp.origin } })).ok()).toBe(true);
  for (const [width, height] of [[320, 700], [390, 844], [844, 390]]) {
    await page.setViewportSize({ width: width!, height: height! }); await page.goto('/display');
    await page.getByRole('button', { name: 'Menu', exact: true }).click();
    await page.getByLabel('Display size', { exact: true }).selectOption('1'); await page.keyboard.press('Escape');
    await expect(page.locator('.header-inner')).toHaveCSS('height', '44px');
    await expect(page.locator('.rotation-seat strong').first()).toHaveCSS('font-size', '13px');
    await expect(page.locator('.order-qr')).toBeVisible(); await fits(page);
    await page.getByRole('button', { name: 'Menu', exact: true }).click();
    await page.getByLabel('Display size', { exact: true }).selectOption('1.5'); await page.keyboard.press('Escape');
    await expect(page.locator('.rotation-seat strong').first()).toHaveCSS('font-size', '19.5px'); await fits(page);
    await page.getByRole('button', { name: 'Menu', exact: true }).click();
    await page.getByRole('navigation').getByRole('link', { name: 'Settings', exact: true }).click();
    await expect(page.locator('body')).toHaveAttribute('data-view', 'settings');
    await expect(page.locator('.header-inner')).toHaveCSS('height', '44px');
    await expect(page.locator('.rotation-seat strong').first()).toHaveCSS('font-size', '13px');
  }
});
