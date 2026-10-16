import { expect, type Page } from '@playwright/test';
import { test } from './app-fixture';
import type { IntegrationView } from '../../src/integrations';

async function noHorizontalOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
}

async function expectConfiguredConnection(page: Page) {
  const connection = page.getByRole('region', { name: 'Music Assistant', exact: true });
  await expect(connection.getByText('Music Assistant is configured.', { exact: true })).toBeVisible();
  await expect(connection.getByRole('button', { name: 'Disconnect', exact: true })).toBeEnabled();
  await expect(connection.locator('input, form, details')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Save connection', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Check connection/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^(Enable|Disable) live playback$/ })).toHaveCount(0);
}

test('host configures Music Assistant entirely in the browser without receiving saved tokens or track metadata', async ({ page, isolatedApp }) => {
  const responses: string[] = [];
  const outgoing: string[] = [];
  page.on('request', request => outgoing.push(request.url()));
  page.on('response', response => {
    if (response.url().includes('/api/host/integrations')) void response.text().then(text => responses.push(text)).catch(() => {});
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/host');
  const palette = await page.evaluate(() => ['--bg', '--panel', '--line', '--text', '--accent'].map(key => getComputedStyle(document.body).getPropertyValue(key)));
  await page.getByRole('link', { name: 'Connections & settings' }).click();
  await expect(page.getByRole('heading', { name: 'Connections & settings.' })).toBeVisible();
  await expect(page.getByRole('banner').getByRole('navigation', { name: 'Primary navigation' }).getByRole('link', { name: 'Connections & settings' })).toHaveAttribute('aria-current', 'page');
  expect(await page.evaluate(() => ['--bg', '--panel', '--line', '--text', '--accent'].map(key => getComputedStyle(document.body).getPropertyValue(key)))).toEqual(palette);
  await expect(page.getByRole('region', { name: 'Music Assistant', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Speaker or group', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Live playback', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^(Enable|Disable) live playback$/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Disconnect', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Check connection/ })).toHaveCount(0);
  await expect(page.locator('.settings-help')).toHaveJSProperty('open', false);
  await page.getByText('Advanced: token or separate login address', { exact: true }).click();
  await page.locator('.settings-help > summary').click();
  await page.getByRole('button', { name: 'Reload saved settings', exact: true }).click();
  await expect(page.locator('.settings-help')).toHaveJSProperty('open', true);
  await expect(page.getByRole('button', { name: 'Save connection', exact: true })).toBeEnabled();
  await page.locator('.settings-help > summary').click();
  await expect(page.getByText('Host access is open:')).toHaveCount(0);
  await expect(page.getByText('HTTP connection — use HTTPS')).toBeVisible();
  await noHorizontalOverflow(page);
  await page.screenshot({ path: 'test-results/settings-unconfigured.png', fullPage: true });
  await page.getByLabel('Music Assistant URL', { exact: true }).fill(isolatedApp.musicAssistantOrigin);
  await page.getByLabel('Music Assistant access token', { exact: true }).fill('browser-test-token');
  await page.getByRole('button', { name: 'Save connection', exact: true }).click();
  await expect(page.getByText('Connection saved. Speakers are discovered automatically.', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Playback destination', { exact: true })).toBeEnabled();
  expect((await (await page.request.get('/api/host/integrations')).json()).playbackAvailable).toBe(false);
  await expectConfiguredConnection(page);
  await expect(page.getByRole('button', { name: 'Save destination', exact: true })).toBeDisabled();
  await page.getByLabel('Playback destination', { exact: true }).selectOption('sonos:room');
  await page.getByRole('button', { name: 'Save destination', exact: true }).click();
  await expect(page.getByText('Saved destination: Living room', { exact: true })).toBeVisible();
  expect((await (await page.request.get('/api/host/integrations')).json()).playbackAvailable).toBe(true);
  await expect(page.getByText('Music starts only when the current participant presses Play.', { exact: false })).toBeVisible();
  await page.screenshot({ path: 'test-results/settings-configured.png', fullPage: true });
  await page.getByRole('button', { name: 'Reload saved settings', exact: true }).click();
  await expectConfiguredConnection(page);
  await expect(page.getByText('Saved destination: Living room', { exact: true })).toBeVisible();
  expect(outgoing.some(url => url.endsWith('/playback'))).toBe(false);
  await expect(page.locator('header .badge')).toHaveText('LIVE · SONOS');
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 }); await noHorizontalOverflow(page);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'test-results/settings-mobile.png', fullPage: true });
  await page.reload();
  await expect(page.getByText('Saved destination: Living room', { exact: true })).toBeVisible();
  await expectConfiguredConnection(page);
  expect(responses.join('')).not.toContain('browser-test-token');
  expect(responses.join('')).not.toContain('PRIVATE FIXTURE TRACK');
  expect(responses.join('')).not.toContain('http://private.example/art');
  expect(outgoing.some(url => url.startsWith(isolatedApp.musicAssistantOrigin))).toBe(false); // Only the backend talks to Music Assistant.
  expect(await page.evaluate(() => Object.values(localStorage).join(''))).not.toContain('browser-test-token');
  page.once('dialog', dialog => dialog.dismiss());
  await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await expectConfiguredConnection(page);
  await expect(page.getByText('Saved destination: Living room', { exact: true })).toBeVisible();
  expect(outgoing.some(url => url.endsWith('/clear'))).toBe(false);
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await expect(page.getByText('Music Assistant disconnected. You can set up a new connection.', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Music Assistant URL', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('Music Assistant access token', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('Playback destination', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^(Enable|Disable) live playback$/ })).toHaveCount(0);
  await expect(page.locator('header .badge')).toHaveText('DEMO · NO AUDIO');
  const disconnected: IntegrationView = await (await page.request.get('/api/host/integrations')).json();
  expect(disconnected.tokenConfigured).toBe(false); expect(disconnected.destination).toBeNull(); expect(disconnected.playbackAvailable).toBe(false);
  await page.getByLabel('Music Assistant URL', { exact: true }).fill(isolatedApp.musicAssistantOrigin);
  await page.getByText('Advanced: token or separate login address', { exact: true }).click();
  await page.getByLabel('Music Assistant access token', { exact: true }).fill('wrong-token');
  await page.getByRole('button', { name: 'Save connection', exact: true }).click();
  await expect(page.getByText('Connection saved. Speakers are discovered automatically.', { exact: true })).toBeVisible();
  await expectConfiguredConnection(page);
  await expect(page.getByRole('alert')).toContainText('rejected the token');
  await page.getByRole('button', { name: 'Reload saved settings', exact: true }).click();
  await expectConfiguredConnection(page);
  await expect(page.getByRole('alert')).toContainText('rejected the token');
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await expect(page.getByText('Music Assistant disconnected. You can set up a new connection.', { exact: true })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.reload();
  await expect(page.getByLabel('Music Assistant URL', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('Music Assistant access token', { exact: true })).toHaveValue('');
  await expect(page.getByRole('button', { name: 'Disconnect', exact: true })).toHaveCount(0);
  expect(outgoing.some(url => url.endsWith('/check'))).toBe(false);
});

test('a rejected disconnect keeps the configured summary and saved destination', async ({ page }) => {
  const settings: IntegrationView = {
    revision: 3, url: 'http://music-assistant.local:8095', tokenConfigured: true,
    destination: { id: 'sonos:test', name: 'Living room' }, status: 'not-checked', message: '',
    report: null, playbackAvailable: true, playbackIssue: '',
  };
  const changes: string[] = [];
  await page.route('**/api/host/integrations**', async route => {
    if (route.request().method() === 'POST') {
      changes.push(new URL(route.request().url()).pathname);
      await route.fulfill({ status: 409, json: { error: 'Stop or finish the current track before changing connection settings.' } });
    } else await route.fulfill({ json: settings });
  });
  await page.goto('/host/settings');
  await expectConfiguredConnection(page);
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Stop or finish the current track');
  await expectConfiguredConnection(page);
  await expect(page.getByText('Saved destination: Living room', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /^(Enable|Disable) live playback$/ })).toHaveCount(0);
  expect(changes).toEqual(['/api/host/integrations/clear']);
});

test('settings keep recovery warnings visible and require confirmation without automatic integration changes', async ({ page }) => {
  const settings: IntegrationView = {
    revision: 1, url: 'http://music-assistant.local:8095', tokenConfigured: true,
    destination: { id: 'sonos:test', name: 'A longer speaker group name for the listening room' },
    status: 'error', message: 'The connection check failed. Check the saved server and token.',
    report: null, playbackAvailable: true, playbackIssue: 'Playback state is uncertain. Recover controls before starting another track.',
  };
  const changes: string[] = [];
  await page.route('**/api/host/integrations**', async route => {
    if (route.request().method() === 'POST') {
      changes.push(new URL(route.request().url()).pathname);
      if (route.request().url().endsWith('/recover')) settings.playbackIssue = '';
    }
    await route.fulfill({ json: settings });
  });
  await page.setViewportSize({ width: 320, height: 844 }); await page.goto('/host/settings');
  await expectConfiguredConnection(page);
  await expect(page.getByRole('alert')).toContainText('connection check failed');
  await expect(page.getByText(settings.playbackIssue, { exact: true })).toBeVisible();
  expect(changes).toEqual([]); await noHorizontalOverflow(page);
  page.once('dialog', dialog => dialog.dismiss());
  await page.getByRole('button', { name: 'Recover playback controls', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Recover playback controls', exact: true })).toBeEnabled();
  expect(changes).toEqual([]);
  await page.screenshot({ path: 'test-results/settings-recovery-mobile.png', fullPage: true });
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Recover playback controls', exact: true }).click();
  await expect(page.getByText('Playback controls recovered. Select a track to start again.', { exact: true })).toBeVisible();
  expect(changes).toEqual(['/api/host/integrations/recover']);
  await expect(page.getByRole('button', { name: 'Recover playback controls', exact: true })).toHaveCount(0);
});
