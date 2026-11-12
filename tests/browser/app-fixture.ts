import { test as base, type APIRequestContext } from '@playwright/test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { Engine } from '../../src/engine.js';
import { FileStore } from '../../src/store.js';
import { IntegrationManager, IntegrationFileStore } from '../../src/integrations.js';
import { ManagedPlayback } from '../../src/live-playback.js';
import { createApp } from '../../src/http.js';
import { PreparationFileStore, PreparationManager, savedSourceAvailable } from '../../src/preparations.js';
import type { CatalogueBrowse, CatalogueTrack } from '../../src/model.js';
import { startMusicAssistantFixture } from '../fixtures/music-assistant.js';
import { UploadAssets } from '../../src/uploads.js';
import { fixtureUploadAnalysis } from '../fixtures/uploads.js';
import type { Express } from 'express';

type Remote = Awaited<ReturnType<typeof startMusicAssistantFixture>>;
/** The fixture Music Assistant's only artist and album; tests add songs to that album with `addTracks`. */
export const fixtureArtist = 'Fixture artist';
export const fixtureSong = 'Real catalogue fixture';
/** How the room display titles the fixture song: its version follows in brackets. */
export const fixtureSongOnDisplay = 'Real catalogue fixture (Original recording)';

/** Finds a song as people do, artist → album → song, through any browse function. Defaults to the fixture song. */
async function findSong(browse: (kind: 'artists' | 'albums' | 'tracks', value: string) => Promise<CatalogueBrowse>, title = fixtureSong): Promise<CatalogueTrack> {
  const artist = (await browse('artists', fixtureArtist)).artists?.[0]; if (!artist) throw new Error('The fixture artist was not found. Call connect() first.');
  const album = (await browse('albums', artist.id)).albums?.[0]; if (!album) throw new Error('The fixture album was not found.');
  const track = (await browse('tracks', album.id)).tracks?.find(item => item.title === title); if (!track) throw new Error(`"${title}" is not on the fixture album.`);
  return track;
}
/** A song's catalogue reference for whoever owns `request`'s membership cookie (references are private to each person). */
export function catalogueTrack(request: APIRequestContext, origin: string, title?: string) {
  return findSong(async (kind, value) => {
    const response = await request.post(origin + '/api/participant/browse', { headers: { Origin: origin }, data: { kind, value } });
    if (!response.ok()) throw new Error(`Browse failed: ${response.status()} ${await response.text()}`);
    return response.json() as Promise<CatalogueBrowse>;
  }, title);
}

// Each workflow has its own room, simulated speakers and join-rate limit; no lifecycle reset endpoint is needed.
export const test = base.extend<{ isolatedApp: { origin: string; musicAssistantOrigin: string; dataDirectory: string; engine: Engine; adapter: ManagedPlayback; app: Express; manager: IntegrationManager;
  remote: Remote; calls: { command: string; args: Record<string, unknown> }[]; setSpeakers: Remote['setSpeakers']; setSchema(schema: number): void;
  /** Connects the fixture Music Assistant and its "Living room" speaker, as a host would in Settings. */
  connect(): Promise<void>;
  addTracks: Remote['addTracks'];
  /** A song's catalogue reference for the participant with this credential. */
  trackFor(credential: string, title?: string): Promise<CatalogueTrack> } }>({
  isolatedApp: async ({}, use) => {
    const remote = await startMusicAssistantFixture(); const dir = await mkdtemp('/tmp/opencode/doom-room-browser-isolated-');
    const manager = new IntegrationManager(new IntegrationFileStore(dir)); await manager.init();
    const adapter = new ManagedPlayback(manager);
    const server = createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const port = (server.address() as AddressInfo).port; const origin = `http://127.0.0.1:${port}`;
    const engine = new Engine(new FileStore(dir), adapter, origin, manager); await engine.init();
    const preparations = new PreparationManager(new PreparationFileStore(dir), Date.now, savedSourceAvailable(manager));
    const uploads = new UploadAssets(dir, fixtureUploadAnalysis);
    const http = createApp(engine, { port, guestUrl: origin, listenHost: '127.0.0.1', dataDir: dir }, 'dist/web', manager, preparations, uploads);
    server.on('request', http.app);
    try {
      await use({ origin, musicAssistantOrigin: remote.origin, dataDirectory: dir, engine, adapter, app: http.app, manager, remote, calls: remote.calls, setSpeakers: remote.setSpeakers,
        setSchema(schema) { remote.info.schema_version = schema; },
        async connect() {
          if (manager.configured && manager.view().destination) return; // Already connected: one call per test is enough, more are harmless.
          await manager.save(remote.origin, 'fixture-token', manager.view().revision);
          await manager.selectDestination('sonos:room', manager.view().revision); await adapter.refresh();
        },
        addTracks: songs => remote.addTracks(songs),
        trackFor: (credential, title) => findSong((kind, value) => engine.browse(credential, kind, value), title) });
    }
    finally { http.close(); adapter.close(); remote.close(); server.closeAllConnections(); server.close(); }
  },
  baseURL: async ({ isolatedApp }, use) => { await use(isolatedApp.origin); },
});
