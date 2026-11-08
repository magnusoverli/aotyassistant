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
import { PreparationFileStore, PreparationManager, savedSourceAvailable } from './preparations.js';
import { UploadAssets } from './uploads.js';
import { drainOperations } from './operation.js';
import { diagnostics } from './diagnostics.js';
import { productName } from './product.js';
import { OnlineAccess } from './online-access.js';
import { TailscaleConnector, onlinePort } from './tailscale.js';
import { publicListener } from './public-listener.js';
import { BrowserSpeakers } from './browser-speakers.js';
import { speakerContext } from './browser-speaker-http.js';

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
  const preparationStore = new PreparationFileStore(config.dataDir);
  const preparations = new PreparationManager(preparationStore, Date.now, savedSourceAvailable(integrations));
  const uploads = new UploadAssets(config.dataDir, undefined, undefined, preparationStore);
  const connector = config.addon && process.env.TAILSCALE_BUNDLED === '1' ? new TailscaleConnector(config.dataDir) : undefined;
  const online = new OnlineAccess(config.dataDir, connector); await online.init();
  engine.setOnlineSharing(() => online.sharing()); online.on('change', () => engine.emit('change'));
  const speakers = new BrowserSpeakers(() => integrations.browserSpeakerConnection(), () => {
    void integrations.check(integrations.view().revision).catch(() => {});
  });
  online.on('revoke', () => speakers.revokePublic());
  const { app, close } = createApp(engine, config, undefined, integrations, preparations, uploads, setup, online, speakers);
  const publicApp = publicListener(app, online);
  let closeBackup = () => {};
  const closeDiagnostics = diagnostics.start();
  const servers: ReturnType<typeof createServer>[] = [];
  cleanup = () => { speakers.close(); void online.close(); publicApp.close(); closeDiagnostics(); setup.close(); closeBackup(); adapter.close(); integrations.close(); close(); for (const server of servers) { server.closeAllConnections(); server.close(); } };
  const server = createServer(app); server.listen(config.port, config.listenHost);
  speakers.attach(server, req => speakerContext(req, 'lan', integrations.guestOrigin || config.guestUrl, config.port));
  servers.push(server);
  await once(server, 'listening'); // Also rejects asynchronous bind/DNS failures.
  if (config.ingressPort) {
    const ingress = createServer(ingressListener(app)); servers.push(ingress);
    speakers.attach(ingress, req => speakerContext(req, 'ingress', config.guestUrl, config.port));
    ingress.listen(config.ingressPort, config.listenHost); await once(ingress, 'listening');
  }
  if (connector) {
    const guests = createServer(publicApp.listener); guests.maxConnections = 256; guests.requestTimeout = 120_000; guests.headersTimeout = 15_000;
    speakers.attach(guests, req => speakerContext(req, 'public', config.guestUrl, config.port, online));
    servers.push(guests); guests.listen(onlinePort, '127.0.0.1'); await once(guests, 'listening');
  }
  if (config.addon) closeBackup = await startBackupControl(undefined, () => online.pause());
  console.info(`${productName} listening on port ${config.port}. Music starts only on Play. Host controls are open to LAN users.`);
  setup.start();
  online.start();
  let stopping = false;
  const shutdown = () => {
    if (stopping) return; stopping = true;
    engine.beginShutdown(); speakers.close(); setup.close(); integrations.stopMonitoring(); adapter.beginShutdown(); uploads.stopReceiving();
    // Reject new HTTP work, then let admitted commands/commits settle before disposing
    // their transports. The final bound covers an unavailable upstream or stuck disk.
    for (const server of servers) server.close();
    const deadline = setTimeout(() => { cleanup(); process.exit(1); }, 25_000); deadline.unref();
    void (async () => {
      try {
        await online.close();
        await drainOperations(); await engine.drain(); await preparations.drain(); await integrations.drain(); await uploads.drain();
        cleanup(); process.exitCode = 0;
      } catch { cleanup(); process.exitCode = 1; }
      finally { clearTimeout(deadline); }
    })();
  };
  process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
} catch {
  cleanup();
  console.error('Startup failed. Check configuration, the listening address/port, and the persistent data directory. No credentials or state details were logged.');
  process.exitCode = 1;
}
