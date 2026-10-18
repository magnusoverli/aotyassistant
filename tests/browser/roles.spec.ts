import { expect, type Page } from '@playwright/test';
import { test } from './app-fixture';
import { saveChoice, showFind } from './preparation-helpers';
import { openNavigation } from './navigation-helpers';

async function noHorizontalOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
}
async function tvFits(page: Page) {
  await noHorizontalOverflow(page);
  expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 2)).toBe(true);
}

test('role-specific layouts show reliable seats/current/next and preserve private preparation through turn changes', async ({ browser, page: host, isolatedApp }) => {
  const post = (path: string, data: unknown) => host.request.post(path, { data, headers: { Origin: isolatedApp.origin } });
  let state = await (await host.request.get('/api/host/state')).json();
  let settings = await (await host.request.get('/api/host/integrations')).json();
  if (settings.tokenConfigured) await post('/api/host/integrations/clear', { revision: settings.revision });
  const contexts = [];
  const listeners = new Map<string, Page>();
  const tvContext = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  try {
    for (const name of ['Alex', 'Sam', 'Jordan', 'Riley']) {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 } }); contexts.push(context);
      const page = await context.newPage(); listeners.set(name, page); await page.goto(state.joinUrl);
      await page.getByLabel('What should we call you?').fill(name); await page.getByRole('button', { name: 'Join room' }).click();
      await expect(page).toHaveURL(/\/participant$/);
    }
    state = await (await host.request.get('/api/host/state')).json();
    expect(state.phase).toBeUndefined(); expect(state.active).toHaveLength(4); expect(state.waiting).toBeUndefined();
    await expect(listeners.get('Alex')!.locator('.participant-hero h1')).toHaveText('Your turn.');
    await host.setViewportSize({ width: 1440, height: 1000 }); await host.goto('/host');
    await openNavigation(host);
    await expect(host.getByRole('banner').getByRole('navigation', { name: 'Primary navigation' })).toBeVisible();
    await host.keyboard.press('Escape');
    const alex = listeners.get('Alex')!; const sam = listeners.get('Sam')!; const jordan = listeners.get('Jordan')!; const riley = listeners.get('Riley')!;
    await expect(alex.locator('main')).toHaveAttribute('data-turn-state', 'mine');
    await expect(sam.locator('main')).toHaveAttribute('data-turn-state', 'next');
    await expect(jordan.locator('main')).toHaveAttribute('data-turn-state', 'listening');
    expect((await (await jordan.request.get('/api/participant/state')).json()).position).toMatchObject({ seat: 3, total: 4 });
    await expect(jordan.getByText('2 turns away', { exact: true })).toBeVisible();
    await expect(jordan.getByRole('heading', { name: 'Alex’s turn.', exact: true })).toBeVisible();
    await expect(riley.locator('main')).toHaveAttribute('data-turn-state', 'listening');
    expect((await (await riley.request.get('/api/participant/state')).json()).position).toMatchObject({ seat: 4, total: 4 });
    await expect(riley.locator('.turn-distance')).toHaveText('3 turns away');
    await expect(alex.locator('.participant-hero h1')).toHaveText('Your turn.');
    await expect(sam.locator('.turn-distance')).toHaveText('You’re next');
    await expect(jordan.locator('.turn-distance')).toHaveText('2 turns away');
    await expect(jordan.getByRole('list', { name: 'Participant rotation' })).toBeVisible();
    for (const page of listeners.values()) {
      await expect(page.getByRole('searchbox', { name: 'Search catalogue' })).toBeInViewport();
      await expect(page.locator('.participant-hero p:not(.turn-distance)')).toHaveCount(0);
      await expect(page.locator('.participant-facts, .participant-footer')).toHaveCount(0);
    }
    for (const page of listeners.values()) {
      await noHorizontalOverflow(page);
      await page.setViewportSize({ width: 320, height: 700 }); await noHorizontalOverflow(page);
      await expect(page.getByRole('searchbox', { name: 'Search catalogue' })).toBeInViewport();
      await page.setViewportSize({ width: 390, height: 844 });
    }
    await noHorizontalOverflow(host);
    const tv = await tvContext.newPage(); await tv.goto(state.displayUrl);
    await expect(tv.getByAltText('Scan to join the room')).toBeVisible(); await tvFits(tv);
    await expect(tv.getByRole('button', { name: 'Full screen', exact: true })).toBeEnabled();
    const palette = (page: Page) => page.evaluate(() => {
      const style = getComputedStyle(document.body);
      return { colors: ['--bg', '--panel', '--line', '--text', '--muted', '--accent'].map(key => style.getPropertyValue(key).trim()), scheme: style.colorScheme, background: style.backgroundImage };
    });
    const hostPalette = await palette(host);
    for (const page of listeners.values()) expect(await palette(page)).toEqual(hostPalette);
    await host.screenshot({ path: 'test-results/host-control-desk.png', fullPage: true });
    await alex.screenshot({ path: 'test-results/participant-your-turn.png', fullPage: true });
    await jordan.screenshot({ path: 'test-results/participant-listening.png', fullPage: true });
    await riley.screenshot({ path: 'test-results/participant-later-turn.png', fullPage: true });
    await tv.screenshot({ path: 'test-results/display-concealed-1366.png' });
    await expect(jordan.getByRole('list', { name: 'Participant rotation' })).toBeVisible();
    await jordan.screenshot({ path: 'test-results/participant-circle.png', fullPage: true });
    await jordan.getByRole('searchbox', { name: 'Search catalogue' }).fill('Northern');
    await jordan.getByRole('button', { name: 'Search', exact: true }).click(); await saveChoice(jordan);
    await expect(jordan.getByRole('button', { name: 'Play this song' })).toBeDisabled();
    await expect(jordan.locator('.list-save-status')).toHaveText('Private · Saved ✓');
    await jordan.screenshot({ path: 'test-results/participant-prepared.png', fullPage: true });
    await showFind(jordan);
    await expect(tv.getByText('Northern Lights')).toHaveCount(0); await expect(host.getByText('Northern Lights')).toHaveCount(0);
    await jordan.getByRole('searchbox', { name: 'Search catalogue' }).focus();
    await host.getByRole('button', { name: 'Manage people' }).click();
    await host.getByRole('button', { name: 'Move Jordan up', exact: true }).click();
    await expect(tv.locator('.rotation-seat.is-next strong')).toHaveText('Jordan');
    await expect(jordan.locator('main')).toHaveAttribute('data-turn-state', 'next');
    expect((await (await jordan.request.get('/api/participant/state')).json()).position).toMatchObject({ seat: 2, total: 4 });
    await expect(host.getByRole('heading', { name: 'Alex', exact: true })).toBeVisible();
    await expect(jordan.getByRole('button', { name: 'Play this song', includeHidden: true })).toBeDisabled();
    await expect(jordan.getByRole('searchbox', { name: 'Search catalogue' })).toHaveValue('Northern');
    await expect(jordan.getByRole('searchbox', { name: 'Search catalogue' })).toBeFocused();
    await expect(jordan.getByRole('list', { name: 'Participant rotation' })).toBeVisible();
    await host.getByRole('button', { name: 'Skip turn' }).click();
    await expect(tv.locator('.rotation-seat.is-current strong')).toHaveText('Jordan');
    await expect(tv.locator('.rotation-seat.is-next strong')).toHaveText('Sam');
    await expect(jordan.locator('main')).toHaveAttribute('data-turn-state', 'mine');
    await expect(jordan.getByRole('button', { name: 'Play this song', includeHidden: true })).toBeEnabled();
    await expect(sam.getByRole('heading', { name: 'Jordan’s turn.', exact: true })).toBeVisible();
    // Direct late joining preserves the current turn and the host's reordered rotation.
    const beforeArrival = await (await host.request.get('/api/host/state')).json();
    const extra = await browser.newContext(); contexts.push(extra);
    await extra.request.post(isolatedApp.origin + '/api/participant/join', { headers: { Origin: isolatedApp.origin }, data: { nickname: 'Another listener' } });
    state = await (await host.request.get('/api/host/state')).json();
    expect(state.turnId).toBe(beforeArrival.turnId); expect(state.current.id).toBe(beforeArrival.current.id);
    expect(state.active.map((person: { nickname: string }) => person.nickname)).toEqual(['Alex', 'Jordan', 'Sam', 'Riley', 'Another listener']);
    await expect(host.getByLabel('Position for Riley')).toHaveCount(0);
    await expect(jordan.locator('main')).toHaveAttribute('data-turn-state', 'mine');
    expect((await (await jordan.request.get('/api/participant/state')).json()).position).toMatchObject({ seat: 2, total: 5 });
    await expect(riley.locator('main')).toHaveAttribute('data-turn-state', 'listening');
    await expect(riley.getByText('2 turns away', { exact: true })).toBeVisible();
    // Keep the shared bar compact for a larger room without clipping the TV page.
    for (const name of ['A very long listener nickname for TV', 'Taylor', 'Morgan', 'Casey']) {
      const context = await browser.newContext(); contexts.push(context);
      await context.request.post(isolatedApp.origin + '/api/participant/join', { headers: { Origin: isolatedApp.origin }, data: { nickname: name } });
      state = await (await host.request.get('/api/host/state')).json();
    }
    await expect(tv.locator('.rotation-seat')).toHaveCount(9);
    await tvFits(tv);
    await tv.setViewportSize({ width: 1920, height: 1080 }); await tvFits(tv);
    await expect(tv.locator('.rotation-seat')).toHaveCount(9);
    await tv.screenshot({ path: 'test-results/display-concealed-1920.png' });
    await noHorizontalOverflow(jordan);
    await host.setViewportSize({ width: 390, height: 844 }); await noHorizontalOverflow(host);
    await host.screenshot({ path: 'test-results/host-mobile.png', fullPage: true });
    for (const person of state.active) { const current = await (await host.request.get('/api/host/state')).json(); await post('/api/host/remove', { id: person.id, revision: current.revision }); }
    await expect(tv.getByRole('heading', { name: 'Nothing playing.' })).toBeVisible();
    await expect(tv.getByRole('list', { name: 'Participant rotation' })).toHaveCount(0);
    await expect(jordan.getByRole('heading', { name: 'Join room', exact: true })).toBeVisible();
    await expect(jordan.locator('.preparation-list')).toHaveCount(0);
    await expect(jordan.getByRole('button', { name: 'Play this song' })).toHaveCount(0);
  } finally {
    for (const context of contexts) await context.close(); await tvContext.close();
  }
});
