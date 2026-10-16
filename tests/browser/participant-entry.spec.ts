import { randomUUID } from 'node:crypto';
import { expect, type Browser, type Page } from '@playwright/test';
import { test } from './app-fixture';
import type { DemoAdapter } from '../../src/playback';
import { uploadBytes } from '../fixtures/uploads';

async function savedMusic(browser: Browser, origin: string, demo: DemoAdapter, count = 8) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const post = async (path: string, data: unknown) => {
    const response = await context.request.post(origin + path, { headers: { Origin: origin }, data }); expect(response.ok()).toBe(true); return response.json();
  };
  await post('/api/participant/join', { nickname: 'Returning listener' });
  let library = await post('/api/participant/preparations/init', {});
  for (let index = 0; index < count; index++) {
    const track = { id: `demo:entry-${index}`, title: `Saved selection ${index + 1}`, artist: 'A familiar artist', album: 'A favourite album', duration: 60 };
    demo.catalogue.push(track);
    library = (await post('/api/participant/preparations/add', { trackId: track.id, operation: { id: randomUUID(), issuedAt: Date.now(), revision: library.revision } })).view;
  }
  const page = await context.newPage();
  return { page, context, post, library };
}
const noOverflow = async (page: Page) => expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
const visibleRows = (page: Page) => page.locator('.entry-list .saved-tracks[aria-label="Your prepared tracks"] > li').evaluateAll(nodes => nodes.filter(node => getComputedStyle(node).display !== 'none').length);

test('a first visit offers the shared inline join form and optional recovery, without a fake empty workspace or automatic writes', async ({ page }) => {
  const writes: string[] = []; page.on('request', request => { if (request.method() === 'POST') writes.push(new URL(request.url()).pathname); });
  await page.goto('/join'); await expect(page.getByLabel('What should we call you?')).toBeVisible();
  const form = await page.locator('.join-panel > form').innerHTML();
  await page.goto('/participant'); await expect(page.getByRole('heading', { name: 'Join room', exact: true })).toBeVisible();
  expect(await page.locator('.join-panel > form').innerHTML()).toBe(form);
  await expect(page.locator('.brand-subtitle')).toHaveText('My seat');
  await expect(page.locator('.preparation-list, .catalogue-panel, .playback-card')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Upload a track', exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Recover with a private key')).toBeHidden();
  for (const [width, height] of [[1440, 1000], [1000, 800], [390, 844], [320, 700], [390, 440]]) {
    await page.setViewportSize({ width: width!, height: height! }); await noOverflow(page);
    await expect(page.getByRole('button', { name: 'Join room', exact: true })).toBeInViewport();
    if (width === 1440 || width === 390 && height === 844) await page.screenshot({ path: `test-results/participant-entry-fresh-${width}.png`, fullPage: true });
  }
  expect(writes).toEqual([]);
  await page.getByLabel('What should we call you?').fill('New listener');
  await page.getByRole('button', { name: 'Join room', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your turn.', exact: true })).toBeVisible();
  await expect(page).toHaveURL('/participant');
  expect(writes).toEqual(['/api/participant/join']);
});

test('checking valid membership never flashes a join form and failed checks require a read-only retry', async ({ page, isolatedApp }) => {
  const joined = await page.request.post('/api/participant/join', { headers: { Origin: isolatedApp.origin }, data: { nickname: 'Already joined' } }); expect(joined.ok()).toBe(true);
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/participant/state', async route => { await gate; await route.continue(); });
  try {
    await page.goto('/participant'); await expect(page.getByRole('heading', { name: 'Checking your place in the room…' })).toBeVisible();
    await expect(page.getByLabel('What should we call you?')).toHaveCount(0);
    await expect(page.locator('.list-count')).toHaveCount(0);
    release(); await expect(page.getByRole('heading', { name: 'Your turn.', exact: true })).toBeVisible();
  } finally { release(); await page.unroute('**/api/participant/state'); }
  await page.context().clearCookies({ name: 'aoty_participant' });
  let fail = true; const writes: string[] = [];
  page.on('request', request => { if (request.method() === 'POST') writes.push(request.url()); });
  await page.route('**/api/participant/state', async route => {
    if (fail) { fail = false; await route.fulfill({ status: 503, json: { error: 'Room temporarily unavailable.' } }); } else await route.continue();
  });
  await page.reload(); await expect(page.getByRole('heading', { name: 'Can’t reach the room.' })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveText('Room temporarily unavailable.');
  await expect(page.getByLabel('What should we call you?')).toHaveCount(0);
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Join room', exact: true })).toBeVisible(); expect(writes).toEqual([]);
});

test('offline entry retains the nickname and returns to the join form after reconnecting without joining automatically', async ({ page }) => {
  await page.goto('/participant'); const input = page.getByLabel('What should we call you?'); await input.fill('Keep my name');
  await page.context().setOffline(true);
  await expect(page.getByRole('heading', { name: 'You’re offline.' })).toBeVisible(); await expect(page.getByRole('button', { name: 'Retry', exact: true })).toBeDisabled();
  await page.context().setOffline(false); await expect(input).toBeVisible(); await expect(input).toHaveValue('Keep my name');
  await expect(page.locator('.participant-hero')).toHaveCount(0);
});

test('returning visitors get a three-track preview and retain explicit list management without membership or playback controls', async ({ browser, isolatedApp }) => {
  const r = await savedMusic(browser, isolatedApp.origin, isolatedApp.demo);
  try {
    await r.context.clearCookies({ name: 'aoty_participant' }); await r.page.goto(isolatedApp.origin + '/participant');
    await expect(r.page.locator('.list-count')).toHaveText(' · 8');
    await expect(r.page.getByRole('heading', { name: 'Join room', exact: true })).toBeVisible();
    await expect(r.page.getByRole('button', { name: 'Play next prepared track' })).toHaveCount(0);
    await expect(r.page.getByRole('button', { name: 'Upload a track', exact: true })).toHaveCount(0);
    for (const [width, height] of [[1440, 1000], [1000, 800], [390, 844], [320, 700], [390, 440]]) {
      await r.page.setViewportSize({ width: width!, height: height! }); await noOverflow(r.page);
      expect(await visibleRows(r.page)).toBe(3);
      if (width === 1440 || width === 390 && height === 844) await r.page.screenshot({ path: `test-results/participant-entry-saved-${width}.png`, fullPage: true });
    }
    await r.page.getByRole('button', { name: 'View all', exact: true }).click(); expect(await visibleRows(r.page)).toBe(8);
    await r.page.getByRole('button', { name: 'Edit order', exact: true }).click();
    await r.page.getByRole('button', { name: 'Move Saved selection 2 up', exact: true }).click();
    await expect(r.page.locator('.saved-track.is-next strong')).toHaveText('Saved selection 2');
    await r.page.getByRole('button', { name: 'Done', exact: true }).click();
    await r.page.getByRole('button', { name: 'Show less', exact: true }).click(); expect(await visibleRows(r.page)).toBe(3);
    const library = await (await r.page.request.get(isolatedApp.origin + '/api/participant/preparations/state')).json();
    expect(library.ownerId).toBe(r.library.ownerId); expect(library.upcoming[0].title).toBe('Saved selection 2');
  } finally { await r.context.close(); }
});

test('recovering a saved list does not join the room and inline joining retains that same private owner and music', async ({ browser, isolatedApp }) => {
  const r = await savedMusic(browser, isolatedApp.origin, isolatedApp.demo, 2);
  const fresh = await browser.newContext({ viewport: { width: 390, height: 844 } });
  try {
    const key = await r.post('/api/participant/preparations/recovery-key', { revision: r.library.revision });
    const page = await fresh.newPage(); await page.goto(isolatedApp.origin + '/participant');
    await expect(page.getByRole('heading', { name: 'Join room', exact: true })).toBeVisible();
    await page.getByText('Recover a saved list', { exact: true }).click();
    await page.getByLabel('Recover with a private key').fill(key.recoveryKey); await page.getByRole('button', { name: 'Recover my list', exact: true }).click();
    await expect(page.locator('.list-count')).toHaveText(' · 2');
    expect((await page.request.get(isolatedApp.origin + '/api/participant/state')).status()).toBe(401);
    expect(page.url()).not.toContain(key.recoveryKey); expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain(key.recoveryKey);
    await page.getByLabel('What should we call you?').fill('Recovered listener'); await page.getByRole('button', { name: 'Join room', exact: true }).click();
    await expect(page.locator('.participant-hero')).toBeVisible();
    const library = await (await page.request.get(isolatedApp.origin + '/api/participant/preparations/state')).json();
    expect(library.ownerId).toBe(r.library.ownerId); expect(library.upcoming).toHaveLength(2);
    expect((await (await page.request.get(isolatedApp.origin + '/api/participant/state')).json()).ownPlayback).toBeUndefined();
  } finally { await fresh.close(); await r.context.close(); }
});

test('revocation shows one calm entry notice, and saved music survives refresh and explicit rejoining', async ({ browser, page: host, isolatedApp }) => {
  const r = await savedMusic(browser, isolatedApp.origin, isolatedApp.demo, 2);
  try {
    await r.page.goto(isolatedApp.origin + '/participant'); await expect(r.page.locator('.participant-hero')).toBeVisible();
    const state = await (await host.request.get('/api/host/state')).json();
    const removed = await host.request.post('/api/host/remove', { headers: { Origin: isolatedApp.origin }, data: { id: state.current.id, revision: state.revision } }); expect(removed.ok()).toBe(true);
    await expect(r.page.getByRole('heading', { name: 'Join room', exact: true })).toBeVisible();
    await expect(r.page.getByRole('status').filter({ hasText: 'You’re no longer in the listening order.' })).toHaveCount(1);
    await expect(r.page.getByRole('alert')).toHaveCount(0); await expect(r.page.locator('.list-count')).toHaveText(' · 2');
    await r.page.reload(); await expect(r.page.locator('.list-count')).toHaveText(' · 2');
    await r.page.getByLabel('What should we call you?').fill('Back again'); await r.page.getByRole('button', { name: 'Join room', exact: true }).click();
    await expect(r.page.getByRole('heading', { name: 'Your turn.', exact: true })).toBeVisible();
    expect((await (await r.page.request.get(isolatedApp.origin + '/api/participant/preparations/state')).json()).ownerId).toBe(r.library.ownerId);
  } finally { await r.context.close(); }
});

test('an unconfirmed private-list edit stays visible across an unjoined reload and retries only by explicit choice', async ({ browser, isolatedApp }) => {
  const r = await savedMusic(browser, isolatedApp.origin, isolatedApp.demo, 3);
  try {
    await r.context.clearCookies({ name: 'aoty_participant' }); await r.page.goto(isolatedApp.origin + '/participant');
    await r.page.getByRole('button', { name: 'View all', exact: true }).click();
    await r.page.getByRole('button', { name: 'Edit order', exact: true }).click();
    let moves = 0;
    await r.page.route('**/api/participant/preparations/move', async route => { moves++; await route.fetch(); await route.abort('failed'); });
    await r.page.getByRole('button', { name: 'Move Saved selection 2 up', exact: true }).click();
    await expect(r.page.locator('.list-save-status')).toHaveText('Not synced · draft retained');
    await r.page.reload(); await expect(r.page.getByRole('button', { name: 'Retry save', exact: true })).toBeVisible();
    expect(moves).toBe(1); await expect(r.page.getByRole('heading', { name: 'Join room', exact: true })).toBeVisible();
    await r.page.unroute('**/api/participant/preparations/move');
    await r.page.getByRole('button', { name: 'Retry save', exact: true }).click();
    await expect(r.page.locator('.list-save-status')).toHaveText('Private · Saved ✓');
    const library = await (await r.page.request.get(isolatedApp.origin + '/api/participant/preparations/state')).json();
    expect(library.upcoming.map((entry: { title: string }) => entry.title)).toEqual(['Saved selection 2', 'Saved selection 1', 'Saved selection 3']);
    expect((await r.page.request.get(isolatedApp.origin + '/api/participant/state')).status()).toBe(401);
  } finally { await r.context.close(); }
});

test('unfinished uploads remain recoverable before joining, and rejoining does not reupload or lose edited metadata', async ({ page, isolatedApp }) => {
  const joined = await page.request.post('/api/participant/join', { headers: { Origin: isolatedApp.origin }, data: { nickname: 'Upload listener' } }); expect(joined.ok()).toBe(true);
  await page.goto('/participant'); await expect(page.getByRole('button', { name: 'Upload a track', exact: true })).toBeEnabled();
  let uploads = 0; page.on('request', request => { if (request.method() === 'POST' && /\/uploads\/[a-f0-9-]+$/.test(new URL(request.url()).pathname)) uploads++; });
  await page.locator('#track-upload-file').setInputFiles({ name: 'retained.mp3', mimeType: 'audio/mpeg', buffer: uploadBytes });
  await page.getByLabel('Track title', { exact: true }).fill('My edited upload');
  const state = await (await page.request.get('/api/host/state')).json();
  const removed = await page.request.post('/api/host/remove', { headers: { Origin: isolatedApp.origin }, data: { id: state.current.id, revision: state.revision } }); expect(removed.ok()).toBe(true);
  await expect(page.getByRole('heading', { name: 'Join room', exact: true })).toBeVisible();
  await expect(page.getByLabel('Track title', { exact: true })).toHaveValue('My edited upload');
  await page.reload(); await expect(page.getByLabel('Track title', { exact: true })).toHaveValue('My edited upload');
  await expect(page.getByLabel('Track title', { exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Choose another file', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Discard upload draft', exact: true })).toBeEnabled();
  await page.getByLabel('What should we call you?').fill('Upload listener again'); await page.getByRole('button', { name: 'Join room', exact: true }).click();
  await expect(page.getByLabel('Track title', { exact: true })).toBeEnabled(); await expect(page.getByLabel('Track title', { exact: true })).toHaveValue('My edited upload');
  expect(uploads).toBe(1); expect((await (await page.request.get('/api/participant/state')).json()).ownPlayback).toBeNull();
});
