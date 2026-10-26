import { expect, type APIRequestContext, type Browser, type Page } from '@playwright/test';
import type { View } from '../../src/model';
import { test } from './app-fixture';
import { recordLabels, recordLabelStorageKey } from '../../web/record-labels';

async function setup(browser: Browser, host: Page, origin: string, nickname = 'Alex') {
  const post = async (request: APIRequestContext, path: string, data: unknown): Promise<View> => {
    const response = await request.post(path, { data, headers: { Origin: origin } }); expect(response.ok()).toBe(true); return response.json();
  };
  const created = await (await host.request.get('/api/host/state')).json() as View;
  const guest = await browser.newContext({ baseURL: origin });
  const screen = await browser.newContext({ baseURL: origin, viewport: { width: 1366, height: 768 }, reducedMotion: 'no-preference' });
  await post(guest.request, '/api/participant/join', { nickname });
  const tv = await screen.newPage(); await tv.goto(created.displayUrl!);
  await expect(tv.getByRole('heading', { name: 'Nothing playing.' })).toBeVisible();
  const current = async (): Promise<View> => (await guest.request.get('/api/participant/state')).json();
  return { tv, screen,
    async play(id = 'demo:aurora') { const view = await current(); return post(guest.request, '/api/participant/play', { turnId: view.turnId, previousPlaybackId: view.ownPlayback?.id ?? null, trackId: id }); },
    async control(action: 'pause' | 'resume' | 'stop') { const view = await current(); await post(guest.request, '/api/participant/control', { turnId: view.turnId, playbackId: view.ownPlayback!.id, action }); },
    async reveal() { const view = await current(); await post(guest.request, '/api/participant/reveal', { turnId: view.turnId, playbackId: view.ownPlayback!.id }); },
    async finish() { const view = await current(); await post(guest.request, '/api/participant/finish', { turnId: view.turnId }); },
    async close() { await guest.close(); await screen.close(); },
  };
}
async function fits(tv: Page) {
  const size = await tv.evaluate(() => ({ width: innerWidth, height: innerHeight, contentWidth: document.documentElement.scrollWidth, contentHeight: document.documentElement.scrollHeight }));
  expect(size.contentWidth).toBeLessThanOrEqual(size.width + 1);
  expect(size.contentHeight).toBeLessThanOrEqual(size.height + 2);
}

test('the display uses the shared listening order without numbers and retains it across playback updates', async ({ browser, page: host, isolatedApp }) => {
  const f = await setup(browser, host, isolatedApp.origin); const tv = f.tv;
  const listeners = [];
  const list = tv.getByRole('list', { name: 'Participant rotation' });
  try {
    await expect(tv.locator('.room-turn')).toBeHidden();
    await expect(tv.locator('.room-topline, .room-next, .room-meter, .reveal-label')).toHaveCount(0);
    await expect(tv.getByText('Scan the QR code to join.', { exact: true })).toHaveCount(0);
    await expect(tv.locator('.rotation-seat.is-current .seat-state:visible')).toHaveText('Current turn');
    await expect(tv.locator('.rotation-seat.is-next')).toHaveCount(0);
    expect((await tv.locator('.rotation-seat').boundingBox())!.width).toBeLessThan(240);
    await expect(tv.getByRole('button', { name: 'Menu', exact: true })).toBeVisible();
    await expect(tv.getByRole('navigation', { name: 'Primary navigation' })).toBeHidden();
    expect(await tv.locator('.room-invitation').evaluate(node => getComputedStyle(node).borderTopWidth)).toBe('0px');
    for (const nickname of ['Sam', 'Jordan', 'Riley', 'A longer listener name for the TV', 'Taylor', 'Morgan', 'Casey', 'Robin']) {
      const context = await browser.newContext(); listeners.push(context);
      const joined = await context.request.post(isolatedApp.origin + '/api/participant/join', { headers: { Origin: isolatedApp.origin }, data: { nickname } }); expect(joined.ok()).toBe(true);
    }
    await expect(list.getByRole('listitem')).toHaveCount(9);
    await expect(tv.locator('.rotation-seat.is-next strong')).toHaveText('Sam');
    await expect(list.locator('.seat-number')).toHaveCount(0);
    await f.play(); await expect(tv.locator('.display-page')).toHaveAttribute('data-playback', 'playing');
    await expect(tv.locator('.room-turn')).toHaveText('Currently playing: Alex');
    await expect(tv.locator('.room-turn')).toBeVisible();
    await expect(tv.getByText('Track details stay private until the reveal.', { exact: true })).toHaveCount(0);
    await list.focus(); await list.evaluate(node => { (window as any).orderList = node; (window as any).currentPerson = node.firstElementChild; });
    await f.reveal(); await expect(tv.getByRole('heading', { name: 'Northern Lights', exact: true })).toBeVisible();
    await expect(list).toBeFocused();
    expect(await list.evaluate(node => (window as any).orderList === node && (window as any).currentPerson === node.firstElementChild)).toBe(true);
    await f.control('pause'); await expect(tv.locator('.display-page')).toHaveAttribute('data-playback', 'paused');
    await expect(tv.locator('.room-turn')).toBeHidden();
    await f.screen.setOffline(true); await expect(tv.getByRole('heading', { name: 'Playback unavailable.' })).toBeVisible();
    await expect(tv.locator('.order-status')).toHaveText('Offline');
    await f.screen.setOffline(false); await expect(tv.locator('.display-page')).toHaveAttribute('data-playback', 'paused');
    await f.control('resume');
    await expect(tv.locator('.room-turn')).toBeVisible();
    await list.evaluate(node => (node as HTMLElement).blur());
    for (const [width, height] of [[1366, 768], [1920, 1080], [1280, 720], [390, 844], [320, 700]]) {
      await tv.setViewportSize({ width: width!, height: height! });
      await expect(tv.locator('.rotation-seat.is-current strong')).toHaveText('Alex');
      await expect(tv.locator('.rotation-seat.is-next strong')).toHaveText('Sam');
      expect(await tv.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      await tv.screenshot({ path: `test-results/display-airy-${width}x${height}.png`, fullPage: true });
      if (width! > 700) await fits(tv);
    }
    await f.control('stop'); await expect(tv.locator('.rotation-seat.is-current .seat-state:visible')).toHaveText('Now');
    await expect(tv.locator('.room-turn')).toBeHidden();
    await f.finish(); await expect(tv.locator('.room-turn')).toBeHidden();
    await expect(tv.locator('.rotation-seat.is-current strong')).toHaveText('Sam');
    await expect(tv.locator('.rotation-seat.is-next strong')).toHaveText('Jordan');
    await expect(tv.locator('.rotation-list strong').nth(0)).toHaveText('Sam');
    await expect(tv.locator('.rotation-list strong').nth(1)).toHaveText('Jordan');
    await expect(tv.locator('.rotation-list strong').nth(2)).toHaveText('Riley');
    await tv.setViewportSize({ width: 1366, height: 768 });
    await expect(tv.locator('.rotation-list strong').nth(0)).toHaveText('Alex');
    await expect(tv.locator('.rotation-seat.is-current strong')).toHaveText('Sam');
  } finally { await f.close(); for (const context of listeners) await context.close(); }
});

test('the public room is clean while idle/stopped and preserves the exact animation timelines through reveal and telemetry', async ({ browser, page: host, isolatedApp }) => {
  const f = await setup(browser, host, isolatedApp.origin); const tv = f.tv;
  try {
    await expect(tv.locator('.now-playing')).toBeHidden(); await expect(tv.locator('.room-record')).toBeHidden();
    await expect(tv.locator('.vinyl-label.is-personalized')).toHaveCount(0);
    await expect(tv.getByRole('progressbar')).toBeHidden(); await expect(tv.getByText('Track details hidden.')).toHaveCount(0);
    await fits(tv); await tv.screenshot({ path: 'test-results/public-room-idle.png' });
    await expect(tv.locator('.display-page')).toHaveAttribute('data-playback', 'idle');
    const images: string[] = []; tv.on('request', request => { if (/artwork|demo-cover/.test(request.url())) images.push(request.url()); });
    await f.play(); await expect(tv.locator('.display-page')).toHaveAttribute('data-playback', 'playing');
    await expect(tv.getByRole('heading', { name: 'Track details hidden.' })).toBeVisible();
    await expect(tv.locator('.room-record .vinyl-owner')).toHaveText('Alex');
    expect(recordLabels).toContain(await tv.locator('.room-record .vinyl-caption').textContent());
    await expect(tv.locator('.track-times')).toBeEmpty(); expect(images).toEqual([]);
    await expect.poll(() => tv.locator('.now-playing').evaluate(node => node.getAnimations({ subtree: true }).filter(a => a.playState === 'running' && a.startTime !== null).length)).toBe(2);
    const motion = await tv.locator('.now-playing').evaluateHandle(node => ({
      glow: node.querySelector('.room-glow'), record: node.querySelector('.room-record'), sticker: node.querySelector('.room-record > .vinyl-label'),
      animations: node.getAnimations({ subtree: true }), starts: node.getAnimations({ subtree: true }).map(a => a.startTime),
    }));
    const coverBounds = await tv.locator('.room-visual').boundingBox();
    await fits(tv); await tv.screenshot({ path: 'test-results/public-room-playing-hidden.png' });
    await f.reveal(); await expect(tv.getByRole('heading', { name: 'Northern Lights', exact: true })).toBeVisible();
    await expect.poll(() => tv.getByAltText('Current album artwork').evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    expect(await tv.evaluate(saved => saved.glow === document.querySelector('.room-glow') &&
      saved.record === document.querySelector('.room-record') && saved.sticker === document.querySelector('.room-record > .vinyl-label') &&
      saved.animations.every((animation, i) => document.getAnimations().includes(animation) && animation.startTime === saved.starts[i]), motion)).toBe(true);
    expect(await tv.locator('.room-visual').boundingBox()).toEqual(coverBounds);
    const previousProgress = Number(await tv.getByRole('progressbar').getAttribute('value'));
    await expect.poll(async () => Number(await tv.getByRole('progressbar').getAttribute('value'))).toBeGreaterThan(previousProgress);
    expect(await tv.evaluate(saved => saved.animations.every((a, i) => document.getAnimations().includes(a) && a.startTime === saved.starts[i]), motion)).toBe(true);
    await fits(tv); await tv.screenshot({ path: 'test-results/public-room-playing-revealed.png' });
    await f.control('pause'); await expect(tv.locator('.display-page')).toHaveAttribute('data-playback', 'paused');
    await expect.poll(() => tv.locator('.now-playing').evaluate(node => node.getAnimations({ subtree: true }).every(a => a.playState === 'paused'))).toBe(true);
    await motion.evaluate(async saved => { await Promise.all(saved.animations.map(animation => animation.ready)); });
    const times = await motion.evaluate(saved => saved.animations.map(a => a.currentTime));
    await tv.screenshot({ path: 'test-results/public-room-paused.png' });
    expect(await motion.evaluate(saved => saved.animations.map(a => a.currentTime))).toEqual(times);
    await f.control('resume'); await expect(tv.locator('.display-page')).toHaveAttribute('data-playback', 'playing');
    expect(await motion.evaluate(saved => saved.animations.every(a => document.getAnimations().includes(a) && a.playState === 'running'))).toBe(true);
    await f.control('stop'); await expect(tv.getByRole('heading', { name: 'Nothing playing.' })).toBeVisible();
    await expect(tv.getByText('Northern Lights', { exact: true })).toHaveCount(0);
    await expect(tv.getByAltText('Current album artwork')).toHaveCount(0); await expect(tv.getByRole('progressbar')).toBeHidden();
    await expect(tv.locator('.now-playing')).toBeHidden(); await fits(tv);
    await f.finish(); await expect(tv.locator('.display-page')).toHaveAttribute('data-playback', 'idle');
    await motion.dispose();
  } finally { await f.close(); }
});

test('reduced motion, paused reveal, disconnect/reconnect, long metadata, and natural completion keep the public room honest and uncluttered', async ({ browser, page: host, isolatedApp }) => {
  const f = await setup(browser, host, isolatedApp.origin); const tv = f.tv;
  try {
    await f.play('demo:night'); await f.control('pause');
    await expect(tv.locator('.display-page')).toHaveAttribute('data-playback', 'paused');
    const frozen = await tv.locator('.now-playing').evaluateHandle(node => node.getAnimations({ subtree: true }));
    await f.reveal(); await expect(tv.getByRole('heading', { name: 'Night Bus Home', exact: true })).toBeVisible();
    await expect(tv.getByAltText('Current album artwork')).toHaveCount(0);
    await expect(tv.locator('.room-record .vinyl-owner')).toHaveText('Night Bus Home');
    await expect(tv.locator('.room-record .vinyl-caption')).toHaveText('Echo Garden');
    expect(await frozen.evaluate(animations => animations.every(a => document.getAnimations().includes(a) && a.playState === 'paused'))).toBe(true);
    await f.control('resume'); await tv.emulateMedia({ reducedMotion: 'reduce' });
    await expect.poll(() => tv.locator('.now-playing').evaluate(node => node.getAnimations({ subtree: true }).length)).toBe(0);
    await tv.screenshot({ path: 'test-results/public-room-revealed-record.png' });
    await expect(tv.getByText('● Playing', { exact: true })).toBeVisible();
    await f.screen.setOffline(true);
    await expect(tv.getByRole('heading', { name: 'Playback unavailable.' })).toBeVisible();
    await expect(tv.locator('.room-turn')).toBeHidden();
    await expect(tv.getByText('Night Bus Home', { exact: true })).toHaveCount(0); await expect(tv.locator('.now-playing')).toBeHidden();
    await f.screen.setOffline(false);
    await expect(tv.getByRole('heading', { name: 'Night Bus Home', exact: true })).toBeVisible();
    await expect(tv.locator('.room-turn')).toBeVisible();
    await f.finish(); await expect(tv.getByRole('heading', { name: 'Nothing playing.' })).toBeVisible();
    const track = isolatedApp.demo.catalogue[0]!;
    track.title = 'A beautifully long song title that should never push the listening room beyond the television screen';
    track.artist = 'A remarkably long artist name for a comfortably uncluttered listening room';
    track.album = 'A very long album name that stays on one quiet line';
    await tv.route('**/demo-cover.svg', route => route.abort());
    await f.play(); await f.reveal();
    await expect(tv.getByRole('heading', { name: track.title, exact: true })).toBeVisible();
    await expect(tv.getByAltText('Current album artwork')).toHaveCount(0);
    await expect(tv.locator('.room-record .vinyl-owner')).toHaveText(track.title);
    await expect(tv.locator('.room-record .vinyl-caption')).toHaveText(track.artist);
    await fits(tv); await tv.setViewportSize({ width: 1920, height: 1080 }); await fits(tv);
    await tv.screenshot({ path: 'test-results/public-room-long-title-1920.png' });
    const titleSize = await tv.locator('.track-info h1').evaluate(node => ({ scroll: node.scrollHeight, height: node.clientHeight, font: getComputedStyle(node).fontSize, line: getComputedStyle(node).lineHeight }));
    expect(titleSize.scroll, JSON.stringify(titleSize)).toBeLessThanOrEqual(titleSize.height + 1);
    await tv.setViewportSize({ width: 390, height: 844 });
    expect(await tv.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await tv.screenshot({ path: 'test-results/public-room-revealed-record-long-390.png', fullPage: true });
    await f.finish(); track.duration = .8; await f.play();
    await expect(tv.locator('.display-page')).toHaveAttribute('data-playback', 'playing');
    await expect(tv.getByRole('heading', { name: 'Nothing playing.' })).toBeVisible();
    await expect(tv.locator('.room-turn')).toBeHidden();
    await expect(tv.getByRole('progressbar')).toBeHidden(); await expect(tv.getByText(track.title, { exact: true })).toHaveCount(0);
    await frozen.dispose();
  } finally { await f.close(); }
});

test('only the small sticker is personalized, its shuffled history survives refresh, and the label spins with the disc', async ({ browser, page: host, isolatedApp }) => {
  const nickname = 'Magnus <img src=x> & mysterious friends';
  const f = await setup(browser, host, isolatedApp.origin, nickname); const tv = f.tv;
  try {
    const caption = 'EARS NOW, OPINIONS LATER';
    await tv.evaluate(({ key, index, size }) => localStorage.setItem(key, JSON.stringify({ version: 1, size, remaining: [index], current: null })),
      { key: recordLabelStorageKey, index: recordLabels.indexOf(caption), size: recordLabels.length });
    await f.play();
    await expect(tv.getByRole('heading', { name: 'Track details hidden.', exact: true })).toBeVisible();
    await expect(tv.locator('.room-record .vinyl-owner')).toHaveText(nickname);
    await expect(tv.locator('.room-record .vinyl-caption')).toHaveText(caption);
    await expect(tv.getByRole('img', { name: `${nickname} — ${caption}`, exact: true })).toBeVisible();
    await expect(tv.locator('img[src="x"]')).toHaveCount(0); await fits(tv);
    expect(await tv.locator('.vinyl-caption').evaluate(node => node.scrollHeight <= node.clientHeight + 1)).toBe(true);
    const spin = await tv.locator('.room-record').evaluateHandle(record => ({
      disc: record.getAnimations()[0]!,
    }));
    await expect.poll(() => spin.evaluate(saved => saved.disc.playState)).toBe('running');
    expect(await spin.evaluate(saved => saved.disc.effect!.getTiming().duration)).toBe(17_650);
    expect(await tv.locator('.room-record > .vinyl-label').evaluate(label => label.getAnimations().length)).toBe(0);
    const initialTime = await spin.evaluate(saved => Number(saved.disc.currentTime));
    await expect.poll(() => spin.evaluate(saved => Number(saved.disc.currentTime))).toBeGreaterThan(initialTime);
    await expect(tv.locator('.room-record > .vinyl-label')).toHaveCSS('transform', 'none');
    await f.control('pause'); await expect(tv.locator('.display-page')).toHaveAttribute('data-playback', 'paused');
    await expect(tv.locator('.room-record .vinyl-caption')).toHaveText(caption);
    await tv.reload(); await expect(tv.locator('.room-record .vinyl-caption')).toHaveText(caption);
    await expect(tv.getByRole('heading', { name: 'Track details hidden.', exact: true })).toBeVisible();
    await f.control('resume'); await expect(tv.locator('.display-page')).toHaveAttribute('data-playback', 'playing');
    const otherScreen = await f.screen.newPage(); await otherScreen.goto('/display');
    await expect(otherScreen.locator('.room-record .vinyl-caption')).toHaveText(caption); await otherScreen.close();
    // The seeded caption exhausted the old bag. The new cycle must not repeat
    // its own picks, but may use that caption again after the boundary pick.
    const seen = new Set<string>(); let previous = caption;
    for (let i = 0; i < 5; i++) {
      await f.finish(); await f.play();
      await expect.poll(async () => { const text = await tv.locator('.room-record .vinyl-caption').textContent(); return recordLabels.some(label => label === text) && text !== previous; }).toBe(true);
      const next = (await tv.locator('.room-record .vinyl-caption').textContent())!;
      expect(recordLabels).toContain(next); expect(seen.has(next)).toBe(false); seen.add(next); previous = next;
    }
    const saved = await tv.evaluate(key => localStorage.getItem(key), recordLabelStorageKey);
    expect(saved).not.toContain(nickname); expect(saved).not.toContain('Northern Lights');
    await tv.setViewportSize({ width: 1920, height: 1080 }); await fits(tv);
    await tv.setViewportSize({ width: 390, height: 844 });
    expect(await tv.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await spin.dispose();
  } finally { await f.close(); }
});

test('record captions fit with different system fonts and display sizes', async ({ browser, page: host, isolatedApp }) => {
  const f = await setup(browser, host, isolatedApp.origin, 'A long participant display name'); const tv = f.tv;
  try {
    await f.play(); await expect(tv.locator('.vinyl-caption')).toBeVisible();
    for (const [width, height] of [[1366, 768], [1920, 1080], [390, 844], [320, 700]]) {
      await tv.setViewportSize({ width: width!, height: height! });
      const clipped = await tv.locator('.vinyl-caption').evaluate((node, captions) => {
        const originalText = node.textContent; const originalFont = document.documentElement.style.fontFamily;
        const failures: string[] = [];
        try {
          for (const font of ['', 'Arial', 'DejaVu Sans']) {
            document.documentElement.style.fontFamily = font;
            for (const caption of captions) {
              node.textContent = caption;
              if (node.scrollHeight > node.clientHeight + 1 || node.scrollWidth > node.clientWidth + 1) failures.push(`${font || 'system font'}: ${caption}`);
            }
          }
        } finally { node.textContent = originalText; document.documentElement.style.fontFamily = originalFont; }
        return failures;
      }, recordLabels);
      expect(clipped, `Captions must remain readable at ${width}×${height}`).toEqual([]);
    }
  } finally { await f.close(); }
});

test('the visible sticker text turns with the record instead of only advancing an invisible rotation clock', async ({ browser, page: host, isolatedApp }) => {
  const f = await setup(browser, host, isolatedApp.origin); const tv = f.tv;
  try {
    await f.play(); await expect(tv.locator('.display-page')).toHaveAttribute('data-playback', 'playing');
    await expect(tv.locator('.room-record .vinyl-owner')).toHaveText('Alex');
    const motion = await tv.locator('.room-record').evaluateHandle(record => ({
      disc: record.getAnimations()[0]!,
    }));
    const frame = async (time: number, path: string) => {
      await motion.evaluate((animations, time) => { animations.disc.pause(); animations.disc.currentTime = time; }, time);
      const position = await tv.locator('.room-record .vinyl-owner').evaluate(owner => {
        const cover = owner.closest('.room-cover')!.getBoundingClientRect(); const point = owner.getBoundingClientRect();
        return { x: point.x + point.width / 2 - cover.x, y: point.y + point.height / 2 - cover.y };
      });
      const image = await tv.locator('.room-cover').screenshot({ path, scale: 'css' });
      const painted = await tv.evaluate(async ({ png, point }) => {
        const image = new Image(); image.src = `data:image/png;base64,${png}`; await image.decode();
        const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
        const context = canvas.getContext('2d')!; context.drawImage(image, 0, 0);
        const pixels = context.getImageData(Math.floor(point.x) - 6, Math.floor(point.y) - 6, 13, 13).data;
        for (let i = 0; i < pixels.length; i += 4) if (pixels[i]! < 100 && pixels[i + 1]! < 110 && pixels[i + 2]! < 100) return true;
        return false;
      }, { png: image.toString('base64'), point: position });
      expect(painted, 'The sticker must actually paint visible letters at its new position, not merely have an advancing animation clock.').toBe(true);
      return position;
    };
    const before = await frame(0, 'test-results/public-record-motion-0.png');
    const after = await frame(5000, 'test-results/public-record-motion-5s.png');
    expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeGreaterThan(6);
    const orientation = await tv.locator('.room-record').evaluate(record => {
      const combined = new DOMMatrix(getComputedStyle(record).transform).multiply(new DOMMatrix(getComputedStyle(record.querySelector('.vinyl-label')!).transform));
      return { a: combined.a, b: combined.b, c: combined.c, d: combined.d };
    });
    const angle = 2 * Math.PI * 5000 / 17_650;
    expect(orientation.a).toBeCloseTo(Math.cos(angle), 3); expect(orientation.b).toBeCloseTo(Math.sin(angle), 3);
    expect(orientation.c).toBeCloseTo(-Math.sin(angle), 3); expect(orientation.d).toBeCloseTo(Math.cos(angle), 3);
    await motion.dispose();
  } finally { await f.close(); }
});
