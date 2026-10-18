import { test as base } from '@playwright/test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { Engine } from '../../src/engine.js';
import { FileStore } from '../../src/store.js';
import { IntegrationManager, IntegrationFileStore } from '../../src/integrations.js';
import { ManagedPlayback } from '../../src/live-playback.js';
import { DemoAdapter } from '../../src/playback.js';
import { createApp } from '../../src/http.js';
import { PreparationFileStore, PreparationManager } from '../../src/preparations.js';
import { startMusicAssistantFixture } from '../fixtures/music-assistant.js';
import { UploadAssets } from '../../src/uploads.js';
import { fixtureUploadAnalysis } from '../fixtures/uploads.js';
import type { Express } from 'express';

// Each workflow has its own room, simulated speakers and join-rate limit; no lifecycle reset endpoint is needed.
export const test = base.extend<{ isolatedApp: { origin: string; musicAssistantOrigin: string; dataDirectory: string; demo: DemoAdapter; engine: Engine; app: Express; manager: IntegrationManager; calls: { command: string; args: Record<string, unknown> }[] } }>({
  isolatedApp: async ({}, use) => {
    const remote = await startMusicAssistantFixture(); const dir = await mkdtemp('/tmp/opencode/aoty-browser-isolated-');
    const manager = new IntegrationManager(new IntegrationFileStore(dir)); await manager.init();
    const demo = new DemoAdapter(60); const adapter = new ManagedPlayback(demo, manager);
    const server = createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const port = (server.address() as AddressInfo).port; const origin = `http://127.0.0.1:${port}`;
    const engine = new Engine(new FileStore(dir), adapter, origin, manager); await engine.init();
    const preparations = new PreparationManager(new PreparationFileStore(dir), Date.now, selection => selection.source === 'demo' ? !manager.configured
      : selection.source === 'upload' ? manager.uploadPlaybackAvailable : selection.sourceBindingId === manager.sourceBindingId);
    const uploads = new UploadAssets(dir, fixtureUploadAnalysis);
    const http = createApp(engine, { port, guestUrl: origin, listenHost: '127.0.0.1', dataDir: dir, mode: 'demo', demoSeconds: 60 }, 'dist/web', manager, preparations, uploads);
    server.on('request', http.app);
    try { await use({ origin, musicAssistantOrigin: remote.origin, dataDirectory: dir, demo, engine, app: http.app, manager, calls: remote.calls }); }
    finally { http.close(); adapter.close(); remote.close(); server.closeAllConnections(); server.close(); }
  },
  baseURL: async ({ isolatedApp }, use) => { await use(isolatedApp.origin); },
});
