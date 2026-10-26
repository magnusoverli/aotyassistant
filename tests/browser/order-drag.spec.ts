import { expect, type Page, type Locator } from '@playwright/test';
import { test } from './app-fixture';

const seat = (page: Page, name: string) => page.locator('.rotation-list .rotation-seat').filter({ has: page.locator('strong', { hasText: new RegExp(`^${name}$`) }) });
const names = (page: Page) => page.locator('.rotation-list .rotation-seat strong');
async function pickUp(page: Page, source: Locator) {
  await expect(source).toHaveAttribute('aria-disabled', 'false');
  // A cancelled preview can still be sliding home; aim at the card once its rollback settles.
  await expect.poll(() => source.evaluate(node => node.getAnimations().every(animation => animation.playState === 'finished'))).toBe(true);
  const box = (await source.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + 18); await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 12, box.y + 18, { steps: 3 });
}
async function movePast(page: Page, target: Locator, after = true) {
  const box = (await target.boundingBox())!;
  await page.mouse.move(box.x + (after ? box.width - 10 : 10), box.y + 18, { steps: 8 });
}

test('host cards are immediately draggable and save a single insertion while preserving playback and keyboard focus', async ({ page, isolatedApp }) => {
  const first = await isolatedApp.engine.join('First');
  for (const name of ['Second', 'Third', 'Fourth']) await isolatedApp.engine.join(name);
  const turn = isolatedApp.engine.view({ kind: 'host' }).turnId!;
  await isolatedApp.engine.play(first, turn, null, 'demo:night');
  const before = isolatedApp.engine.view({ kind: 'host' });
  const writes: unknown[] = []; page.on('request', request => { if (request.url().endsWith('/api/host/reorder')) writes.push(request.postDataJSON()); });
  await page.setViewportSize({ width: 1440, height: 900 }); await page.goto('/host');
  await expect(page.getByRole('button', { name: /^(Manage people|Done managing)$/ })).toHaveCount(0);
  await expect(page.locator('.order-remove')).toHaveCount(4); await expect(seat(page, 'Second').getByRole('button')).toBeEnabled();
  expect((await seat(page, 'First').boundingBox())!.height).toBeLessThanOrEqual(64);
  await expect(page.getByRole('button', { name: /^Move .+ (up|down)$/ })).toHaveCount(0);
  const secondBox = (await seat(page, 'Second').boundingBox())!; const fourthBox = (await seat(page, 'Fourth').boundingBox())!;
  const header = await page.locator('.app-header').boundingBox();
  await pickUp(page, seat(page, 'Second')); await movePast(page, seat(page, 'Fourth'));
  await expect(page.locator('.order-drag-preview')).toBeVisible();
  expect(await page.locator('.app-header').boundingBox()).toEqual(header);
  await expect.poll(async () => (await seat(page, 'Third').boundingBox())!.x).toBeCloseTo(secondBox.x, 0);
  expect((await seat(page, 'Second').boundingBox())!.x).toBeCloseTo(fourthBox.x, 0);
  expect(writes).toHaveLength(0); await expect(names(page)).toHaveText(['First', 'Second', 'Third', 'Fourth']);
  await expect(page.locator('.order-announcement')).toHaveText('Second: position 4 of 4. Drop to save the order.');
  await expect(page.locator('.seat-number')).toHaveCount(0);
  isolatedApp.engine.emit('change', 'playback');
  await expect(seat(page, 'Second')).toHaveClass(/is-dragging/);
  await page.screenshot({ path: 'test-results/order-drag-desktop.png' }); await page.mouse.up();
  await expect(names(page)).toHaveText(['First', 'Third', 'Fourth', 'Second']);
  await expect(page.locator('.seat-number')).toHaveCount(0);
  expect((await seat(page, 'Second').boundingBox())!.x).toBeCloseTo(fourthBox.x, 0);
  expect(writes).toEqual([{ ids: [before.rotation![0]!.id, before.rotation![2]!.id, before.rotation![3]!.id, before.rotation![1]!.id], revision: before.revision }]);
  await expect(seat(page, 'Second')).toBeFocused(); await expect(page.locator('.order-drag-preview, .rotation-seat.is-dragging')).toHaveCount(0);
  // Moving the current listener changes placement, not the turn or song.
  await pickUp(page, seat(page, 'First')); await movePast(page, seat(page, 'Fourth')); await page.mouse.up();
  await expect(names(page)).toHaveText(['Third', 'Fourth', 'First', 'Second']);
  const after = isolatedApp.engine.view({ kind: 'host' });
  expect(after.current).toEqual(before.current); expect(after.turnId).toBe(before.turnId); expect(after.hostPlayback).toEqual(before.hostPlayback);
  await seat(page, 'Second').focus(); await page.keyboard.press('Space'); await page.keyboard.press('Home'); await page.keyboard.press('Enter');
  await expect(names(page)).toHaveText(['Second', 'Third', 'Fourth', 'First']); await expect(seat(page, 'Second')).toBeFocused();
  await expect(page.locator('.order-announcement')).toHaveText('Moved Second to position 1.'); expect(writes).toHaveLength(3);
  expect(await page.locator('.app-header').boundingBox()).toEqual(header);
  await expect(page.locator('.order-announcement')).toHaveCSS('clip', 'rect(0px, 0px, 0px, 0px)');
});

test('neighbours visibly slide aside, stay stable under a still pointer and flow back on reversal or cancellation', async ({ page, isolatedApp }) => {
  for (const name of ['First', 'Second', 'Third']) await isolatedApp.engine.join(name);
  await page.setViewportSize({ width: 1440, height: 900 }); await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/host');
  const first = seat(page, 'First'); const second = seat(page, 'Second'); const third = seat(page, 'Third');
  const origin = (await first.boundingBox())!; const middle = (await second.boundingBox())!; const end = (await third.boundingBox())!;
  let writes = 0; page.on('request', request => { if (request.url().endsWith('/api/host/reorder')) writes++; });
  await pickUp(page, first); await page.mouse.move(middle.x + middle.width / 2, middle.y + 18);
  const motion = await second.evaluateHandle(async node => {
    const animation = node.getAnimations()[0]!; animation.pause(); await animation.ready; return animation;
  });
  try {
    await motion.evaluate(animation => { animation.currentTime = 0; });
    expect((await second.boundingBox())!.x).toBeCloseTo(middle.x, 0);
    await motion.evaluate(animation => { animation.currentTime = Number(animation.effect!.getTiming().duration) / 2; });
    const halfway = (await second.boundingBox())!.x;
    expect(halfway).toBeGreaterThan(origin.x + 1); expect(halfway).toBeLessThan(middle.x - 1);
    await page.screenshot({ path: 'test-results/order-flow-mid-animation.png' });
    await motion.evaluate(animation => animation.finish());
    await expect.poll(async () => (await second.boundingBox())!.x).toBeCloseTo(origin.x, 0);
    const steady = await first.evaluate(async node => {
      const positions: number[] = [];
      for (let frame = 0; frame < 16; frame++) { await new Promise(requestAnimationFrame); positions.push(node.getBoundingClientRect().x); }
      return positions;
    });
    expect(steady.every(x => Math.abs(x - middle.x) < 1)).toBe(true);
    await page.mouse.move(origin.x + origin.width / 2, origin.y + 18);
    await expect.poll(async () => (await second.boundingBox())!.x).toBeCloseTo(middle.x, 0);
    await page.mouse.move(end.x + end.width / 2, end.y + 18);
    await expect.poll(async () => (await third.boundingBox())!.x).toBeCloseTo(middle.x, 0);
    await page.keyboard.press('Escape'); await page.mouse.up();
    await expect.poll(async () => (await third.boundingBox())!.x).toBeCloseTo(end.x, 0);
    await expect(names(page)).toHaveText(['First', 'Second', 'Third']); expect(writes).toBe(0);
    await expect(page.locator('.order-announcement')).toHaveText('Reordering cancelled.');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await first.focus(); await page.keyboard.press('Space'); await page.keyboard.press('End');
    expect((await second.boundingBox())!.x).toBeCloseTo(origin.x, 0);
    expect(await page.locator('.rotation-list .rotation-seat').evaluateAll(nodes => nodes.every(node => !node.getAnimations().length))).toBe(true);
    await page.keyboard.press('Escape'); expect((await first.boundingBox())!.x).toBeCloseTo(origin.x, 0); expect(writes).toBe(0);
    await pickUp(page, first); await page.mouse.move(end.x + end.width / 2, end.y + 18);
    await page.setViewportSize({ width: 320, height: 700 }); await page.mouse.up();
    await expect(page.locator('.order-drag-preview, .rotation-seat.is-dragging')).toHaveCount(0);
    expect(await first.evaluate(node => (node as HTMLElement).style.transform)).toBe(''); expect(writes).toBe(0);
  } finally { await motion.dispose(); }
});

test('cancelled, unchanged, stale and disconnected drags never write an order', async ({ page, isolatedApp }) => {
  for (const name of ['First', 'Second', 'Third']) await isolatedApp.engine.join(name);
  const writes: string[] = []; page.on('request', request => { if (request.method() === 'POST') writes.push(request.url()); });
  await page.goto('/host');
  await pickUp(page, seat(page, 'First')); await page.mouse.up();
  await expect(page.locator('.order-announcement')).toHaveText('Listening order unchanged.');
  await pickUp(page, seat(page, 'First')); await movePast(page, seat(page, 'Third')); await page.keyboard.press('Escape'); await page.mouse.up();
  await expect(page.locator('.order-drag-preview, .rotation-seat.is-dragging')).toHaveCount(0);
  await pickUp(page, seat(page, 'First')); await page.mouse.move(10, 700); await page.mouse.up();
  await seat(page, 'First').focus(); await page.keyboard.press('Space'); await page.keyboard.press('End'); await page.keyboard.press('Escape');
  await page.keyboard.press('Space'); await page.keyboard.press('ArrowRight'); await page.keyboard.press('Tab');
  await expect(page.locator('.is-keyboard-dragging')).toHaveCount(0);
  await pickUp(page, seat(page, 'First')); await movePast(page, seat(page, 'Third'));
  await isolatedApp.engine.join('Fourth'); await expect(names(page)).toHaveText(['First', 'Second', 'Third', 'Fourth']);
  await expect(page.locator('.order-drag-preview, .rotation-seat.is-dragging')).toHaveCount(0); await page.mouse.up();
  await expect(page.locator('.order-announcement')).toContainText('The room changed');
  await pickUp(page, seat(page, 'First')); await movePast(page, seat(page, 'Third')); await page.context().setOffline(true);
  await expect(page.locator('.order-status')).toHaveText('Offline'); await expect(page.locator('.order-drag-preview')).toHaveCount(0); await page.mouse.up();
  await expect(seat(page, 'First')).toHaveAttribute('aria-disabled', 'true');
  await page.context().setOffline(false); await expect(seat(page, 'First')).toHaveAttribute('aria-disabled', 'false');
  await seat(page, 'First').focus(); await page.keyboard.press('Space'); await page.keyboard.press('ArrowRight');
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await expect(page.locator('.is-dragging, .is-keyboard-dragging')).toHaveCount(0);
  expect(await page.locator('.rotation-list .rotation-seat').evaluateAll(nodes => nodes.every(node => !(node as HTMLElement).style.transform))).toBe(true);
  expect(writes).toEqual([]);
});

test('pointer gestures over trash icons cannot remove a participant, while deliberate mouse and keyboard removal still work', async ({ page, isolatedApp }) => {
  for (const name of ['First', 'Second', 'Third']) await isolatedApp.engine.join(name);
  const writes: string[] = []; page.on('request', request => { if (request.method() === 'POST') writes.push(request.url()); });
  await page.goto('/host');
  const remove = seat(page, 'Third').getByRole('button', { name: 'Remove Third', exact: true });
  const box = (await remove.boundingBox())!; const x = box.x + box.width / 2; const y = box.y + box.height / 2;
  await page.mouse.move(x, y); await page.mouse.down();
  await page.mouse.move(x + 70, y, { steps: 3 }); await page.mouse.move(x, y, { steps: 3 }); await page.mouse.up();
  await expect(names(page)).toHaveText(['First', 'Second', 'Third']); expect(writes).toEqual([]);
  await pickUp(page, seat(page, 'First')); await movePast(page, seat(page, 'Third')); await page.keyboard.press('Escape');
  await expect.poll(() => seat(page, 'Third').evaluate(node => node.getAnimations().length)).toBe(0);
  await page.mouse.move(x, y); await page.mouse.up();
  await expect(names(page)).toHaveText(['First', 'Second', 'Third']); expect(writes).toEqual([]);
  await remove.click(); await expect(names(page)).toHaveText(['First', 'Second']);
  const second = seat(page, 'Second').getByRole('button', { name: 'Remove Second', exact: true });
  await second.focus(); await page.keyboard.press('Enter'); await expect(names(page)).toHaveText(['First']); expect(writes).toHaveLength(2);
});

test('pending and failed drops keep the authoritative order, block repeats and reconcile without retrying', async ({ page, isolatedApp }) => {
  for (const name of ['First', 'Second', 'Third']) await isolatedApp.engine.join(name);
  await page.goto('/host');
  const firstBox = (await seat(page, 'First').boundingBox())!; const lastBox = (await seat(page, 'Third').boundingBox())!;
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; }); let writes = 0;
  await page.route('**/api/host/reorder', async route => {
    writes++; await gate;
    await route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'The room changed. Refresh your view and try again.' }) });
  });
  try {
    await seat(page, 'First').focus(); await page.keyboard.press('Space'); await page.keyboard.press('End'); await page.keyboard.press('Enter');
    await expect(page.locator('.order-announcement')).toHaveText('Saving First at position 3…');
    await expect(seat(page, 'First')).toHaveAttribute('aria-disabled', 'true');
    await page.keyboard.press('Space'); await page.keyboard.press('End'); await page.keyboard.press('Enter');
    await expect(names(page)).toHaveText(['First', 'Second', 'Third']);
    await expect.poll(async () => (await seat(page, 'First').boundingBox())!.x).toBeCloseTo(lastBox.x, 0);
    release(); await expect(page.getByRole('alert')).toContainText('The room changed');
    await expect(page.locator('.order-announcement')).toContainText('Order could not be confirmed');
    await expect(seat(page, 'First')).toHaveAttribute('aria-disabled', 'false'); expect(writes).toBe(1);
    await expect(names(page)).toHaveText(['First', 'Second', 'Third']);
    await expect.poll(async () => (await seat(page, 'First').boundingBox())!.x).toBeCloseTo(firstBox.x, 0);
    await page.unroute('**/api/host/reorder');
    await page.keyboard.press('Space'); await page.keyboard.press('ArrowRight'); await page.keyboard.press('Enter');
    await expect(names(page)).toHaveText(['Second', 'First', 'Third']);
  } finally { release(); }
});

test('mobile host reordering translates a turn-first view back to the saved order without changing the current turn', async ({ page, isolatedApp }) => {
  for (const name of ['First', 'Second', 'Third', 'Fourth', 'Fifth']) await isolatedApp.engine.join(name);
  for (let index = 0; index < 2; index++) await isolatedApp.engine.advance(isolatedApp.engine.view({ kind: 'host' }).turnId!);
  const before = isolatedApp.engine.view({ kind: 'host' });
  const writes: unknown[] = []; page.on('request', request => { if (request.url().endsWith('/api/host/reorder')) writes.push(request.postDataJSON()); });
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/host');
  await expect(names(page)).toHaveText(['Third', 'Fourth', 'Fifth', 'First', 'Second']);
  const fifth = seat(page, 'Fifth'); await fifth.scrollIntoViewIfNeeded(); await fifth.focus();
  await page.keyboard.press('Space'); await page.keyboard.press('ArrowRight'); await page.keyboard.press('Enter');
  await expect(names(page)).toHaveText(['Third', 'Fourth', 'First', 'Fifth', 'Second']);
  await expect(fifth).toBeFocused(); expect(writes).toHaveLength(1);
  const after = isolatedApp.engine.view({ kind: 'host' });
  expect(after.rotation!.map(person => person.nickname)).toEqual(['First', 'Fifth', 'Second', 'Third', 'Fourth']);
  expect(after.current).toEqual(before.current); expect(after.turnId).toBe(before.turnId); expect(after.hostPlayback).toEqual(before.hostPlayback);
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(names(page)).toHaveText(['First', 'Fifth', 'Second', 'Third', 'Fourth']);
  expect(writes).toHaveLength(1);
});

test('touch dragging scrolls a long mobile order at its edge and Remove stays a separate action', async ({ browser, isolatedApp }) => {
  for (let index = 1; index <= 8; index++) await isolatedApp.engine.join(`Person ${index}`);
  const context = await browser.newContext({ baseURL: isolatedApp.origin, viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await context.newPage(); const touch = await context.newCDPSession(page);
  let writes = 0; page.on('request', request => { if (request.url().endsWith('/api/host/reorder')) writes++; });
  try {
    await page.goto('/host'); await expect(seat(page, 'Person 1').getByRole('button')).toBeEnabled();
    const list = page.locator('.rotation-list'); const box = (await list.boundingBox())!; const source = (await seat(page, 'Person 1').boundingBox())!;
    const x = source.x + source.width / 2; const y = source.y + 18;
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + 20, y }] });
    await expect(page.locator('.order-drag-preview')).toBeVisible();
    await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: box.x + box.width - 5, y }] });
    await expect.poll(() => list.evaluate(node => node.scrollLeft)).toBeGreaterThan(50);
    await page.screenshot({ path: 'test-results/order-drag-touch-390.png' });
    await expect.poll(() => list.evaluate(node => node.scrollWidth - node.clientWidth - node.scrollLeft)).toBeLessThan(2);
    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect(names(page)).toHaveText(['Person 1', 'Person 2', 'Person 3', 'Person 4', 'Person 5', 'Person 6', 'Person 7', 'Person 8']);
    expect(isolatedApp.engine.view({ kind: 'host' }).rotation!.map(person => person.nickname)).toEqual(['Person 2', 'Person 3', 'Person 4', 'Person 5', 'Person 6', 'Person 7', 'Person 8', 'Person 1']);
    expect(writes).toBe(1); await expect(page.locator('.order-drag-preview, .rotation-seat.is-dragging')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await seat(page, 'Person 8').getByRole('button', { name: 'Remove Person 8', exact: true }).tap();
    await expect(names(page)).toHaveCount(7); expect(writes).toBe(1);
    await page.setViewportSize({ width: 320, height: 700 });
    await page.screenshot({ path: 'test-results/order-manage-320.png', fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally { await context.close(); }
});
