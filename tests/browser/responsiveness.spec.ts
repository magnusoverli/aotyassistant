import { randomUUID } from 'node:crypto';
import { expect, type BrowserContext } from '@playwright/test';
import { test } from './app-fixture';
import { PreparationFileStore } from '../../src/preparations';

async function join(context: BrowserContext, origin: string) {
  const headers = { Origin: origin };
  expect((await context.request.post(origin + '/api/participant/join', { data: { nickname: 'Responsive listener' }, headers })).ok()).toBe(true);
  return (await context.request.post(origin + '/api/participant/preparations/init', { data: {}, headers })).json();
}

test('three participant tabs use one live connection each and leave capacity for ordinary requests', async ({ browser, isolatedApp }) => {
  const context = await browser.newContext();
  try {
    await join(context, isolatedApp.origin);
    await context.addInitScript(() => {
      const state = window as unknown as { liveSources: { closed: boolean }[] }; state.liveSources = [];
      const Original = EventSource;
      window.EventSource = class extends Original {
        private tracked = { closed: false };
        constructor(url: string | URL, options?: EventSourceInit) { super(url, options); state.liveSources.push(this.tracked); }
        close() { this.tracked.closed = true; super.close(); }
      };
    });
    for (let n = 0; n < 3; n++) {
      const page = await context.newPage(); await page.goto(isolatedApp.origin + '/participant');
      await expect(page.locator('.list-save-status')).toHaveText('Private · Saved ✓');
      await expect.poll(() => page.evaluate(() => (window as unknown as { liveSources: { closed: boolean }[] }).liveSources.filter(source => !source.closed).length)).toBe(1);
    }
    expect(await context.pages()[2]!.evaluate(async () => (await fetch('/api/health', { signal: AbortSignal.timeout(1500) })).ok)).toBe(true);
  } finally { await context.close(); }
});

test('large lists keep search/result/row nodes, and closed history creates no rows until expanded in bounded pages', async ({ browser, isolatedApp }) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  try {
    const owner = await join(context, isolatedApp.origin);
    const store = new PreparationFileStore(isolatedApp.dataDirectory); const state = (await store.load(owner.ownerId))!;
    state.entries = Array.from({ length: 1000 }, (_, i) => ({ id: randomUUID(), state: i < 200 ? 'upcoming' : 'removed',
      selection: { source: 'demo', trackId: 'demo:aurora', metadata: { title: `Saved ${i}`, artist: 'Fixture', album: '', version: '', provider: 'Demo', duration: 60 } },
      addedAt: Date.now(), ...(i < 200 ? {} : { removedAt: Date.now() }), playbackIds: [] }));
    state.order = state.entries.slice(0, 200).map(entry => entry.id); await store.save(state);
    const page = await context.newPage(); await page.goto(isolatedApp.origin + '/participant');
    await expect(page.locator('.saved-track')).toHaveCount(200);
    await page.evaluate(() => {
      const state = window as unknown as { retained: Element[]; detachedRow: boolean }; state.detachedRow = false;
      state.retained = [document.querySelector('.search-form')!, document.querySelector('.saved-track:nth-child(2)')!];
      new MutationObserver(records => { if (records.some(record => [...record.removedNodes].includes(state.retained[1]!))) state.detachedRow = true; })
        .observe(document.body, { childList: true, subtree: true });
    });
    await page.getByRole('button', { name: 'Edit order', exact: true }).click();
    expect(await page.evaluate(() => (window as unknown as { retained: Element[] }).retained.every(node => node.isConnected))).toBe(true);
    expect(await page.evaluate(() => (window as unknown as { detachedRow: boolean }).detachedRow)).toBe(false);
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    await page.getByLabel('Options for Saved 0', { exact: true }).click();
    await page.locator('.saved-track').first().getByRole('button', { name: 'Remove', exact: true }).click();
    await expect(page.locator('.saved-tracks[aria-label="Your prepared tracks"] > li')).toHaveCount(199);
    expect(await page.evaluate(() => (window as unknown as { retained: Element[] }).retained.every(node => node.isConnected))).toBe(true);
    expect(await page.evaluate(() => (window as unknown as { detachedRow: boolean }).detachedRow)).toBe(false);
    await expect(page.locator('#list-history').locator('..').locator('.saved-track')).toHaveCount(0);
    await page.locator('#list-history').click();
    await expect(page.locator('#list-history').locator('..').locator('.saved-track')).toHaveCount(50);
    await page.getByRole('button', { name: 'Show more history', exact: true }).click();
    await expect(page.locator('#list-history').locator('..').locator('.saved-track')).toHaveCount(100);
  } finally { await context.close(); }
});

test('the player clock moves between server samples, freezes on pause and stays frozen when offline', async ({ browser, isolatedApp }) => {
  const context = await browser.newContext();
  try {
    await join(context, isolatedApp.origin); const page = await context.newPage(); await page.goto(isolatedApp.origin + '/participant');
    await page.getByRole('searchbox', { name: 'Search catalogue' }).fill('Northern'); await page.getByRole('button', { name: 'Search', exact: true }).click();
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await expect(page.locator('.player-pending')).toHaveCount(0);
    await expect(page.locator('.playback-card .playback-status')).toHaveText('● Playing');
    // Keep the authoritative demo playing, but suppress progress events entirely.
    isolatedApp.demo.onProgress = () => {};
    const values = await page.evaluate(async () => {
      const values: number[] = [];
      for (let n = 0; n < 8; n++) { values.push(Number(document.querySelector('.playback-card progress')!.getAttribute('value'))); await new Promise(resolve => setTimeout(resolve, 300)); }
      return values;
    });
    expect(new Set(values).size).toBeGreaterThan(5); expect(values.at(-1)!).toBeGreaterThan(values[0]! + .0004);
    const times = page.locator('.playback-card .track-times span').first(); await expect(times).not.toHaveText('0:00');
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Resume', exact: true })).toBeVisible();
    await expect.poll(async () => (await (await page.request.get('/api/participant/state')).json()).ownPlayback.status).toBe('paused');
    const frozen = await page.locator('.playback-card progress').getAttribute('value');
    await page.waitForTimeout(1100); expect(await page.locator('.playback-card progress').getAttribute('value')).toBe(frozen);
    await page.getByRole('button', { name: 'Resume', exact: true }).click();
    await expect.poll(async () => (await (await page.request.get('/api/participant/state')).json()).ownPlayback.status).toBe('playing');
    await context.setOffline(true); await expect(page.locator('.notice.connection')).toBeVisible();
    const offline = await page.locator('.playback-card progress').getAttribute('value');
    await page.waitForTimeout(500); expect(await page.locator('.playback-card progress').getAttribute('value')).toBe(offline);
  } finally { await context.close(); }
});

test('a replacement search cancels stale work without blocking the search form', async ({ browser, isolatedApp }) => {
  const context = await browser.newContext(); let release = () => {};
  try {
    await join(context, isolatedApp.origin); const page = await context.newPage(); await page.goto(isolatedApp.origin + '/participant');
    const held = new Promise<void>(resolve => { release = resolve; });
    await page.route('**/api/participant/search', async route => { if (route.request().postDataJSON().query === 'Northern') await held; await route.continue().catch(() => {}); });
    await page.getByRole('searchbox').fill('Northern'); await page.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(page.locator('#catalogue-search-submit')).toBeEnabled();
    await page.getByRole('searchbox').fill('Summer'); await page.locator('#catalogue-search-submit').click();
    await expect(page.locator('.catalogue-results')).toContainText('Late Summer'); release();
    await expect(page.locator('.catalogue-results')).not.toContainText('Northern Lights');
  } finally { release(); await context.close(); }
});

test('optional file diagnostics do not disable speaker settings and saving reuses the validated inventory', async ({ page, isolatedApp }) => {
  await isolatedApp.manager.save(isolatedApp.musicAssistantOrigin, 'fixture-token', 0);
  await isolatedApp.manager.selectDestination('sonos:room', 1);
  let release = () => {}; let entered!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; }); const started = new Promise<void>(resolve => { entered = resolve; });
  await page.route('**/api/host/addressing/test', async route => { entered(); await held; await route.continue().catch(() => {}); });
  try {
    await page.goto('/host/settings'); await started;
    await expect(page.getByRole('button', { name: 'Change speaker', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Change speaker', exact: true }).click();
    await page.getByLabel('Speaker or group', { exact: true }).selectOption('sonos:bedroom');
    const before = isolatedApp.calls.filter(call => call.command === 'players/all').length;
    await page.getByRole('button', { name: 'Save speaker', exact: true }).click();
    await expect(page.getByText('Speaker: Bedroom', { exact: true })).toBeVisible();
    expect(isolatedApp.calls.filter(call => call.command === 'players/all').length - before).toBe(1);
  } finally { release(); }
});
