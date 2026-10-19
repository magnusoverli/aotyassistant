import { expect } from '@playwright/test';
import { test } from './app-fixture';

test('active output stays synchronized across Settings, host and participant as speakers disappear and return', async ({ page, browser, isolatedApp }) => {
  await isolatedApp.manager.save(isolatedApp.musicAssistantOrigin, 'fixture-token', 0);
  await isolatedApp.manager.selectDestination('sonos:room', isolatedApp.manager.view().revision);
  const context = await browser.newContext({ viewport: { width: 320, height: 700 } });
  try {
    const other = await context.newPage(); const host = await context.newPage(); const participant = await context.newPage();
    await context.request.post(isolatedApp.origin + '/api/participant/join', { data: { nickname: 'Listener' }, headers: { Origin: isolatedApp.origin } });
    await page.goto('/host/settings'); await other.goto(isolatedApp.origin + '/host/settings');
    await host.goto(isolatedApp.origin + '/host'); await participant.goto(isolatedApp.origin + '/participant');
    for (const screen of [host, participant]) await expect(screen.locator('.output-label')).toHaveText('Output: Living room');
    const geometry = () => participant.locator('.playback-card').evaluate(node => ({ height: node.getBoundingClientRect().height, top: node.getBoundingClientRect().top + scrollY }));
    const before = await geometry();
    await other.getByRole('button', { name: 'Change connection', exact: true }).click();
    await other.getByLabel('Music Assistant URL', { exact: true }).fill('http://keep-draft.local:8095');
    await page.getByLabel('Speaker or group', { exact: true }).selectOption('sonos:bedroom');
    await expect(other.getByText('Active speaker: Bedroom', { exact: true })).toBeVisible();
    await expect(other.getByLabel('Music Assistant URL', { exact: true })).toHaveValue('http://keep-draft.local:8095');
    for (const screen of [host, participant]) await expect(screen.locator('.output-label')).toHaveText('Output: Bedroom');
    await page.getByLabel('Speaker or group', { exact: true }).focus();
    isolatedApp.setSpeakers([]);
    for (const screen of [page, other]) {
      await expect(screen.getByLabel('Speaker or group', { exact: true })).toBeDisabled();
      await expect(screen.locator('#ma-destination option')).toHaveText(['No available speakers or groups']);
      await expect(screen.locator('.settings-destination .settings-state')).toHaveText('No active speaker');
    }
    for (const screen of [host, participant]) await expect(screen.locator('.output-label')).toHaveText('Output: No active speaker');
    isolatedApp.setSpeakers([{ player_id: 'sonos:bedroom', name: 'Bedroom', available: true }]);
    for (const screen of [page, other]) await expect(screen.getByText('Active speaker: Bedroom', { exact: true })).toBeVisible();
    for (const screen of [host, participant]) await expect(screen.locator('.output-label')).toHaveText('Output: Bedroom');
    expect(await geometry()).toEqual(before);
    expect(isolatedApp.calls.some(call => /play_media|\/cmd\/|\/stop$|\/pause$|\/resume$/.test(call.command))).toBe(false);
    await participant.screenshot({ path: 'test-results/active-speaker-player-320.png', fullPage: true });
    await other.screenshot({ path: 'test-results/active-speaker-settings-320.png', fullPage: true });
    await context.setOffline(true);
    await expect(other.locator('.settings-destination .settings-state')).toHaveText('Connection lost');
    await expect(other.locator('.active-destination')).toHaveCount(0);
    await expect(participant.locator('.output-label')).toHaveText('Output: Connection lost');
    await context.setOffline(false); await other.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(other.getByText('Active speaker: Bedroom', { exact: true })).toBeVisible();
    await expect(participant.locator('.output-label')).toHaveText('Output: Bedroom');
  } finally { await context.close(); }
});

test('an empty inventory discovers a newly added speaker automatically without choosing it', async ({ page, isolatedApp }) => {
  await isolatedApp.manager.save(isolatedApp.musicAssistantOrigin, 'fixture-token', 0); isolatedApp.setSpeakers([]);
  await page.goto('/host/settings');
  await expect(page.locator('#ma-destination option')).toHaveText(['No available speakers or groups']);
  isolatedApp.setSpeakers([{ player_id: 'sonos:room', name: 'Living room', available: true }]);
  await expect(page.getByLabel('Speaker or group', { exact: true })).toBeEnabled();
  await expect(page.locator('#ma-destination option')).toHaveText(['Choose a speaker or group', 'Living room']);
  await expect(page.getByLabel('Speaker or group', { exact: true })).toHaveValue('');
  expect(isolatedApp.manager.view().destination).toBeNull();
  await page.getByLabel('Speaker or group', { exact: true }).selectOption('sonos:room');
  await expect(page.getByText('Active speaker: Living room', { exact: true })).toBeVisible();
});
