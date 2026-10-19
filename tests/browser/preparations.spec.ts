import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { test } from './app-fixture';
import { showFind, showList } from './preparation-helpers';

async function room(browser: Browser, host: Page, origin: string) {
  const post = (path: string, data: unknown) => host.request.post(path, { data, headers: { Origin: origin } });
  const contexts: BrowserContext[] = [];
  const listeners: Page[] = [];
  for (const nickname of ['First', 'Second']) {
    const context = await browser.newContext({ viewport: { width: 320, height: 740 } }); contexts.push(context);
    // Exercise the same fallback needed on non-secure LAN origins (not just localhost).
    await context.addInitScript(() => Object.defineProperty(Crypto.prototype, 'randomUUID', { value: undefined, configurable: true }));
    const response = await context.request.post(origin + '/api/participant/join', { data: { nickname }, headers: { Origin: origin } }); expect(response.ok()).toBe(true);
    const page = await context.newPage(); await page.goto(origin + '/participant'); listeners.push(page);
    await expect(page.getByRole('searchbox', { name: 'Search catalogue' })).toBeVisible();
  }
  return { first: listeners[0]!, second: listeners[1]!, contexts, post, async close() { for (const context of contexts) await context.close(); } };
}
async function add(page: Page, query: string) {
  await showFind(page); await page.getByRole('searchbox', { name: 'Search catalogue' }).fill(query);
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await page.getByRole('button', { name: 'Add to list', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Added ✓', exact: true })).toBeVisible();
  await expect(page.getByRole('searchbox', { name: 'Search catalogue' })).toHaveValue(query);
}
const titles = (page: Page) => page.locator('.saved-tracks[aria-label="Your prepared tracks"] .saved-track strong');
const state = async (page: Page) => (await page.request.get('/api/participant/preparations/state')).json();

test('the first save reaches an already-open tab without reload, extra writes, or private broadcast data', async ({ page, isolatedApp }) => {
  await page.request.post('/api/participant/join', { data: { nickname: 'Two tabs' }, headers: { Origin: isolatedApp.origin } });
  await page.goto('/participant'); await expect(page.locator('.list-save-status')).toHaveText('Private · saved when you add a song');
  const other = await page.context().newPage();
  try {
    await other.goto(isolatedApp.origin + '/participant'); await expect(other.locator('.list-save-status')).toHaveText('Private · saved when you add a song');
    const writes: string[] = []; other.on('request', request => { if (request.method() === 'POST') writes.push(request.url()); });
    await other.evaluate(() => { (window as any).originalDocument = document; });
    await add(page, 'Northern');
    await expect(other.locator('.list-count')).toHaveText(' · 1');
    await expect(titles(other)).toHaveText(['Northern Lights']);
    await add(page, 'Summer'); await expect(other.locator('.list-count')).toHaveText(' · 2');
    expect(await other.evaluate(() => (window as any).originalDocument === document)).toBe(true);
    expect(writes).toEqual([]);
    const library = await state(page); const storage = await other.evaluate(() => JSON.stringify(localStorage));
    expect(storage).not.toContain(library.ownerId); expect(storage).not.toContain('Northern Lights');
    expect((await (await other.request.get('/api/participant/state')).json()).ownPlayback).toBeNull();
  } finally { await other.close(); }
});

test('compact private lists reorder, restore from history, survive removal/rejoining, recover on another phone, and never autoplay', async ({ browser, page: host, isolatedApp }) => {
  const r = await room(browser, host, isolatedApp.origin); const second = r.second;
  try {
    for (const query of ['Northern', 'Summer', 'Night']) await add(second, query);
    await showList(second); await expect(titles(second)).toHaveText(['Northern Lights', 'Late Summer', 'Night Bus Home']);
    await expect(second.getByRole('button', { name: 'Play next' })).toBeDisabled();
    await second.getByRole('button', { name: 'Edit order', exact: true }).click();
    await second.getByRole('button', { name: 'Move Night Bus Home up', exact: true }).click();
    await expect(titles(second)).toHaveText(['Northern Lights', 'Night Bus Home', 'Late Summer']);
    await expect(second.getByRole('button', { name: 'Move Night Bus Home up', exact: true })).toBeFocused();
    await second.getByRole('button', { name: 'Move Night Bus Home up', exact: true }).press('Enter');
    await expect(titles(second)).toHaveText(['Night Bus Home', 'Northern Lights', 'Late Summer']);
    await expect(second.getByRole('button', { name: 'Drag Night Bus Home to reorder', exact: true })).toBeFocused();
    await second.getByRole('button', { name: 'Done', exact: true }).click();
    await second.getByLabel('Options for Northern Lights', { exact: true }).click();
    await second.locator('.saved-track', { hasText: 'Northern Lights' }).getByRole('button', { name: 'Remove', exact: true }).click();
    await expect(titles(second)).toHaveText(['Night Bus Home', 'Late Summer']);
    await expect(second.locator('.list-save-status')).toHaveText('Private · Saved ✓');
    await expect(second.locator('.preparation-list > .list-notice')).toHaveCount(0);
    await second.locator('#list-history').click();
    await second.locator('#list-history').locator('..').locator('.saved-track', { hasText: 'Northern Lights' }).getByRole('button', { name: 'Add back', exact: true }).click();
    await expect(titles(second)).toHaveText(['Night Bus Home', 'Late Summer', 'Northern Lights']);
    await second.reload(); await showList(second); await expect(titles(second)).toHaveText(['Night Bus Home', 'Late Summer', 'Northern Lights']);
    const overflow = await second.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1); expect(overflow).toBe(false);
    await second.screenshot({ path: 'test-results/participant-durable-list-320.png', fullPage: true });
    expect((await (await r.first.request.get('/api/participant/preparations/state')).json()).code).toBe('missing-library');
    const before = await (await host.request.get('/api/host/state')).json(); await r.post('/api/host/advance', { turnId: before.turnId });
    await expect(second.getByRole('button', { name: 'Play next' })).toBeEnabled();
    expect((await (await second.request.get('/api/participant/state')).json()).ownPlayback).toBeNull();
    await second.getByRole('button', { name: 'Play next' }).click();
    await expect.poll(async () => (await state(second)).played.length).toBe(1);
    await showList(second);
    await expect(titles(second)).toHaveText(['Late Summer', 'Northern Lights']);
    if (!await second.locator('#list-history').evaluate(node => (node.parentElement as HTMLDetailsElement).open)) await second.locator('#list-history').click();
    await expect(second.getByRole('button', { name: 'Add back', exact: true })).toBeVisible();
    await second.locator('#list-recovery').click(); second.once('dialog', dialog => dialog.accept());
    await second.getByRole('button', { name: 'Create recovery key' }).click();
    const key = await second.getByRole('textbox', { name: 'Your private recovery key' }).inputValue(); expect(key.length).toBeGreaterThan(70);
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } }); r.contexts.push(context);
    const phone = await context.newPage(); await phone.goto(isolatedApp.origin + '/participant');
    await phone.locator('#list-recovery').click(); await phone.getByLabel('Recover with a private key').fill(key);
    await phone.getByRole('button', { name: 'Recover list', exact: true }).click();
    await expect.poll(async () => (await state(phone)).ownerId).toBe((await state(second)).ownerId);
    await expect(titles(phone)).toHaveCount(0);
    await expect(phone.getByRole('button', { name: 'Play next' })).toHaveCount(0);
    expect(phone.url()).not.toContain(key); expect(await phone.evaluate(() => JSON.stringify(localStorage))).not.toContain(key);
    const hostState = await (await host.request.get('/api/host/state')).json(); await r.post('/api/host/remove', { id: hostState.current.id, revision: hostState.revision });
    await expect(second.getByRole('heading', { name: 'Join room', exact: true })).toBeVisible();
    await expect(titles(second)).toHaveCount(0);
    await second.goto(isolatedApp.origin + '/join'); await second.getByLabel('Display name').fill('Second again'); await second.getByRole('button', { name: 'Join room', exact: true }).click();
    await expect(second).toHaveURL(/\/participant$/); await expect(titles(second)).toHaveText(['Late Summer', 'Northern Lights']);
    expect((await state(phone)).ownerId).toBe((await state(second)).ownerId);
  } finally { await r.close(); }
});

test('lost save replies retain a reload-safe draft and conflicts require explicit reconciliation without losing additions', async ({ browser, page: host, isolatedApp }) => {
  const r = await room(browser, host, isolatedApp.origin); const page = r.second;
  try {
    let calls = 0;
    await page.route('**/api/participant/preparations/add', async route => { calls++; await route.fetch(); await route.abort('failed'); });
    await page.getByRole('searchbox', { name: 'Search catalogue' }).fill('Northern'); await page.getByRole('button', { name: 'Search', exact: true }).click();
    await page.getByRole('button', { name: 'Add to list' }).click();
    await expect(page.locator('.list-save-status')).toHaveText('Save not confirmed. Your change is kept.');
    expect((await state(page)).upcoming).toHaveLength(1); expect(calls).toBe(1);
    await page.reload(); await showList(page); await expect(page.getByRole('button', { name: 'Retry save', exact: true })).toBeVisible();
    expect(calls).toBe(1); await page.unroute('**/api/participant/preparations/add');
    await page.getByRole('button', { name: 'Retry save', exact: true }).click(); await expect(page.locator('.list-save-status')).toHaveText('Private · Saved ✓');
    expect((await state(page)).upcoming).toHaveLength(1);
    await add(page, 'Summer'); await showList(page); await page.getByRole('button', { name: 'Edit order', exact: true }).click();
    let release!: () => void; let entered!: () => void; const gate = new Promise<void>(resolve => { release = resolve; }); const routed = new Promise<void>(resolve => { entered = resolve; });
    await page.route('**/api/participant/preparations/move', async route => { entered(); await gate; await route.continue(); });
    await page.getByRole('button', { name: 'Move Late Summer up', exact: true }).click(); await routed;
    const before = await state(page);
    await page.request.post('/api/participant/preparations/add', { headers: { Origin: isolatedApp.origin }, data: { trackId: 'demo:night', operation: { id: '1390efbb-f9a9-44bb-a376-fefb8f1d342c', issuedAt: Date.now(), revision: before.revision } } });
    release(); await expect(page.getByRole('button', { name: 'Apply this change', exact: true })).toBeVisible();
    await page.unroute('**/api/participant/preparations/move');
    await page.getByRole('button', { name: 'Apply this change', exact: true }).click();
    await expect(page.locator('.list-save-status')).toHaveText('Private · Saved ✓');
    await expect(titles(page)).toHaveText(['Late Summer', 'Northern Lights', 'Night Bus Home']);
  } finally { await r.close(); }
});

test('Play next keeps optimistic controls responsive while its list bookkeeping reply is delayed', async ({ browser, page: host, isolatedApp }) => {
  const r = await room(browser, host, isolatedApp.origin); const page = r.first;
  let release = () => {};
  try {
    await add(page, 'Northern'); await add(page, 'Summer'); await showList(page);
    let entered!: () => void; const gate = new Promise<void>(resolve => { release = resolve; }); const routed = new Promise<void>(resolve => { entered = resolve; });
    let plays = 0;
    await page.route('**/api/participant/preparations/play', async route => { plays++; const response = await route.fetch(); entered(); await gate; await route.fulfill({ response }); });
    await page.getByRole('button', { name: 'Play next' }).click(); await routed;
    await expect(page.locator('.player-pending')).toBeVisible();
    await page.getByRole('button', { name: 'Pause', exact: true }).click(); await page.getByRole('button', { name: 'Reveal song', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Resume', exact: true })).toBeVisible();
    release(); await expect(page.locator('.player-pending')).toHaveCount(0);
    await expect.poll(async () => (await (await page.request.get('/api/participant/state')).json()).ownPlayback.status).toBe('paused');
    const saved = await state(page); expect(saved.upcoming).toHaveLength(1); expect(saved.played).toHaveLength(1); expect(plays).toBe(1);
    await showList(page);
    await expect(titles(page)).toHaveText(['Late Summer']);
  } finally { release(); await r.close(); }
});
