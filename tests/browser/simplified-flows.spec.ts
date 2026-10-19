import { expect } from '@playwright/test';
import { test } from './app-fixture';
import { uploadBytes } from '../fixtures/uploads';
import type { IntegrationView } from '../../src/integrations';

test('compact phone workspace keeps results visible, expands the list inline and preserves browsing on turn arrival', async ({ page, browser, isolatedApp }) => {
  const current = await browser.newContext();
  const post = (path: string, data: unknown) => page.request.post(path, { data, headers: { Origin: isolatedApp.origin } });
  try {
    await current.request.post(isolatedApp.origin + '/api/participant/join', { data: { nickname: 'Sam' }, headers: { Origin: isolatedApp.origin } });
    await post('/api/participant/join', { nickname: 'Alex' });
    await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/participant');
    await expect(page.locator('.turn-distance')).toHaveText('You’re next');
    await expect(page.locator('.turn-chip')).toHaveCount(0);
    await expect(page.locator('.catalogue-results')).toHaveCount(0);
    expect((await page.locator('.header-inner').boundingBox())!.height).toBeLessThanOrEqual(72);
    expect((await page.locator('header').boundingBox())!.height).toBeLessThanOrEqual(169);
    await page.getByRole('searchbox').fill('Northern'); await page.getByRole('button', { name: 'Search', exact: true }).click();
    const add = page.getByRole('button', { name: 'Add to list', exact: true });
    await expect(add).toBeInViewport();
    expect((await page.locator('.preparation-list').boundingBox())!.height).toBeLessThanOrEqual(88);
    await add.click(); await expect(page.locator('.list-count')).toHaveText(' · 1');
    await page.getByRole('button', { name: 'Open list', exact: true }).click();
    await expect(page.locator('.saved-track.is-next')).toBeVisible();
    expect(await page.locator('.preparation-list').evaluate(node => getComputedStyle(node).position)).toBe('static');
    await page.getByRole('button', { name: 'Close list', exact: true }).click();
    const before = await page.evaluate(() => scrollY);
    const state = await (await page.request.get('/api/host/state')).json(); await post('/api/host/advance', { turnId: state.turnId });
    await expect(page.locator('.preparation-list a[href="#participant-player"]')).toHaveCount(0);
    await expect(page.getByRole('searchbox')).toHaveValue('Northern');
    expect(await page.evaluate(() => scrollY)).toBe(before);
    expect((await (await page.request.get('/api/participant/state')).json()).ownPlayback).toBeNull();
    await page.setViewportSize({ width: 390, height: 440 });
    await expect.poll(() => page.locator('.preparation-list').evaluate(node => getComputedStyle(node).position)).toBe('static');
    await page.screenshot({ path: 'test-results/simplified-workspace-short.png', fullPage: true });
  } finally { await current.close(); }
});

test('one player separates reveal, volume and finish while keeping search available', async ({ page, isolatedApp }) => {
  await page.request.post('/api/participant/join', { data: { nickname: 'Player' }, headers: { Origin: isolatedApp.origin } });
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/participant');
  await expect(page.locator('.playback-card').getByRole('button', { name: 'Pass turn' })).toBeEnabled();
  await page.getByRole('searchbox').fill('Northern'); await page.getByRole('button', { name: 'Search', exact: true }).click();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Reveal song' })).toBeEnabled();
  await expect(page.locator('.player-ending').getByRole('button', { name: 'Finish turn' })).toBeEnabled();
  await expect(page.getByRole('slider', { name: 'Volume', exact: true })).toBeVisible();
  await expect(page.getByRole('slider', { name: 'Volume', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Reveal song' }).click(); await expect(page.locator('.playback-card .privacy-tag')).toHaveText('Visible on room display');
  await expect(page.getByRole('searchbox')).toHaveValue('Northern');
  await page.getByRole('button', { name: 'Finish turn', exact: true }).click(); await expect(page.locator('.playback-card')).toContainText('Choose a song');
  await expect(page.getByRole('button', { name: 'Pass turn' })).toBeEnabled();
});

test('browser and in-page Back restore private browsing without putting results in history', async ({ page, isolatedApp }) => {
  const post = (path: string, data: unknown) => page.request.post(path, { data, headers: { Origin: isolatedApp.origin } });
  const settings = await (await page.request.get('/api/host/integrations')).json();
  await post('/api/host/integrations/save', { url: isolatedApp.musicAssistantOrigin, accessToken: 'browser-test-token', revision: settings.revision });
  await post('/api/participant/join', { nickname: 'Browse' }); await page.goto('/participant');
  await page.getByRole('searchbox').fill('Fixture'); await page.getByRole('button', { name: 'Search', exact: true }).click();
  await page.getByRole('button', { name: 'View albums', exact: true }).click();
  await page.getByRole('button', { name: 'View tracks', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Add to list', exact: true })).toBeVisible();
  expect(await page.evaluate(() => Object.keys(history.state))).toEqual(['aotyBrowse']);
  expect(new URL(page.url()).pathname).toBe('/participant');
  await page.goBack(); await expect(page.getByRole('button', { name: 'View tracks', exact: true })).toBeVisible();
  await page.goBack(); await expect(page.getByRole('button', { name: 'View albums', exact: true })).toBeVisible();
  await expect(page.getByRole('searchbox')).toHaveValue('Fixture');
  await page.goForward(); await expect(page.getByRole('button', { name: 'View tracks', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '← Artists' }).click(); await expect(page.getByRole('button', { name: 'View albums', exact: true })).toBeVisible();
  expect((await (await page.request.get('/api/participant/state')).json()).ownPlayback).toBeNull();
});

test('upload review, history restoration and recovery-key copy fallback keep saved music intact', async ({ page, isolatedApp }) => {
  await page.request.post('/api/participant/join', { data: { nickname: 'Keeper' }, headers: { Origin: isolatedApp.origin } });
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/participant');
  await page.locator('#list-upload').click(); await expect(page.getByText('Choose one audio file, then review it before adding.')).toBeVisible();
  await page.locator('#track-upload-file').setInputFiles({ name: 'draft.mp3', mimeType: 'audio/mpeg', buffer: uploadBytes });
  await expect(page.getByRole('heading', { name: 'Review uploaded song' })).toBeVisible();
  await page.getByLabel('Track title', { exact: true }).fill('Keep this draft');
  page.once('dialog', dialog => dialog.dismiss());
  await page.locator('#track-upload-file').setInputFiles({ name: 'other.mp3', mimeType: 'audio/mpeg', buffer: uploadBytes });
  await expect(page.getByLabel('Track title', { exact: true })).toHaveValue('Keep this draft');
  await page.locator('.upload-preview').getByRole('button', { name: 'Add to list', exact: true }).click();
  await expect(page.locator('.list-count')).toHaveText(' · 1');
  await page.getByRole('button', { name: 'Open list' }).click();
  await page.getByLabel('Options for Keep this draft', { exact: true }).click();
  await page.getByRole('button', { name: 'Remove', exact: true }).click();
  await page.locator('#list-history').click();
  await page.locator('#list-history').locator('..').getByRole('button', { name: 'Add back', exact: true }).click();
  await expect(page.locator('.saved-track.is-next')).toContainText('Keep this draft');
  await page.locator('#list-recovery').click(); await page.getByRole('button', { name: 'Create recovery key', exact: true }).click();
  const key = page.getByRole('textbox', { name: 'Your private recovery key' }); await expect(key).toBeVisible();
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true }));
  await page.getByRole('button', { name: 'Copy key' }).click();
  await expect(key).toBeFocused(); expect(await key.evaluate(node => (node as HTMLTextAreaElement).selectionEnd)).toBe((await key.inputValue()).length);
  await expect(page.getByRole('button', { name: 'Replace recovery key' })).toBeVisible();
  expect((await (await page.request.get('/api/participant/state')).json()).ownPlayback).toBeNull();
});

test('host invitations remain available with thirty people and consequential actions are guarded', async ({ page, isolatedApp }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/host');
  await expect(page.locator('.host-invitations')).toBeInViewport();
  await expect(page.getByRole('button', { name: 'Skip turn' })).toHaveCount(0);
  await page.request.post('/api/participant/join', { data: { nickname: 'Current' }, headers: { Origin: isolatedApp.origin } });
  for (let i = 1; i < 30; i++) await isolatedApp.engine.join(`Guest ${i}`);
  await expect(page.locator('.rotation-seat')).toHaveCount(30);
  await expect(page.getByRole('button', { name: 'Remove', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Copy join link' }).scrollIntoViewIfNeeded();
  await expect(page.getByRole('button', { name: 'Copy join link' })).toBeInViewport();
  const state = await (await page.request.get('/api/participant/state')).json();
  await page.request.post('/api/participant/play', { data: { turnId: state.turnId, previousPlaybackId: null, trackId: 'demo:aurora' }, headers: { Origin: isolatedApp.origin } });
  await expect(page.locator('.host-playback-status')).toContainText('Playing');
  await expect(page.locator('main')).not.toContainText('Northern Lights');
  page.once('dialog', dialog => dialog.dismiss()); await page.getByRole('button', { name: 'Skip turn' }).click();
  expect((await (await page.request.get('/api/host/state')).json()).turnId).toBe(state.turnId);
  await page.getByRole('button', { name: 'Manage people' }).click();
  page.once('dialog', dialog => dialog.dismiss()); await page.locator('.rotation-seat.is-current').getByRole('button', { name: /^Remove/ }).click();
  await expect(page.locator('.rotation-seat')).toHaveCount(30);
  page.once('dialog', dialog => dialog.accept()); await page.getByRole('button', { name: 'Skip turn' }).click();
  await expect(page.locator('.host-playback-status')).toContainText('Choosing a song');
});

test('setup retries preserve drafts, healthy summaries need no save, and returning reads respect playback blocks', async ({ page, isolatedApp }) => {
  const settings: IntegrationView = { revision: 1, url: isolatedApp.musicAssistantOrigin, tokenConfigured: true,
    output: { name: 'A long speaker group name for the listening room', state: 'checking', checkedAt: null },
    destination: { id: 'room', name: 'A long speaker group name for the listening room' }, status: 'checked', message: '',
    destinationStatus: 'checked', destinationMessage: '',
    report: null, playbackAvailable: true, playbackIssue: '', settingsChangesBlocked: false };
  let fail = true; const writes: string[] = [];
  await page.route('**/api/host/integrations**', async route => {
    if (route.request().method() === 'POST') writes.push(route.request().url());
    if (route.request().url().endsWith('/destinations') && fail) await route.fulfill({ status: 503, json: { error: 'Speaker discovery failed. Try again.' } });
    else await route.fulfill({ json: settings });
  });
  await page.setViewportSize({ width: 320, height: 700 }); await page.goto('/host/settings');
  await expect(page.locator('.settings-destination').getByRole('alert')).toContainText('Speaker discovery failed');
  await page.getByRole('button', { name: 'Change connection', exact: true }).click();
  await page.getByLabel('Music Assistant URL', { exact: true }).fill('http://draft.local:8095');
  settings.report = { checkedAt: Date.now(), serverVersion: 'fixture', schemaVersion: 65, docsAvailable: true,
    players: [{ id: 'room', name: settings.destination!.name, available: true }] };
  settings.output.state = 'ready';
  fail = false; await page.getByRole('button', { name: 'Refresh speakers' }).click();
  await expect(page.getByLabel('Music Assistant URL', { exact: true })).toHaveValue('http://draft.local:8095');
  await expect(page.locator('.settings-destination').getByRole('alert')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Save speaker' })).toHaveCount(0);
  await expect(page.getByLabel('Speaker or group', { exact: true })).toBeEnabled();
  settings.settingsChangesBlocked = true;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByLabel('Speaker or group', { exact: true })).toBeDisabled();
  await page.getByLabel('Speaker or group', { exact: true }).dispatchEvent('change');
  await expect(page.locator('.settings-destination')).toContainText('Finish the current song');
  await expect(page.getByLabel('Music Assistant URL', { exact: true })).toHaveValue('http://draft.local:8095');
  expect(writes).toEqual([]);
  await page.screenshot({ path: 'test-results/settings-blocked-320.png', fullPage: true });
});

test('sign-in cancellation and expiry keep saved connection and expose a usable retry', async ({ page, isolatedApp }) => {
  await page.goto('/host/settings');
  await page.getByLabel('Music Assistant URL', { exact: true }).fill(isolatedApp.musicAssistantOrigin);
  let expiresAt = Date.now() + 600_000;
  await page.route('**/api/host/auth/start', route => route.fulfill({ json: { loginUrl: isolatedApp.musicAssistantOrigin, expiresAt } }));
  const popup = page.waitForEvent('popup'); await page.getByRole('button', { name: 'Connect Music Assistant', exact: true }).click();
  await (await popup).close(); await expect(page.getByText('Waiting for sign-in…')).toBeVisible();
  await page.getByRole('button', { name: 'Cancel sign-in' }).click();
  await expect(page.getByText('Sign-in cancelled. Your saved connection was kept.')).toBeVisible();
  expiresAt = Date.now() - 1;
  const retry = page.waitForEvent('popup'); await page.getByRole('button', { name: 'Connect Music Assistant', exact: true }).click();
  await (await retry).close(); await expect(page.getByText('Sign-in expired. Try connecting again.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Connect Music Assistant', exact: true })).toBeEnabled();
});

test('home, error pages and display invitations provide concrete routes while API errors stay JSON', async ({ page }) => {
  await page.goto('/'); await expect(page).toHaveTitle('Home · Albums of the Year');
  for (const name of ['Join room', 'Music', 'Room display', 'Host desk']) await expect(page.locator('main').getByRole('link', { name, exact: true })).toBeVisible();
  const missing = await page.goto('/missing-page'); expect(missing?.status()).toBe(404);
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
  expect(await page.locator('html').evaluate(node => getComputedStyle(node).backgroundColor)).toBe('rgb(16, 23, 19)');
  const api = await page.request.get('/api/missing'); expect(api.status()).toBe(404); expect(api.headers()['content-type']).toContain('application/json');
  await page.goto('/display'); await expect(page).toHaveTitle('Room display · Albums of the Year');
  await expect(page.locator('.room-qr-link')).toHaveAttribute('href', /\/join$/);
  await expect(page.locator('.room-join-link')).toBeVisible();
  await page.locator('.room-qr-link').click(); await expect(page.getByLabel('Display name')).toBeVisible();
});

test('initial settings failure can retry and an empty speaker inventory keeps the visible selector disabled', async ({ page }) => {
  let unavailable = true; const writes: string[] = [];
  const settings: IntegrationView = { revision: 1, url: 'http://music.local:8095', tokenConfigured: true, destination: null,
    output: { name: null, state: 'none', checkedAt: null },
    status: 'checked', message: '', playbackAvailable: false, playbackIssue: '',
    destinationStatus: 'not-selected', destinationMessage: 'Choose a speaker or group before playing.',
    report: { checkedAt: Date.now(), serverVersion: 'fixture', schemaVersion: 65, docsAvailable: true, players: [] } };
  await page.route('**/api/host/integrations**', async route => {
    if (route.request().method() === 'POST') writes.push(route.request().url());
    if (unavailable) await route.abort('failed'); else await route.fulfill({ json: settings });
  });
  await page.goto('/host/settings'); await expect(page.getByRole('button', { name: 'Retry connection' })).toBeEnabled();
  await expect(page.getByLabel('Speaker or group', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Speaker or group', { exact: true })).toBeDisabled();
  unavailable = false; await page.getByRole('button', { name: 'Retry connection' }).click();
  await expect(page.locator('.settings-destination')).toContainText('No speakers found.');
  await expect(page.getByLabel('Speaker or group', { exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Save speaker', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Refresh speakers' }).click();
  expect(writes).toEqual([]);
});
