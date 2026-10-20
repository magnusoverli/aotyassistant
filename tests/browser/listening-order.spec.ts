import { expect, type Page } from '@playwright/test';
import { test } from './app-fixture';

async function expectGlowing(pages: Page[], animated: boolean) {
  for (const page of pages) {
    await expect.poll(() => page.locator('.rotation-seat').evaluateAll(nodes => nodes.filter(node => getComputedStyle(node.querySelector('.order-trace-head')!).animationName === 'order-trace').map(node => node.getAttribute('aria-current')))).toEqual(animated ? ['step'] : []);
  }
}

test('every route highlights the current turn, including before playback, while paused, stopped and disconnected', async ({ page, browser, isolatedApp }) => {
  const first = await isolatedApp.engine.join('First'); await isolatedApp.engine.join('Second');
  const guest = await browser.newContext({ baseURL: isolatedApp.origin });
  const member = await browser.newContext({ baseURL: isolatedApp.origin });
  await member.request.post('/api/participant/join', { headers: { Origin: isolatedApp.origin }, data: { nickname: 'My seat' } });
  const pages = [page];
  try {
    await page.goto('/host');
    for (const path of ['/', '/host/settings', '/join', '/display']) {
      const next = await guest.newPage(); await next.goto(path); pages.push(next);
    }
    const participant = await member.newPage(); await participant.goto('/participant'); pages.push(participant);
    for (const [width, height] of [[1440, 900], [1099, 900], [390, 900], [320, 900], [844, 390], [390, 480]] as const) {
      let appearance: unknown;
      for (const current of pages) {
        await current.setViewportSize({ width, height });
        await expect(current.locator('.rotation-seat')).toHaveCount(3);
        await expect(current.locator('.listening-order')).toHaveCount(1);
        await expect(current.locator('main .rotation-list, .host-people, .room-turn-order')).toHaveCount(0);
        const bar = (await current.locator('.header-inner').boundingBox())!;
        const order = (await current.locator('.order-bar').boundingBox())!;
        expect(Math.abs(order.y - bar.y - bar.height)).toBeLessThan(1);
        expect(order.height).toBeLessThanOrEqual(width < 1100 ? 56 : 104);
        await expect(current.locator('.listening-order details, .listening-order summary')).toHaveCount(0);
        await expect(current.locator('.rotation-list')).toBeVisible();
        await expect(current.getByRole('list', { name: 'Participant rotation' }).getByRole('listitem')).toHaveCount(3);
        expect(await current.locator('.rotation-seat').evaluateAll(nodes => nodes.map(node => getComputedStyle(node, '::after').content))).toEqual(['""', '""', 'none']);
        expect(await current.locator('.rotation-seat.is-next .seat-state:visible').evaluate(node => getComputedStyle(node, '::before').content)).toBe('none');
        await expect(current.locator('.rotation-seat').first()).toBeInViewport();
        const seat = current.locator('.rotation-seat').first();
        if (width < 1100) {
          await expect(seat.locator('.avatar')).toBeHidden();
          await expect(current.locator('.rotation-seat').nth(1)).toBeInViewport({ ratio: 1 });
          await expect(seat.locator('.seat-state:visible')).toHaveText('Now');
          if (current === page) await expect(current.locator('.workspace-heading').getByRole('button', { name: 'Manage people' })).toBeVisible();
        } else {
          const avatar = (await seat.locator('.avatar').boundingBox())!;
          const name = (await seat.locator('strong').boundingBox())!;
          expect(avatar.x + avatar.width).toBeLessThanOrEqual(name.x);
          if (current === page) await expect(current.locator('.order-bar').getByRole('button', { name: 'Manage people' })).toBeVisible();
        }
        const style = await current.locator('.rotation-seat').first().evaluate(node => {
          const style = getComputedStyle(node); return [style.width, style.padding, style.backgroundColor, style.borderRadius, style.fontFamily];
        });
        if (appearance) expect(style).toEqual(appearance); else appearance = style;
        await expect(current.locator('.rotation-seat strong')).toHaveText(['First', 'Second', 'My seat']);
        expect(await current.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await current.getByRole('button', { name: 'Menu', exact: true }).click();
        await expect(current.getByRole('navigation', { name: 'Primary navigation' })).toBeVisible();
        const link = current.locator('.primary-links a').first();
        expect(await link.evaluate(node => { const r = node.getBoundingClientRect(); return node.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)); })).toBe(true);
        await current.keyboard.press('Escape');
        if (height === 900 && (width === 390 || width === 1440)) await current.screenshot({ path: `test-results/listening-order-${width}-${new URL(current.url()).pathname.replaceAll('/', '-') || 'home'}.png`, fullPage: true });
      }
    }
    await expect(participant.locator('.rotation-seat.is-you strong')).toHaveText('My seat');
    await expect(participant.locator('.rotation-seat.is-you .seat-state:visible')).toHaveText('You');
    for (const current of pages.slice(0, -1)) await expect(current.locator('.rotation-seat.is-you')).toHaveCount(0);
    const state = isolatedApp.engine.view({ kind: 'participant', credential: first });
    await expectGlowing(pages, true);
    await isolatedApp.engine.play(first, state.turnId!, null, 'demo:aurora');
    const playing = isolatedApp.engine.view({ kind: 'participant', credential: first });
    await expectGlowing(pages, true);
    const glow = await page.locator('.rotation-seat.is-current').evaluateHandle(async node => {
      const animation = node.getAnimations({ subtree: true })[0]!; await animation.ready; return { animation, start: animation.startTime };
    });
    await isolatedApp.engine.reveal(first, playing.turnId!, playing.ownPlayback!.id);
    isolatedApp.engine.emit('change', 'playback');
    await expect(page.locator('.host-live')).toBeVisible();
    expect(await glow.evaluate(saved => document.getAnimations().includes(saved.animation) && saved.animation.startTime === saved.start)).toBe(true);
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await page.locator('.listening-order').screenshot({ path: `test-results/listening-order-playing-${width}.png` });
    }
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expectGlowing([page], false);
    await expect(page.locator('.rotation-seat.is-current')).toHaveAttribute('aria-current', 'step');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await expectGlowing([page], true);
    await guest.setOffline(true);
    for (const current of pages.slice(1, -1)) await expect(current.locator('.order-status')).toHaveText('Offline');
    await expectGlowing(pages.slice(1, -1), true);
    await guest.setOffline(false); await expectGlowing(pages, true);
    Object.defineProperty(isolatedApp.engine.adapter, 'connected', { configurable: true, value: false }); isolatedApp.engine.emit('change', 'output');
    await expectGlowing(pages, true);
    Reflect.deleteProperty(isolatedApp.engine.adapter, 'connected'); isolatedApp.engine.emit('change', 'output');
    await expectGlowing(pages, true);
    await isolatedApp.engine.control(first, playing.turnId!, playing.ownPlayback!.id, 'pause');
    await expectGlowing(pages, true);
    await isolatedApp.engine.control(first, playing.turnId!, playing.ownPlayback!.id, 'resume');
    await expectGlowing(pages, true);
    await isolatedApp.engine.control(first, playing.turnId!, playing.ownPlayback!.id, 'stop');
    await expectGlowing(pages, true);
    await glow.dispose();
    await isolatedApp.engine.advance(state.turnId!, first);
    for (const current of pages) await expect(current.locator('.rotation-seat.is-current strong')).toHaveText('Second');
    await expectGlowing(pages, true);
    await expect(participant.locator('.rotation-seat.is-you .seat-state:visible')).toHaveText('Next · You');
    await guest.setOffline(true);
    for (const current of pages.slice(1, -1)) await expect(current.locator('.order-status')).toHaveText('Offline');
    await guest.setOffline(false);
    for (const current of pages.slice(1, -1)) await expect(current.locator('.order-status')).toBeEmpty();
  } finally { await guest.close(); await member.close(); }
});

test('the current-turn highlight visibly travels around the rounded perimeter before playback at desktop, mobile and management sizes', async ({ page, isolatedApp }) => {
  await isolatedApp.engine.join('Magnus'); await isolatedApp.engine.join('Sam');
  await page.emulateMedia({ reducedMotion: 'no-preference' }); await page.goto('/host'); await expectGlowing([page], true);
  const seat = page.locator('.rotation-seat.is-current');
  const motion = await seat.evaluateHandle(async node => {
    const animations = node.getAnimations({ subtree: true });
    for (const animation of animations) animation.pause();
    await Promise.all(animations.map(animation => animation.ready)); return animations;
  });
  try {
    for (const [width, manage] of [[1440, false], [320, false], [320, true]] as const) {
      await page.setViewportSize({ width, height: 900 });
      if (manage) await page.getByRole('button', { name: 'Manage people', exact: true }).click();
      const bounds = await seat.boundingBox();
      const probes = await seat.evaluate(node => {
        const head = node.querySelector<SVGRectElement>('.order-trace-head')!;
        const box = node.getBoundingClientRect(); const matrix = head.getScreenCTM()!;
        return [.20, .45, .70, .95].map(fraction => {
          const point = head.getPointAtLength(head.getTotalLength() * fraction).matrixTransform(matrix);
          return { x: point.x - box.x, y: point.y - box.y };
        });
      });
      for (let frame = 0; frame < 4; frame++) {
        await motion.evaluate((animations, time) => { for (const animation of animations) animation.currentTime = time; }, frame * 2000);
        const image = await seat.screenshot({ path: `test-results/order-trace-${width}-${manage ? 'manage' : 'normal'}-${frame}.png`, scale: 'css' });
        const painted = await page.evaluate(async ({ png, probes }) => {
          const image = new Image(); image.src = `data:image/png;base64,${png}`; await image.decode();
          const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
          const context = canvas.getContext('2d')!; context.drawImage(image, 0, 0);
          return probes.map(point => {
            const pixels = context.getImageData(Math.max(0, Math.floor(point.x) - 2), Math.max(0, Math.floor(point.y) - 2), 5, 5).data;
            for (let i = 0; i < pixels.length; i += 4) if (pixels[i]! > 225 && pixels[i + 1]! > 220 && pixels[i + 2]! > 160) return true;
            return false;
          });
        }, { png: image.toString('base64'), probes });
        expect(painted, `The bright head must move to a different edge at ${frame * 2000}ms (${width}px, management ${manage}).`).toEqual(probes.map((_, index) => index === frame));
        expect(await seat.boundingBox()).toEqual(bounds);
      }
    }
  } finally { await motion.dispose(); }
});

test('order feed exposes names, placement and playback status without song details even after reveal', async ({ isolatedApp }) => {
  const credential = await isolatedApp.engine.join('Listener');
  let view = isolatedApp.engine.view({ kind: 'participant', credential });
  await isolatedApp.engine.play(credential, view.turnId!, null, 'demo:aurora');
  view = isolatedApp.engine.view({ kind: 'participant', credential });
  await isolatedApp.engine.reveal(credential, view.turnId!, view.ownPlayback!.id);
  const controller = new AbortController();
  try {
    const response = await fetch(isolatedApp.origin + '/api/listening-order/events', { signal: controller.signal });
    expect(response.status).toBe(200);
    const reader = response.body!.getReader(); let frame = '';
    while (!frame.includes('\n\n')) frame += new TextDecoder().decode((await reader.read()).value);
    const snapshot = JSON.parse(frame.split('\n').find(line => line.startsWith('data: '))!.slice(6));
    expect(Object.keys(snapshot).sort()).toEqual(['current', 'next', 'playbackStatus', 'revision', 'roomId', 'rotation']);
    expect(snapshot.playbackStatus).toBe('playing');
    expect(snapshot.rotation).toEqual([{ id: view.me!.id, nickname: 'Listener' }]);
    expect(Object.keys(snapshot.current).sort()).toEqual(['id', 'nickname']);
    expect(frame).not.toContain('Northern Lights'); expect(frame).not.toContain(credential);
  } finally { controller.abort(); }
});

test('the visible bar preserves focus and horizontal scroll through updates and keeps host management in the shared list', async ({ page, isolatedApp }) => {
  for (let index = 0; index < 20; index++) await isolatedApp.engine.join(`Listener ${index}`);
  await page.setViewportSize({ width: 320, height: 568 }); await page.goto('/host');
  await expect(page.locator('.rotation-seat')).toHaveCount(20);
  const list = page.locator('.rotation-list'); await list.focus();
  await list.evaluate(node => { node.scrollLeft = 400; (window as any).orderList = node; (window as any).firstSeat = node.firstElementChild; });
  isolatedApp.engine.emit('change');
  await expect(list).toBeFocused(); await expect(list).toHaveJSProperty('scrollLeft', 400);
  expect(await list.evaluate(node => node === (window as any).orderList && node.firstElementChild === (window as any).firstSeat)).toBe(true);
  const normalHeight = (await page.locator('.rotation-seat').first().boundingBox())!.height;
  await page.getByRole('button', { name: 'Manage people' }).click();
  const controls = page.locator('.rotation-seat').nth(1);
  await controls.scrollIntoViewIfNeeded();
  await expect(controls).toBeInViewport({ ratio: 1 });
  const seatBox = (await controls.boundingBox())!;
  expect(seatBox.height).toBe(normalHeight);
  for (const action of await controls.getByRole('button').all()) {
    const box = (await action.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(32); expect(box.height).toBeGreaterThanOrEqual(32);
    expect(box.y - seatBox.y).toBeLessThan(5); expect(seatBox.x + seatBox.width - box.x - box.width).toBeLessThan(5);
    expect(box.y + box.height).toBeLessThanOrEqual(seatBox.y + seatBox.height);
    await expect(action).toHaveText(''); await expect(action).toHaveAccessibleName('Remove Listener 1');
  }
  await controls.focus(); await page.keyboard.press('Space'); await page.keyboard.press('ArrowLeft'); await page.keyboard.press('Enter');
  await expect(page.locator('.rotation-seat strong').first()).toHaveText('Listener 1');
  await expect(page.locator('.rotation-seat').first()).toBeFocused();
  await page.getByRole('button', { name: 'Remove Listener 1', exact: true }).click();
  await expect(page.locator('.rotation-seat')).toHaveCount(19);
  await expect(list).toBeVisible();
  await expect(page.locator('.order-feedback')).toContainText('Their saved music is kept.');
  await page.getByRole('button', { name: 'Done managing' }).click();
  await expect(page.locator('.order-actions')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Manage people' })).toBeFocused();
  expect((await page.locator('.order-bar').boundingBox())!.height).toBeLessThanOrEqual(56);
});
