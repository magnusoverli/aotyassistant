import { randomUUID } from 'node:crypto';
import { expect, type Page } from '@playwright/test';
import { test } from './app-fixture';

function gate() { let release!: () => void; const promise = new Promise<void>(resolve => { release = resolve; }); return { promise, release }; }
// The header has its own reconnecting line; measure positions relative to the player.
const geometry = (page: Page) => page.evaluate(() => {
  const top = document.querySelector('#participant-player')!.getBoundingClientRect().top;
  return [
  '#participant-player', '.private-now-playing', '.private-now-playing h2', '.private-now-playing .artist-credit', '.player-status-line', '#participant-player progress',
  '#player-play-next', '#player-transport', '#player-stop', '#player-mute', '#volume-level', '#player-reveal', '#finish-my-turn', '.preparation-list',
].map(selector => {
  const box = document.querySelector(selector)!.getBoundingClientRect();
  return { selector, x: box.x, y: box.y - top, width: box.width, ...(selector === '.preparation-list' ? {} : { height: box.height }) };
}); });

for (const viewport of [{ width: 320, height: 568 }, { width: 360, height: 740 }, { width: 390, height: 844 }, { width: 430, height: 932 }, { width: 844, height: 390 }, { width: 1099, height: 844 }]) {
  test(`mobile player keeps its frame and control slots through all states at ${viewport.width}×${viewport.height}`, async ({ page, browser, isolatedApp }) => {
    await page.setViewportSize(viewport);
    const post = (path: string, data: unknown) => page.request.post(path, { data, headers: { Origin: isolatedApp.origin } });
    await post('/api/participant/join', { pin: '1234', nickname: 'Player' });
    const other = await browser.newContext({ baseURL: isolatedApp.origin });
    await other.request.post('/api/participant/join', { data: { pin: '1234', nickname: 'Next listener' }, headers: { Origin: isolatedApp.origin } });
    const song = { id: 'demo:mobile-frame', title: 'A deliberately very long song title that cannot fit on two phone lines and must never stretch this player',
      artist: 'An artist name that also cannot fit in the available space', album: 'Full album details', duration: 600, artwork: '/demo-cover.svg', artistArtwork: '/demo-cover.svg' };
    isolatedApp.demo.catalogue.push(song);
    let library = await (await post('/api/participant/preparations/init', {})).json();
    const edit = async (action: string, data: Record<string, unknown>) => {
      const response = await post(`/api/participant/preparations/${action}`, { ...data, operation: { id: randomUUID(), issuedAt: Date.now(), revision: library.revision } });
      expect(response.ok()).toBe(true); library = (await response.json()).view;
    };
    const start = gate(); const reveal = gate(); const finish = gate();
    try {
      await page.goto('/participant');
      await expect(page.locator('.player-mobile-notice')).toHaveText('Choose a song');
      await expect(page.getByRole('button', { name: 'Play pick', exact: true })).toBeVisible();
      await expect(page.locator('#player-play-next')).toBeDisabled();
      await expect(page.locator('.private-now-playing .artist-credit')).toBeHidden();
      await expect(page.locator('#participant-player .output-label')).toBeHidden();
      await expect(page.locator('.player-mobile-privacy')).toBeEmpty();
      expect(await page.locator('.player-details-open').evaluate(node => getComputedStyle(node, '::after').content)).toBe('none');
      const before = await geometry(page);
      expect(before[0]!.height).toBe(272);
      expect(await page.locator('#participant-player').evaluate(player => player.getBoundingClientRect().top
        - document.querySelector('.app-header')!.getBoundingClientRect().bottom)).toBe(10);
      const unchanged = async () => {
        expect(await geometry(page)).toEqual(before);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        expect(await page.locator('#participant-player').evaluate(card => {
          const box = card.getBoundingClientRect();
          return [...card.querySelectorAll<HTMLButtonElement>('button:not(dialog button)')].filter(button => getComputedStyle(button).display !== 'none').every(button => {
            const rect = button.getBoundingClientRect();
            return rect.width >= 44 && rect.height >= 44 && rect.left >= box.left && rect.right <= box.right && rect.top >= box.top && rect.bottom <= box.bottom;
          });
        })).toBe(true);
        expect(await page.locator('.playback-transport button > span').evaluateAll(spans => spans
          .filter(span => getComputedStyle(span).display !== 'none')
          .filter(span => span.scrollWidth > span.clientWidth)
          .map(span => ({ label: span.textContent, width: span.clientWidth, required: span.scrollWidth })))).toEqual([]);
      };
      const click = (id: string) => page.locator(id).evaluate(node => (node as HTMLButtonElement).click());
      await edit('add', { trackId: song.id });
      await expect(page.locator('#player-play-next')).toBeEnabled();
      await expect(page.locator('.private-now-playing h2')).toHaveText(song.title); await unchanged();
      await expect(page.locator('.private-now-playing .artist-credit')).toBeHidden();
      await expect(page.locator('.player-mobile-privacy')).toBeEmpty();
      await edit('add', { trackId: 'demo:summer' });
      await expect(page.locator('.list-count')).toHaveText('2 tracks'); await unchanged();
      await edit('remove', { entryId: library.upcoming[1].id });
      await expect(page.locator('.list-count')).toHaveText('1 track'); await unchanged();

      await page.getByRole('button', { name: 'Player details', exact: true }).click();
      const details = page.getByRole('dialog', { name: 'Player details', exact: true });
      await expect(details).toContainText(song.title); await expect(details).toContainText(song.artist); await unchanged();
      await page.keyboard.press('Escape'); await expect(details).toBeHidden();
      await expect(page.getByRole('button', { name: 'Player details', exact: true })).toBeFocused();

      await page.route('**/api/participant/preparations/play', async route => { await start.promise; await route.continue(); });
      await click('#player-play-next'); await expect(page.locator('.player-pending')).toHaveCount(1); await unchanged();
      start.release(); await expect(page.locator('.player-pending')).toHaveCount(0);
      await expect(page.locator('.list-count')).toHaveText('0 tracks');
      await expect(page.locator('#player-play-next')).toBeVisible(); await expect(page.locator('#player-play-next')).toBeDisabled(); await unchanged();
      await expect(page.locator('.private-now-playing .artist')).toBeVisible();
      await expect(page.locator('.private-now-playing .artist')).toHaveText(song.artist);
      await click('#player-transport'); await expect(page.locator('#player-transport')).toHaveText('Resume'); await unchanged();
      await click('#player-transport'); await expect(page.locator('#player-transport')).toHaveText('Pause'); await unchanged();

      await page.route('**/api/participant/reveal', async route => { await reveal.promise; await route.continue(); });
      await click('#player-reveal'); await expect(page.locator('.player-mobile-privacy')).toHaveText('Revealing'); await unchanged();
      reveal.release(); await expect(page.locator('.player-mobile-privacy')).toHaveText('Revealed'); await unchanged();
      for (const level of [0, 100]) {
        await page.locator('#volume-level').evaluate((node, value) => {
          const input = node as HTMLInputElement; input.value = String(value); input.dispatchEvent(new Event('input')); input.dispatchEvent(new Event('change'));
        }, level);
        await expect(page.locator('.volume-control output')).toHaveText(`${level}%`); await unchanged();
      }
      const progress = isolatedApp.demo.progress.bind(isolatedApp.demo);
      isolatedApp.demo.progress = () => null; isolatedApp.demo.onProgress();
      await expect(page.locator('#participant-player progress')).not.toHaveAttribute('value'); await unchanged();
      isolatedApp.demo.progress = progress; isolatedApp.demo.onProgress();
      await expect(page.locator('#participant-player progress')).toHaveAttribute('value');
      isolatedApp.demo.volume = { ...isolatedApp.demo.volume, available: false, level: null }; isolatedApp.demo.onProgress();
      await expect(page.locator('.volume-control output')).toHaveText('Unavailable'); await unchanged();
      isolatedApp.demo.volume = { ...isolatedApp.demo.volume, available: true, level: 35 }; isolatedApp.demo.onProgress();

      await page.context().setOffline(true);
      await expect(page.locator('.player-mobile-notice')).toHaveText('Connection lost'); await unchanged();
      await page.context().setOffline(false);
      await expect(page.locator('#player-transport')).toBeEnabled(); await unchanged();
      await page.route('**/api/participant/control', route => route.fulfill({ status: 503, json: { error: 'A detailed player failure that should be readable without expanding the card.' } }));
      await click('#player-transport');
      await expect(page.getByRole('alert')).toContainText('A detailed player failure'); await unchanged();
      await page.getByRole('button', { name: 'Player details', exact: true }).click();
      await expect(details).toContainText('A detailed player failure'); await unchanged();
      await details.getByRole('button', { name: 'Close', exact: true }).click();
      await page.unroute('**/api/participant/control');
      await click('#player-stop'); await expect(page.locator('.playback-status')).toHaveText('■ Stopped'); await unchanged();
      await expect(page.locator('.private-now-playing .artist-credit')).toBeHidden();
      await page.locator('#participant-player').screenshot({ path: `test-results/mobile-player-fixed-${viewport.width}.png` });

      await page.route('**/api/participant/finish', async route => { await finish.promise; await route.continue(); });
      await click('#finish-my-turn'); await expect(page.locator('#finish-my-turn')).toBeDisabled(); await unchanged();
      finish.release(); await expect(page.locator('.player-mobile-notice')).toHaveText('Waiting for turn'); await unchanged();
      const host = await (await page.request.get('/api/host/state')).json();
      await post('/api/host/advance', { turnId: host.turnId });
      await expect(page.locator('.player-mobile-notice')).toHaveText('Choose a song'); await unchanged();
    } finally { start.release(); reveal.release(); finish.release(); await other.close(); }
  });
}

test('mobile details close on desktop and enlarged text scales the frame, not its playback states', async ({ page, isolatedApp }) => {
  await page.request.post('/api/participant/join', { data: { pin: '1234', nickname: 'Player' }, headers: { Origin: isolatedApp.origin } });
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/participant');
  await expect(page.getByRole('button', { name: 'Player details', exact: true })).toBeVisible();
  await page.evaluate(() => { document.documentElement.style.fontSize = '20px'; });
  expect((await page.locator('#participant-player').boundingBox())!.height).toBe(339.5);
  const before = await geometry(page);
  const state = await (await page.request.get('/api/participant/state')).json();
  await page.request.post('/api/participant/play', { data: { turnId: state.turnId, previousPlaybackId: null, trackId: 'demo:aurora' }, headers: { Origin: isolatedApp.origin } });
  await expect(page.locator('#player-transport')).toBeEnabled();
  expect(await geometry(page)).toEqual(before);
  await page.getByRole('button', { name: 'Player details', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.setViewportSize({ width: 1100, height: 1000 });
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Player details', exact: true })).toHaveCount(0);
  await expect(page.locator('#player-play-next')).toBeHidden();
  await expect(page.locator('#player-reveal')).toHaveAccessibleName('Reveal details');
  expect(await page.locator('#participant-player').evaluate(node => getComputedStyle(node).gridTemplateAreas)).toBe('"identity transport" "timeline timeline" "footer footer"');
  await page.setViewportSize({ width: 390, height: 844 });
  expect((await page.locator('#participant-player').boundingBox())!.height).toBe(339.5);
});
