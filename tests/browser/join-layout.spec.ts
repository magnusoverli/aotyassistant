import { expect } from '@playwright/test';
import { test } from './app-fixture';

test('joining matches the reviewed pages in typography, surfaces and responsive form layout', async ({ browser, page: host, isolatedApp }) => {
  const guest = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await guest.newPage();
  const typography = (node: Element) => {
    const style = getComputedStyle(node);
    return { family: style.fontFamily, weight: style.fontWeight, size: style.fontSize, spacing: style.letterSpacing };
  };
  const surface = (node: Element) => {
    const style = getComputedStyle(node);
    return { background: style.backgroundColor, border: style.borderColor, radius: style.borderRadius, padding: style.padding };
  };
  try {
    await host.setViewportSize({ width: 1440, height: 1000 }); await host.goto('/host/settings');
    await expect(host.getByRole('button', { name: 'Find Music Assistant', exact: true })).toBeEnabled();
    const titleStyle = await host.getByRole('heading', { level: 1 }).evaluate(typography);
    const labelStyle = await host.locator('label[for="ma-url"]').evaluate(typography);
    await isolatedApp.engine.join('Layout host');
    await host.goto('/host'); await expect(host.locator('.host-people')).toBeVisible();
    const cardStyle = await host.locator('.host-people').evaluate(surface);
    const background = await host.locator('body').evaluate(node => ({ color: getComputedStyle(node).backgroundColor, image: getComputedStyle(node).backgroundImage }));
    await page.goto(isolatedApp.origin + '/join');
    const title = page.getByRole('heading', { name: 'Join room', exact: true });
    const card = page.getByRole('region', { name: 'Join room', exact: true });
    const input = page.getByLabel('What should we call you?');
    const submit = page.getByRole('button', { name: 'Join room', exact: true });
    await expect(title).toBeVisible();
    expect(await title.evaluate(typography)).toEqual(titleStyle);
    expect(await page.locator('label[for="nickname"]').evaluate(typography)).toEqual(labelStyle);
    expect(await card.evaluate(surface)).toEqual(cardStyle);
    expect(await page.locator('body').evaluate(node => ({ color: getComputedStyle(node).backgroundColor, image: getComputedStyle(node).backgroundImage }))).toEqual(background);
    await expect(input).toHaveAttribute('autocomplete', 'nickname'); await expect(input).toHaveAttribute('maxlength', '40');
    await expect(input).toHaveAttribute('required', '');
    expect(await input.evaluate(node => parseFloat(getComputedStyle(node).fontSize))).toBeGreaterThanOrEqual(16);
    await input.fill('A listener with a longer nickname');
    for (const [width, height] of [[1440, 1000], [1000, 800], [701, 800], [700, 800], [390, 844], [320, 700], [390, 440]]) {
      await page.setViewportSize({ width: width!, height: height! });
      await expect(title).toBeInViewport(); await expect(input).toBeInViewport(); await expect(submit).toBeInViewport();
      await expect(input).toHaveValue('A listener with a longer nickname');
      const field = (await input.boundingBox())!; const button = (await submit.boundingBox())!;
      expect(field.width).toBe(button.width); expect(field.height).toBeGreaterThanOrEqual(44); expect(button.height).toBeGreaterThanOrEqual(44);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      if (width === 1440 || width === 390 && height === 844) await page.screenshot({ path: `test-results/join-coherent-${width}.png`, fullPage: true });
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await input.focus(); await page.keyboard.press('Tab'); await expect(submit).toBeFocused(); await submit.press('Enter');
    await expect(page).toHaveURL(isolatedApp.origin + '/participant');
    await expect(page.getByRole('heading', { name: 'Layout host’s turn.', exact: true })).toBeVisible();
    expect((await (await page.request.get(isolatedApp.origin + '/api/participant/state')).json()).ownPlayback).toBeFalsy();
  } finally { await guest.close(); }
});

test('join failures keep the nickname and keyboard focus available for an explicit retry', async ({ page }) => {
  let fail = true;
  await page.route('**/api/participant/join', async route => {
    if (fail) { fail = false; await route.fulfill({ status: 409, json: { error: 'The room could not be joined. Try again.' } }); }
    else await route.continue();
  });
  await page.setViewportSize({ width: 320, height: 700 }); await page.goto('/join');
  const input = page.getByLabel('What should we call you?'); const submit = page.getByRole('button', { name: 'Join room', exact: true });
  await input.fill('Retry listener'); await submit.focus(); await submit.press('Enter');
  await expect(page.getByRole('alert')).toHaveText('The room could not be joined. Try again.');
  await expect(input).toHaveValue('Retry listener'); await expect(submit).toBeFocused(); await expect(submit).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await submit.press('Enter'); await expect(page).toHaveURL('/participant');
  await expect(page.getByRole('heading', { name: 'Your turn.', exact: true })).toBeVisible();
});
