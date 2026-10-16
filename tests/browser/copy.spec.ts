import { expect, type Page } from '@playwright/test';
import { test } from './app-fixture';

async function plainCopy(page: Page) {
  await expect(page.locator('.host-warning, .setup-steps, .session-navigation')).toHaveCount(0);
  const text = await page.locator('body').innerText();
  for (const phrase of ['PEOPLE FIRST. ONE TRACK AT A TIME.', 'GOOD RECORDS. GOOD COMPANY.', 'GOOD MUSIC. GOOD COMPANY.',
    'PULL UP A CHAIR', 'AN EVENING WORTH SHARING', 'Another circle, another story', 'Give them time for the song',
    'The room is yours', 'The circle is warming up', 'The circle is gathering', 'Your year, in records',
    'People, not a song queue', 'Open host controls:', 'Host access is open:', 'Session links']) {
    expect(text.toLocaleLowerCase()).not.toContain(phrase.toLocaleLowerCase());
  }
}

test('pages use plain functional copy without host banners or slogans while joining/playback/reveal remain usable', async ({ browser, page: host, isolatedApp }) => {
  const post = (path: string, data: unknown) => host.request.post(path, { data, headers: { Origin: isolatedApp.origin } });
  const participantContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const displayContext = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  try {
    await host.goto('/'); await expect(host.getByRole('heading', { name: 'Albums of the Year', exact: true })).toBeVisible(); await plainCopy(host);
    await host.goto('/host'); await expect(host.getByRole('heading', { name: 'Listening room', exact: true })).toBeVisible(); await plainCopy(host);
    await host.goto('/host/settings'); await expect(host.getByLabel('Music Assistant URL', { exact: true })).toBeVisible(); await plainCopy(host);
    // The cleanup removes the repeated open-host notice, not real error/security feedback.
    await host.getByText('Advanced: token or separate login address', { exact: true }).click();
    await expect(host.getByText('HTTP connection — use HTTPS')).toBeVisible();
    await host.screenshot({ path: 'test-results/settings-plain-copy.png', fullPage: true });
    const listener = await participantContext.newPage(); await listener.goto(isolatedApp.origin + '/participant');
    await expect(listener.getByRole('heading', { name: 'Participant', exact: true })).toBeVisible(); await plainCopy(listener);
    let session = await (await host.request.get('/api/host/state')).json(); await host.goto('/host');
    await expect(host.getByRole('button', { name: 'Start listening', exact: true })).toHaveCount(0); await plainCopy(host);
    await listener.goto(session.joinUrl); await expect(listener.getByRole('heading', { name: 'Join room', exact: true })).toBeVisible(); await plainCopy(listener);
    await listener.getByLabel('What should we call you?').fill('Listener'); await listener.getByRole('button', { name: 'Join room', exact: true }).click();
    await expect(listener.locator('.turn-chip')).toHaveText('YOUR TURN'); await plainCopy(listener);
    session = await (await host.request.get('/api/host/state')).json();
    await expect(listener.getByRole('heading', { name: 'Your turn.', exact: true })).toBeVisible(); await plainCopy(listener);
    await listener.screenshot({ path: 'test-results/participant-plain-copy.png', fullPage: true });
    await expect(host.getByRole('heading', { name: 'Listener', exact: true })).toBeVisible(); await plainCopy(host);
    await host.screenshot({ path: 'test-results/host-plain-copy.png', fullPage: true });
    const tv = await displayContext.newPage(); await tv.goto(session.displayUrl);
    await expect(tv.getByRole('heading', { name: 'Nothing playing.' })).toBeVisible(); await plainCopy(tv);
    const play = await listener.request.post('/api/participant/play', { headers: { Origin: isolatedApp.origin }, data: { turnId: session.turnId, previousPlaybackId: null, trackId: 'demo:aurora' } }); expect(play.ok()).toBe(true);
    const own = await play.json(); await expect(tv.getByRole('heading', { name: 'Keep them guessing.' })).toBeVisible();
    await expect(tv.locator('.artist-credit')).toHaveText(''); await expect(tv.locator('.vinyl-caption')).not.toHaveText(''); await plainCopy(tv);
    const reveal = await listener.request.post('/api/participant/reveal', { headers: { Origin: isolatedApp.origin }, data: { turnId: session.turnId, playbackId: own.ownPlayback.id } }); expect(reveal.ok()).toBe(true);
    await expect(tv.getByRole('heading', { name: 'Northern Lights', exact: true })).toBeVisible(); await plainCopy(tv);
    session = await (await host.request.get('/api/host/state')).json(); await post('/api/host/remove', { id: session.current.id, revision: session.revision });
    await expect(tv.getByRole('heading', { name: 'Nothing playing.' })).toBeVisible(); await plainCopy(tv);
    await expect(listener.getByRole('heading', { name: 'Removed from the room.' })).toBeVisible(); await plainCopy(listener);
    await expect(host.getByRole('button', { name: 'Create another session' })).toHaveCount(0); await plainCopy(host);
  } finally { await participantContext.close(); await displayContext.close(); }
});
