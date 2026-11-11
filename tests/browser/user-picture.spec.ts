import { expect } from '@playwright/test';
import sharp from 'sharp';
import { test } from './app-fixture';

test('native camera selection previews a crop, saves across room views and removes back to an initial', async ({ page, browser, isolatedApp }) => {
  const joined = await page.request.post('/api/participant/join', { data: { nickname: 'Photo User', pin: '1234' }, headers: { Origin: isolatedApp.origin } });
  expect(joined.ok()).toBe(true);
  await page.goto('/participant');
  const display = await page.context().newPage(); await display.goto('/display');
  const guest = await browser.newContext();
  try {
    const picker = await guest.newPage(); await picker.goto(isolatedApp.origin + '/join');
    await expect(picker.getByRole('button', { name: 'Photo User', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Profile picture', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Profile picture' });
    const camera = dialog.locator('input[capture="user"]'); await expect(camera).toHaveAttribute('accept', 'image/*');
    const chooserEvent = page.waitForEvent('filechooser'); await dialog.getByRole('button', { name: 'Take photo', exact: true }).click();
    const chooser = await chooserEvent; expect(await chooser.element().getAttribute('capture')).toBe('user');
    const buffer = await sharp({ create: { width: 600, height: 1000, channels: 3, background: '#2590bb' } }).jpeg().toBuffer();
    await chooser.setFiles({ name: 'camera.jpg', mimeType: 'image/jpeg', buffer });
    await expect(dialog.locator('canvas')).toBeVisible();
    await dialog.getByLabel('Zoom', { exact: true }).focus(); await page.keyboard.press('ArrowRight');
    await dialog.locator('canvas').focus(); await page.keyboard.press('ArrowLeft');
    await expect(display.locator('.rotation-seat .avatar img')).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Save picture', exact: true }).click();
    await expect(dialog.getByRole('status')).toContainText('Picture saved');
    await expect(display.locator('.rotation-seat .avatar img')).toBeVisible();
    await expect(picker.getByRole('button', { name: 'Photo User', exact: true }).locator('.avatar img')).toBeVisible();
    await dialog.getByRole('button', { name: 'Remove picture', exact: true }).click();
    await expect(dialog.getByRole('status')).toContainText('Picture removed');
    await expect(display.locator('.rotation-seat .avatar img')).toHaveCount(0);
    await expect(picker.getByRole('button', { name: 'Photo User', exact: true }).locator('.avatar')).toHaveText('P');
  } finally { await guest.close(); }
});

test('closing a selected picture without saving keeps the existing avatar', async ({ page, isolatedApp }) => {
  await page.request.post('/api/participant/join', { data: { nickname: 'Cancel Photo', pin: '1234' }, headers: { Origin: isolatedApp.origin } });
  await page.goto('/participant'); await page.getByRole('button', { name: 'Profile picture', exact: true }).click();
  const dialog = page.getByRole('dialog');
  const image = await sharp({ create: { width: 128, height: 128, channels: 3, background: '#aa2255' } }).png().toBuffer();
  await dialog.locator('input[type=file]:not([capture])').setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: image });
  await expect(dialog.getByRole('button', { name: 'Save picture', exact: true })).toBeEnabled();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  const state = await (await page.request.get('/api/participant/state')).json(); expect(state.user.avatarUrl).toBeUndefined();
});
