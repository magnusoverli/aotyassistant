import { expect } from '@playwright/test';
import { test } from './app-fixture';
import type { IntegrationView } from '../../src/integrations';

for (const width of [1440, 390]) test(`background speaker refresh retains selection and focus but never disguises last-known inventory at ${width}px`, async ({ page, isolatedApp }) => {
  const { manager, remote } = isolatedApp; manager.stopMonitoring();
  await manager.save(remote.origin, 'fixture-token', 0); await manager.selectDestination('sonos:room', manager.view().revision);
  await page.setViewportSize({ width, height: 900 }); await page.goto('/host/settings');
  const panel = page.locator('.settings-destination'); const select = page.getByLabel('Speaker or group', { exact: true });
  await expect(panel.locator('.settings-state')).toHaveText('Ready');
  await page.locator('.settings-navigation a[href="#music-assistant"]').click();
  await page.getByRole('button', { name: 'Change connection', exact: true }).click();
  const draft = page.getByLabel('Music Assistant URL', { exact: true }); await draft.fill('http://keep-this-draft.local:8095');
  await page.locator('.settings-navigation a[href="#playback"]').click();
  await select.focus();
  await select.evaluate(node => { (window as unknown as { originalSpeakerSelect: Element }).originalSpeakerSelect = node; });
  const gate = remote.holdNextInventoryRead();
  try {
    remote.setSpeakers([{ player_id: 'sonos:bedroom', name: 'Bedroom', available: true }], false);
    await page.evaluate(() => window.dispatchEvent(new Event('focus'))); await gate.entered;
    await expect(panel).toHaveAttribute('data-inventory-state', 'refreshing');
    await expect(panel.locator('.settings-state')).toHaveText('Updating…');
    await expect(panel.locator('#ma-destination-help')).toContainText('last verified list');
    await expect(select).toBeEnabled(); await expect(select).toHaveValue('sonos:room');
    await expect(select.locator('option[value="sonos:room"]')).toHaveText('Living room');
    expect(manager.playbackAvailable).toBe(true); // Updating inventory is not a playback interruption.
    await expect(select).toBeFocused();
    gate.release();
    await expect(panel).toHaveAttribute('data-inventory-state', 'verified');
    await expect(select.locator('option[value="sonos:room"]')).toHaveCount(0);
    await expect(select).toHaveValue(''); await expect(select).toBeFocused();
    await expect(draft).toHaveValue('http://keep-this-draft.local:8095');
    await select.selectOption('sonos:bedroom');
    await expect(page.getByText('Active speaker: Bedroom', { exact: true })).toBeVisible();
    remote.fail(true);
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(panel).toHaveAttribute('data-inventory-state', 'failed');
    await expect(panel.locator('.settings-state')).not.toHaveText('Ready');
    await expect(panel.locator('#ma-destination-help')).toContainText('availability is not verified');
    await expect(select.locator('option[value="sonos:bedroom"]')).toHaveText('Bedroom');
    await expect(select).toHaveValue('sonos:bedroom'); await expect(select).toBeDisabled();
    remote.fail(false); await panel.getByRole('button', { name: 'Refresh speakers', exact: true }).click();
    await expect(panel.locator('.settings-state')).toHaveText('Ready'); await expect(select).toBeEnabled();
    expect(await select.evaluate(node => node === (window as unknown as { originalSpeakerSelect: Element }).originalSpeakerSelect)).toBe(true);
    expect(remote.calls.filter(call => /play_media|player_queues\/(stop|pause|resume)|players\/cmd\//.test(call.command))).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally { gate.release(); remote.fail(false); }
});

test('browser readiness expires without events, survives clock skew, and cannot be renewed by an old snapshot', async ({ page, isolatedApp }) => {
  await page.clock.install({ time: new Date('2030-01-01T00:00:00Z') });
  await page.addInitScript(() => {
    // Simulate a quiet/stalled stream, not a stream error which already disables controls.
    window.EventSource = class extends EventTarget { close() {} } as unknown as typeof EventSource;
  });
  const settings: IntegrationView = {
    revision: 1, instanceId: 'fixture', sequence: 1, url: isolatedApp.musicAssistantOrigin, tokenConfigured: true,
    destination: { id: 'one', name: 'Living room' }, status: 'checked', destinationStatus: 'checked', destinationMessage: '', message: '',
    playbackAvailable: true, playbackIssue: '', output: { name: 'Living room', state: 'ready', checkedAt: 98_000 },
    report: { checkedAt: 100_000, serverVersion: 'fixture', schemaVersion: 65, docsAvailable: false, players: [{ id: 'one', name: 'Living room', available: true }] },
    speakerInventory: { state: 'verified', checkedAt: 100_000, expiresAt: 145_000, asOf: 140_000, players: [{ id: 'one', name: 'Living room', available: true }] },
  };
  let reads = 0; const writes: string[] = [];
  await page.route('**/api/host/integrations**', async route => {
    if (route.request().method() === 'POST') writes.push(route.request().url()); else reads++;
    await route.fulfill({ json: settings });
  });
  await page.goto('/host/settings');
  const panel = page.locator('.settings-destination'); const select = page.getByLabel('Speaker or group', { exact: true });
  await expect(panel.locator('.settings-state')).toHaveText('Ready'); await select.focus();
  await page.clock.runFor(3500);
  await expect(panel).toHaveAttribute('data-inventory-state', 'verified');
  await expect(panel.locator('.settings-state')).toHaveText('Checking…');
  await page.clock.runFor(2500);
  await expect(panel).toHaveAttribute('data-inventory-state', 'stale');
  await expect(panel.locator('.settings-state')).toHaveText('Checking…');
  await expect(panel.locator('#ma-destination-help')).toContainText('information has expired');
  await expect(panel.locator('.active-destination')).toHaveCount(0);
  await expect(select).toHaveValue('one'); await expect(select).toBeEnabled(); await expect(select).toBeFocused();
  const before = reads; await page.clock.runFor(60_000);
  expect(reads).toBeLessThanOrEqual(before + 1); expect(writes).toEqual([]);
  await expect(panel.locator('.settings-state')).not.toHaveText('Ready');
});
