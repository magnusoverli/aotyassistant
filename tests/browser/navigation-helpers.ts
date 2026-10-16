import type { Page } from '@playwright/test';

export async function openNavigation(page: Page) {
  const toggle = page.locator('header .header-menu-toggle');
  if (await toggle.isVisible() && await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
}
