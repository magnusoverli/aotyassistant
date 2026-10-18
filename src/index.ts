import { createServer } from 'node:http';
import { once } from 'node:events';
import { configFromEnv } from './config.js';
import { Engine } from './engine.js';
import { FileStore } from './store.js';
import { DemoAdapter } from './playback.js';
import { createApp } from './http.js';
import { IntegrationFileStore, IntegrationManager } from './integrations.js';
import { ManagedPlayback } from './live-playback.js';
import { SetupManager } from './setup.js';
import { SupervisorClient } from './supervisor.js';
import { ingressListener } from './ingress.js';
import { startBackupControl } from './backup.js';

let cleanup = () => {};
try {
  const config = configFromEnv();
  const integrations = new IntegrationManager(new IntegrationFileStore(config.dataDir));
  await integrations.init();
  const adapter = new ManagedPlayback(new DemoAdapter(config.demoSeconds), integrations);
  cleanup = () => { adapter.close(); integrations.close(); };
  const engine = new Engine(new FileStore(config.dataDir), adapter, config.guestUrl, integrations);
  await engine.init();
  const setup = new SetupManager(config, integrations, origin => engine.setGuestOrigin(origin),
    config.addon && process.env.SUPERVISOR_TOKEN ? new SupervisorClient(process.env.SUPERVISOR_TOKEN) : undefined);
  const { app, close } = createApp(engine, config, undefined, integrations, undefined, undefined, setup);
  let closeBackup = () => {};
  const servers: ReturnType<typeof createServer>[] = [];
  cleanup = () => { setup.close(); closeBackup(); adapter.close(); integrations.close(); close(); for (const server of servers) { server.closeAllConnections(); server.close(); } };
  const server = createServer(app); server.listen(config.port, config.listenHost);
  servers.push(server);
  await once(server, 'listening'); // Also rejects asynchronous bind/DNS failures.
  if (config.ingressPort) {
    const ingress = createServer(ingressListener(app)); servers.push(ingress);
    ingress.listen(config.ingressPort, config.listenHost); await once(ingress, 'listening');
  }
  if (config.addon) closeBackup = await startBackupControl();
  console.info(`Albums of the Year listening on port ${config.port}. Music starts only on Play. Host controls are open to LAN users.`);
  setup.start();
  let stopping = false;
  const shutdown = () => {
    if (stopping) return; stopping = true;
    cleanup(); process.exitCode = 0;
    setTimeout(() => process.exit(1), 5000).unref();
  };
  process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
} catch {
  cleanup();
  console.error('Startup failed. Check configuration, the listening address/port, and the persistent data directory. No credentials or state details were logged.');
  process.exitCode = 1;
}
