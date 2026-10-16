import { MusicAssistantClient, musicAssistantUrl, maToken } from '../src/music-assistant.js';

// Explicitly read-only. No raw responses, track metadata, or access tokens are printed.
async function main() {
  const url = musicAssistantUrl.parse(process.env.MUSIC_ASSISTANT_URL ?? '');
  const token = maToken.parse(process.env.MUSIC_ASSISTANT_TOKEN ?? '');
  const reader = new MusicAssistantClient(url, token);
  const report = await reader.inspect();
  console.info(`Authenticated read-only connection succeeded; ${report.players.length} player(s) available in inventory.`);
  console.info(report.docsAvailable ? 'Generated API documentation is reachable.' : 'Generated API documentation was not reachable. Review it on the deployed server.');
  const destination = process.env.PLAYBACK_DESTINATION;
  if (destination) {
    const player = report.players.find(p => p.id === destination);
    if (!player || !player.available) throw new Error();
    await reader.activeQueue(destination);
    console.info('Configured destination exists and has an active Music Assistant queue. No playback commands were issued.');
  } else console.info('Set PLAYBACK_DESTINATION to also check the selected speaker/group.');
}
await main().catch(() => {
  console.error('Read-only probe failed. Check URL/token/destination and the deployed API documentation. Raw server errors were suppressed.');
  process.exitCode = 1;
});
