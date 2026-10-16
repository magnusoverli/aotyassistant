import { expect, type Browser, type Page } from '@playwright/test';
import { test } from './app-fixture';

function gate() { let release!: () => void; const promise = new Promise<void>(resolve => { release = resolve; }); return { promise, release }; }
async function setup(browser: Browser, host: Page) {
  let state = await (await host.request.get('/api/host/state')).json();
  const post = (path: string, data: unknown) => host.request.post(path, { data, headers: { Origin: new URL(state.joinUrl).origin } });
  const settings = await (await host.request.get('/api/host/integrations')).json();
  if (settings.tokenConfigured) await post('/api/host/integrations/clear', { revision: settings.revision });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } }); const participant = await context.newPage();
  await participant.goto(state.joinUrl); await participant.getByLabel('What should we call you?').fill('Alex'); await participant.getByRole('button', { name: 'Join room' }).click();
  await expect(participant).toHaveURL(/\/participant$/);
  state = await (await host.request.get('/api/host/state')).json();
  await host.goto('/host'); const tv = await context.newPage(); await tv.goto(state.displayUrl);
  await participant.getByRole('searchbox', { name: 'Search catalogue' }).fill('Northern'); await participant.getByRole('button', { name: 'Search', exact: true }).click();
  return { participant, tv, post, async close() { await context.close(); } };
}
async function volume(page: Page, level: number) {
  await page.getByRole('slider', { name: 'Volume', exact: true }).evaluate((node, value) => {
    const slider = node as HTMLInputElement; slider.value = String(value);
    slider.dispatchEvent(new Event('input', { bubbles: true })); slider.dispatchEvent(new Event('change', { bubbles: true }));
  }, level);
}

test('the participant player stays responsive through slow play/pause/reveal replies and rolls back rejected actions', async ({ browser, page: host }) => {
  const f = await setup(browser, host); const { participant: page, tv } = f;
  const start = gate(); const pause = gate(); const reveal = gate(); const actions: string[] = [];
  let holdPause = true; let rejectStop = true;
  await page.route('**/api/participant/play', async route => { await start.promise; await route.continue(); });
  await page.route('**/api/participant/control', async route => {
    const action = route.request().postDataJSON().action as string; actions.push(action);
    if (action === 'pause' && holdPause) { holdPause = false; await pause.promise; }
    if (action === 'stop' && rejectStop) { rejectStop = false; await route.fulfill({ status: 502, json: { error: 'Fixture stop rejected.' } }); return; }
    await route.continue();
  });
  await page.route('**/api/participant/reveal', async route => { await reveal.promise; await route.continue(); });
  try {
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await expect(page.getByText('Starting track…', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Resume', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Resume', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeEnabled();
    expect(actions).toEqual([]); await expect(tv.getByRole('heading', { name: 'Nothing playing.' })).toBeVisible();
    start.release(); await expect(page.locator('.player-pending')).toHaveCount(0);
    expect(actions).toEqual(['resume']);
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Resume', exact: true })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeEnabled();
    await expect(page.getByRole('slider', { name: 'Volume', exact: true })).toBeEnabled();
    await expect(tv.getByText('● Playing', { exact: true })).toBeVisible();
    await page.screenshot({ path: 'test-results/player-pending-responsive.png', fullPage: true });
    await page.getByRole('button', { name: 'Resume', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeEnabled();
    pause.release(); await expect(page.locator('.player-pending')).toHaveCount(0);
    expect(actions).toEqual(['resume', 'pause', 'resume']);
    await page.getByRole('button', { name: 'Stop', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Fixture stop rejected.');
    await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeEnabled();
    expect(actions.filter(action => action === 'stop')).toHaveLength(1);
    await page.getByRole('button', { name: 'Reveal on the display', exact: true }).click();
    await expect(page.getByText('Revealing…', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeEnabled();
    await expect(tv.getByRole('heading', { name: 'Keep them guessing.' })).toBeVisible();
    reveal.release(); await expect(tv.getByRole('heading', { name: 'Northern Lights', exact: true })).toBeVisible();
    await expect(page.locator('.player-pending')).toHaveCount(0);
  } finally { start.release(); pause.release(); reveal.release(); await f.close(); }
});

test('participant and host volume remain active, optimistic, and latest-only during delayed responses', async ({ browser, page: host }) => {
  const f = await setup(browser, host); const page = f.participant; const participantAck = gate(); const hostAck = gate();
  const participantLevels: number[] = []; const hostLevels: number[] = [];
  let firstParticipant = true; let firstHost = true; let fail = false;
  await page.route('**/api/participant/volume', async route => {
    participantLevels.push(route.request().postDataJSON().level);
    if (fail) { await route.fulfill({ status: 502, json: { error: 'Fixture volume rejected.' } }); return; }
    const response = await route.fetch();
    if (firstParticipant) { firstParticipant = false; await participantAck.promise; }
    await route.fulfill({ response });
  });
  await host.route('**/api/host/volume', async route => {
    hostLevels.push(route.request().postDataJSON().level); const response = await route.fetch();
    if (firstHost) { firstHost = false; await hostAck.promise; }
    await route.fulfill({ response });
  });
  try {
    await page.getByRole('button', { name: 'Play', exact: true }).click(); await expect(page.locator('.player-pending')).toHaveCount(0);
    await expect(page.getByRole('slider', { name: 'Volume', exact: true })).toBeEnabled();
    await page.getByRole('slider', { name: 'Volume', exact: true }).evaluate(node => { (node as HTMLElement).dataset.sameNode = 'yes'; });
    await volume(page, 55); await expect(page.locator('.volume-control output')).toHaveText('55%');
    await expect(page.getByRole('slider', { name: 'Volume', exact: true })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeEnabled();
    await volume(page, 20); await volume(page, 65);
    await expect(host.locator('.volume-control output')).toHaveText('55%'); // A confirmed SSE update must not undo the newer local intent.
    await expect(page.locator('.volume-control output')).toHaveText('65%');
    await expect(page.getByRole('slider', { name: 'Volume', exact: true })).toHaveAttribute('data-same-node', 'yes');
    expect(participantLevels).toEqual([55]); participantAck.release();
    await expect(host.locator('.volume-control output')).toHaveText('65%'); expect(participantLevels).toEqual([55, 65]);
    await volume(host, 45); await volume(host, 25);
    await expect(host.getByRole('slider', { name: 'Volume', exact: true })).toBeEnabled();
    await expect(host.getByRole('button', { name: 'Advance / skip current turn' })).toBeEnabled();
    await expect(host.locator('.volume-control output')).toHaveText('25%');
    hostAck.release(); await expect(page.locator('.volume-control output')).toHaveText('25%'); expect(hostLevels).toEqual([45, 25]);
    fail = true; await volume(page, 90);
    await expect(page.getByRole('alert')).toContainText('Fixture volume rejected.');
    await expect(page.locator('.volume-control output')).toHaveText('25%');
    await expect(page.getByRole('slider', { name: 'Volume', exact: true })).toBeEnabled();
    expect(participantLevels.filter(level => level === 90)).toHaveLength(1);
  } finally { participantAck.release(); hostAck.release(); await f.close(); }
});
