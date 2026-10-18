import { expect } from '@playwright/test';
import { test } from './app-fixture';

test('every application route has one matching live listening order directly under the header bar', async ({ page, browser, isolatedApp }) => {
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
        expect(order.height).toBeLessThanOrEqual(104);
        await expect(current.locator('.listening-order details, .listening-order summary')).toHaveCount(0);
        await expect(current.locator('.rotation-list')).toBeVisible();
        await expect(current.locator('.rotation-seat').first()).toBeInViewport();
        const seat = current.locator('.rotation-seat').first();
        const avatar = (await seat.locator('.avatar').boundingBox())!;
        const name = (await seat.locator('strong').boundingBox())!;
        expect(avatar.x + avatar.width).toBeLessThanOrEqual(name.x);
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
    for (const current of pages.slice(0, -1)) await expect(current.locator('.rotation-seat.is-you')).toHaveCount(0);
    const state = isolatedApp.engine.view({ kind: 'participant', credential: first });
    await isolatedApp.engine.advance(state.turnId!, first);
    for (const current of pages) await expect(current.locator('.rotation-seat.is-current strong')).toHaveText('Second');
    await guest.setOffline(true);
    for (const current of pages.slice(1, -1)) await expect(current.locator('.order-status')).toHaveText('Offline');
    await guest.setOffline(false);
    for (const current of pages.slice(1, -1)) await expect(current.locator('.order-status')).toBeEmpty();
  } finally { await guest.close(); await member.close(); }
});

test('order feed exposes only names and placement even after a track is revealed', async ({ isolatedApp }) => {
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
    expect(Object.keys(snapshot).sort()).toEqual(['current', 'next', 'revision', 'roomId', 'rotation']);
    expect(snapshot.rotation).toEqual([{ id: view.me!.id, nickname: 'Listener' }]);
    expect(Object.keys(snapshot.current).sort()).toEqual(['id', 'nickname']);
    expect(frame).not.toContain('Northern Lights'); expect(frame).not.toContain(credential);
  } finally { controller.abort(); }
});

test('the visible bar preserves focus and horizontal scroll through updates and keeps host management in the shared list', async ({ page, isolatedApp }) => {
  for (let index = 0; index < 20; index++) await isolatedApp.engine.join(`Listener ${index}`);
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/host');
  await expect(page.locator('.rotation-seat')).toHaveCount(20);
  const list = page.locator('.rotation-list'); await list.focus();
  await list.evaluate(node => { node.scrollLeft = 400; (window as any).orderList = node; (window as any).firstSeat = node.firstElementChild; });
  isolatedApp.engine.emit('change');
  await expect(list).toBeFocused(); await expect(list).toHaveJSProperty('scrollLeft', 400);
  expect(await list.evaluate(node => node === (window as any).orderList && node.firstElementChild === (window as any).firstSeat)).toBe(true);
  await page.getByRole('button', { name: 'Manage people' }).click();
  await page.getByRole('button', { name: 'Move Listener 1 up', exact: true }).click();
  await expect(page.locator('.rotation-seat strong').first()).toHaveText('Listener 1');
  await page.getByRole('button', { name: 'Remove Listener 1', exact: true }).click();
  await expect(page.locator('.rotation-seat')).toHaveCount(19);
  await expect(list).toBeVisible();
  await expect(page.locator('.order-feedback')).toContainText('Their saved music is kept.');
});
