import { expect } from '@playwright/test';
import { test } from './app-fixture';

test('host suggests the opened address, verifies media automatically without a speaker, and retains guest links across reload', async ({ page, isolatedApp }) => {
  const origin = isolatedApp.origin;
  const saved = await page.request.post('/api/host/integrations/save', { headers: { Origin: origin }, data: { url: isolatedApp.musicAssistantOrigin, accessToken: 'fixture-token', revision: 0 } });
  expect(saved.status()).toBe(200);
  const responses: string[] = []; page.on('response', response => { if (response.url().includes('/api/host/addressing')) void response.text().then(text => responses.push(text)).catch(() => {}); });
  await page.goto('/host/settings');
  const panel = page.getByRole('region', { name: 'Application addresses', exact: true });
  await expect(panel.getByText('File access verified.', { exact: true })).toBeVisible();
  await expect(panel.getByLabel('Guest address', { exact: true })).toBeHidden();
  await expect(panel.getByLabel('Application address reachable from Music Assistant', { exact: true })).toBeHidden();
  await expect(panel.getByText('Last tested:', { exact: false })).toBeHidden();
  expect((await (await page.request.get('/api/host/integrations')).json()).destination).toBeNull();
  await panel.getByText('Change guest address', { exact: true }).click();
  await expect(panel.getByText('Changing address may require people to rejoin or recover their private lists.', { exact: false })).toBeVisible();
  await panel.getByRole('button', { name: 'Use the address I opened for guest links' }).click();
  await expect(panel.getByText('Guest address saved.', { exact: false })).toBeVisible();
  await expect(panel.getByLabel('Guest address', { exact: true })).toHaveValue(origin);
  await panel.getByRole('button', { name: 'Test file connection', exact: true }).click();
  await expect(panel.getByText('File access verified.', { exact: true })).toBeVisible();
  await page.reload(); await expect(panel.getByLabel('Guest address', { exact: true })).toHaveValue(origin);
  await expect(panel.getByText('File access verified.', { exact: true })).toBeVisible();
  await expect(panel.getByLabel('Guest address', { exact: true })).toBeHidden();
  expect(responses.join('')).not.toContain('fixture-token'); expect(responses.join('')).not.toContain('/api/media/check/');
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 844 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  }
  await page.screenshot({ path: 'test-results/settings-addressing-320.png', fullPage: true });
});

test('an unreachable manual override is rejected without replacing the automatic address, with an explicit no-audio retry', async ({ page, isolatedApp }) => {
  const origin = isolatedApp.origin;
  await page.request.post('/api/host/integrations/save', { headers: { Origin: origin }, data: { url: isolatedApp.musicAssistantOrigin, accessToken: 'fixture-token', revision: 0 } });
  await page.goto('/host/settings');
  const panel = page.getByRole('region', { name: 'Application addresses', exact: true });
  await expect(panel.getByText('File access verified.', { exact: true })).toBeVisible();
  const initial = await (await page.request.get('/api/host/addressing')).json();
  await panel.getByText('Advanced address override', { exact: true }).click();
  await panel.getByLabel('Application address reachable from Music Assistant', { exact: true }).fill('http://127.0.0.1:9');
  await panel.getByRole('button', { name: 'Save file playback address', exact: true }).click();
  await expect(panel.getByRole('alert')).toContainText('could not fetch and verify');
  const latest = await (await page.request.get('/api/host/addressing')).json(); expect(latest.mediaOrigin).toBeNull(); expect(latest.effectiveMediaOrigin).toBe(initial.effectiveMediaOrigin);
  await panel.getByRole('button', { name: 'Test file connection', exact: true }).click();
  await expect(panel.getByText('File access verified.', { exact: true })).toBeVisible();
  expect((await (await page.request.get('/api/host/state')).json()).nowPlaying).toBeUndefined();
});

test('the host can select the opened local hostname without MA and new invitation links use it', async ({ page, isolatedApp }) => {
  const port = new URL(isolatedApp.origin).port; const origin = `http://localhost:${port}`;
  // localhost is a configured loopback admin alias; save another advertised origin to exercise explicit selection.
  await page.goto(origin + '/host/settings');
  const panel = page.getByRole('region', { name: 'Application addresses', exact: true });
  await panel.getByText('Change guest address', { exact: true }).click();
  await expect(panel.getByRole('button', { name: 'Use the address I opened for guest links' })).toBeEnabled();
  await panel.getByRole('button', { name: 'Use the address I opened for guest links' }).click();
  await expect(panel.getByText('Guest address saved.', { exact: false })).toBeVisible();
  const saved = await (await page.request.get(origin + '/api/host/addressing')).json(); expect(saved.guestOrigin).toBe(origin);
  const created = await page.request.get(origin + '/api/host/state');
  expect(created.status()).toBe(200); expect(new URL((await created.json()).joinUrl).origin).toBe(origin);
});
