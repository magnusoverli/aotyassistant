import { expect } from '@playwright/test';
import { test } from './app-fixture';

test('settings section navigation preserves form drafts, supports history and fits desktop and mobile', async ({ page }) => {
  const writes: string[] = []; page.on('request', request => { if (request.method() === 'POST') writes.push(request.url()); });
  await page.goto('/host/settings');
  await expect(page.locator('.settings-navigation a[href="#music-assistant"]')).toHaveAttribute('aria-current', 'location');
  const input = page.getByLabel('Music Assistant URL', { exact: true }); await input.fill('http://my-unsaved-server.local:8095');
  await input.evaluate(node => { (window as unknown as { retainedSettingsInput: Element }).retainedSettingsInput = node; });
  await page.locator('.settings-navigation a[href="#users"]').click();
  await expect(page.getByRole('heading', { name: 'No users yet', exact: true })).toBeVisible();
  await expect(input).toBeHidden();
  await page.goBack(); await expect(input).toBeVisible(); await expect(input).toHaveValue('http://my-unsaved-server.local:8095');
  expect(await input.evaluate(node => node === (window as unknown as { retainedSettingsInput: Element }).retainedSettingsInput)).toBe(true);
  for (const width of [1440, 1024, 820, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    for (const section of ['playback', 'users', 'music-assistant', 'access']) {
      await page.locator(`.settings-navigation a[href="#${section}"]`).click();
      await expect(page.locator('.settings-section:not([hidden])')).toHaveCount(1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
  }
  await page.reload(); await expect(page.locator('.settings-navigation a[href="#access"]')).toHaveAttribute('aria-current', 'location');
  expect(writes).toEqual([]);
});

test('users are managed inline and the same browser can recreate a deleted name with an empty playlist', async ({ page, isolatedApp }) => {
  const headers = { Origin: isolatedApp.origin };
  const joined = await page.request.post('/api/participant/preparations/join', { headers, data: { nickname: 'Alex', pin: '0042' } });
  expect(joined.ok()).toBe(true); const original = await joined.json();
  const initial = await page.request.post('/api/participant/preparations/init', { headers, data: {} });
  const oldList = await initial.json();
  const participant = await page.context().newPage(); await participant.goto('/participant');
  await expect(participant.locator('.participant-hero')).toBeVisible();
  await page.goto('/host/settings#users');
  await page.getByRole('button', { name: 'Manage Alex', exact: true }).click();
  await expect(page.getByLabel('New 4-digit PIN', { exact: true })).toBeHidden();
  await page.getByRole('button', { name: 'Reset PIN', exact: true }).click();
  await page.getByLabel('New 4-digit PIN', { exact: true }).fill('0099');
  await page.locator('.settings-navigation a[href="#playback"]').click();
  await page.locator('.settings-navigation a[href="#users"]').click();
  await expect(page.getByLabel('New 4-digit PIN', { exact: true })).toHaveValue('0099');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  page.once('dialog', dialog => dialog.dismiss());
  await page.getByRole('button', { name: 'Delete user', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Close Alex', exact: true })).toBeVisible();
  page.once('dialog', dialog => { expect(dialog.message()).toContain('Permanently delete Alex?'); return dialog.accept(); });
  await page.getByRole('button', { name: 'Delete user', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'No users yet', exact: true })).toBeVisible();
  await expect(participant.getByLabel('Display name')).toBeVisible(); await participant.getByLabel('Display name').fill('Alex');
  await participant.getByLabel('4-digit PIN', { exact: true }).fill('0042');
  await participant.getByRole('button', { name: 'Join room', exact: true }).click();
  await expect(participant.locator('.list-empty')).toBeVisible();
  const current = await (await page.request.get('/api/participant/state')).json();
  const list = await (await page.request.get('/api/participant/preparations/state')).json();
  expect(current.user.id).not.toBe(original.user.id); expect(list.ownerId).not.toBe(oldList.ownerId); expect(list.upcoming).toEqual([]);
});
