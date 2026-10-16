import { expect } from '@playwright/test';
import { test } from './app-fixture';

test('a permanent public room opens on fresh browsers and joins need no lifecycle, while reorder/remove stay available', async ({ browser, page: host, isolatedApp }) => {
  const contexts = await Promise.all(Array.from({ length: 3 }, () => browser.newContext({ viewport: { width: 390, height: 844 } })));
  const requests: string[] = []; host.on('request', request => { if (request.method() === 'POST') requests.push(new URL(request.url()).pathname); });
  try {
    await host.goto('/host');
    for (const name of ['Create a session', 'End session', 'New invitation', 'Close joining']) await expect(host.getByRole('button', { name, exact: true })).toHaveCount(0);
    const display = await contexts[2]!.newPage(); await display.goto(isolatedApp.origin + '/display');
    await expect(display.getByRole('heading', { name: 'Nothing playing.', exact: true })).toBeVisible();
    await display.reload(); await expect(display.getByRole('heading', { name: 'Join room', exact: true })).toBeVisible();
    await display.goto(isolatedApp.origin + '/display#access=obsolete');
    await expect(display).toHaveURL(isolatedApp.origin + '/display'); await expect(display.getByRole('alert')).toBeHidden();
    await expect(host.getByRole('button', { name: 'Advance / skip current turn' })).toBeDisabled();
    await expect(host.getByRole('heading', { name: 'Waiting for participants', exact: true })).toBeVisible();
    const invitation = await host.getByRole('link', { name: 'Open guest invitation' }).getAttribute('href');
    const join = async (index: number, nickname: string) => {
      const page = await contexts[index]!.newPage(); page.on('request', request => { if (request.method() === 'POST') requests.push(new URL(request.url()).pathname); });
      await page.goto(invitation!); await page.getByLabel('What should we call you?').fill(nickname); await page.getByRole('button', { name: 'Join room', exact: true }).click();
      await expect(page).toHaveURL(/\/participant$/); return page;
    };
    const first = await join(0, 'First'); await expect(first.getByRole('heading', { name: 'Your turn.', exact: true })).toBeVisible();
    const second = await join(1, 'Second'); await expect(second.getByRole('heading', { name: 'Seat 2 of 2', exact: true })).toBeVisible();
    expect((await (await first.request.get(isolatedApp.origin + '/api/participant/state')).json()).ownPlayback).toBeNull();
    await expect(host.getByRole('button', { name: 'Admit', exact: true })).toHaveCount(0);
    await expect(host.getByRole('button', { name: 'Start listening', exact: true })).toHaveCount(0);
    await expect(host.locator('.host-arrivals, .arrival-actions')).toHaveCount(0);
    await first.getByRole('searchbox', { name: 'Search catalogue' }).fill('Northern'); await first.getByRole('button', { name: 'Search', exact: true }).click();
    await first.getByRole('button', { name: 'Play', exact: true }).click(); await expect(first.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
    const before = await (await first.request.get('/api/participant/state')).json();
    const late = await join(2, 'Late'); await expect(late.getByRole('heading', { name: 'Seat 3 of 3', exact: true })).toBeVisible();
    const after = await (await first.request.get('/api/participant/state')).json(); expect(after.turnId).toBe(before.turnId); expect(after.ownPlayback.id).toBe(before.ownPlayback.id); expect(after.ownPlayback.status).toBe('playing');
    await host.locator('.host-people .person-row').filter({ hasText: 'Second' }).getByRole('button', { name: 'Remove', exact: true }).click();
    await expect(second.getByRole('status').filter({ hasText: 'You’re no longer in the listening order.' })).toBeVisible();
    await expect(first.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
    await host.getByRole('button', { name: 'Move Late up', exact: true }).click();
    await expect(late.getByRole('heading', { name: 'Seat 1 of 2', exact: true })).toBeVisible();
    await expect(host.getByRole('heading', { name: 'First', exact: true })).toBeVisible();
    await host.locator('.host-people .person-row').filter({ hasText: 'First' }).getByRole('button', { name: 'Remove', exact: true }).click();
    await expect(late.getByRole('heading', { name: 'Your turn.', exact: true })).toBeVisible();
    expect((await (await late.request.get('/api/participant/state')).json()).ownPlayback).toBeNull();
    for (const path of ['/api/host/admit', '/api/host/start', '/api/host/create', '/api/host/end', '/api/host/invitation', '/api/display/auth']) expect(requests).not.toContain(path);
    await host.setViewportSize({ width: 320, height: 844 });
    await host.evaluate(() => { (document.activeElement as HTMLElement | null)?.blur(); window.scrollTo({ top: 0, behavior: 'instant' }); });
    expect(await host.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)).toBe(false);
    expect(await host.locator('header').evaluate(node => node.getBoundingClientRect().top)).toBe(0);
    await host.screenshot({ path: 'test-results/host-automatic-session-320.png', fullPage: true });
  } finally { for (const context of contexts) await context.close(); }
});
