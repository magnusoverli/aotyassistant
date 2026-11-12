import { expect, type Page } from '@playwright/test';
export async function showList(page: Page) {
  await expect(page.getByRole('complementary', { name: 'Your playlist', exact: true })).toBeVisible();
}
export async function showFind(page: Page) { await expect(page.getByRole('searchbox', { name: 'Search catalogue' })).toBeVisible(); }
export async function saveChoice(page: Page) {
  await page.getByRole('button', { name: 'Add to list', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Added ✓', exact: true })).toBeVisible();
  await showList(page); await expect(page.locator('.saved-track.is-next')).toBeVisible();
}
/** Drags a saved song's row with the mouse onto another song's place in Your playlist. */
export async function dragSong(page: Page, title: string, onto: string) {
  const list = page.locator('.preparation-list');
  await expect(list).toHaveAttribute('data-save-state', 'ready');
  const row = (name: string) => list.locator('ol.saved-tracks > .saved-track').filter({ has: page.getByText(name, { exact: true }) });
  await row(title).scrollIntoViewIfNeeded();
  const from = (await row(title).boundingBox())!; const to = (await row(onto).boundingBox())!;
  const x = from.x + from.width / 3;
  await page.mouse.move(x, from.y + from.height / 2); await page.mouse.down();
  await page.mouse.move(x, from.y + from.height / 2 + (to.y > from.y ? 12 : -12), { steps: 3 });
  await page.mouse.move(x, to.y + to.height / 2, { steps: 10 }); await page.mouse.up();
}
/** Phones keep search behind the field under the playlist title; desktop shows it beside the list. */
export async function openSearch(page: Page) {
  const opener = page.locator('#music-search-open');
  if (await opener.isVisible()) await opener.click();
  await showFind(page);
}
/** Searches for an artist, as a person types it. */
export async function searchArtist(page: Page, artist = 'Fixture artist') {
  await openSearch(page);
  const input = page.getByRole('searchbox', { name: 'Search catalogue' }); await input.fill(artist);
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.getByRole('button', { name: `View albums by ${artist}`, exact: true })).toBeVisible();
}
/** Artist → album → its songs: the only way to reach a song. Leaves the album's songs on screen. */
export async function openAlbum(page: Page, artist = 'Fixture artist', album = 'Fixture album') {
  await searchArtist(page, artist);
  await page.getByRole('button', { name: `View albums by ${artist}`, exact: true }).click();
  await page.getByRole('button', { name: `View tracks on ${album}`, exact: true }).click();
  await expect(page.locator('.catalogue-results .track-row:not(.browse-row)').first()).toBeVisible();
}
/** The row of one song in the open album. */
export function songRow(page: Page, title: string) {
  return page.locator('.catalogue-results .track-row').filter({ has: page.getByText(title, { exact: true }) });
}
/** Adds songs from the open fixture album to Your playlist, then leaves phone search so the list is in view. */
export async function addSongs(page: Page, titles: string[]) {
  await openAlbum(page);
  for (const title of titles) {
    const row = songRow(page, title);
    await row.getByRole('button', { name: 'Add to list', exact: true }).click();
    await expect(row.getByRole('button', { name: 'Added ✓', exact: true })).toBeVisible();
  }
  await closeSearch(page);
}
/** Phones: Done closes the search sheet. Desktop has no sheet, so nothing happens there. */
export async function closeSearch(page: Page) {
  const done = page.getByRole('button', { name: 'Done', exact: true }).and(page.locator('.search-sheet-done'));
  if (await done.isVisible()) { await done.click(); await expect(page.locator('#music-search-open')).toBeVisible(); }
}
