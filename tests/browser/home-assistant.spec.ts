import { expect } from '@playwright/test';
import { createServer, request } from 'node:http';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { ingressListener } from '../../src/ingress.js';
import { test } from './app-fixture';
import { openNavigation } from './navigation-helpers';

test('Connect signs in through MA, selects a speaker, and reconnects without losing catalogue identity', async ({ page, isolatedApp }) => {
  await page.goto('/host/settings');
  await expect(page.getByRole('button', { name: 'Connect Music Assistant', exact: true })).toBeDisabled();
  await expect(page.getByLabel('Music Assistant access token')).toBeHidden();
  await page.getByLabel('Music Assistant URL', { exact: true }).fill(isolatedApp.musicAssistantOrigin);
  const popupPromise = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Connect Music Assistant', exact: true }).click();
  const login = await popupPromise;
  await expect(login.getByRole('heading', { name: 'Music Assistant sign-in' })).toBeVisible();
  await login.getByRole('link', { name: 'Authorize Listening Room' }).click();
  await expect(login.locator('.settings-connection .settings-state')).toHaveText('Connected');
  await expect(page.getByText('Music Assistant connected.', { exact: true })).toBeVisible();
  await expect(page.getByText('Waiting for sign-in…', { exact: true })).toHaveCount(0);
  await page.locator('.settings-navigation a[href="#access"]').click();
  await expect(page.getByText('File access verified.', { exact: true })).toBeVisible();
  await expect(page.getByText('Connect Music Assistant to enable file access.', { exact: true })).toHaveCount(0);
  await expect(login).toHaveURL(/\/host\/settings$/);
  await login.locator('.settings-navigation a[href="#playback"]').click();
  await expect(login.getByLabel('Speaker or group', { exact: true })).toBeEnabled();
  await login.getByLabel('Speaker or group', { exact: true }).selectOption('sonos:room');
  await expect(login.getByText('Active speaker: Living room', { exact: true })).toBeVisible();
  const binding = isolatedApp.manager.sourceBindingId;
  await login.locator('.settings-navigation a[href="#music-assistant"]').click();
  await login.getByRole('button', { name: 'Change connection', exact: true }).click();
  const reconnectPromise = login.waitForEvent('popup'); await login.getByRole('button', { name: 'Reconnect Music Assistant' }).click();
  const reconnect = await reconnectPromise; await reconnect.getByRole('link', { name: 'Authorize Listening Room' }).click();
  await reconnect.locator('.settings-navigation a[href="#playback"]').click();
  await expect(reconnect.getByText('Active speaker: Living room', { exact: true })).toBeVisible();
  expect(isolatedApp.manager.sourceBindingId).toBe(binding);
  expect(isolatedApp.calls.filter(c => c.command === 'auth/token/create')).toHaveLength(2);
  expect(isolatedApp.calls.some(c => /play_media|cmd\/|\/stop$|\/pause$|\/resume$/.test(c.command))).toBe(false);
  expect(await reconnect.evaluate(() => Object.values(localStorage).join(''))).not.toContain('browser-login-session');
  await reconnect.close(); await login.close();
});

test('unrelated settings changes and another attempt cannot announce successful sign-in', async ({ page, isolatedApp }) => {
  await page.goto('/host/settings');
  await page.getByLabel('Music Assistant URL', { exact: true }).fill(isolatedApp.musicAssistantOrigin);
  const popup = page.waitForEvent('popup'); await page.getByRole('button', { name: 'Connect Music Assistant', exact: true }).click();
  const login = await popup; await expect(login.getByRole('link', { name: 'Authorize Listening Room' })).toBeVisible();
  const unrelated = await page.context().newPage(); await unrelated.goto(`${isolatedApp.origin}/host`);
  await unrelated.evaluate(() => localStorage.setItem('aoty.ma-auth-result', JSON.stringify({ attemptId: 'different-attempt', result: 'connected', at: Date.now() })));
  await isolatedApp.manager.saveGuestOrigin('http://guest-change.local:3000', isolatedApp.manager.view().revision);
  await expect(page.locator('.settings-addressing')).toContainText('Guest links: http://guest-change.local:3000');
  await expect(page.getByText('Music Assistant connected.', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Waiting for sign-in…', { exact: true })).toBeVisible();
  expect(isolatedApp.manager.configured).toBe(false);
  await login.getByRole('link', { name: 'Authorize Listening Room' }).click();
  await expect(login.getByText(/Music Assistant sign-in could not finish/)).toBeVisible();
  await expect(page.getByText('Sign-in could not finish. Try connecting again.', { exact: true })).toBeVisible();
  expect(isolatedApp.calls.some(call => call.command === 'auth/token/create')).toBe(false);
  await login.close(); await unrelated.close();
});

test('cross-tab file diagnostics update without overwriting an unsaved guest address', async ({ page, isolatedApp }) => {
  await isolatedApp.manager.save(isolatedApp.musicAssistantOrigin, 'fixture-token', 0);
  await page.goto('/host/settings#access'); await expect(page.getByText('File access verified.', { exact: true })).toBeVisible();
  await page.getByText('Change guest address', { exact: true }).click();
  await page.getByLabel('Guest address', { exact: true }).fill('http://draft.local:3000');
  const before = isolatedApp.manager.addressing().sequence!;
  await isolatedApp.manager.checkMediaOrigins(['http://127.0.0.1:1'], isolatedApp.manager.view().revision);
  await expect(page.locator('.settings-addressing')).toContainText('could not fetch and verify');
  expect(isolatedApp.manager.addressing().sequence!).toBeGreaterThan(before);
  await isolatedApp.manager.checkMediaOrigins([isolatedApp.origin], isolatedApp.manager.view().revision);
  await expect(page.getByText('File access verified.', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Guest address', { exact: true })).toHaveValue('http://draft.local:3000');
});

test('advanced same-server address changes retain the selected speaker and private-list binding', async ({ page, isolatedApp }) => {
  await isolatedApp.manager.save(isolatedApp.musicAssistantOrigin, 'fixture-token', 0);
  await isolatedApp.manager.check(1); await isolatedApp.manager.selectDestination('sonos:room', 1);
  const binding = isolatedApp.manager.sourceBindingId;
  await page.goto('/host/settings'); await expect(page.getByText('Active speaker: Living room', { exact: true })).toBeVisible();
  await page.locator('.settings-navigation a[href="#music-assistant"]').click();
  await page.getByRole('button', { name: 'Change connection', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Find Music Assistant', exact: true })).toBeEnabled();
  await page.getByLabel('Music Assistant URL', { exact: true }).fill(isolatedApp.musicAssistantOrigin.replace('127.0.0.1', 'localhost'));
  await page.getByText('Advanced: token or separate login address', { exact: true }).click();
  await page.getByLabel('Music Assistant access token', { exact: true }).fill('browser-test-token');
  await page.getByRole('button', { name: 'Save connection', exact: true }).click();
  await expect(page.getByText('Connection saved.', { exact: true })).toBeVisible();
  await page.locator('.settings-navigation a[href="#playback"]').click();
  await expect(page.getByText('Active speaker: Living room', { exact: true })).toBeVisible();
  expect(isolatedApp.manager.sourceBindingId).toBe(binding);
  expect(isolatedApp.calls.some(call => /play_media|cmd\//.test(call.command))).toBe(false);
});

test('an unsupported schema identifies compatibility while retaining a healthy selected speaker', async ({ page, isolatedApp }) => {
  await isolatedApp.manager.save(isolatedApp.musicAssistantOrigin, 'fixture-token', 0);
  await isolatedApp.manager.selectDestination('sonos:room', 1); isolatedApp.setSchema(66);
  await page.goto('/host/settings');
  await expect(page.locator('.settings-connection .settings-state')).toHaveText('Connected');
  await expect(page.locator('.settings-connection')).toContainText('uses API schema 66');
  await expect(page.locator('.settings-connection')).toContainText('Check for an app update');
  await expect(page.locator('.settings-destination .settings-state')).toHaveText('Playback unsupported');
  await expect(page.getByLabel('Speaker or group', { exact: true })).toHaveValue('sonos:room');
  await expect(page.locator('.settings-destination')).not.toContainText('Living room is unavailable');
  expect(isolatedApp.manager.view().destinationStatus).toBe('checked'); expect(isolatedApp.manager.playbackAvailable).toBe(false);
  isolatedApp.setSchema(65); await isolatedApp.manager.check(isolatedApp.manager.view().revision);
  await expect(page.getByText('Active speaker: Living room', { exact: true })).toBeVisible();
  await expect(page.locator('.settings-connection')).not.toContainText('uses API schema 66');
  expect(isolatedApp.calls.some(call => /play_media|cmd\//.test(call.command))).toBe(false);
});

test('HA iframe loads prefixed assets/APIs/SSE, authorizes in a new tab, and shares LAN guest links', async ({ page, isolatedApp }) => {
  const prefix = '/api/hassio_ingress/browser-fixture'; const guest = 'http://192.168.1.20:4000';
  await page.request.post(`${isolatedApp.origin}/api/host/addressing/guest`, { headers: { Origin: isolatedApp.origin }, data: { origin: guest, revision: 0 } });
  const ingress = createServer(ingressListener(isolatedApp.app, '127.0.0.1')); ingress.listen(0, '127.0.0.1'); await once(ingress, 'listening');
  const backend = (ingress.address() as AddressInfo).port;
  const escaped: string[] = [];
  const proxy = createServer((req, res) => {
    if (req.url === '/') { res.setHeader('Content-Type', 'text/html'); res.end(`<iframe title="Listening Room" src="${prefix}/host/settings" style="width:100%;height:100vh;border:0"></iframe>`); return; }
    if (!req.url?.startsWith(`${prefix}/`)) { escaped.push(req.url ?? ''); res.writeHead(404); res.end(); return; }
    const upstream = request({ hostname: '127.0.0.1', port: backend, path: req.url.slice(prefix.length), method: req.method,
      headers: { ...req.headers, 'x-ingress-path': prefix, 'x-forwarded-host': req.headers.host!, 'x-forwarded-proto': 'http', 'x-remote-user-id': 'owner' } }, reply => {
      res.writeHead(reply.statusCode!, reply.headers); reply.pipe(res); res.once('close', () => reply.destroy());
    });
    upstream.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); }); req.pipe(upstream);
  });
  proxy.listen(0, '127.0.0.1'); await once(proxy, 'listening');
  const origin = `http://127.0.0.1:${(proxy.address() as AddressInfo).port}`;
  try {
    await page.goto(origin); const frame = page.frameLocator('iframe');
    await expect(frame.getByRole('heading', { name: 'Settings' })).toBeVisible();
    await expect(frame.getByRole('button', { name: 'Use this browser address for guest links' })).toHaveCount(0);
    await expect(frame.getByLabel('Guest address', { exact: true })).toHaveValue(guest);
    await frame.getByLabel('Music Assistant URL', { exact: true }).fill(isolatedApp.musicAssistantOrigin);
    const popupPromise = page.waitForEvent('popup'); await frame.getByRole('button', { name: 'Connect Music Assistant', exact: true }).click();
    const login = await popupPromise; await login.getByRole('link', { name: 'Authorize Listening Room' }).click();
    await expect(login.locator('.settings-connection .settings-state')).toHaveText('Connected');
    await expect(login).toHaveURL(`${origin}${prefix}/host/settings`);
    await openNavigation(login);
    await login.getByRole('link', { name: 'Host desk', exact: true }).click();
    await expect(login).toHaveURL(`${origin}${prefix}/host`);
    await expect(login.getByRole('link', { name: 'Open guest invitation ↗' })).toHaveAttribute('href', `${guest}/join`);
    await openNavigation(login);
    await expect(login.getByRole('link', { name: 'Room display', exact: true })).toHaveAttribute('href', `${guest}/display`);
    await page.request.post(`${isolatedApp.origin}/api/participant/join`, { headers: { Origin: isolatedApp.origin }, data: { pin: '1234', nickname: 'Ingress listener' } });
    await expect(login.getByText('Ingress listener', { exact: true }).first()).toBeVisible(); // Prefixed SSE delivered the live join.
    await expect(frame.locator('.rotation-seat strong')).toHaveText(['Ingress listener']); // Settings uses the names-only prefixed feed.
    expect(escaped.filter(path => path !== '/favicon.ico')).toEqual([]);
    expect(isolatedApp.calls.some(c => /play_media|cmd\/|\/stop$/.test(c.command))).toBe(false);
    await login.close();
    const fallbackContext = await page.context().browser()!.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
    try {
      const fallback = await fallbackContext.newPage(); const assets: string[] = [];
      fallback.on('response', response => { if (response.url().endsWith('.css') && response.status() === 200) assets.push(new URL(response.url()).pathname); });
      const response = await fallback.goto(`${origin}${prefix}/missing-page`); expect(response?.status()).toBe(404);
      await expect(fallback.locator('h1')).toHaveText('Page not found');
      expect(await fallback.locator('.panel').evaluate(node => getComputedStyle(node).padding)).toBe('16px');
      expect(await fallback.locator('html').evaluate(node => getComputedStyle(node).backgroundColor)).toBe('rgb(16, 23, 19)');
      expect(assets.sort()).toEqual(['ui-components.css', 'ui-foundation.css', 'ui-layouts.css'].map(name => `${prefix}/assets/${name}`).sort());
      expect(escaped.filter(path => path !== '/favicon.ico')).toEqual([]);
    } finally { await fallbackContext.close(); }
  } finally { proxy.closeAllConnections(); proxy.close(); ingress.closeAllConnections(); ingress.close(); }
});
