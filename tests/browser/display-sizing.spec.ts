import { expect, type Page } from '@playwright/test';
import { test } from './app-fixture';

const fontSize = (page: Page, selector: string) => page.locator(selector).first().evaluate(node => parseFloat(getComputedStyle(node).fontSize));

async function fits(page: Page) {
  await expect(page.locator('.rotation-seat.is-current')).toBeInViewport({ ratio: 1 });
  await expect(page.locator('.rotation-seat.is-next')).toBeInViewport({ ratio: 1 });
  await expect(page.locator('.room-cover')).toBeInViewport({ ratio: 1 });
  await expect(page.locator('.track-info')).toBeInViewport({ ratio: 1 });
  const artwork = (await page.locator('.room-cover').boundingBox())!;
  expect(Math.abs(artwork.width - artwork.height)).toBeLessThan(1);
  if (await page.evaluate(() => matchMedia('(orientation:landscape)').matches)) {
    const details = (await page.locator('.track-info').boundingBox())!;
    expect(Math.abs(artwork.height - details.height)).toBeLessThan(1);
    expect(Math.abs(artwork.y - details.y)).toBeLessThan(1);
    expect(Math.abs(artwork.y + artwork.height - details.y - details.height)).toBeLessThan(1);
    expect(await page.locator('.track-info').evaluate(node => node.scrollHeight - node.clientHeight)).toBeLessThanOrEqual(1);
  }
  const overflow = await page.locator('.app-content').evaluate(node => ({ x: node.scrollWidth - node.clientWidth, y: node.scrollHeight - node.clientHeight }));
  expect(overflow.x).toBeLessThanOrEqual(1); expect(overflow.y).toBeLessThanOrEqual(1);
  await expect(page.locator('.app-content')).toHaveCSS('overflow-y', 'clip');
  await expect(page.locator('.room-invitation:not([hidden]), .order-qr:not([hidden])')).toHaveCount(1);
}

for (const [width, height] of [[960, 540], [1024, 768], [1280, 720], [1366, 768], [1920, 1080], [1920, 540], [2560, 1440], [3440, 1440], [3840, 2160], [5120, 1440], [1080, 1920]]) {
  test(`display automatically fits ${width}×${height} and keeps Now and Next across turns`, async ({ browser, isolatedApp }) => {
    for (let i = 0; i < 20; i++) await isolatedApp.engine.join(`Listener ${i} with a long name`);
    const saved = isolatedApp.engine.view({ kind: 'host' }).rotation;
    const context = await browser.newContext({ viewport: { width: width!, height: height! } });
    try {
      const page = await context.newPage(); await page.goto(isolatedApp.origin + '/display');
      await expect(page.locator('.rotation-more')).toBeVisible();
      await expect(page.locator('.seat-state')).toHaveCount(0);
      expect(await fontSize(page, '.rotation-seat strong')).toBeGreaterThanOrEqual(22);
      expect(await page.locator('html').evaluate(node => node.style.fontSize)).toBe('');
      await fits(page);
      for (let turn = 0; turn < 3; turn++) {
        await isolatedApp.engine.advance(isolatedApp.engine.view({ kind: 'host' }).turnId!);
        const state = isolatedApp.engine.view({ kind: 'host' });
        await expect(page.locator('.rotation-seat').first().locator('strong')).toHaveText(state.current!.nickname);
        await expect(page.locator('.rotation-seat').nth(1).locator('strong')).toHaveText(state.next!.nickname);
        await fits(page); expect(state.rotation).toEqual(saved);
      }
    } finally { await context.close(); }
  });
}

test('resizing relocates the QR without rebuilding playback, and old size choices have no effect', async ({ page, isolatedApp }) => {
  await isolatedApp.engine.join('First'); await isolatedApp.engine.join('Next');
  await page.addInitScript(() => localStorage.setItem('doom-room.display-size', 'back'));
  await page.setViewportSize({ width: 1920, height: 1080 }); await page.goto('/display');
  await expect(page.locator('.room-invitation')).toBeVisible();
  const record = await page.locator('.room-record').elementHandle();
  const title = await fontSize(page, '.track-info h1');
  await page.setViewportSize({ width: 960, height: 540 });
  await expect(page.locator('.order-qr')).toBeVisible(); await expect(page.locator('.room-invitation')).toBeHidden();
  await fits(page);
  // A smaller viewport loses optional structure rather than halving the text size.
  expect(await fontSize(page, '.track-info h1')).toBeGreaterThan(title * .6);
  await page.setViewportSize({ width: 3840, height: 2160 });
  await expect(page.locator('.room-invitation')).toBeVisible(); await fits(page);
  expect(await fontSize(page, '.track-info h1')).toBeGreaterThan(title);
  expect(await record!.evaluate(node => node === document.querySelector('.room-record'))).toBe(true);
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await expect(page.getByLabel('This screen’s size', { exact: true })).toHaveCount(0);
  await page.getByRole('navigation').getByRole('link', { name: 'Host desk', exact: true }).click();
  await expect(page.locator('body')).toHaveAttribute('data-view', 'host');
  expect(await page.locator('html').evaluate(node => node.style.fontSize)).toBe('');
});

test('long playback details fit both QR preferences and preserve geometry through reveal', async ({ page, isolatedApp }) => {
  const credential = await isolatedApp.engine.join('A listener with a long name'); await isolatedApp.engine.join('Next listener');
  const track = isolatedApp.demo.catalogue[0]!;
  track.title = 'A very long track title that wraps across the available playback space';
  track.artist = 'An artist with a long display name'; track.album = 'A long album title';
  const turn = isolatedApp.engine.view({ kind: 'host' }).turnId!;
  await isolatedApp.engine.play(credential, turn, null, track.id);
  const playbackId = isolatedApp.engine.view({ kind: 'participant', credential }).ownPlayback!.id;
  await isolatedApp.engine.control(credential, turn, playbackId, 'pause');
  await page.goto('/display'); await expect(page.locator('.display-page')).toHaveAttribute('data-playback', 'paused');
  const cover = await page.locator('.room-cover').boundingBox();
  await isolatedApp.engine.reveal(credential, turn, playbackId);
  await expect(page.locator('.track-info h1')).toHaveText(track.title);
  expect(await page.locator('.room-cover').boundingBox()).toEqual(cover);
  for (const placement of ['bottom-right', 'play-order']) {
    const settings = await (await page.request.get('/api/host/background-settings')).json();
    settings.settings.qrPlacement = placement;
    expect((await page.request.post('/api/host/background-settings', { data: settings, headers: { Origin: isolatedApp.origin } })).ok()).toBe(true);
    for (const [width, height] of [[960, 540], [1366, 768], [1920, 540], [1920, 1080], [3440, 1440], [3840, 2160]]) {
      await page.setViewportSize({ width: width!, height: height! }); await fits(page);
      const picture = (await page.locator('.room-visual').boundingBox())!;
      const details = (await page.locator('.track-info').boundingBox())!;
      expect(picture.x + picture.width).toBeLessThan(details.x);
      const code = page.locator('.room-invitation:not([hidden])');
      if (await code.count()) expect(details.x + details.width).toBeLessThanOrEqual((await code.boundingBox())!.x);
      await expect(page.locator('.room-invitation:not([hidden]) img, .order-qr:not([hidden]) img')).toHaveAttribute('src', /^data:image\/svg\+xml/);
    }
  }
});

test('a short window budgets playback inside the viewport without introducing scrolling', async ({ page, isolatedApp }) => {
  await isolatedApp.engine.join('First'); await isolatedApp.engine.join('Next');
  await page.setViewportSize({ width: 1920, height: 1080 }); await page.goto('/display');
  await expect(page.locator('.track-info h1')).toBeVisible();
  await page.evaluate(() => { document.documentElement.style.fontSize = '32px'; });
  await page.setViewportSize({ width: 1600, height: 450 });
  expect(await fontSize(page, 'html')).toBe(32);
  await fits(page);
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await expect(page.getByRole('navigation')).toBeVisible();
});

test('the animation fits its own row above playback in every state and exposes no width control', async ({ page, isolatedApp }) => {
  const credential = await isolatedApp.engine.join('First'); await isolatedApp.engine.join('Next');
  await page.goto('/host/settings#appearance');
  await expect(page.getByLabel('Background opacity', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Background width (%)', { exact: true })).toHaveCount(0);
  await page.goto('/display');
  await expect(page.locator('.bmf-background bmf-logo svg')).toBeAttached();
  const turn = isolatedApp.engine.view({ kind: 'host' }).turnId!;
  const track = isolatedApp.demo.catalogue[0]!;
  track.title = 'A long revealed title that must not push the animation into the album artwork';
  for (const state of ['idle', 'hidden', 'revealed'] as const) {
    if (state === 'hidden') await isolatedApp.engine.play(credential, turn, null, track.id);
    if (state === 'revealed') {
      const id = isolatedApp.engine.view({ kind: 'participant', credential }).ownPlayback!.id;
      await isolatedApp.engine.reveal(credential, turn, id);
      await expect(page.locator('.track-info h1')).toHaveText(track.title);
    }
    for (const [width, height] of [[960, 540], [1366, 768], [1920, 1080], [1920, 540], [3840, 2160], [3440, 1440]]) {
      await page.setViewportSize({ width: width!, height: height! }); await fits(page);
      const area = (await page.locator('.display-page > .bmf-background').boundingBox())!;
      const svg = (await page.locator('.bmf-background bmf-logo svg').boundingBox())!;
      const artwork = (await page.locator('.room-cover').boundingBox())!;
      expect(svg.x).toBeGreaterThanOrEqual(area.x - 1);
      expect(svg.x + svg.width).toBeLessThanOrEqual(area.x + area.width + 1);
      expect(svg.y + svg.height).toBeLessThanOrEqual(area.y + area.height + 1);
      expect(area.y + area.height).toBeLessThanOrEqual(artwork.y);
    }
  }
});

test('larger desktop windows never reduce workspace content width', async ({ page, isolatedApp }) => {
  await isolatedApp.engine.join('Listener');
  for (const path of ['/host', '/host/settings']) {
    await page.goto(path); let previous = 0;
    for (const width of [1100, 1200, 1320, 1440, 1920, 2560, 3840, 5120]) {
      await page.setViewportSize({ width, height: 1080 });
      const available = await page.locator('main.page').evaluate(node => {
        const style = getComputedStyle(node); return node.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      });
      expect(available).toBeGreaterThanOrEqual(previous - 1); previous = available;
    }
  }
});

test('small-screen display retains Now and Next and the existing stacked portrait composition', async ({ page, isolatedApp }) => {
  await isolatedApp.engine.join('First listener'); await isolatedApp.engine.join('Next listener');
  for (const [width, height] of [[320, 700], [390, 844], [844, 390]]) {
    await page.setViewportSize({ width: width!, height: height! }); await page.goto('/display');
    await expect(page.locator('.order-qr')).toBeVisible();
    await expect(page.locator('.rotation-seat.is-current')).toBeInViewport({ ratio: 1 });
    await expect(page.locator('.rotation-seat.is-next')).toBeInViewport({ ratio: 1 });
    await expect(page.locator('.seat-state')).toHaveCount(0);
    if (width! < height!) {
      const picture = (await page.locator('.room-visual').boundingBox())!;
      const details = (await page.locator('.track-info').boundingBox())!;
      expect(details.y).toBeGreaterThanOrEqual(picture.y + picture.height);
    }
  }
});
