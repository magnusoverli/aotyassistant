import { expect, type Page } from '@playwright/test';
export async function showList(page: Page) {
  const expand = page.getByRole('button', { name: 'Open list', exact: true });
  if (await expand.isVisible()) await expand.click();
  await expect(page.getByRole('complementary', { name: /^Saved list/ })).toBeVisible();
}
export async function showFind(page: Page) { await expect(page.getByRole('searchbox', { name: 'Search catalogue' })).toBeVisible(); }
export async function saveChoice(page: Page) {
  await page.getByRole('button', { name: 'Add to list', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Added ✓', exact: true })).toBeVisible();
  await showList(page); await expect(page.locator('.saved-track.is-next')).toBeVisible();
}
