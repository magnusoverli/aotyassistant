import { expect } from '@playwright/test';
import { test } from './app-fixture';

test('host progress respects reveal, unavailable positions and stable keyboard controls across live updates', async ({ page, isolatedApp }) => {
  const { engine } = isolatedApp;
  const credential = await engine.join('A very long participant display name'); await engine.join('Sam');
  const turn = engine.view({ kind: 'host' }).turnId!;
  await engine.play(credential, turn, null, 'demo:aurora'); const id = engine.view({ kind: 'host' }).hostPlayback!.id;
  await page.goto('/host');
  const live = page.locator('.host-live'); const more = page.getByRole('button', { name: 'More', exact: true });
  const stop = page.getByRole('button', { name: 'Stop song — keep turn', exact: true });
  const writes: string[] = []; page.on('request', request => { if (request.method() === 'POST') writes.push(new URL(request.url()).pathname); });
  await expect(live.getByRole('progressbar')).toBeVisible();
  await expect(live.locator('.track-times')).toBeEmpty(); await expect(live).toContainText('Hidden on room display');
  await expect(live).not.toContainText('Northern Lights');
  await expect(live.getByRole('button', { name: /^(Pause|Resume|Reveal)/ })).toHaveCount(0);
  await expect(stop).toBeHidden(); await more.focus(); await more.press('Enter');
  await expect(more).toHaveAttribute('aria-expanded', 'true'); await more.press('Tab'); await expect(stop).toBeFocused();
  await stop.press('Escape'); await expect(stop).toBeHidden(); await expect(more).toBeFocused();
  await more.press('Enter'); await stop.focus();
  const nodes = await live.evaluateHandle(node => ({ card: node, progress: node.querySelector('progress'), stop: node.querySelector('#host-stop') }));
  const before = await live.getByRole('progressbar').getAttribute('value');
  await expect.poll(() => live.getByRole('progressbar').getAttribute('value')).not.toBe(before);
  await expect(stop).toBeFocused(); await expect(more).toHaveAttribute('aria-expanded', 'true');
  await engine.control(credential, turn, id, 'pause');
  await expect(live.locator('.host-playback-status')).toContainText('Paused'); await expect(stop).toBeEnabled();
  const paused = await live.getByRole('progressbar').getAttribute('value');
  await engine.reveal(credential, turn, id);
  await expect(live).toContainText('Visible on room display'); await expect(live.locator('.track-times')).toContainText('1:00');
  expect(await live.getByRole('progressbar').getAttribute('value')).toBe(paused);
  await expect(stop).toBeFocused(); await expect(live).not.toContainText('Northern Lights');
  expect(await nodes.evaluate(saved => saved.card === document.querySelector('.host-live') && saved.progress === document.querySelector('.host-progress progress') && saved.stop === document.querySelector('#host-stop'))).toBe(true);
  const progress = isolatedApp.demo.progress.bind(isolatedApp.demo);
  isolatedApp.demo.progress = () => null; engine.emit('change', 'playback');
  await expect(live.getByText('Position unavailable', { exact: true })).toBeVisible();
  await expect(live.getByRole('progressbar')).toBeHidden();
  isolatedApp.demo.progress = progress; engine.emit('change', 'playback');
  await expect(live.getByRole('progressbar')).toBeVisible();
  await expect(live.getByText('Position unavailable', { exact: true })).toBeHidden();
  for (const width of [1440, 1100, 800, 700, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    for (const button of await live.getByRole('button').all()) expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    if ([1440, 390, 320].includes(width)) await page.screenshot({ path: `test-results/host-playback-more-${width}.png`, fullPage: true });
  }
  await expect(live.getByRole('heading')).toHaveText('A very long participant display name');
  for (const font of ['Arial', 'DejaVu Sans', '']) {
    await page.evaluate(font => { document.documentElement.style.fontFamily = font; }, font);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(stop).toBeVisible();
  }
  page.once('dialog', dialog => dialog.dismiss()); await stop.click();
  expect(writes).toEqual([]); expect(engine.view({ kind: 'host' }).hostPlayback!.status).toBe('paused');
  await stop.focus(); await engine.play(credential, turn, id, 'demo:night');
  await expect(more).toHaveAttribute('aria-expanded', 'false'); await expect(stop).toBeHidden();
  await expect(page.getByRole('button', { name: 'Skip turn', exact: true })).toBeFocused();
  await expect(live).toContainText('Hidden on room display'); await expect(live.locator('.track-times')).toBeEmpty();
  await more.click(); await stop.focus(); await engine.advance(turn);
  await expect(live.getByRole('heading', { name: 'Sam', exact: true })).toBeVisible();
  await expect(more).toBeHidden(); await expect(live.getByRole('progressbar')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Skip turn', exact: true })).toBeFocused();
  expect(writes).toEqual([]); await nodes.dispose();
});

test('confirmed host stop shows pending feedback, keeps the turn and synchronizes the participant and display', async ({ page, context, isolatedApp }) => {
  const joined = await (await page.request.post('/api/participant/join', { data: { nickname: 'Magnus' }, headers: { Origin: isolatedApp.origin } })).json();
  await isolatedApp.engine.join('Sam');
  const response = await page.request.post('/api/participant/play', { data: { turnId: joined.turnId, previousPlaybackId: null, trackId: 'demo:aurora' }, headers: { Origin: isolatedApp.origin } });
  expect(response.ok()).toBe(true); const playing = await response.json();
  const participant = await context.newPage(); await participant.goto('/participant');
  const display = await context.newPage(); await display.goto('/display'); await page.goto('/host');
  let release!: () => void; const held = new Promise<void>(resolve => { release = resolve; }); let stops = 0; let payload: unknown;
  await page.route('**/api/host/stop', async route => { stops++; payload = route.request().postDataJSON(); await held; await route.continue(); });
  try {
    await page.getByRole('button', { name: 'More', exact: true }).click();
    page.once('dialog', dialog => { expect(dialog.message()).toBe('Stop Magnus’s song and keep their turn?'); void dialog.accept(); });
    await page.getByRole('button', { name: 'Stop song — keep turn', exact: true }).click();
    await expect(page.locator('.host-playback-status')).toContainText('Stopping…');
    await expect(page.getByRole('button', { name: 'Skip turn', exact: true })).toBeDisabled();
    expect(isolatedApp.engine.view({ kind: 'host' }).hostPlayback!.status).toBe('playing');
    release();
    await expect(page.locator('.host-playback-status')).toContainText('Stopped · Magnus keeps the turn');
    await expect(page.locator('.host-progress')).toBeHidden(); await expect(page.getByRole('button', { name: 'More', exact: true })).toBeHidden();
    await expect(page.getByRole('button', { name: 'Skip turn', exact: true })).toBeFocused();
    await expect(participant.locator('.playback-status')).toContainText('Stopped');
    await expect(display.getByRole('heading', { name: 'Nothing playing.', exact: true })).toBeVisible();
    const after = isolatedApp.engine.view({ kind: 'host' });
    expect(after.turnId).toBe(joined.turnId); expect(after.current!.nickname).toBe('Magnus');
    expect(payload).toEqual({ turnId: joined.turnId, playbackId: playing.ownPlayback.id }); expect(stops).toBe(1);
  } finally { release(); await participant.close(); await display.close(); }
});

test('host stop failures and lost acknowledgements reconcile through reads without retrying the command', async ({ page, context, isolatedApp }) => {
  const credential = await isolatedApp.engine.join('Magnus');
  const turn = isolatedApp.engine.view({ kind: 'host' }).turnId!;
  await isolatedApp.engine.play(credential, turn, null, 'demo:aurora'); await page.goto('/host');
  let requests = 0;
  await page.route('**/api/host/stop', async route => {
    requests++;
    if (requests === 1) await route.fulfill({ status: 503, json: { error: 'Stop could not be confirmed.' } });
    else { await route.fetch(); await route.abort('connectionreset'); }
  });
  const more = page.getByRole('button', { name: 'More', exact: true });
  await context.setOffline(true); await expect(page.locator('.app-content > .connection')).toBeVisible(); await expect(more).toBeHidden();
  await context.setOffline(false); await expect(more).toBeEnabled();
  await more.click(); page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Stop song — keep turn', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Stop could not be confirmed.');
  await expect(page.locator('.host-playback-status')).toContainText('Playing'); await expect(more).toBeEnabled();
  expect(requests).toBe(1);
  await more.click(); page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Stop song — keep turn', exact: true }).click();
  await expect(page.locator('.host-playback-status')).toContainText('Stopped · Magnus keeps the turn');
  await expect(page.getByRole('button', { name: 'Skip turn', exact: true })).toBeEnabled();
  await expect(page.getByRole('alert')).toBeVisible();
  expect(requests).toBe(2); expect(isolatedApp.engine.view({ kind: 'host' }).turnId).toBe(turn);
});
