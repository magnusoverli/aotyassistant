import { expect } from '@playwright/test';
import { test } from './app-fixture';
import { openNavigation } from './navigation-helpers';

test('menu navigation and Back retain the actual header, order cards and animation nodes', async ({ page, isolatedApp }) => {
  await page.addInitScript(() => {
    const state = window as unknown as { shellSources: { url: string; closed: boolean }[] }; state.shellSources = [];
    const Original = EventSource;
    window.EventSource = class extends Original {
      private record: { url: string; closed: boolean };
      constructor(url: string | URL, options?: EventSourceInit) {
        super(url, options); this.record = { url: String(url), closed: false }; state.shellSources.push(this.record);
      }
      close() { this.record.closed = true; super.close(); }
    };
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.request.post('/api/participant/join', { data: { pin: '1234', nickname: 'Persistent listener' }, headers: { Origin: isolatedApp.origin } });
  await page.goto('/participant');
  await expect(page.locator('.rotation-seat')).toHaveCount(1);
  const shell = await page.locator('.app-header').elementHandle();
  const card = await page.locator('.rotation-seat').elementHandle();
  const light = await page.locator('.rotation-seat .order-trace').elementHandle();
  const documents: string[] = [];
  const writes: string[] = [];
  page.on('request', request => {
    if (request.isNavigationRequest() && request.frame() === page.mainFrame()) documents.push(request.url());
    if (request.method() === 'POST') writes.push(new URL(request.url()).pathname);
  });
  for (const [name, path] of [['Settings', '/host/settings'], ['Room display', '/display'], ['Host desk', '/host'], ['Your music', '/participant']]) {
    await openNavigation(page);
    await page.getByRole('navigation').getByRole('link', { name, exact: true }).click();
    await expect(page).toHaveURL(isolatedApp.origin + path);
    await expect(page.locator('main')).toBeVisible();
    expect(await shell!.evaluate(node => node === document.querySelector('.app-header'))).toBe(true);
    expect(await card!.evaluate(node => node === document.querySelector('.rotation-seat'))).toBe(true);
    expect(await light!.evaluate(node => node === document.querySelector('.rotation-seat .order-trace'))).toBe(true);
    await expect(page.locator('.header-inner')).toHaveCSS('height', '44px');
    await expect(page.getByRole('navigation')).toBeHidden();
    await expect(page.locator('.seat-state-compact')).toHaveText('Now · You');
    await expect.poll(() => page.evaluate(() => (window as unknown as { shellSources: { closed: boolean }[] }).shellSources.filter(source => !source.closed).length)).toBe(path === '/host/settings' ? 2 : 1);
  }
  await page.goBack(); await expect(page).toHaveURL(isolatedApp.origin + '/host');
  expect(await shell!.evaluate(node => node === document.querySelector('.app-header'))).toBe(true);
  await page.goForward(); await expect(page).toHaveURL(isolatedApp.origin + '/participant');
  expect(await card!.evaluate(node => node === document.querySelector('.rotation-seat'))).toBe(true);
  expect(documents).toEqual([]);
  expect(writes.filter(path => /\/(play|control|finish|advance|reorder|remove|reveal)$/.test(path))).toEqual([]);
});

test('a late response from an abandoned page cannot replace the current page or its header state', async ({ page, isolatedApp }) => {
  await page.goto('/');
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let entered!: () => void;
  const requested = new Promise<void>(resolve => { entered = resolve; });
  await page.route('**/api/host/state', async route => {
    const response = await route.fetch(); entered(); await gate;
    await route.fulfill({ response }).catch(() => {});
  });
  try {
    await openNavigation(page); await page.getByRole('navigation').getByRole('link', { name: 'Host desk', exact: true }).click();
    await requested;
    await openNavigation(page); await page.getByRole('navigation').getByRole('link', { name: 'Settings', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
    const late = page.waitForResponse('**/api/host/state');
    release(); await (await late).finished();
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
    await expect(page).toHaveURL(isolatedApp.origin + '/host/settings');
    await expect(page.locator('body')).toHaveAttribute('data-view', 'settings');
    await expect(page.locator('.host-page')).toHaveCount(0);
    await openNavigation(page);
    await expect(page.getByRole('navigation').getByRole('link', { name: 'Settings', exact: true })).toHaveAttribute('aria-current', 'page');
  } finally { release(); }
});
