import { expect, type Page } from '@playwright/test';
import { test, catalogueTrack, fixtureSongOnDisplay } from './app-fixture';
import { addSongs, dragSong } from './preparation-helpers';

async function plainCopy(page: Page) {
  await expect(page.locator('.host-warning, .setup-steps, .session-navigation')).toHaveCount(0);
  const text = await page.locator('body').innerText();
  for (const phrase of ['PEOPLE FIRST. ONE TRACK AT A TIME.', 'GOOD RECORDS. GOOD COMPANY.', 'GOOD MUSIC. GOOD COMPANY.',
    'PULL UP A CHAIR', 'AN EVENING WORTH SHARING', 'Another circle, another story', 'Give them time for the song',
    'The room is yours', 'The circle is warming up', 'The circle is gathering', 'Your year, in records',
    'People, not a song queue', 'Open host controls:', 'Host access is open:', 'Session links',
    'Albums of the Year', 'Play next', 'Make next', 'Reveal song', 'Keep them guessing.', 'listening circle']) {
    expect(text.toLocaleLowerCase()).not.toContain(phrase.toLocaleLowerCase());
  }
  await expect(page.getByRole('heading', { name: 'Saved list', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Saved list', exact: true })).toHaveCount(0);
}

test('pages use function-first copy while joining, playback and reveal remain usable', async ({ browser, page: host, isolatedApp }) => {
  const post = (path: string, data: unknown) => host.request.post(path, { data, headers: { Origin: isolatedApp.origin } });
  const participantContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const displayContext = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  try {
    await host.goto('/'); await expect(host.getByRole('heading', { name: 'Doom Room', exact: true })).toBeVisible(); await plainCopy(host);
    await expect(host.getByText('Take turns. Share music. Listen together.', { exact: true })).toBeVisible();
    await expect(host.locator('meta[name="description"]')).toHaveAttribute('content', 'Turn-based music sharing for Home Assistant, powered by Music Assistant.');
    await host.goto('/host'); await expect(host.getByRole('main', { name: 'Host desk', exact: true })).toBeVisible(); await plainCopy(host);
    await host.goto('/host/settings'); await expect(host.getByLabel('Music Assistant URL', { exact: true })).toBeVisible(); await plainCopy(host);
    // Connection-security guidance remains visible in advanced setup.
    await host.getByText('Advanced: token or separate login address', { exact: true }).click();
    await expect(host.getByText('This connection uses HTTP. Use HTTPS')).toBeVisible();
    await host.screenshot({ path: 'test-results/settings-plain-copy.png', fullPage: true });
    const listener = await participantContext.newPage(); await listener.goto(isolatedApp.origin + '/participant');
    await expect(listener.getByRole('heading', { name: 'Join room', exact: true })).toBeVisible(); await plainCopy(listener);
    let session = await (await host.request.get('/api/host/state')).json(); await host.goto('/host');
    await expect(host.getByRole('button', { name: 'Start listening', exact: true })).toHaveCount(0); await plainCopy(host);
    await listener.goto(session.joinUrl); await expect(listener.getByRole('heading', { name: 'Join room', exact: true })).toBeVisible(); await plainCopy(listener);
    await listener.getByLabel('Display name').fill('Listener'); await listener.getByLabel('4-digit PIN', { exact: true }).fill('1234'); await listener.getByRole('button', { name: 'Join room', exact: true }).click();
    await expect(listener.locator('.participant-hero')).toContainText('Your turn.'); await plainCopy(listener);
    session = await (await host.request.get('/api/host/state')).json();
    await expect(listener.getByRole('heading', { name: 'Your turn.', exact: true })).toBeVisible(); await plainCopy(listener);
    await listener.screenshot({ path: 'test-results/participant-plain-copy.png', fullPage: true });
    await expect(host.getByRole('heading', { name: 'Listener', exact: true })).toBeVisible(); await plainCopy(host);
    await host.screenshot({ path: 'test-results/host-plain-copy.png', fullPage: true });
    const tv = await displayContext.newPage(); await tv.goto(session.displayUrl);
    await expect(tv.getByRole('heading', { name: 'Nothing playing.' })).toBeVisible(); await plainCopy(tv);
    await isolatedApp.connect(); const track = await catalogueTrack(listener.request, isolatedApp.origin);
    const play = await listener.request.post('/api/participant/play', { headers: { Origin: isolatedApp.origin }, data: { turnId: session.turnId, previousPlaybackId: null, trackId: track.id } }); expect(play.ok()).toBe(true);
    const own = await play.json(); await expect(tv.getByRole('heading', { name: 'Track details hidden.' })).toBeVisible();
    await expect(tv.locator('.artist-credit')).toHaveText(''); await expect(tv.locator('.vinyl-caption')).not.toHaveText(''); await plainCopy(tv);
    const reveal = await listener.request.post('/api/participant/reveal', { headers: { Origin: isolatedApp.origin }, data: { turnId: session.turnId, playbackId: own.ownPlayback.id } }); expect(reveal.ok()).toBe(true);
    await expect(tv.getByRole('heading', { name: fixtureSongOnDisplay, exact: true })).toBeVisible(); await plainCopy(tv);
    session = await (await host.request.get('/api/host/state')).json(); await post('/api/host/remove', { id: session.current.id, revision: session.revision });
    await expect(tv.getByRole('heading', { name: 'Nothing playing.' })).toBeVisible(); await plainCopy(tv);
    await expect(listener.getByRole('status').filter({ hasText: 'You’re no longer in the listening order.' })).toBeVisible(); await plainCopy(listener);
    await expect(host.getByRole('button', { name: 'Create another session' })).toHaveCount(0); await plainCopy(host);
  } finally { await participantContext.close(); await displayContext.close(); }
});

test('without Music Assistant, search says to connect it and opens once it is connected, with no demo mode anywhere', async ({ page, isolatedApp }) => {
  await page.goto('/join'); await page.getByLabel('Display name').fill('Early listener'); await page.getByLabel('4-digit PIN', { exact: true }).fill('1234');
  await page.getByRole('button', { name: 'Join room', exact: true }).click(); await expect(page).toHaveURL('/participant');
  const search = page.getByRole('searchbox', { name: 'Search catalogue' });
  await expect(page.locator('#music-find')).toContainText('Connect Music Assistant in host settings to find music.');
  await expect(search).toBeDisabled(); await expect(page.getByRole('button', { name: 'Search', exact: true })).toBeDisabled();
  for (const path of ['/host', '/participant', '/display']) {
    await page.goto(path); await expect(page.getByRole('main')).toBeVisible();
    await expect(page.locator('body')).not.toContainText('Demo mode', { useInnerText: true });
  }
  const post = (path: string, data: unknown) => page.request.post(path, { data, headers: { Origin: isolatedApp.origin } });
  const connected = await post('/api/host/integrations/save', { url: isolatedApp.musicAssistantOrigin, accessToken: 'fixture-token', revision: 0 });
  expect(connected.ok()).toBe(true);
  await page.goto('/participant');
  await expect(search).toBeEnabled(); await expect(search).toHaveAttribute('placeholder', 'Artist');
  await expect(page.locator('#music-find')).not.toContainText('Connect Music Assistant');
  expect(isolatedApp.calls.some(call => /play_media|cmd\/play|cmd\/volume/.test(call.command))).toBe(false);
});

test('dragging a song to the top only changes the first selection and Play first selection starts it explicitly', async ({ page, isolatedApp }) => {
  await isolatedApp.connect(); isolatedApp.addTracks([{ title: 'Northern Lights' }, { title: 'Night Bus Home' }]);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/join'); await page.getByLabel('Display name').fill('Selections listener'); await page.getByLabel('4-digit PIN', { exact: true }).fill('1234');
  await page.getByRole('button', { name: 'Join room', exact: true }).click(); await expect(page).toHaveURL('/participant');
  await addSongs(page, ['Northern Lights', 'Night Bus Home']);
  const list = page.getByRole('complementary', { name: 'Your playlist', exact: true });
  await expect(list.locator('.saved-track')).toHaveCount(2);
  // No edit mode, handle or menu: the row itself is dragged.
  await expect(page.getByRole('button', { name: 'Edit order' })).toHaveCount(0);
  await dragSong(page, 'Night Bus Home', 'Northern Lights');
  await expect(list.locator('.saved-track').first().locator('strong')).toHaveText('Night Bus Home');
  const before = await (await page.request.get('/api/participant/state')).json();
  expect(before.ownPlayback).toBeNull(); expect(before.playbackStatus).toBe('idle');
  await page.getByRole('button', { name: /^(Play first selection|Play pick)$/ }).click();
  await expect(page.locator('.playback-card .playback-status')).toHaveText('● Playing');
  const after = await (await page.request.get('/api/participant/state')).json();
  expect(after.turnId).toBe(before.turnId); expect(after.ownPlayback.track.title).toBe('Night Bus Home');
});
