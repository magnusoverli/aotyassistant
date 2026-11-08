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
