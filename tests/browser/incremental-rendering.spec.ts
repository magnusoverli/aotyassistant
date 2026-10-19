import { randomUUID } from 'node:crypto';
import { expect, type Page } from '@playwright/test';
import { test } from './app-fixture';
import { uploadBytes } from '../fixtures/uploads';

type Retention = { nodes: [string, Element][]; detached: string[]; observer: MutationObserver };

/** Check continuous attachment as well as identity: reusing a node after removing its
 * ancestor still interrupts focus, native pickers, media and animation state. */
async function retain(page: Page, selectors: string[]) {
  await page.evaluate(selectors => {
    const state = window as unknown as { retention?: Retention };
    state.retention?.observer.disconnect();
    const nodes: [string, Element][] = selectors.map(selector => {
      const node = document.querySelector(selector); if (!node) throw new Error(`Missing ${selector}`); return [selector, node];
    });
    const detached: string[] = [];
    const observer = new MutationObserver(records => {
      for (const record of records) for (const [selector, node] of nodes) {
        if ([...record.removedNodes].some(removed => removed === node || removed.contains(node))) detached.push(selector);
      }
    });
    observer.observe(document.body, { subtree: true, childList: true }); state.retention = { nodes, detached, observer };
  }, selectors);
}
async function retained(page: Page) {
  expect(await page.evaluate(() => {
    const { nodes, detached } = (window as unknown as { retention: Retention }).retention;
    return { replaced: nodes.filter(([selector, node]) => document.querySelector(selector) !== node || !node.isConnected).map(([selector]) => selector), detached: [...new Set(detached)] };
  })).toEqual({ replaced: [], detached: [] });
}
async function join(page: Page, origin: string) {
  const headers = { Origin: origin };
  expect((await page.request.post('/api/participant/join', { data: { nickname: 'Stable UI' }, headers })).ok()).toBe(true);
  expect((await page.request.post('/api/participant/preparations/init', { data: {}, headers })).ok()).toBe(true);
  await page.goto('/participant');
  await expect(page.locator('.list-save-status')).toHaveText('Private · Saved ✓');
  await expect(page.locator('#catalogue-search-submit')).toBeEnabled();
}
async function search(page: Page, query: string) {
  await page.getByRole('searchbox').fill(query); await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.locator('.catalogue-results[aria-busy="false"] .track-row').first()).toBeVisible();
}
const workspace = ['.app-header', '.participant-page', '.music-workspace', '.playback-card', '#volume-level', '.search-form', '#catalogue-search', '.preparation-list', '.upload-panel'];

test('search, source selection and playback patch existing regions without detaching unrelated controls', async ({ page, isolatedApp }) => {
  await isolatedApp.manager.save(isolatedApp.musicAssistantOrigin, 'fixture-token', 0);
  await isolatedApp.manager.selectDestination('sonos:room', isolatedApp.manager.view().revision);
  await join(page, isolatedApp.origin);
  await page.getByRole('button', { name: 'Songs', exact: true }).click();
  await retain(page, workspace); await search(page, 'multi-provider'); await retained(page);
  const row = page.locator('.catalogue-results .track-row').first();
  const source = row.getByRole('combobox');
  const value = await source.locator('option').filter({ hasText: /^Tidal/ }).getAttribute('value');
  await source.focus();
  await retain(page, [...workspace, '.catalogue-results', '.catalogue-results .track-row', '.catalogue-results .track-row:last-child', '.catalogue-results select']);
  await source.selectOption(value!); await retained(page); await expect(source).toBeFocused();
  await row.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.locator('.player-pending')).toHaveCount(0); await expect(page.locator('.playback-card .playback-status')).toHaveText('● Playing');
  await retained(page);
  const stable = [...workspace, '.playback-card .mini-record img', '#player-transport', '.playback-card progress', '.catalogue-results .track-row'];
  await retain(page, stable);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect.poll(async () => (await (await page.request.get('/api/participant/state')).json()).ownPlayback.status).toBe('paused');
  await expect(page.locator('.playback-card .playback-status')).toHaveText('Ⅱ Paused'); await retained(page);
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  await expect.poll(async () => (await (await page.request.get('/api/participant/state')).json()).ownPlayback.status).toBe('playing');
  await page.getByRole('button', { name: 'Reveal song', exact: true }).click();
  await expect(page.locator('.playback-card .privacy-tag')).toHaveText('Visible on room display'); await retained(page);
});

test('upload progress is local and a private-list event preserves upload input selection', async ({ page, isolatedApp }) => {
  await page.addInitScript(() => {
    const Original = XMLHttpRequest;
    window.XMLHttpRequest = class extends Original {
      constructor() { super(); (window as unknown as { lastUpload: XMLHttpRequest }).lastUpload = this; }
    };
  });
  await join(page, isolatedApp.origin); await search(page, 'Northern'); await page.locator('#list-upload').click();
  let release!: () => void; let entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; }); const held = new Promise<void>(resolve => { release = resolve; });
  await page.route(/\/api\/participant\/preparations\/uploads\/[a-f0-9-]{36}$/, async route => { entered(); await held; await route.continue().catch(() => {}); });
  try {
    await retain(page, [...workspace, '.catalogue-results .track-row']);
    await page.locator('#track-upload-file').setInputFiles({ name: 'retained.mp3', mimeType: 'audio/mpeg', buffer: uploadBytes }); await started;
    await retained(page);
    await retain(page, [...workspace, '.catalogue-results .track-row', '.upload-panel progress']);
    for (const loaded of [20, 55, 90]) {
      await page.evaluate(loaded => (window as unknown as { lastUpload: XMLHttpRequest }).lastUpload.upload.dispatchEvent(new ProgressEvent('progress', { lengthComputable: true, loaded, total: 100 })), loaded);
      await expect(page.getByRole('progressbar', { name: 'File upload progress' })).toHaveJSProperty('value', loaded); await retained(page);
    }
    release(); await expect(page.getByLabel('Track title', { exact: true })).toHaveValue('Uploaded song');
    await page.locator('#upload-title').focus(); await page.locator('#upload-title').evaluate((node: HTMLInputElement) => node.setSelectionRange(2, 5));
    await retain(page, [...workspace, '.upload-preview', '#upload-title', '#upload-artist', '#upload-album']);
    const headers = { Origin: isolatedApp.origin };
    const room = await (await page.request.get('/api/participant/state')).json();
    const found = await (await page.request.post('/api/participant/search', { data: { turnId: room.turnId, query: 'Northern' }, headers })).json();
    const list = await (await page.request.get('/api/participant/preparations/state')).json();
    expect((await page.request.post('/api/participant/preparations/add', { headers, data: { trackId: found.tracks[0].id, operation: { id: randomUUID(), revision: list.revision, issuedAt: Date.now() } } })).ok()).toBe(true);
    await expect(page.locator('.saved-track')).toHaveCount(1); await retained(page);
    await expect(page.locator('#upload-title')).toBeFocused();
    expect(await page.locator('#upload-title').evaluate((node: HTMLInputElement) => [node.selectionStart, node.selectionEnd])).toEqual([2, 5]);
  } finally { release(); }
});

test('speaker discovery, errors and live updates retain forms, picker options and refresh animation node', async ({ page, context, isolatedApp }) => {
  await isolatedApp.manager.save(isolatedApp.musicAssistantOrigin, 'fixture-token', 0);
  await isolatedApp.manager.selectDestination('sonos:room', isolatedApp.manager.view().revision);
  await page.request.post('/api/participant/join', { headers: { Origin: isolatedApp.origin }, data: { nickname: 'Listener' } });
  const host = await context.newPage(); await host.goto('/host');
  await expect(host.locator('.output-label')).toHaveText('Output: Living room');
  await page.goto('/host/settings');
  await expect(page.getByRole('button', { name: 'Test file connection' })).toBeEnabled();
  await page.getByRole('button', { name: 'Change connection', exact: true }).click();
  await page.getByText('Advanced: token or separate login address', { exact: true }).click();
  await page.getByLabel('Music Assistant access token').fill('draft-kept');
  const regions = ['.settings-workspace', '.settings-connection', '.settings-addressing', '#app-guest-origin', '#upload-media-origin', '#ma-url', '#ma-token', '#ma-destination', '#ma-destination option[value="sonos:room"]', '.speaker-refresh'];
  await retain(page, regions);
  let release!: () => void; let entered!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; }); const started = new Promise<void>(resolve => { entered = resolve; });
  await page.route('**/api/host/integrations/destinations', async route => { entered(); await held; await route.fulfill({ status: 503, json: { error: 'Discovery temporarily unavailable' } }); });
  try {
    await page.getByRole('button', { name: 'Refresh speakers' }).click(); await started;
    await expect(page.locator('.speaker-refresh')).toHaveAttribute('aria-busy', 'true'); await retained(page);
    release(); await expect(page.locator('.speaker-refresh')).toHaveAttribute('aria-busy', 'false');
    await expect(page.locator('.speaker-refresh')).toBeEnabled(); await retained(page);
    await page.unroute('**/api/host/integrations/destinations');
    await page.getByRole('button', { name: 'Refresh speakers' }).click(); await expect(page.locator('.speaker-refresh')).toBeEnabled(); await retained(page);
    await page.locator('#ma-token').focus(); await page.locator('#ma-token').evaluate((node: HTMLInputElement) => node.setSelectionRange(2, 5));
    await retain(host, ['.host-page', '.host-invitations', '#volume-level', '.host-live']);
    isolatedApp.setSpeakers([{ player_id: 'sonos:room', name: 'Renamed room', available: true }]);
    await expect(page.getByText('Active speaker: Renamed room', { exact: true })).toBeVisible(); await expect(host.locator('.output-label')).toHaveText('Output: Renamed room');
    await retained(page); await retained(host);
    await expect(page.locator('#ma-token')).toBeFocused(); expect(await page.locator('#ma-token').evaluate((node: HTMLInputElement) => [node.value, node.selectionStart, node.selectionEnd])).toEqual(['draft-kept', 2, 5]);
  } finally { release(); }
});

test('unchanged membership revalidation and list edits retain the workspace and recovery input', async ({ page, isolatedApp }) => {
  await page.addInitScript(() => {
    const state = window as unknown as { eventConnections: number }; state.eventConnections = 0;
    const Original = EventSource;
    window.EventSource = class extends Original { constructor(url: string | URL, options?: EventSourceInit) { super(url, options); state.eventConnections++; } };
  });
  await join(page, isolatedApp.origin); await search(page, 'Northern');
  await page.getByRole('button', { name: 'Add to list', exact: true }).click();
  await expect(page.locator('.list-save-status')).toHaveText('Private · Saved ✓');
  await page.locator('#list-recovery').click(); await page.getByLabel('Recover with a private key').fill('draft-recovery-key');
  await page.locator('#preparation-recovery-key').evaluate((node: HTMLInputElement) => node.setSelectionRange(3, 7));
  await retain(page, [...workspace, '.saved-track', '#preparation-recovery-key', '.catalogue-results .track-row']);
  const connections = await page.evaluate(() => (window as unknown as { eventConnections: number }).eventConnections);
  const room = page.waitForResponse('**/api/participant/state'); const library = page.waitForResponse('**/api/participant/preparations/state');
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); await Promise.all([room, library]);
  await expect(page.locator('.list-save-status')).toHaveText('Private · Saved ✓'); await retained(page);
  expect(await page.evaluate(() => (window as unknown as { eventConnections: number }).eventConnections)).toBe(connections);
  await expect(page.locator('#preparation-recovery-key')).toBeFocused();
  expect(await page.locator('#preparation-recovery-key').evaluate((node: HTMLInputElement) => [node.selectionStart, node.selectionEnd])).toEqual([3, 7]);
  await page.getByRole('button', { name: 'Edit order', exact: true }).click(); await retained(page);
});

test('listening-order membership updates retain existing seats', async ({ page, browser, isolatedApp }) => {
  await join(page, isolatedApp.origin); await expect(page.locator('.rotation-seat')).toHaveCount(1);
  await retain(page, [...workspace, '.rotation-seat']);
  const other = await browser.newContext();
  try {
    expect((await other.request.post(isolatedApp.origin + '/api/participant/join', { data: { nickname: 'Second listener' }, headers: { Origin: isolatedApp.origin } })).ok()).toBe(true);
    await expect(page.locator('.rotation-seat')).toHaveCount(2); await retained(page);
  } finally { await other.close(); }
});
