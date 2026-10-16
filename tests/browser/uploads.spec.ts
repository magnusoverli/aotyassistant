import { expect, type Browser, type Page } from '@playwright/test';
import { test } from './app-fixture';
import { uploadBytes } from '../fixtures/uploads';
import { showList } from './preparation-helpers';

async function room(browser: Browser, host: Page, origin: string) {
  const post = (path: string, data: unknown) => host.request.post(path, { data, headers: { Origin: origin } });
  const context = await browser.newContext({ viewport: { width: 320, height: 740 } });
  const joined = await context.request.post(origin + '/api/participant/join', { data: { nickname: 'Upload listener' }, headers: { Origin: origin } });
  expect(joined.ok()).toBe(true);
  const page = await context.newPage(); await page.goto(origin + '/participant');
  await expect(page.getByRole('button', { name: 'Upload a track', exact: true })).toBeEnabled();
  return { page, context, post };
}
const selectFile = (page: Page, name = 'local-song.mp3') => page.locator('#track-upload-file').setInputFiles({ name, mimeType: 'audio/mpeg', buffer: uploadBytes });
const list = async (page: Page) => (await page.request.get('/api/participant/preparations/state')).json();

test('file selection reserves the upload lane while private-list initialization is pending', async ({ browser, page: host, isolatedApp }) => {
  const r = await room(browser, host, isolatedApp.origin); const page = r.page;
  let release = () => {};
  try {
    let enter!: () => void; const entered = new Promise<void>(resolve => { enter = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; }); let uploads = 0;
    await page.route('**/api/participant/preparations/init', async route => { enter(); await gate; await route.continue(); });
    page.on('request', request => { if (request.method() === 'POST' && /\/uploads\/[a-f0-9-]{36}$/.test(request.url())) uploads++; });
    await selectFile(page, 'first.mp3'); await entered;
    await selectFile(page, 'overlapping.mp3'); release();
    await expect(page.getByLabel('Track title', { exact: true })).toHaveValue('Uploaded song');
    await expect(page.locator('.upload-preview')).toContainText('first.mp3');
    expect(uploads).toBe(1);
  } finally { release(); await r.context.close(); }
});

test('cancelling during private-list initialization prevents a delayed upload and permits a fresh selection', async ({ browser, page: host, isolatedApp }) => {
  const r = await room(browser, host, isolatedApp.origin); const page = r.page;
  let release = () => {};
  try {
    let enter!: () => void; const entered = new Promise<void>(resolve => { enter = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; }); let uploads = 0;
    await page.route('**/api/participant/preparations/init', async route => { enter(); await gate; await route.continue(); });
    page.on('request', request => { if (request.method() === 'POST' && /\/uploads\/[a-f0-9-]{36}$/.test(request.url())) uploads++; });
    await selectFile(page, 'cancelled.mp3'); await entered;
    await page.getByRole('button', { name: 'Cancel upload', exact: true }).click({ timeout: 3000 });
    const initialized = page.waitForResponse('**/api/participant/preparations/init'); release(); await initialized;
    await expect(page.getByRole('button', { name: 'Upload a track', exact: true })).toBeEnabled();
    await selectFile(page, 'fresh.mp3');
    await expect(page.getByLabel('Track title', { exact: true })).toHaveValue('Uploaded song');
    await expect(page.locator('.upload-preview')).toContainText('fresh.mp3');
    expect(uploads).toBe(1);
  } finally { release(); await r.context.close(); }
});

test('single-file metadata review, private save/reload/recovery and reversible/permanent deletion work at phone width without autoplay', async ({ browser, page: host, isolatedApp }) => {
  const r = await room(browser, host, isolatedApp.origin); const page = r.page;
  try {
    await selectFile(page);
    await expect(page.getByLabel('Track title', { exact: true })).toHaveValue('Uploaded song');
    await expect(page.getByLabel('Artist', { exact: true })).toHaveValue('Local artist');
    await expect(page.getByRole('img', { name: 'Uploaded album artwork' })).toBeVisible();
    await expect(page.locator('.list-save-status')).toHaveText('Private · upload not yet added');
    expect((await list(page)).upcoming).toHaveLength(0);
    await page.getByLabel('Track title', { exact: true }).fill('My private file title');
    await page.getByLabel('Artist', { exact: true }).fill('My local artist');
    await page.getByLabel('Album', { exact: true }).fill('My local album');
    const before = await (await host.request.get('/api/host/state')).json();
    await r.post('/api/host/reorder', { ids: before.active.map((person: { id: string }) => person.id), revision: before.revision });
    await expect(page.getByLabel('Album', { exact: true })).toBeFocused();
    await expect(page.getByLabel('Track title', { exact: true })).toHaveValue('My private file title');
    await page.screenshot({ path: 'test-results/participant-upload-review-320.png', fullPage: true });
    await page.getByRole('button', { name: 'Add uploaded track to my list', exact: true }).click();
    await expect(page.locator('.saved-track strong')).toHaveText('My private file title');
    expect((await (await page.request.get('/api/participant/state')).json()).ownPlayback).toBeNull();
    const publicHost = await (await host.request.get('/api/host/state')).json(); expect(JSON.stringify(publicHost)).not.toContain('My private file title');
    await page.reload(); await showList(page); await expect(page.locator('.saved-track strong')).toHaveText('My private file title');
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)).toBe(false);
    await page.screenshot({ path: 'test-results/participant-uploaded-file-320.png', fullPage: true });
    await page.getByLabel('Options for My private file title', { exact: true }).click();
    await page.getByRole('button', { name: 'Remove', exact: true }).click();
    await expect(page.locator('.saved-tracks[aria-label="Your prepared tracks"] .saved-track')).toHaveCount(0);
    await page.getByRole('button', { name: 'Undo last removal' }).click();
    await expect(page.locator('.saved-tracks[aria-label="Your prepared tracks"] strong')).toHaveText('My private file title');
    const options = page.getByLabel('Options for My private file title', { exact: true });
    if (!await options.evaluate(node => (node.parentElement as HTMLDetailsElement).open)) await options.click();
    await page.getByRole('button', { name: 'Remove', exact: true }).click();
    await page.locator('#list-removed').click(); page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: 'Delete file permanently' }).click();
    await expect.poll(async () => (await list(page)).removed.length).toBe(0);
    await page.reload(); expect((await list(page)).removed).toHaveLength(0);
  } finally { await r.context.close(); }
});

test('lost upload and add acknowledgements recover through read-only checks and explicit idempotent save retries', async ({ browser, page: host, isolatedApp }) => {
  const r = await room(browser, host, isolatedApp.origin); const page = r.page;
  try {
    let uploads = 0;
    await page.route(/\/api\/participant\/preparations\/uploads\/[a-f0-9-]{36}$/, async route => {
      if (route.request().method() !== 'POST') { await route.continue(); return; }
      uploads++; await route.fetch(); await route.abort('failed');
    });
    await selectFile(page); await expect(page.getByText('Upload connection lost.', { exact: false })).toBeVisible();
    await page.reload(); await expect(page.getByLabel('Track title', { exact: true })).toHaveValue('Uploaded song'); expect(uploads).toBe(1);
    await page.unroute(/\/api\/participant\/preparations\/uploads\/[a-f0-9-]{36}$/);
    let adds = 0;
    await page.route('**/api/participant/preparations/add-upload', async route => { adds++; await route.fetch(); await route.abort('failed'); });
    await page.getByRole('button', { name: 'Add uploaded track to my list' }).click();
    await expect(page.locator('.list-save-status')).toHaveText('Not synced · draft retained');
    expect((await list(page)).upcoming).toHaveLength(1);
    await page.reload(); await expect(page.getByRole('button', { name: 'Retry save', exact: true })).toBeVisible(); expect(adds).toBe(1);
    await page.unroute('**/api/participant/preparations/add-upload');
    await page.getByRole('button', { name: 'Retry save', exact: true }).click();
    await expect(page.locator('.list-save-status')).toHaveText('Private · Saved ✓'); expect((await list(page)).upcoming).toHaveLength(1);
  } finally { await r.context.close(); }
});

test('an uploaded file uses the normal explicit player and never exposes Music Assistant source URLs', async ({ browser, page: host, isolatedApp }) => {
  const r = await room(browser, host, isolatedApp.origin); const page = r.page;
  try {
    await r.post('/api/host/integrations/save', { url: isolatedApp.musicAssistantOrigin, accessToken: 'fixture-token', revision: 0 });
    const settings = await (await host.request.get('/api/host/integrations')).json();
    await r.post('/api/host/integrations/destination', { id: 'sonos:room', revision: settings.revision });
    await selectFile(page); await expect(page.getByLabel('Track title', { exact: true })).toHaveValue('Uploaded song');
    await page.getByRole('button', { name: 'Add uploaded track to my list' }).click();
    await expect(page.getByRole('button', { name: 'Play next prepared track' })).toBeEnabled();
    await page.getByRole('button', { name: 'Play next prepared track' }).click();
    await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Pause', exact: true }).click(); await expect(page.getByRole('button', { name: 'Resume', exact: true })).toBeVisible();
    const state = await (await page.request.get('/api/participant/state')).json();
    expect(state.ownPlayback.track.title).toBe('Uploaded song'); expect(JSON.stringify(state)).not.toContain('/api/media/'); expect(JSON.stringify(state)).not.toContain('UPSTREAM SECRET');
    expect((await list(page)).played).toHaveLength(1);
    await page.getByRole('button', { name: 'Finish my turn', exact: true }).click();
    await expect(page.locator('.playback-card')).toHaveCount(0);
  } finally { await r.context.close(); }
});

test('unsupported standalone AAC and explicit cancellation leave existing lists untouched and allow a fresh selection', async ({ browser, page: host, isolatedApp }) => {
  const r = await room(browser, host, isolatedApp.origin); const page = r.page;
  let release = () => {};
  try {
    await selectFile(page, 'unsupported.aac'); await expect(page.getByText('Standalone AAC is not supported.', { exact: false })).toBeVisible();
    expect((await list(page)).upcoming).toHaveLength(0);
    await page.getByRole('button', { name: 'Discard upload draft' }).click();
    await expect(page.getByRole('button', { name: 'Upload a track', exact: true })).toBeEnabled();
    let enter!: () => void; const entered = new Promise<void>(resolve => { enter = resolve; }); const gate = new Promise<void>(resolve => { release = resolve; });
    await page.route(/\/api\/participant\/preparations\/uploads\/[a-f0-9-]{36}$/, async route => {
      if (route.request().method() !== 'POST') { await route.continue(); return; }
      enter(); await gate; try { await route.abort('aborted'); } catch { /* The explicit client abort may have already closed this request. */ }
    });
    await selectFile(page); await entered;
    await page.getByRole('button', { name: 'Cancel upload', exact: true }).click();
    await expect(page.getByText('Upload interrupted.', { exact: false })).toBeVisible(); release();
    await page.unroute(/\/api\/participant\/preparations\/uploads\/[a-f0-9-]{36}$/);
    await page.getByRole('button', { name: 'Discard upload draft' }).click();
    await expect(page.getByRole('button', { name: 'Upload a track', exact: true })).toBeEnabled();
    await selectFile(page, 'fresh.mp3'); await expect(page.getByLabel('Track title', { exact: true })).toHaveValue('Uploaded song');
    expect((await list(page)).upcoming).toHaveLength(0);
  } finally { release(); await r.context.close(); }
});

test('host saves and reloads the file callback address without changing the music connection or starting audio', async ({ page: host, isolatedApp }) => {
  const saved = await host.request.post('/api/host/integrations/save', { data: { url: isolatedApp.musicAssistantOrigin, accessToken: 'fixture-token', revision: 0 }, headers: { Origin: isolatedApp.origin } });
  expect(saved.status()).toBe(200); await host.goto('/host/settings');
  await host.getByText('Advanced address override', { exact: true }).click();
  const field = host.getByLabel('Application address reachable from Music Assistant', { exact: true }); await expect(field).toBeEnabled();
  await field.fill(isolatedApp.origin); await host.getByRole('button', { name: 'Save file playback address' }).click();
  await expect(host.getByText('File playback address saved.', { exact: true })).toBeVisible();
  await host.reload(); await expect(field).toHaveValue(isolatedApp.origin);
  const settings = await (await host.request.get('/api/host/integrations')).json(); expect(settings.mediaOrigin).toBe(isolatedApp.origin); expect(settings.tokenConfigured).toBe(true);
  expect(JSON.stringify(settings)).not.toContain('fixture-token');
});
