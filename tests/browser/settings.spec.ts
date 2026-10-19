import { expect, type Page } from '@playwright/test';
import { test } from './app-fixture';
import type { IntegrationView } from '../../src/integrations';
import { openNavigation } from './navigation-helpers';

async function noHorizontalOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
}

async function expectConfiguredConnection(page: Page, state = 'Connected') {
  const connection = page.getByRole('region', { name: '1. Music connection', exact: true });
  await expect(connection.locator('.settings-state')).toHaveText(state);
  await expect(connection.getByText('Music Assistant is configured.', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Reload saved settings', exact: true })).toHaveCount(0);
  await expect(connection.getByRole('button', { name: /^(Change connection|Close connection settings)$/ })).toBeEnabled();
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
  await expect(page.locator('.host-invitations')).toBeVisible();
  const columns = (selectors: string[]) => selectors.map(selector => {
    const rect = document.querySelector(selector)!.getBoundingClientRect(); return { x: rect.x, width: rect.width };
  });
  const hostColumns = await page.evaluate(columns, ['.host-workspace', '.host-invitations']);
  const palette = await page.evaluate(() => ['--bg', '--panel', '--line', '--text', '--accent'].map(key => getComputedStyle(document.body).getPropertyValue(key)));
  await openNavigation(page);
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  await openNavigation(page);
  await expect(page.getByRole('banner').getByRole('navigation', { name: 'Primary navigation' }).getByRole('link', { name: 'Settings' })).toHaveAttribute('aria-current', 'page');
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => ['--bg', '--panel', '--line', '--text', '--accent'].map(key => getComputedStyle(document.body).getPropertyValue(key)))).toEqual(palette);
  await expect(page.getByRole('region', { name: '1. Music connection', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: '2. Active speaker', exact: true })).toBeVisible();
  await expect(page.getByLabel('Speaker or group', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Speaker or group', { exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: /^(Change speaker|Save speaker|Cancel speaker change)$/ })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Return to host · Invite people', exact: true })).toHaveCount(0);
  expect(await page.evaluate(columns, ['.settings-connection', '.settings-output'])).toEqual(hostColumns);
  await expect(page.getByRole('button', { name: 'Reload saved settings', exact: true })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Live playback', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^(Enable|Disable) live playback$/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Disconnect', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Check connection/ })).toHaveCount(0);
  await expect(page.locator('.settings-help')).toHaveJSProperty('open', false);
  await page.getByText('Advanced: token or separate login address', { exact: true }).click();
  await page.locator('.settings-help > summary').click();
  await page.getByRole('button', { name: 'Find Music Assistant', exact: true }).click();
  await expect(page.locator('.settings-help')).toHaveJSProperty('open', true);
  await expect(page.getByRole('button', { name: 'Save connection', exact: true })).toBeEnabled();
  await page.locator('.settings-help > summary').click();
  await expect(page.getByText('Host access is open:')).toHaveCount(0);
  await expect(page.getByText('This connection uses HTTP. Use HTTPS')).toBeVisible();
  await noHorizontalOverflow(page);
  await page.screenshot({ path: 'test-results/settings-unconfigured.png', fullPage: true });
  await page.getByLabel('Music Assistant URL', { exact: true }).fill(isolatedApp.musicAssistantOrigin);
  await page.getByLabel('Music Assistant access token', { exact: true }).fill('browser-test-token');
  await page.getByRole('button', { name: 'Save connection', exact: true }).click();
  await expect(page.getByText('Connection saved.', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Speaker or group', { exact: true })).toBeEnabled();
  expect((await (await page.request.get('/api/host/integrations')).json()).playbackAvailable).toBe(false);
  await expectConfiguredConnection(page);
  expect(outgoing.filter(url => url.endsWith('/destination'))).toEqual([]);
  await page.getByLabel('Speaker or group', { exact: true }).selectOption('sonos:room');
  await expect(page.getByText('Active speaker: Living room', { exact: true })).toBeVisible();
  await expect(page.getByText('Living room is now the active speaker.', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Speaker or group', { exact: true })).toHaveValue('sonos:room');
  await page.getByLabel('Speaker or group', { exact: true }).selectOption('sonos:room');
  expect(outgoing.filter(url => url.endsWith('/destination'))).toHaveLength(1);
  expect((await (await page.request.get('/api/host/integrations')).json()).playbackAvailable).toBe(true);
  await expect(page.getByText('Pressing Play replaces the selected speaker’s queue and may interrupt other audio.', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/settings-configured.png', fullPage: true });
  await page.reload();
  await expectConfiguredConnection(page);
  await expect(page.getByText('Active speaker: Living room', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Speaker or group', { exact: true })).toBeEnabled();
  await expect(page.getByLabel('Speaker or group', { exact: true })).toHaveValue('sonos:room');
  expect(outgoing.some(url => url.endsWith('/playback'))).toBe(false);
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 }); await noHorizontalOverflow(page);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'test-results/settings-mobile.png', fullPage: true });
  await page.reload();
  await expect(page.getByText('Active speaker: Living room', { exact: true })).toBeVisible();
  await expectConfiguredConnection(page);
  expect(responses.join('')).not.toContain('browser-test-token');
  expect(responses.join('')).not.toContain('PRIVATE FIXTURE TRACK');
  expect(responses.join('')).not.toContain('http://private.example/art');
  expect(outgoing.some(url => url.startsWith(isolatedApp.musicAssistantOrigin))).toBe(false); // Only the backend talks to Music Assistant.
  expect(await page.evaluate(() => Object.values(localStorage).join(''))).not.toContain('browser-test-token');
  await page.getByRole('button', { name: 'Change connection', exact: true }).click();
  page.once('dialog', dialog => dialog.dismiss());
  await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await expectConfiguredConnection(page);
  await expect(page.getByText('Active speaker: Living room', { exact: true })).toBeVisible();
  expect(outgoing.some(url => url.endsWith('/clear'))).toBe(false);
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await expect(page.getByText('Music Assistant disconnected.', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Music Assistant URL', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('Music Assistant access token', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('Speaker or group', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Speaker or group', { exact: true })).toBeDisabled();
  await expect(page.getByLabel('Speaker or group', { exact: true })).toHaveValue('');
  await expect(page.getByRole('button', { name: /^(Enable|Disable) live playback$/ })).toHaveCount(0);
  const disconnected: IntegrationView = await (await page.request.get('/api/host/integrations')).json();
  expect(disconnected.tokenConfigured).toBe(false); expect(disconnected.destination).toBeNull(); expect(disconnected.playbackAvailable).toBe(false);
  await page.getByLabel('Music Assistant URL', { exact: true }).fill(isolatedApp.musicAssistantOrigin);
  await page.getByText('Advanced: token or separate login address', { exact: true }).click();
  await page.getByLabel('Music Assistant access token', { exact: true }).fill('wrong-token');
  await page.getByRole('button', { name: 'Save connection', exact: true }).click();
  await expect(page.getByText('Connection saved.', { exact: true })).toBeVisible();
  await expectConfiguredConnection(page, 'Needs attention');
  await expect(page.getByRole('alert')).toContainText('rejected the token');
  await page.reload();
  await expectConfiguredConnection(page, 'Needs attention');
  await expect(page.getByRole('alert')).toContainText('rejected the token');
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await expect(page.getByText('Music Assistant disconnected.', { exact: true })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.reload();
  await expect(page.getByLabel('Music Assistant URL', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('Music Assistant access token', { exact: true })).toHaveValue('');
  await expect(page.getByRole('button', { name: 'Disconnect', exact: true })).toHaveCount(0);
  expect(outgoing.some(url => url.endsWith('/check'))).toBe(false);
  expect(outgoing.filter(url => url.endsWith('/destination'))).toHaveLength(1);
  expect(isolatedApp.calls.some(call => /play_media|cmd\/|\/stop$|\/pause$|\/resume$/.test(call.command))).toBe(false);
});

test('a rejected disconnect keeps the configured summary and saved destination', async ({ page }) => {
  const settings: IntegrationView = {
    revision: 3, url: 'http://music-assistant.local:8095', tokenConfigured: true,
    output: { name: 'Living room', state: 'checking', checkedAt: null },
    destination: { id: 'sonos:test', name: 'Living room' }, status: 'not-checked', message: '',
    destinationStatus: 'not-checked', destinationMessage: 'The saved speaker has not been checked.',
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
  await expectConfiguredConnection(page, 'Not checked');
  await page.getByRole('button', { name: 'Change connection', exact: true }).click();
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Stop or finish the current track');
  await expectConfiguredConnection(page, 'Not checked');
  await expect(page.getByText('Checking Living room…', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /^(Enable|Disable) live playback$/ })).toHaveCount(0);
  expect(changes).toEqual(['/api/host/integrations/clear']);
});

test('settings keep recovery warnings visible and require confirmation without automatic integration changes', async ({ page }) => {
  const settings: IntegrationView = {
    revision: 1, url: 'http://music-assistant.local:8095', tokenConfigured: true,
    output: { name: 'A longer speaker group name for the listening room', state: 'recovery', checkedAt: null },
    destination: { id: 'sonos:test', name: 'A longer speaker group name for the listening room' },
    status: 'error', message: 'The connection check failed. Check the saved server and token.',
    destinationStatus: 'not-checked', destinationMessage: 'Speaker status cannot be checked until Music Assistant is connected.',
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
  await expectConfiguredConnection(page, 'Needs attention');
  await expect(page.getByRole('alert')).toContainText('connection check failed');
  await expect(page.locator('.settings-recovery')).toContainText('The speaker may still be playing');
  await page.locator('.settings-recovery summary').click();
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

for (const scenario of ['offline-speaker', 'missing-speaker', 'queue-failure', 'no-speaker', 'ma-failure'] as const) {
  test(`Music Assistant and speaker health stay independent for ${scenario}`, async ({ page, isolatedApp }) => {
    const connectionFailed = scenario === 'ma-failure'; const noSpeaker = scenario === 'no-speaker';
    const message = connectionFailed ? 'Music Assistant rejected the token. Reconnect Music Assistant.' : '';
    const destinationMessage = scenario === 'offline-speaker' || scenario === 'missing-speaker' ? 'The saved speaker is unavailable in Music Assistant. Check that speaker or choose another destination.'
      : scenario === 'queue-failure' ? 'The speaker’s queue could not be checked. Check the speaker in Music Assistant and try again.'
      : connectionFailed ? 'Speaker status cannot be checked until Music Assistant is connected.' : 'Choose a speaker or group before playing.';
    const settings: IntegrationView = {
      revision: 2, url: isolatedApp.musicAssistantOrigin, tokenConfigured: true,
      output: { name: noSpeaker ? null : 'Living room', state: noSpeaker ? 'none' : connectionFailed ? 'unconfirmed' : 'unavailable', checkedAt: null },
      destination: noSpeaker ? null : { id: 'sonos:room', name: 'Living room' },
      status: connectionFailed ? 'error' : 'checked', message,
      destinationStatus: noSpeaker ? 'not-selected' : connectionFailed ? 'not-checked' : 'error', destinationMessage,
      report: connectionFailed ? null : { checkedAt: Date.now(), serverVersion: 'fixture', schemaVersion: 65, docsAvailable: true,
        players: [{ id: 'sonos:room', name: 'Living room', available: scenario !== 'offline-speaker' }, { id: 'sonos:bedroom', name: 'Bedroom', available: true }]
          .filter(player => scenario !== 'missing-speaker' || player.id !== 'sonos:room') },
      playbackAvailable: !noSpeaker, playbackIssue: '',
    };
    const writes: string[] = [];
    await page.route('**/api/host/integrations**', async route => {
      if (route.request().method() === 'POST') writes.push(route.request().url());
      await route.fulfill({ json: settings });
    });
    await page.setViewportSize({ width: 320, height: 844 }); await page.goto('/host/settings');
    await expectConfiguredConnection(page, connectionFailed ? 'Needs attention' : 'Connected');
    const connection = page.locator('.settings-connection'); const speaker = page.locator('.settings-destination');
    const select = speaker.getByLabel('Speaker or group', { exact: true });
    const savedAvailable = scenario === 'queue-failure';
    await expect(select).toBeVisible(); await expect(select).toHaveValue('');
    if (connectionFailed) await expect(select).toBeDisabled(); else await expect(select).toBeEnabled();
    if (!savedAvailable && !noSpeaker) await expect(select.locator('option[value="sonos:room"]')).toHaveCount(0);
    await expect(speaker.getByRole('button', { name: /^(Change speaker|Save speaker|Cancel speaker change)$/ })).toHaveCount(0);
    await expect(speaker.locator('.settings-state')).toHaveText(connectionFailed ? 'Unconfirmed' : 'No active speaker');
    await expect(page.locator('.settings-notice.error')).toHaveCount(0);
    if (connectionFailed) {
      await expect(connection.getByRole('alert')).toHaveText(message); await expect(speaker.getByRole('alert')).toHaveCount(0);
      await expect(speaker).toContainText('Speaker status will update');
    } else {
      await expect(connection.getByRole('alert')).toHaveCount(0);
      await expect(connection.getByRole('button', { name: 'Reconnect Music Assistant', exact: true })).toHaveCount(0);
      if (noSpeaker) await expect(speaker.getByRole('alert')).toHaveCount(0);
      else await expect(speaker.getByRole('alert')).toHaveText(destinationMessage);
      await expect(connection).not.toContainText(destinationMessage);
    }
    expect(writes).toEqual([]); expect(isolatedApp.calls).toEqual([]); await noHorizontalOverflow(page);
  });
}

test('a failed automatic speaker selection restores the saved speaker without downgrading Music Assistant or retrying the write', async ({ page, isolatedApp }) => {
  const settings: IntegrationView = {
    revision: 2, url: isolatedApp.musicAssistantOrigin, tokenConfigured: true, destination: { id: 'sonos:room', name: 'Living room' },
    output: { name: 'Living room', state: 'ready', checkedAt: Date.now() },
    status: 'checked', message: 'Music Assistant is connected and authorized.', destinationStatus: 'checked', destinationMessage: '',
    report: { checkedAt: Date.now(), serverVersion: 'fixture', schemaVersion: 65, docsAvailable: true,
      players: [{ id: 'sonos:room', name: 'Living room', available: true }, { id: 'sonos:bedroom', name: 'Bedroom', available: true }] },
    playbackAvailable: true, playbackIssue: '',
  };
  let release!: () => void; let enter!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; }); const entered = new Promise<void>(resolve => { enter = resolve; });
  const writes: string[] = []; const message = 'The speaker’s queue could not be checked. Try another speaker.';
  await page.route('**/api/host/integrations**', async route => {
    if (route.request().method() === 'POST') {
      writes.push(new URL(route.request().url()).pathname);
      expect(route.request().postDataJSON()).toEqual({ id: 'sonos:bedroom', revision: 2 });
      if (writes.length === 1) { enter(); await held; await route.fulfill({ status: 502, json: { error: message } }); }
      else {
        settings.destination = { id: 'sonos:bedroom', name: 'Bedroom' }; settings.output = { name: 'Bedroom', state: 'ready', checkedAt: Date.now() }; settings.revision++;
        await route.fulfill({ json: settings });
      }
    }
    else await route.fulfill({ json: settings });
  });
  try {
    await page.goto('/host/settings'); await expectConfiguredConnection(page);
    await page.getByLabel('Speaker or group', { exact: true }).focus();
    await page.getByLabel('Speaker or group', { exact: true }).selectOption('sonos:bedroom');
    await entered;
    await expect(page.locator('.settings-connection .settings-state')).toHaveText('Connected');
    await expect(page.locator('.settings-destination .settings-state')).toHaveText('Selecting…');
    await expect(page.getByLabel('Speaker or group', { exact: true })).toBeDisabled();
    await expect(page.getByLabel('Speaker or group', { exact: true })).toHaveValue('sonos:bedroom');
    await page.getByLabel('Speaker or group', { exact: true }).dispatchEvent('change');
    release(); await expect(page.locator('.settings-destination').getByRole('alert')).toHaveText(message);
    await expectConfiguredConnection(page); await expect(page.locator('.settings-connection').getByRole('alert')).toHaveCount(0);
    await expect(page.locator('.settings-notice.error')).toHaveCount(0);
    await expect(page.getByText('Active speaker: Living room', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Speaker or group', { exact: true })).toHaveValue('sonos:room');
    await expect(page.getByLabel('Speaker or group', { exact: true })).toBeEnabled();
    await expect(page.getByLabel('Speaker or group', { exact: true })).toBeFocused();
    const revalidated = page.waitForResponse(response => response.url().endsWith('/api/host/integrations/destinations') && response.request().method() === 'GET');
    await page.evaluate(() => window.dispatchEvent(new Event('focus'))); await revalidated;
    expect(writes).toEqual(['/api/host/integrations/destination']);
    await page.getByLabel('Speaker or group', { exact: true }).selectOption('sonos:bedroom');
    await expect(page.getByText('Active speaker: Bedroom', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Speaker or group', { exact: true })).toHaveValue('sonos:bedroom');
    await expect(page.locator('.settings-destination').getByRole('alert')).toHaveCount(0);
    expect(writes).toEqual(['/api/host/integrations/destination', '/api/host/integrations/destination']);
  } finally { release(); }
});

for (const inventory of ['empty', 'all-offline', 'missing-saved'] as const) {
  test(`speaker discovery removes stale choices and recovers from ${inventory} without automatic selection`, async ({ page, isolatedApp }) => {
    await isolatedApp.manager.save(isolatedApp.musicAssistantOrigin, 'browser-test-token', 0);
    const saved = await isolatedApp.manager.selectDestination('sonos:room', 1);
    const bedroom = { player_id: 'sonos:bedroom', name: 'Bedroom', available: true };
    isolatedApp.setSpeakers(inventory === 'empty' ? [] : inventory === 'missing-saved' ? [bedroom] : [
      { player_id: 'sonos:room', name: 'Living room', available: false }, { ...bedroom, available: false },
    ]);
    const writes: string[] = [];
    page.on('request', request => { if (request.method() === 'POST' && request.url().includes('/api/host/integrations')) writes.push(request.url()); });
    await page.setViewportSize({ width: 320, height: 844 }); await page.goto('/host/settings');
    await expectConfiguredConnection(page);
    const speaker = page.locator('.settings-destination');
    const select = speaker.getByLabel('Speaker or group', { exact: true });
    await expect(select).toHaveValue('');
    await expect(select.locator('option[value="sonos:room"]')).toHaveCount(0);
    await expect(speaker).toContainText('Living room is unavailable.');
    if (inventory === 'missing-saved') {
      await expect(select).toBeEnabled();
      await expect(select.locator('option')).toHaveText(['Choose a speaker or group', 'Bedroom']);
    } else {
      await expect(select).toBeDisabled();
      await expect(select.locator('option')).toHaveText(['No available speakers or groups']);
      await expect(speaker).toContainText(inventory === 'empty' ? 'No speakers found.' : 'No speakers are currently available.');
    }
    await expect(speaker.getByRole('button', { name: 'Refresh speakers' })).toBeEnabled();
    expect(writes).toEqual([]);
    // A stale client still cannot select a missing/offline speaker through the API.
    const rejected = await page.request.post('/api/host/integrations/destination', {
      headers: { Origin: isolatedApp.origin }, data: { id: 'sonos:room', revision: saved.revision },
    });
    expect(rejected.status()).toBe(409);
    expect(isolatedApp.manager.view().destination).toEqual(saved.destination);
    expect(isolatedApp.manager.view().revision).toBe(saved.revision);
    isolatedApp.setSpeakers([bedroom]);
    await speaker.getByRole('button', { name: 'Refresh speakers' }).click();
    await expect(select).toBeEnabled(); await expect(select).toHaveValue('');
    await expect(select.locator('option')).toHaveText(['Choose a speaker or group', 'Bedroom']);
    expect(writes).toEqual([]); expect(isolatedApp.manager.view().revision).toBe(saved.revision);
    await select.selectOption('sonos:bedroom');
    await expect(speaker.getByText('Active speaker: Bedroom', { exact: true })).toBeVisible();
    await expect(select).toHaveValue('sonos:bedroom');
    expect(isolatedApp.manager.view().destination?.id).toBe('sonos:bedroom');
    expect(writes).toHaveLength(1);
    // Settings also performs a read-only file-address diagnostic via item_by_uri.
    const reads = ['players/all', 'players/get', 'player_queues/get_active_queue', 'music/item_by_uri'];
    expect(isolatedApp.calls.filter(call => !reads.includes(call.command))).toEqual([]);
    await noHorizontalOverflow(page);
  });
}
