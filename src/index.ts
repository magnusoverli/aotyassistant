import { createServer } from 'node:http';
import { once } from 'node:events';
import { configFromEnv } from './config.js';
import { Engine } from './engine.js';
import { FileStore } from './store.js';
import { DemoAdapter } from './playback.js';
import { createApp } from './http.js';
import { IntegrationFileStore, IntegrationManager } from './integrations.js';
import { ManagedPlayback } from './live-playback.js';

let cleanup = () => {};
try {
  const config = configFromEnv();
  const integrations = new IntegrationManager(new IntegrationFileStore(config.dataDir));
  await integrations.init();
  const adapter = new ManagedPlayback(new DemoAdapter(config.demoSeconds), integrations);
  cleanup = () => adapter.close();
  const engine = new Engine(new FileStore(config.dataDir), adapter, config.guestUrl, integrations);
  await engine.init();
  const { app, close } = createApp(engine, config, undefined, integrations);
  cleanup = () => { adapter.close(); close(); };
  const server = createServer(app); server.listen(config.port, config.listenHost);
  await once(server, 'listening'); // Also rejects asynchronous bind/DNS failures.
  console.info(`Albums of the Year listening on port ${config.port}. Music starts only on Play. Host controls are open to LAN users.`);
  if (integrations.configured) void integrations.checkMediaOrigins([integrations.addressing().effectiveMediaOrigin], integrations.view().revision).catch(() => {});
  let stopping = false;
  const shutdown = () => {
    if (stopping) return; stopping = true;
    cleanup(); server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 5000).unref();
  };
  process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
} catch {
  cleanup();
  console.error('Startup failed. Check configuration, the listening address/port, and the persistent data directory. No credentials or state details were logged.');
  process.exitCode = 1;
}
