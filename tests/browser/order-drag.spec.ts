import { expect, type Page, type Locator } from '@playwright/test';
import { test } from './app-fixture';

const seat = (page: Page, name: string) => page.locator('.rotation-list .rotation-seat').filter({ has: page.locator('strong', { hasText: new RegExp(`^${name}$`) }) });
const names = (page: Page) => page.locator('.rotation-list .rotation-seat strong');
async function pickUp(page: Page, source: Locator) {
  const box = (await source.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + 18); await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 12, box.y + 18, { steps: 3 });
}
async function movePast(page: Page, target: Locator, after = true) {
  const box = (await target.boundingBox())!;
  await page.mouse.move(box.x + (after ? box.width - 10 : 10), box.y + 18, { steps: 8 });
}

test('whole-card dragging saves a single insertion and preserves current playback and keyboard focus', async ({ page, isolatedApp }) => {
  const first = await isolatedApp.engine.join('First');
  for (const name of ['Second', 'Third', 'Fourth']) await isolatedApp.engine.join(name);
  const turn = isolatedApp.engine.view({ kind: 'host' }).turnId!;
  await isolatedApp.engine.play(first, turn, null, 'demo:night');
  const before = isolatedApp.engine.view({ kind: 'host' });
  const writes: unknown[] = []; page.on('request', request => { if (request.url().endsWith('/api/host/reorder')) writes.push(request.postDataJSON()); });
  await page.setViewportSize({ width: 1440, height: 900 }); await page.goto('/host');
  await pickUp(page, seat(page, 'Second')); await movePast(page, seat(page, 'Fourth')); await page.mouse.up();
  expect(writes).toHaveLength(0); await expect(page.locator('.order-drag-preview')).toHaveCount(0);
  await page.getByRole('button', { name: 'Manage people', exact: true }).click();
  await expect(page.getByRole('button', { name: /^Move .+ (up|down)$/ })).toHaveCount(0);
  await pickUp(page, seat(page, 'Second')); await movePast(page, seat(page, 'Fourth'));
  await expect(page.locator('.order-drop-marker')).toBeVisible(); await expect(page.locator('.order-drag-preview')).toBeVisible();
  expect(writes).toHaveLength(0); await expect(names(page)).toHaveText(['First', 'Second', 'Third', 'Fourth']);
  isolatedApp.engine.emit('change', 'playback');
  await expect(seat(page, 'Second')).toHaveClass(/is-dragging/);
  await page.screenshot({ path: 'test-results/order-drag-desktop.png' }); await page.mouse.up();
  await expect(names(page)).toHaveText(['First', 'Third', 'Fourth', 'Second']);
  expect(writes).toEqual([{ ids: [before.rotation![0]!.id, before.rotation![2]!.id, before.rotation![3]!.id, before.rotation![1]!.id], revision: before.revision }]);
  await expect(seat(page, 'Second')).toBeFocused(); await expect(page.locator('.order-drag-preview, .order-drop-marker')).toHaveCount(0);
  // Moving the current listener changes placement, not the turn or song.
  await pickUp(page, seat(page, 'First')); await movePast(page, seat(page, 'Fourth')); await page.mouse.up();
  await expect(names(page)).toHaveText(['Third', 'Fourth', 'First', 'Second']);
  const after = isolatedApp.engine.view({ kind: 'host' });
  expect(after.current).toEqual(before.current); expect(after.turnId).toBe(before.turnId); expect(after.hostPlayback).toEqual(before.hostPlayback);
  await seat(page, 'Second').focus(); await page.keyboard.press('Space'); await page.keyboard.press('Home'); await page.keyboard.press('Enter');
  await expect(names(page)).toHaveText(['Second', 'Third', 'Fourth', 'First']); await expect(seat(page, 'Second')).toBeFocused();
  await expect(page.locator('.order-feedback')).toHaveText('Moved Second to position 1.'); expect(writes).toHaveLength(3);
});

test('cancelled, unchanged, stale and disconnected drags never write an order', async ({ page, isolatedApp }) => {
  for (const name of ['First', 'Second', 'Third']) await isolatedApp.engine.join(name);
  const writes: string[] = []; page.on('request', request => { if (request.method() === 'POST') writes.push(request.url()); });
  await page.goto('/host'); await page.getByRole('button', { name: 'Manage people', exact: true }).click();
  await pickUp(page, seat(page, 'First')); await page.mouse.up();
  await expect(page.locator('.order-feedback')).toHaveText('Listening order unchanged.');
  await pickUp(page, seat(page, 'First')); await movePast(page, seat(page, 'Third')); await page.keyboard.press('Escape'); await page.mouse.up();
  await expect(page.locator('.order-drag-preview, .order-drop-marker')).toHaveCount(0);
  await pickUp(page, seat(page, 'First')); await page.mouse.move(10, 700); await page.mouse.up();
  await seat(page, 'First').focus(); await page.keyboard.press('Space'); await page.keyboard.press('End'); await page.keyboard.press('Escape');
  await page.keyboard.press('Space'); await page.keyboard.press('ArrowRight'); await page.keyboard.press('Tab');
  await expect(page.locator('.is-keyboard-dragging')).toHaveCount(0);
  await pickUp(page, seat(page, 'First')); await movePast(page, seat(page, 'Third'));
  await isolatedApp.engine.join('Fourth'); await expect(names(page)).toHaveText(['First', 'Second', 'Third', 'Fourth']);
  await expect(page.locator('.order-drag-preview, .order-drop-marker')).toHaveCount(0); await page.mouse.up();
  await expect(page.locator('.order-feedback')).toContainText('The room changed');
  await pickUp(page, seat(page, 'First')); await movePast(page, seat(page, 'Third')); await page.context().setOffline(true);
  await expect(page.locator('.order-status')).toHaveText('Offline'); await expect(page.locator('.order-drag-preview')).toHaveCount(0); await page.mouse.up();
  await expect(seat(page, 'First')).toHaveAttribute('aria-disabled', 'true');
  await page.context().setOffline(false); await expect(seat(page, 'First')).toHaveAttribute('aria-disabled', 'false');
  await seat(page, 'First').focus(); await page.keyboard.press('Space'); await page.keyboard.press('ArrowRight');
  await page.getByRole('button', { name: 'Done managing', exact: true }).click();
  await expect(page.locator('.order-drop-marker, .is-keyboard-dragging')).toHaveCount(0);
  expect(writes).toEqual([]);
});

test('pending and failed drops keep the authoritative order, block repeats and reconcile without retrying', async ({ page, isolatedApp }) => {
  for (const name of ['First', 'Second', 'Third']) await isolatedApp.engine.join(name);
  await page.goto('/host'); await page.getByRole('button', { name: 'Manage people', exact: true }).click();
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; }); let writes = 0;
  await page.route('**/api/host/reorder', async route => {
    writes++; await gate;
    await route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'The room changed. Refresh your view and try again.' }) });
  });
  try {
    await seat(page, 'First').focus(); await page.keyboard.press('Space'); await page.keyboard.press('End'); await page.keyboard.press('Enter');
    await expect(page.locator('.order-feedback')).toHaveText('Saving First at position 3…');
    await expect(seat(page, 'First')).toHaveAttribute('aria-disabled', 'true');
    await page.keyboard.press('Space'); await page.keyboard.press('End'); await page.keyboard.press('Enter');
    await expect(names(page)).toHaveText(['First', 'Second', 'Third']);
    release(); await expect(page.getByRole('alert')).toContainText('The room changed');
    await expect(page.locator('.order-feedback')).toContainText('Order could not be confirmed');
    await expect(seat(page, 'First')).toHaveAttribute('aria-disabled', 'false'); expect(writes).toBe(1);
    await expect(names(page)).toHaveText(['First', 'Second', 'Third']);
    await page.unroute('**/api/host/reorder');
    await page.keyboard.press('Space'); await page.keyboard.press('ArrowRight'); await page.keyboard.press('Enter');
    await expect(names(page)).toHaveText(['Second', 'First', 'Third']);
  } finally { release(); }
});

test('touch dragging scrolls a long mobile order at its edge and Remove stays a separate action', async ({ browser, isolatedApp }) => {
  for (let index = 1; index <= 8; index++) await isolatedApp.engine.join(`Person ${index}`);
  const context = await browser.newContext({ baseURL: isolatedApp.origin, viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await context.newPage(); const touch = await context.newCDPSession(page);
  let writes = 0; page.on('request', request => { if (request.url().endsWith('/api/host/reorder')) writes++; });
  try {
    await page.goto('/host'); await page.getByRole('button', { name: 'Manage people', exact: true }).tap();
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
    await expect(names(page)).toHaveText(['Person 2', 'Person 3', 'Person 4', 'Person 5', 'Person 6', 'Person 7', 'Person 8', 'Person 1']);
    expect(writes).toBe(1); await expect(page.locator('.order-drag-preview, .order-drop-marker')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await seat(page, 'Person 8').getByRole('button', { name: 'Remove Person 8', exact: true }).tap();
    await expect(names(page)).toHaveCount(7); expect(writes).toBe(1);
    await page.setViewportSize({ width: 320, height: 700 });
    await page.screenshot({ path: 'test-results/order-manage-320.png', fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally { await context.close(); }
});
