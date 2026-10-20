import { expect, type Page } from '@playwright/test';
import { test } from './app-fixture';

async function expectGlowing(pages: Page[], animated: boolean) {
  for (const page of pages) {
    await expect.poll(() => page.locator('.rotation-seat').evaluateAll(nodes => nodes.filter(node => getComputedStyle(node.querySelector('.order-trace-light')!).animationName === 'order-trace').map(node => node.getAttribute('aria-current')))).toEqual(animated ? ['step'] : []);
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
        expect(await current.locator('.rotation-seat').evaluateAll(nodes => nodes.map(node => getComputedStyle(node, '::after').content))).toEqual(current === page ? ['none', 'none', 'none'] : ['""', '""', 'none']);
        await expect(current.getByRole('button', { name: /^(Manage people|Done managing)$/ })).toHaveCount(0);
        await expect(current.locator('.order-remove')).toHaveCount(current === page ? 3 : 0);
        await expect(current.locator('.rotation-seat[tabindex="0"]')).toHaveCount(current === page ? 3 : 0);
        expect(await current.locator('.rotation-seat.is-next .seat-state:visible').evaluate(node => getComputedStyle(node, '::before').content)).toBe('none');
        await expect(current.locator('.rotation-seat').first()).toBeInViewport();
        const seat = current.locator('.rotation-seat').first();
        if (width < 1100) {
          await expect(seat.locator('.avatar')).toBeHidden();
          await expect(current.locator('.rotation-seat').nth(1)).toBeInViewport({ ratio: 1 });
          await expect(seat.locator('.seat-state:visible')).toHaveText('Now');
        } else {
          const avatar = (await seat.locator('.avatar').boundingBox())!;
          const name = (await seat.locator('strong').boundingBox())!;
          expect(avatar.x + avatar.width).toBeLessThanOrEqual(name.x);
        }
        const style = await current.locator('.rotation-seat').first().evaluate(node => {
          const style = getComputedStyle(node); return [style.height, style.paddingTop, style.paddingBottom, style.paddingLeft, style.backgroundColor, style.borderRadius, style.fontFamily];
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

test('a diffuse light travels on the actual card border without an inset trail at desktop and mobile sizes', async ({ page, isolatedApp }) => {
  await isolatedApp.engine.join('Magnus'); await isolatedApp.engine.join('Sam');
  await page.emulateMedia({ reducedMotion: 'no-preference' }); await page.goto('/host'); await expectGlowing([page], true);
  const masks = await page.locator('.order-trace mask').evaluateAll(nodes => nodes.map(node => node.id));
  expect(new Set(masks).size).toBe(masks.length);
  const seat = page.locator('.rotation-seat.is-current');
  const motion = await seat.evaluateHandle(async node => {
    const animations = node.getAnimations({ subtree: true });
    for (const animation of animations) animation.pause();
    await Promise.all(animations.map(animation => animation.ready)); return animations;
  });
  try {
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      const bounds = await seat.boundingBox();
      const outline = await seat.evaluate(node => {
        const box = node.getBoundingClientRect(); const mask = node.querySelector<SVGRectElement>('.order-trace-mask')!;
        const geometry = mask.getBBox(); const matrix = node.querySelector<SVGSVGElement>('.order-trace')!.getScreenCTM()!;
        const first = new DOMPoint(geometry.x, geometry.y).matrixTransform(matrix);
        const last = new DOMPoint(geometry.x + geometry.width, geometry.y + geometry.height).matrixTransform(matrix);
        return { left: first.x - box.left, top: first.y - box.top, right: box.right - last.x, bottom: box.bottom - last.y,
          radius: parseFloat(getComputedStyle(mask).rx), cardRadius: parseFloat(getComputedStyle(node).borderTopLeftRadius), stroke: getComputedStyle(mask).strokeWidth };
      });
      for (const edge of [outline.left, outline.top, outline.right, outline.bottom]) expect(edge).toBeCloseTo(.5, 2);
      expect(outline.radius).toBeCloseTo(outline.cardRadius - .5, 2); expect(outline.stroke).toBe('1px');
      const probes = await seat.evaluate(node => {
        const head = node.querySelector<SVGRectElement>('.order-trace-light')!;
        const box = node.getBoundingClientRect(); const matrix = head.getScreenCTM()!;
        return [.20, .45, .70, .95].map(fraction => {
          const point = head.getPointAtLength(head.getTotalLength() * fraction).matrixTransform(matrix);
          return { x: point.x - box.x, y: point.y - box.y };
        });
      });
      await seat.locator('.order-trace').evaluate(node => { (node as SVGElement).style.visibility = 'hidden'; });
      const baseline = await seat.screenshot({ scale: 'css' });
      await seat.locator('.order-trace').evaluate(node => { (node as SVGElement).style.removeProperty('visibility'); });
      for (let frame = 0; frame < 4; frame++) {
        await motion.evaluate((animations, time) => { for (const animation of animations) animation.currentTime = time; }, frame * 2500);
        const image = await seat.screenshot({ path: `test-results/order-trace-${width}-${frame}.png`, scale: 'css' });
        const painted = await page.evaluate(async ({ png, baseline, probes }) => {
          const pixels = async (png: string) => {
            const image = new Image(); image.src = `data:image/png;base64,${png}`; await image.decode();
            const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
            const context = canvas.getContext('2d')!; context.drawImage(image, 0, 0); return context;
          };
          const context = await pixels(png); const original = await pixels(baseline);
          const gain = (point: { x: number; y: number }, size = 5) => {
            const half = Math.floor(size / 2);
            const x = Math.max(0, Math.floor(point.x) - half); const y = Math.max(0, Math.floor(point.y) - half);
            const after = context.getImageData(x, y, size, size).data; const before = original.getImageData(x, y, size, size).data;
            let brighter = 0;
            for (let i = 0; i < after.length; i += 4) brighter += ((after[i]! - before[i]!) + (after[i + 1]! - before[i + 1]!) + (after[i + 2]! - before[i + 2]!)) / 3;
            return brighter / (size * size);
          };
          const inside = probes.map(point => {
            const vertical = Math.min(point.x, context.canvas.width - point.x) < Math.min(point.y, context.canvas.height - point.y);
            return gain({ x: point.x + (vertical ? point.x < context.canvas.width / 2 ? 8 : -8 : 0),
              y: point.y + (!vertical ? point.y < context.canvas.height / 2 ? 8 : -8 : 0) }, 3);
          });
          const profile = [-36, -24, -12, 0, 12, 24, 36].map(offset => gain({ x: probes[0]!.x + offset, y: probes[0]!.y }, 1));
          return { edges: probes.map(point => gain(point) > 15), inside, profile };
        }, { png: image.toString('base64'), baseline: baseline.toString('base64'), probes });
        expect(painted.edges, `The soft glow must visibly move to a different edge at ${frame * 2500}ms (${width}px).`).toEqual(probes.map((_, index) => index === frame));
        expect(painted.inside[frame], 'The card interior must not contain a second bright travelling line.').toBeLessThan(4);
        if (frame === 0) {
          const profile = painted.profile;
          expect(profile[3]!).toBeGreaterThan(profile[2]! + 10);
          expect(profile[2]!).toBeGreaterThan(profile[1]! + 10);
          expect(profile[1]!).toBeGreaterThan(profile[0]! + 4);
          for (let index = 0; index < 3; index++) expect(Math.abs(profile[index]! - profile[6 - index]!)).toBeLessThan(8);
        }
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
  const controls = page.locator('.rotation-seat').nth(1);
  await controls.scrollIntoViewIfNeeded();
  await expect(controls).toBeInViewport({ ratio: 1 });
  const seatBox = (await controls.boundingBox())!;
  expect(seatBox.height).toBeLessThanOrEqual(44);
  for (const action of await controls.getByRole('button').all()) {
    const box = (await action.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(32); expect(box.height).toBeGreaterThanOrEqual(32);
    expect(box.y - seatBox.y).toBeLessThan(5); expect(seatBox.x + seatBox.width - box.x - box.width).toBeLessThan(5);
    expect(box.y + box.height).toBeLessThanOrEqual(seatBox.y + seatBox.height);
    await expect(action).toHaveText(''); await expect(action).toHaveAccessibleName('Remove Listener 1');
  }
  const workspace = await page.locator('.host-page').boundingBox();
  const header = await page.locator('.app-header').boundingBox();
  await controls.focus(); await expect(page.locator('.order-help')).toHaveCSS('clip', 'rect(0px, 0px, 0px, 0px)');
  expect(await page.locator('.host-page').boundingBox()).toEqual(workspace);
  await page.keyboard.press('Space'); await page.keyboard.press('ArrowLeft'); await page.keyboard.press('Enter');
  await expect(page.locator('.rotation-seat strong').first()).toHaveText('Listener 1');
  await expect(page.locator('.rotation-seat').first()).toBeFocused();
  await page.getByRole('button', { name: 'Remove Listener 1', exact: true }).click();
  await expect(page.locator('.rotation-seat')).toHaveCount(19);
  await expect(list).toBeVisible();
  await expect(page.locator('.order-announcement')).toContainText('Their saved music is kept.');
  await expect(page.locator('.order-announcement')).toHaveCSS('clip', 'rect(0px, 0px, 0px, 0px)');
  expect(await page.locator('.app-header').boundingBox()).toEqual(header);
  await expect(page.locator('.order-actions')).toHaveCount(19);
  await expect(page.getByRole('button', { name: /^(Manage people|Done managing)$/ })).toHaveCount(0);
  expect((await page.locator('.order-bar').boundingBox())!.height).toBeLessThanOrEqual(56);
});
