import { expect } from '@playwright/test';
import { test } from './app-fixture';

test('the shared playback component preserves host and participant actions, privacy and turn permissions', async ({ page: host, browser, isolatedApp }) => {
  const headers = { Origin: isolatedApp.origin };
  const joined = await (await host.request.post('/api/participant/join', { headers, data: { nickname: 'Current listener' } })).json();
  const other = await browser.newContext({ baseURL: isolatedApp.origin });
  try {
    await other.request.post('/api/participant/join', { headers, data: { nickname: 'Next listener' } });
    const participant = await host.context().newPage(); const waiting = await other.newPage();
    await host.goto('/host'); await participant.goto('/participant'); await waiting.goto('/participant');
    for (const [page, role] of [[host, 'host'], [participant, 'participant'], [waiting, 'participant']] as const) {
      await expect(page.locator('[data-playback-role]')).toHaveCount(1);
      await expect(page.locator('[data-playback-role]')).toHaveAttribute('data-playback-role', role);
      await expect(page.getByRole('slider', { name: 'Volume', exact: true })).toHaveCount(1);
    }
    await expect(host.locator('[data-playback-role] #player-transport, [data-playback-role] #player-reveal')).toHaveCount(0);
    await expect(participant.locator('#host-skip-turn, #host-stop')).toHaveCount(0);
    await expect(waiting.locator('#finish-my-turn')).toBeDisabled();
    const start = await participant.request.post('/api/participant/play', { headers, data: { turnId: joined.turnId, previousPlaybackId: null, trackId: 'demo:aurora' } });
    expect(start.ok()).toBe(true);
    await expect(participant.locator('#player-transport')).toBeEnabled();
    await expect(participant.locator('.private-now-playing h2')).toHaveText('Northern Lights');
    await expect(host.locator('.host-live')).not.toContainText('Northern Lights');
    await expect(host.locator('.host-progress .track-times')).toBeEmpty();
    await expect(waiting.locator('#player-transport')).toBeDisabled();
    await expect(waiting.locator('#player-reveal')).toBeDisabled();
    await expect(waiting.getByRole('slider')).toBeDisabled();
    await expect(waiting.locator('.playback-card')).not.toContainText('Northern Lights');
    const writes: string[] = [];
    for (const page of [host, participant]) page.on('request', request => { if (request.method() === 'POST') writes.push(new URL(request.url()).pathname); });
    await participant.locator('#player-transport').click();
    await expect(participant.locator('#player-transport')).toHaveText('Resume');
    await expect(host.locator('.host-playback-status')).toContainText('Paused');
    await participant.locator('#player-reveal').click();
    await expect(host.locator('.host-reveal-status')).toHaveText('Visible on room display');
    await expect(host.locator('.host-live')).not.toContainText('Northern Lights');
    host.once('dialog', dialog => dialog.accept());
    await host.locator('#host-stop').click();
    await expect(host.locator('.host-playback-status')).toContainText('Stopped · Current listener keeps the turn');
    await expect(participant.locator('.playback-status')).toHaveText('■ Stopped');
    await participant.locator('#finish-my-turn').click();
    await expect(host.locator('.host-live h2')).toHaveText('Next listener');
    await expect(waiting.locator('#finish-my-turn')).toBeEnabled();
    await expect(participant.locator('#finish-my-turn')).toBeDisabled();
    expect(writes).toEqual(['/api/participant/control', '/api/participant/reveal', '/api/host/stop', '/api/participant/finish']);
    await participant.close();
  } finally { await other.close(); }
});

test('host pause/resume and both players’ mute/stop controls preserve the turn and use the correct endpoints', async ({ page: host, browser, isolatedApp }) => {
  const headers = { Origin: isolatedApp.origin };
  const joined = await (await host.request.post('/api/participant/join', { headers, data: { nickname: 'Player' } })).json();
  const other = await browser.newContext({ baseURL: isolatedApp.origin });
  try {
    await other.request.post('/api/participant/join', { headers, data: { nickname: 'Waiting' } });
    const participant = await host.context().newPage(); const waiting = await other.newPage();
    await participant.request.post('/api/participant/play', { headers, data: { turnId: joined.turnId, previousPlaybackId: null, trackId: 'demo:aurora' } });
    await host.goto('/host'); await participant.goto('/participant'); await waiting.goto('/participant');
    const calls: { path: string; data: { level?: number; action?: string } }[] = [];
    for (const page of [host, participant]) page.on('request', request => { if (request.method() === 'POST') calls.push({ path: new URL(request.url()).pathname, data: request.postDataJSON() }); });
    await expect(waiting.locator('#player-stop')).toBeDisabled(); await expect(waiting.locator('#player-mute')).toBeDisabled();
    await host.locator('#host-transport').click();
    await expect(participant.locator('#player-transport')).toHaveText('Resume');
    await expect(host.locator('.host-playback-status')).toContainText('Paused');
    expect(isolatedApp.engine.view({ kind: 'host' }).turnId).toBe(joined.turnId);
    await host.locator('#host-transport').click(); await expect(participant.locator('#player-transport')).toHaveText('Pause');
    for (const page of [host, participant]) {
      const before = isolatedApp.engine.adapter.volume!.level!;
      await expect(page.locator('#player-mute')).toBeEnabled(); await page.locator('#player-mute').click();
      await expect(page.locator('#player-mute')).toHaveText('Unmute');
      await expect.poll(() => isolatedApp.engine.adapter.volume!.level).toBe(0);
      await page.locator('#player-mute').click(); await expect(page.locator('#player-mute')).toHaveText('Mute');
      await expect.poll(() => isolatedApp.engine.adapter.volume!.level).toBe(before);
    }
    for (const width of [1440, 844, 390, 320]) for (const page of [host, participant]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await expect(page.locator('.playback-transport')).toHaveAccessibleName('Playback controls');
      await expect(page.getByRole('slider')).toHaveCount(1); // Progress stays honest: no unsupported seek control.
      await page.locator('[data-playback-role]').screenshot({ path: `test-results/playback-controls-${page === host ? 'host' : 'participant'}-${width}.png` });
    }
    await participant.locator('#player-stop').click();
    await expect(host.locator('.host-playback-status')).toContainText('Stopped · Player keeps the turn');
    await expect(participant.locator('#player-transport')).toBeDisabled();
    await expect(participant.locator('#player-mute')).toBeDisabled();
    expect(isolatedApp.engine.view({ kind: 'host' }).turnId).toBe(joined.turnId);
    expect(calls.filter(call => call.path === '/api/host/control').map(call => call.data.action)).toEqual(['pause', 'resume']);
    expect(calls.filter(call => call.path.endsWith('/volume')).map(call => call.data.level)).toEqual([0, 35, 0, 35]);
    expect(calls.filter(call => call.path === '/api/participant/control').map(call => call.data.action)).toEqual(['stop']);
    await participant.close();
  } finally { await other.close(); }
});

test('failed mute rolls back without retrying and changing outputs resets the remembered unmute level', async ({ page, isolatedApp }) => {
  await isolatedApp.manager.save(isolatedApp.musicAssistantOrigin, 'fixture-token', 0);
  await isolatedApp.manager.selectDestination('sonos:room', isolatedApp.manager.view().revision);
  await isolatedApp.engine.join('Listener'); await page.goto('/host');
  const slider = page.getByRole('slider', { name: 'Volume', exact: true });
  await expect(slider).toBeEnabled();
  let writes = 0;
  await page.route('**/api/host/volume', async route => { writes++; await route.fulfill({ status: 503, json: { error: 'Mute was not confirmed.' } }); });
  await page.locator('#player-mute').click();
  await expect(page.getByRole('alert')).toContainText('Mute was not confirmed.');
  await expect(page.locator('#player-mute')).toHaveText('Mute'); await expect(slider).toHaveValue('30'); expect(writes).toBe(1);
  await page.unroute('**/api/host/volume');
  await slider.evaluate(node => { const input = node as HTMLInputElement; input.value = '65'; input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); });
  await expect.poll(() => isolatedApp.calls.filter(call => call.command === 'players/cmd/volume_set').at(-1)?.args.volume_level).toBe(65);
  await page.locator('#player-mute').click(); await expect(page.locator('#player-mute')).toHaveText('Unmute');
  await expect.poll(() => isolatedApp.calls.filter(call => call.command === 'players/cmd/volume_set').at(-1)?.args.volume_level).toBe(0);
  await isolatedApp.manager.selectDestination('sonos:bedroom', isolatedApp.manager.view().revision);
  await expect(page.locator('.output-label')).toHaveText('Output: Bedroom');
  await expect(page.locator('#player-mute')).toHaveText('Unmute'); await expect(slider).toHaveValue('0');
  await page.locator('#player-mute').click();
  await expect.poll(() => isolatedApp.calls.filter(call => call.command === 'players/cmd/volume_set').at(-1)?.args.volume_level).toBe(35);
});
