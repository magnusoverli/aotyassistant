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
  await login.getByRole('link', { name: 'Authorize Albums of the Year' }).click();
  await expect(login.locator('.settings-connection .settings-state')).toHaveText('Connected');
  await expect(login).toHaveURL(/\/host\/settings$/);
  await expect(login.getByLabel('Speaker or group', { exact: true })).toBeEnabled();
  await login.getByLabel('Speaker or group', { exact: true }).selectOption('sonos:room');
  await expect(login.getByText('Active speaker: Living room', { exact: true })).toBeVisible();
  const binding = isolatedApp.manager.sourceBindingId;
  await login.getByRole('button', { name: 'Change connection', exact: true }).click();
  const reconnectPromise = login.waitForEvent('popup'); await login.getByRole('button', { name: 'Reconnect Music Assistant' }).click();
  const reconnect = await reconnectPromise; await reconnect.getByRole('link', { name: 'Authorize Albums of the Year' }).click();
  await expect(reconnect.getByText('Active speaker: Living room', { exact: true })).toBeVisible();
  expect(isolatedApp.manager.sourceBindingId).toBe(binding);
  expect(isolatedApp.calls.filter(c => c.command === 'auth/token/create')).toHaveLength(2);
  expect(isolatedApp.calls.some(c => /play_media|cmd\/|\/stop$|\/pause$|\/resume$/.test(c.command))).toBe(false);
  expect(await reconnect.evaluate(() => Object.values(localStorage).join(''))).not.toContain('browser-login-session');
  await reconnect.close(); await login.close();
});

test('HA iframe loads prefixed assets/APIs/SSE, authorizes in a new tab, and shares LAN guest links', async ({ page, isolatedApp }) => {
  const prefix = '/api/hassio_ingress/browser-fixture'; const guest = 'http://192.168.1.20:4000';
  await page.request.post(`${isolatedApp.origin}/api/host/addressing/guest`, { headers: { Origin: isolatedApp.origin }, data: { origin: guest, revision: 0 } });
  const ingress = createServer(ingressListener(isolatedApp.app, '127.0.0.1')); ingress.listen(0, '127.0.0.1'); await once(ingress, 'listening');
  const backend = (ingress.address() as AddressInfo).port;
  const escaped: string[] = [];
  const proxy = createServer((req, res) => {
    if (req.url === '/') { res.setHeader('Content-Type', 'text/html'); res.end(`<iframe title="Albums of the Year" src="${prefix}/host/settings" style="width:100%;height:100vh;border:0"></iframe>`); return; }
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
    await expect(frame.getByRole('button', { name: 'Use the address I opened for guest links' })).toHaveCount(0);
    await expect(frame.getByLabel('Guest address', { exact: true })).toHaveValue(guest);
    await frame.getByLabel('Music Assistant URL', { exact: true }).fill(isolatedApp.musicAssistantOrigin);
    const popupPromise = page.waitForEvent('popup'); await frame.getByRole('button', { name: 'Connect Music Assistant', exact: true }).click();
    const login = await popupPromise; await login.getByRole('link', { name: 'Authorize Albums of the Year' }).click();
    await expect(login.locator('.settings-connection .settings-state')).toHaveText('Connected');
    await expect(login).toHaveURL(`${origin}${prefix}/host/settings`);
    await openNavigation(login);
    await login.getByRole('link', { name: 'Host desk', exact: true }).click();
    await expect(login).toHaveURL(`${origin}${prefix}/host`);
    await expect(login.getByRole('link', { name: 'Open guest invitation ↗' })).toHaveAttribute('href', `${guest}/join`);
    await openNavigation(login);
    await expect(login.getByRole('link', { name: 'Room display', exact: true })).toHaveAttribute('href', `${guest}/display`);
    await page.request.post(`${isolatedApp.origin}/api/participant/join`, { headers: { Origin: isolatedApp.origin }, data: { nickname: 'Ingress listener' } });
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
