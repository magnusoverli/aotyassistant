import { expect, type Page } from '@playwright/test';
import { test, catalogueTrack, fixtureSongOnDisplay } from './app-fixture';
import { closeSearch, openAlbum, songRow } from './preparation-helpers';

const layoutSong = 'Layout song with a deliberately long title that wraps across several lines on a phone';

const layout = (page: Page) => page.evaluate(() =>
  ['.participant-hero', '.playback-card', '.music-workspace', '.catalogue-panel', '.catalogue-results', '.preparation-list'].map(selector => {
    // Phones hide the player and playlist while search is open: those stay hidden, the rest stays put.
    const rect = document.querySelector(selector)!.getBoundingClientRect(); if (!rect.width && !rect.height) return { hidden: true };
    return { top: rect.top + scrollY, height: rect.height, width: rect.width };
  }));

for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }, { width: 320, height: 700 }, { width: 390, height: 440 }, { width: 844, height: 390 }]) {
  test(`playback and turn changes keep the workspace in place at ${viewport.width}×${viewport.height}`, async ({ page, browser, isolatedApp }) => {
    await page.setViewportSize(viewport);
    await isolatedApp.connect();
    isolatedApp.addTracks([{ title: layoutSong, artist: 'A long artist name with a portrait beside it', album: 'Layout album', duration: 180 }]);
    const post = (path: string, data: unknown) => page.request.post(path, { data, headers: { Origin: isolatedApp.origin } });
    await post('/api/participant/join', { pin: '1234', nickname: 'First' });
    const other = await browser.newContext();
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    try {
      await other.request.post(isolatedApp.origin + '/api/participant/join', { data: { pin: '1234', nickname: 'A very long next listener name' }, headers: { Origin: isolatedApp.origin } });
      await page.goto('/participant');
      await expect(page.locator('.playback-card')).toContainText('Choose a song');
      await expect(page.getByRole('slider', { name: 'Volume', exact: true })).toBeDisabled();
      await openAlbum(page);
      await expect(songRow(page, layoutSong)).toHaveCount(1);
      await page.evaluate(() => { (document.activeElement as HTMLElement)?.blur(); scrollTo({ top: 0, behavior: 'instant' }); });
      // Phones start the song from full-screen search, with the player out of sight until Done.
      const phone = viewport.width < 1100;
      let before = await layout(page);
      const workspace = await page.locator('.music-workspace').elementHandle();
      const sameWorkspace = async () => expect(await workspace!.evaluate(node => node === document.querySelector('.music-workspace'))).toBe(true);
      const unchanged = async () => {
        expect(await layout(page)).toEqual(before);
        expect(await page.evaluate(() => scrollY)).toBe(0);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      };
      // Invoke controls without browser test automation scrolling to them first.
      const click = (selector: string) => page.locator(selector).evaluate(node => (node as HTMLButtonElement).click());
      await page.route('**/api/participant/play', async route => { await pending; await route.continue(); });
      await songRow(page, layoutSong).locator('.row-actions button:last-child').evaluate(node => (node as HTMLButtonElement).click());
      if (phone) await expect(page.locator('.player-pending')).not.toHaveCount(0);
      else await expect(page.getByText('Starting track…', { exact: true })).toBeVisible();
      await unchanged(); await sameWorkspace();
      release(); await expect(page.locator('.player-pending')).toHaveCount(0);
      await expect(page.locator('#player-transport')).toBeEnabled();
      await unchanged(); await sameWorkspace();
      if (phone) {
        await closeSearch(page);
        await page.evaluate(() => { (document.activeElement as HTMLElement)?.blur(); scrollTo({ top: 0, behavior: 'instant' }); });
        before = await layout(page);
      }
      for (const name of ['Resume', 'Pause']) {
        await click('#player-transport'); await expect(page.locator('#player-transport')).toHaveText(name);
        await unchanged(); await sameWorkspace();
      }
      await click('#player-reveal'); await expect(page.locator('.playback-card .privacy-tag')).toHaveText('Visible on room display');
      await expect(page.locator('#player-reveal')).toBeDisabled();
      await unchanged(); await sameWorkspace();
      await page.screenshot({ path: `test-results/stable-player-playing-${viewport.width}x${viewport.height}.png`, fullPage: true });
      const previous = await (await page.request.get('/api/participant/state')).json();
      await post('/api/participant/play', { turnId: previous.turnId, previousPlaybackId: previous.ownPlayback.id, trackId: (await catalogueTrack(page.request, isolatedApp.origin)).id });
      await expect(page.locator('.private-now-playing h2')).toHaveText(fixtureSongOnDisplay);
      await unchanged(); await sameWorkspace();
      const state = await (await page.request.get('/api/participant/state')).json();
      await post('/api/participant/control', { turnId: state.turnId, playbackId: state.ownPlayback.id, action: 'stop' });
      await expect(page.locator('.playback-status')).toHaveText('■ Stopped');
      await expect(page.locator('#player-transport')).toBeDisabled();
      await unchanged(); await sameWorkspace();
      page.once('dialog', dialog => dialog.accept()); await click('#finish-my-turn'); await expect(page.locator('.playback-card')).toContainText('Waiting for your turn');
      await expect(page.locator('#finish-my-turn')).toBeDisabled();
      // Phones replace the controls with a compact waiting card while someone else has the turn.
      if (viewport.width >= 1100) await unchanged();
      else { await expect(page.locator('.player-waiting')).toBeVisible(); await expect(page.locator('.player-waiting-turn')).toHaveText('A very long next listener name’s turn'); }
      const next = await (await page.request.get('/api/host/state')).json();
      await post('/api/host/advance', { turnId: next.turnId });
      await expect(page.locator('.playback-card')).toContainText('Choose a song');
      await expect(page.locator('#finish-my-turn')).toBeEnabled();
      await unchanged();
      await page.screenshot({ path: `test-results/stable-player-${viewport.width}x${viewport.height}.png`, fullPage: true });
    } finally { release(); await other.close(); }
  });
}
