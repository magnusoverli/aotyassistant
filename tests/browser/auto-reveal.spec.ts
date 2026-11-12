import { expect } from '@playwright/test';
import { test, catalogueTrack, fixtureSong, fixtureSongOnDisplay } from './app-fixture';

test('settings persist auto reveal and all progress markers disappear after automatic or manual reveal', async ({ page, context, isolatedApp }) => {
  const headers = { Origin: isolatedApp.origin }; await isolatedApp.connect();
  const joined = await (await page.request.post('/api/participant/join', { headers, data: { pin: '1234', nickname: 'Auto listener' } })).json();
  await page.goto('/host/settings#playback');
  const toggle = page.getByRole('checkbox', { name: 'Automatically reveal at 70%' });
  await expect(toggle).toBeEnabled(); await expect(toggle).toBeChecked();
  await toggle.uncheck(); await expect(page.locator('.settings-playback')).toContainText('Saved');
  await page.reload(); await expect(toggle).not.toBeChecked();
  const participant = await context.newPage(); const display = await context.newPage(); const host = await context.newPage();
  const start = async (previousPlaybackId: string | null) => {
    const track = await catalogueTrack(page.request, isolatedApp.origin);
    const response = await page.request.post('/api/participant/play', { headers, data: { turnId: joined.turnId, previousPlaybackId, trackId: track.id } });
    expect(response.ok()).toBe(true); return response.json();
  };
  const playing = await start(null);
  await participant.goto('/participant'); await display.goto('/display'); await host.goto('/host');
  for (const tab of [participant, display, host]) await expect(tab.locator('.auto-reveal-marker')).toBeHidden();
  await toggle.check(); await expect(page.locator('.settings-playback')).toContainText('Saved');
  for (const tab of [participant, display, host]) {
    await expect(tab.locator('.auto-reveal-marker')).toBeVisible();
    await expect(tab.locator('.auto-reveal-marker')).toHaveAccessibleName('Automatic reveal at 70%');
  }
  // 70% of the fixture song's 180 seconds, as Music Assistant would report it.
  isolatedApp.remote.queue.elapsed_time = 126;
  await expect(display.getByRole('heading', { name: fixtureSongOnDisplay, exact: true })).toBeVisible();
  for (const tab of [participant, display, host]) await expect(tab.locator('.auto-reveal-marker')).toBeHidden();
  await expect(host.locator('#host-player')).not.toContainText(fixtureSong);
  const replacement = await start(playing.ownPlayback.id);
  await expect(display.locator('.auto-reveal-marker')).toBeVisible();
  await page.request.post('/api/participant/reveal', { headers, data: { turnId: joined.turnId, playbackId: replacement.ownPlayback.id } });
  for (const tab of [participant, display, host]) await expect(tab.locator('.auto-reveal-marker')).toBeHidden();
});
