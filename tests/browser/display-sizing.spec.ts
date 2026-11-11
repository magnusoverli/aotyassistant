import { expect, type Page } from '@playwright/test';
import { test } from './app-fixture';

const fontSize = (page: Page, selector: string) => page.locator(selector).first().evaluate(node => parseFloat(getComputedStyle(node).fontSize));

async function fits(page: Page) {
  const bounds = await page.evaluate(() => ({ width: innerWidth, height: innerHeight,
    contentWidth: document.documentElement.scrollWidth, contentHeight: document.documentElement.scrollHeight }));
  expect(bounds.contentWidth).toBeLessThanOrEqual(bounds.width + 1);
  expect(bounds.contentHeight).toBeLessThanOrEqual(bounds.height + 1);
  await expect(page.locator('.rotation-seat.is-current')).toBeInViewport({ ratio: 1 });
  await expect(page.locator('.rotation-seat.is-next')).toBeInViewport({ ratio: 1 });
}

async function setDistance(page: Page, origin: string, distance: string) {
  const current = await (await page.request.get('/api/host/display-settings')).json();
  const response = await page.request.post('/api/host/display-settings', { data: { revision: current.revision, settings: { distance } }, headers: { Origin: origin } });
  expect(response.ok()).toBe(true);
}

for (const screen of [
  { width: 1920, height: 1080, name: '1080p', name32: 32, root: 16 },
  { width: 3840, height: 2160, name: 'native 4K', name32: 64, root: 32 },
  { width: 960, height: 540, name: 'a 960×540 TV box', name32: 16, root: 8 },
]) test(`the ${screen.name} display is one scaled picture, and keeps Now and Next visible across turns`, async ({ browser, isolatedApp }) => {
  for (let i = 0; i < 20; i++) await isolatedApp.engine.join(`Listener ${i} with a long name`);
  const saved = isolatedApp.engine.view({ kind: 'host' }).rotation;
  const context = await browser.newContext({ viewport: { width: screen.width, height: screen.height } });
  try {
    const page = await context.newPage(); await page.goto(isolatedApp.origin + '/display');
    await expect(page.locator('.rotation-seat').first()).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-display-tier', 'standard');
    expect(await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize))).toBeCloseTo(screen.root, 1);
    expect(await fontSize(page, '.rotation-seat strong')).toBeCloseTo(screen.name32, 1);
    await expect(page.locator('.rotation-more')).toBeVisible(); await fits(page);
    for (let turn = 0; turn < 3; turn++) {
      await isolatedApp.engine.advance(isolatedApp.engine.view({ kind: 'host' }).turnId!);
      const state = isolatedApp.engine.view({ kind: 'host' });
      await expect(page.locator('.rotation-seat').first().locator('strong')).toHaveText(state.current!.nickname);
      await expect(page.locator('.rotation-seat').nth(1).locator('strong')).toHaveText(state.next!.nickname);
      await fits(page); expect(state.rotation).toEqual(saved);
    }
  } finally { await context.close(); }
});

test('the room size applies live, a screen can override it, and other pages are unchanged', async ({ page, isolatedApp }) => {
  await isolatedApp.engine.join('First'); await isolatedApp.engine.join('Next');
  await page.setViewportSize({ width: 1920, height: 1080 }); await page.goto('/display');
  const header = await page.locator('header').elementHandle();
  await expect(page.locator('html')).toHaveAttribute('data-display-tier', 'standard');
  await setDistance(page, isolatedApp.origin, 'back');
  await expect(page.locator('html')).toHaveAttribute('data-display-tier', 'compact');
  expect(await fontSize(page, '.rotation-seat strong')).toBeCloseTo(48, 1); await fits(page);
  expect(await header!.evaluate(node => node === document.querySelector('header'))).toBe(true);
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.getByLabel('This screen’s size', { exact: true }).selectOption('close');
  await expect(page.locator('html')).toHaveAttribute('data-display-tier', 'standard');
  expect(await fontSize(page, '.rotation-seat strong')).toBeCloseTo(27.2, 1);
  await page.reload();
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await expect(page.getByLabel('This screen’s size', { exact: true })).toHaveValue('close');
  await page.getByRole('navigation').getByRole('link', { name: 'Host desk', exact: true }).click();
  await expect(page.locator('body')).toHaveAttribute('data-view', 'host');
  await expect(page.locator('html')).not.toHaveAttribute('data-display-tier', /.*/);
  expect(await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize))).toBe(16);
});

test('long playback details fit both QR placements and every viewing distance', async ({ page, isolatedApp }) => {
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
    for (const [width, height] of [[1366, 768], [1920, 1080], [3440, 1440], [3840, 2160], [960, 540]]) {
      await page.setViewportSize({ width: width!, height: height! });
      for (const distance of ['close', 'sofa', 'room', 'back']) {
        await setDistance(page, isolatedApp.origin, distance);
        await expect(page.locator('.room-invitation:not([hidden]), .order-qr:not([hidden])')).toBeVisible();
        await fits(page);
        const info = await page.locator('.track-info').evaluate(node => ({ height: node.clientHeight, content: node.scrollHeight }));
        expect(info.content).toBeLessThanOrEqual(info.height + 1);
        const picture = (await page.locator('.room-visual').boundingBox())!;
        const details = (await page.locator('.track-info').boundingBox())!;
        expect(picture.x + picture.width).toBeLessThan(details.x);
        const code = page.locator('.room-invitation:not([hidden])');
        if (await code.count()) {
          const box = (await code.boundingBox())!;
          expect(details.x + details.width).toBeLessThanOrEqual(box.x); expect(box.y + box.height).toBeLessThanOrEqual(height! + 1);
        }
      }
    }
  }
});

test('phones use the stacked layout and keep readable text', async ({ page, isolatedApp }) => {
  await isolatedApp.engine.join('First listener'); await isolatedApp.engine.join('Next listener');
  for (const [width, height] of [[320, 700], [390, 844], [844, 390]]) {
    await page.setViewportSize({ width: width!, height: height! }); await page.goto('/display');
    await expect(page.locator('html')).toHaveAttribute('data-display-tier', width! < height! ? 'portrait' : 'compact');
    await expect(page.locator('.order-qr')).toBeVisible(); await fits(page);
    expect(await fontSize(page, '.seat-state-compact')).toBeGreaterThanOrEqual(12);
  }
});
