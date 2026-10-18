import { expect, type Browser, type Page } from '@playwright/test';
import { test } from './app-fixture';
import { showList } from './preparation-helpers';

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

for (const paused of [false, true]) test(`direct and prepared replacement both require confirmation while ${paused ? 'paused' : 'playing'}`, async ({ browser, page: host }) => {
  const f = await setup(browser, host); const page = f.participant;
  try {
    const plays: string[] = []; page.on('request', request => { if (/\/participant\/(play|preparations\/play)$/.test(new URL(request.url()).pathname)) plays.push(request.url()); });
    await page.getByRole('button', { name: 'Add to my list', exact: true }).click();
    await expect(page.locator('.list-count')).toHaveText(' · 1');
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeEnabled();
    await expect(page.locator('.player-pending')).toHaveCount(0);
    if (paused) { await page.getByRole('button', { name: 'Pause', exact: true }).click(); await expect(page.locator('.player-pending')).toHaveCount(0); }
    const original = await (await page.request.get('/api/participant/state')).json();
    const prompts: string[] = [];
    for (const name of ['Play', 'Play this song']) {
      if (name === 'Play this song') await showList(page);
      page.once('dialog', async dialog => { prompts.push(dialog.message()); await dialog.dismiss(); });
      await page.getByRole('button', { name, exact: true }).click();
      expect((await (await page.request.get('/api/participant/state')).json()).ownPlayback.id).toBe(original.ownPlayback.id);
    }
    expect(prompts).toEqual(Array(2).fill('Replace the current song? Playing this song will stop the current one.'));
    expect(plays).toHaveLength(1);
    page.once('dialog', dialog => dialog.accept()); await page.getByRole('button', { name: 'Play', exact: true }).click();
    await expect(page.locator('.player-pending')).toHaveCount(0);
    await expect.poll(async () => (await (await page.request.get('/api/participant/state')).json()).ownPlayback.id).not.toBe(original.ownPlayback.id);
    expect(plays).toHaveLength(2);
  } finally { await f.close(); }
});

test('a delayed search leaves pause and finish available and retains its results across a turn change', async ({ browser, page: host }) => {
  const f = await setup(browser, host); const page = f.participant; const search = gate();
  try {
    await page.getByRole('button', { name: 'Play', exact: true }).click(); await expect(page.locator('.player-pending')).toHaveCount(0);
    await page.route('**/api/participant/search', async route => { await search.promise; await route.continue(); });
    await page.getByRole('searchbox', { name: 'Search catalogue' }).fill('Night');
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(page.locator('.catalogue-results')).toHaveAttribute('aria-busy', 'true');
    await expect(page.getByRole('button', { name: 'Finish turn', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Resume', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Finish turn', exact: true }).click();
    await expect(page.locator('.playback-card')).toHaveCount(0);
    search.release();
    await expect(page.locator('.catalogue-results')).toHaveAttribute('aria-busy', 'false');
    await expect(page.locator('.catalogue-results .track-row')).not.toHaveCount(0);
    await expect(page.getByRole('searchbox', { name: 'Search catalogue' })).toHaveValue('Night');
  } finally { search.release(); await f.close(); }
});

test('the participant player stays responsive through slow play/pause/reveal replies and rolls back rejected actions', async ({ browser, page: host }) => {
  const f = await setup(browser, host); const { participant: page, tv } = f;
  const start = gate(); const pause = gate(); const reveal = gate(); const actions: string[] = [];
  let holdPause = true;
  await page.route('**/api/participant/play', async route => { await start.promise; await route.continue(); });
  await page.route('**/api/participant/control', async route => {
    const action = route.request().postDataJSON().action as string; actions.push(action);
    if (action === 'pause' && holdPause) { holdPause = false; await pause.promise; }
    await route.continue();
  });
  await page.route('**/api/participant/reveal', async route => { await reveal.promise; await route.continue(); });
  let finishes = 0;
  await page.route('**/api/participant/finish', async route => { finishes++; await route.fulfill({ status: 502, json: { error: 'Fixture finish rejected.' } }); });
  try {
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await expect(page.getByText('Starting track…', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Finish turn', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Resume', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Resume', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeEnabled();
    expect(actions).toEqual([]); await expect(tv.getByRole('heading', { name: 'Nothing playing.' })).toBeVisible();
    start.release(); await expect(page.locator('.player-pending')).toHaveCount(0);
    expect(actions).toEqual(['resume']);
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Resume', exact: true })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0);
    await expect(page.locator('.playback-card').getByRole('button', { name: 'Finish turn', exact: true })).toBeEnabled();
    await expect(page.locator('.finish-turn')).toHaveCount(0);
    await page.locator('.player-volume summary').click();
    await expect(page.getByRole('slider', { name: 'Volume', exact: true })).toBeEnabled();
    await expect(tv.getByText('● Playing', { exact: true })).toBeVisible();
    await page.screenshot({ path: 'test-results/player-pending-responsive.png', fullPage: true });
    await page.getByRole('button', { name: 'Resume', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeEnabled();
    pause.release(); await expect(page.locator('.player-pending')).toHaveCount(0);
    expect(actions).toEqual(['resume', 'pause', 'resume']);
    await page.getByRole('button', { name: 'Finish turn', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Fixture finish rejected.');
    await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeEnabled();
    expect(finishes).toBe(1); expect(actions).not.toContain('stop');
    await page.getByRole('button', { name: 'Reveal song', exact: true }).click();
    await expect(page.getByText('Revealing…', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeEnabled();
    await expect(tv.getByRole('heading', { name: 'Keep them guessing.' })).toBeVisible();
    reveal.release(); await expect(tv.getByRole('heading', { name: 'Northern Lights', exact: true })).toBeVisible();
    await expect(page.locator('.player-pending')).toHaveCount(0);
  } finally { start.release(); pause.release(); reveal.release(); await f.close(); }
});

for (const paused of [false, true]) test(`finishing from the ${paused ? 'paused' : 'playing'} player advances once without a separate Stop or automatic next playback`, async ({ browser, page: host }) => {
  const f = await setup(browser, host); const page = f.participant; const finish = gate();
  const nextContext = await browser.newContext();
  try {
    const origin = new URL(page.url()).origin;
    await nextContext.request.post(origin + '/api/participant/join', { headers: { Origin: origin }, data: { nickname: 'Next listener' } });
    const next = await nextContext.newPage(); await next.goto(origin + '/participant');
    await expect(next.getByRole('heading', { name: 'Alex’s turn.' })).toBeVisible();
    await expect(next.getByRole('button', { name: 'Finish turn', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Play', exact: true }).click(); await expect(page.locator('.player-pending')).toHaveCount(0);
    if (paused) { await page.getByRole('button', { name: 'Pause', exact: true }).click(); await expect(page.locator('.player-pending')).toHaveCount(0); }
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      await expect(page.getByRole('button', { name: 'Finish turn', exact: true })).toHaveCount(1);
      await expect(page.locator('.player-ending').getByRole('button', { name: 'Finish turn', exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0);
      await expect(page.locator('.finish-turn')).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    }
    let finishes = 0; const controls: string[] = [];
    page.on('request', request => { if (request.url().endsWith('/api/participant/control')) controls.push(request.postDataJSON().action); });
    await page.route('**/api/participant/finish', async route => { finishes++; await finish.promise; await route.continue(); });
    const before = await (await page.request.get('/api/participant/state')).json();
    await page.getByRole('button', { name: 'Finish turn', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Finish turn', exact: true })).toBeDisabled();
    await page.locator('#finish-my-turn').evaluate(node => { (node as HTMLButtonElement).click(); });
    expect(finishes).toBe(1);
    finish.release(); await expect(next.getByRole('heading', { name: 'Your turn.', exact: true })).toBeVisible();
    await expect(page.locator('.playback-card')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Finish turn', exact: true })).toHaveCount(0);
    await expect(f.tv.getByRole('heading', { name: 'Nothing playing.' })).toBeVisible();
    const after = await (await next.request.get('/api/participant/state')).json();
    expect(after.turnId).not.toBe(before.turnId); expect(after.ownPlayback).toBeNull(); expect(controls).toEqual([]); expect(finishes).toBe(1);
    // A participant can still pass an idle turn without choosing music.
    await expect(next.getByRole('button', { name: 'Pass turn', exact: true })).toBeEnabled();
    await next.getByRole('button', { name: 'Pass turn', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Your turn.', exact: true })).toBeVisible();
  } finally { finish.release(); await nextContext.close(); await f.close(); }
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
    await page.locator('.player-volume summary').click();
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
    await expect(host.getByRole('button', { name: 'Skip turn' })).toBeEnabled();
    await expect(host.locator('.volume-control output')).toHaveText('25%');
    hostAck.release(); await expect(page.locator('.volume-control output')).toHaveText('25%'); expect(hostLevels).toEqual([45, 25]);
    fail = true; await volume(page, 90);
    await expect(page.getByRole('alert')).toContainText('Fixture volume rejected.');
    await expect(page.locator('.volume-control output')).toHaveText('25%');
    await expect(page.getByRole('slider', { name: 'Volume', exact: true })).toBeEnabled();
    expect(participantLevels.filter(level => level === 90)).toHaveLength(1);
  } finally { participantAck.release(); hostAck.release(); await f.close(); }
});
