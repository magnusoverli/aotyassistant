import express, { type Request, type Response, type NextFunction } from 'express';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { AppError, type Role, type ListeningOrderView } from './model.js';
import type { Engine, EngineChange } from './engine.js';
import type { Config } from './config.js';
import type { IntegrationManager } from './integrations.js';
import { PreparationManager, PreparationFileStore } from './preparations.js';
import { mountPreparations } from './preparation-http.js';
import { UploadAssets } from './uploads.js';
import { MediaChecks, setupHostAllowed, guestAddressHelp } from './addressing.js';
import { artworkSize, body, rawCookie, setPrivateCookie } from './http-utils.js';
import { EventStreams } from './event-streams.js';
import { mountIntegrations } from './integration-http.js';
import { ingressContext, requestBase } from './ingress.js';
import { mountAuthorization } from './ma-authorization.js';
import type { SetupManager } from './setup.js';
import { durability } from './backup.js';
import { errorPage, escapeHtml } from './error-page.js';
import { maOperation } from './ma-operation.js';
import { mountStaticAssets } from './static-assets.js';
import { diagnostics } from './diagnostics.js';

const turn = z.string().uuid();
const revision = z.number().int().nonnegative();
const cookie = (request: Request, name: string): string => {
  const value = rawCookie(request, name);
  return value && /^[A-Za-z0-9_-]{43}$/.test(value) ? value : '';
};

/** Only read-only catalogue work follows browser cancellation; audio mutations finish independently. */
async function catalogueRead(res: Response, action: string, work: () => Promise<unknown>) {
  const controller = new AbortController();
  const close = () => { if (!res.writableFinished) controller.abort(); };
  res.once('close', close);
  try { await maOperation(action, work, 12_000, controller.signal); }
  finally { res.off('close', close); }
}

export function createApp(engine: Engine, config: Config, webDirectory = resolve('dist/web'), integrations?: IntegrationManager,
  preparations?: PreparationManager, uploads = new UploadAssets(config.dataDir), setupManager?: SetupManager) {
  integrations?.attachUploads(uploads, config.guestUrl);
  const checks = new MediaChecks(); integrations?.attachMediaChecks(checks);
  const defaults = config;
  config = { ...defaults, get guestUrl() { return integrations?.guestOrigin || defaults.guestUrl; } };
  engine.setGuestOrigin(config.guestUrl);
  preparations ??= new PreparationManager(new PreparationFileStore(config.dataDir), Date.now, selection => selection.source === 'demo' ? !integrations?.configured
    : selection.source === 'upload' ? Boolean(integrations?.uploadPlaybackAvailable) : selection.sourceBindingId === integrations?.sourceBindingId);
  const app = express();
  app.disable('x-powered-by');
  const rates = new Map<string, { count: number; start: number }>();
  const cleanup = setInterval(() => {
    for (const [key, value] of rates) if (Date.now() - value.start >= 60_000) rates.delete(key);
  }, 60_000);
  cleanup.unref();

  app.use((req, res, next) => {
    const ingress = ingressContext(req);
    res.set({
      'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': ingress ? 'SAMEORIGIN' : 'DENY',
      'Content-Security-Policy': `default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors ${ingress ? "'self'" : "'none'"}; form-action 'self'`,
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    });
    // Supervisor checks process liveness, never speaker recovery or dependency readiness.
    if (req.path === '/api/health' && ['GET', 'HEAD'].includes(req.method)) {
      res.status(engine.live ? 200 : 503).json({ ok: engine.live, storageAvailable: engine.storageAvailable,
        playbackAvailable: engine.playbackAvailable, mode: engine.adapter.mode, backupPaused: durability.paused }); return;
    }
    if (!engine.live) return next(new AppError(503, 'The application is shutting down. Try again after it restarts.'));
    if (ingress) {
      if (['/', '/join', '/participant', '/display'].includes(req.path) && ['GET', 'HEAD'].includes(req.method)) {
        res.redirect(req.path === '/' ? `${ingress.base}/host` : /^(localhost|127\.|\[::1\])/.test(new URL(config.guestUrl).hostname)
          ? `${ingress.base}/host/settings` : `${config.guestUrl}${req.path}`); return;
      }
      if (!(req.path === '/host' || req.path === '/host/settings' || req.path.startsWith('/assets/') || req.path.startsWith('/api/host/') || req.path === '/api/listening-order/events')) {
        return next(new AppError(404, 'Use the guest address for participant and display access.'));
      }
    }
    const mediaRead = ['GET', 'HEAD'].includes(req.method) && /^\/api\/media\/uploads\/[^/]+\/[^/]+\/track\.[a-z0-9]+$/.test(req.path);
    const host = req.headers.host ?? '';
    const setup = integrations && setupHostAllowed(host, req.socket.remoteAddress ?? '');
    const known = Boolean(ingress) || [new URL(config.guestUrl).host, `localhost:${config.port}`, `127.0.0.1:${config.port}`].includes(host) ||
      Boolean(setup && setupManager?.allowsGuestHost(host));
    const read = ['GET', 'HEAD'].includes(req.method);
    const diagnosticRead = read && /^\/api\/media\/check\/[A-Za-z0-9_-]{43}\/track\.wav$/.test(req.path);
    const setupRoute = req.path.startsWith('/api/host/addressing') || req.path.startsWith('/api/host/auth/') || req.path === '/api/host/setup' || req.path === '/api/host/setup/refresh' ||
      (read && (req.path === '/host/settings' || req.path.startsWith('/assets/') || req.path === '/api/listening-order/events' || req.path === '/api/host/integrations' || req.path === '/api/host/integrations/destinations' || req.path === '/api/host/integrations/events'));
    if (!known && setup && read && ['/', '/host'].includes(req.path)) { res.redirect('/host/settings'); return; }
    if (!known && setup && read && ['/display', '/join', '/participant'].includes(req.path)) {
      res.status(403).type('html').send(guestAddressHelp(config.guestUrl, req.path)); return;
    }
    // The synthetic diagnostic handler performs its own exact Host/capability/expiry checks, including revocation/404.
    if (!known && !(setup && setupRoute) && !diagnosticRead && !(mediaRead && integrations?.mediaHostAllowed(host))) return next(new AppError(403, 'Unconfigured host. Open /host/settings through a local LAN IP or .local hostname to configure the guest address.'));
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      if (durability.paused) return next(new AppError(503, 'A Home Assistant backup is in progress. Try again when it finishes.'));
      const origin = req.headers.origin;
      const localOrigin = `http://${req.headers.host}`;
      const setupOrigin = setup && setupRoute && origin && [localOrigin, `https://${host}`].includes(origin);
      if (!origin || (ingress ? origin !== ingress.origin : origin !== config.guestUrl && origin !== localOrigin && !setupOrigin)) return next(new AppError(403, 'Cross-origin controls are not allowed.'));
      if (req.headers['sec-fetch-site'] === 'cross-site') return next(new AppError(403, 'Cross-site controls are not allowed.'));
      const fileUpload = req.method === 'POST' && /^\/api\/participant\/preparations\/uploads\/[a-f0-9-]{36}$/.test(req.path) && req.is('application/octet-stream');
      if (!req.is('application/json') && !fileUpload) return next(new AppError(415, 'Send an application/json request, or one audio file to the upload endpoint.'));
    }
    next();
  });
  app.use('/api', (req, _res, next) => {
    if (req.path.startsWith('/participant/preparations/') && req.path !== '/participant/preparations/play') return next();
    if (req.method === 'GET') return next();
    const join = req.path.endsWith('/join');
    const key = `${req.socket.remoteAddress}:${join ? 'join' : 'commands'}`;
    const entry = rates.get(key) ?? { count: 0, start: Date.now() };
    if (Date.now() - entry.start > 60_000) { entry.start = Date.now(); entry.count = 0; }
    entry.count++; rates.set(key, entry);
    next(entry.count > (join ? 20 : 180) ? new AppError(429, 'Too many requests. Wait a minute and try again.') : undefined);
  });
  app.use(express.json({ limit: '16kb' }));
  const closePreparations = mountPreparations(app, preparations, engine, config, integrations, uploads);
  void uploads.cleanup();
  const uploadCleanup = setInterval(() => { void uploads.cleanup(); }, 60 * 60_000); uploadCleanup.unref();
  app.get('/api/media/uploads/:assetId/:key/:filename', async (req, res) => { await uploads.serve(req, res); });
  app.get('/api/media/check/:key/track.wav', (req, res) => { checks.serve(req, res); });
  const participant = (req: Request): Role => ({ kind: 'participant', credential: cookie(req, 'aoty_participant') });
  const participantCredential = (req: Request) => cookie(req, 'aoty_participant');

  app.get('/api/host/state', (_req, res) => res.json(engine.view({ kind: 'host' })));
  app.get('/api/host/diagnostics', (_req, res) => res.json(diagnostics.snapshot()));
  let closeAuthorization = () => {};
  let closeIntegrations = () => {};
  if (integrations) {
    closeIntegrations = mountIntegrations(app, engine, integrations, setupManager);
    closeAuthorization = mountAuthorization(app, integrations, () => { engine.emit('change'); });
  }
  app.post('/api/host/volume', async (req, res) => {
    const input = body(req, z.object({ turnId: turn.nullable(), level: z.number().int().min(0).max(100), volumeRevision: z.string().min(1).max(200) }).strict());
    await engine.setVolume(input.level, input.turnId, undefined, undefined, input.volumeRevision); res.json(engine.view({ kind: 'host' }));
  });
  app.get('/api/participant/state', (req, res) => res.json(engine.view(participant(req))));
  app.get('/api/display/state', (_req, res) => res.json(engine.view({ kind: 'display' })));
  if (integrations) {
    app.get('/api/participant/artwork/:reference', async (req, res) => {
      const context = engine.catalogueContext(participantCredential(req));
      const reference = z.string().max(1500).parse(req.params.reference);
      const image = await integrations.artwork(reference, context, artworkSize.parse(req.query.size));
      if (engine.catalogueContext(participantCredential(req)) !== context) throw new AppError(403, 'Artwork access expired.');
      res.type(image.contentType).send(image.body);
    });
    app.get('/api/display/artwork/:id/:kind', async (req, res) => {
      const id = turn.parse(req.params.id); const kind = z.enum(['artwork', 'artistArtwork']).parse(req.params.kind);
      const access = engine.displayArtwork(id, kind);
      const image = await integrations.artwork(access.reference, access.context, artworkSize.parse(req.query.size));
      engine.displayArtwork(id, kind); // Revalidate reveal/turn after the network read.
      res.type(image.contentType).send(image.body);
    });
  }
  app.post('/api/participant/join', async (req, res) => {
    const input = body(req, z.object({ nickname: z.string().trim().min(1).max(40) }).strict());
    const credential = await engine.join(input.nickname, participantCredential(req));
    setPrivateCookie(res, 'aoty_participant', credential, '/api/participant', config.guestUrl);
    res.json(engine.view({ kind: 'participant', credential }));
  });
  // Deliberately unauthenticated, per the owner's explicit LAN-only exception.
  app.post('/api/host/reorder', async (req, res) => {
    const input = body(req, z.object({ ids: z.array(turn).max(100), revision }).strict());
    await engine.reorder(input.ids, input.revision); res.json(engine.view({ kind: 'host' }));
  });
  app.post('/api/host/remove', async (req, res) => {
    const input = body(req, z.object({ id: turn, revision }).strict());
    await engine.remove(input.id, input.revision); res.json(engine.view({ kind: 'host' }));
  });
  app.post('/api/host/advance', async (req, res) => {
    const input = body(req, z.object({ turnId: turn }).strict());
    await engine.advance(input.turnId); res.json(engine.view({ kind: 'host' }));
  });
  app.post('/api/host/stop', async (req, res) => {
    const input = body(req, z.object({ turnId: turn, playbackId: turn }).strict());
    await engine.stopForHost(input.turnId, input.playbackId); res.json(engine.view({ kind: 'host' }));
  });
  app.post('/api/host/control', async (req, res) => {
    const input = body(req, z.object({ turnId: turn, playbackId: turn, action: z.enum(['pause', 'resume']) }).strict());
    await engine.controlForHost(input.turnId, input.playbackId, input.action); res.json(engine.view({ kind: 'host' }));
  });
  app.post('/api/participant/finish', async (req, res) => {
    const input = body(req, z.object({ turnId: turn }).strict());
    await engine.advance(input.turnId, participantCredential(req)); res.json(engine.view(participant(req)));
  });
  app.post('/api/participant/search', async (req, res) => {
    const input = body(req, z.object({ turnId: turn, query: z.string().trim().min(1).max(200) }).strict());
    await catalogueRead(res, 'search', async () => res.json(await engine.search(participantCredential(req), input.turnId, input.query)));
  });
  app.post('/api/participant/browse', async (req, res) => {
    const input = body(req, z.object({ kind: z.enum(['artists', 'albums', 'tracks']), value: z.string().trim().min(1).max(1000) }).strict());
    await catalogueRead(res, 'browse', async () => res.json(await engine.browse(participantCredential(req), input.kind, input.value)));
  });
  app.post('/api/participant/play', async (req, res) => {
    const input = body(req, z.object({ turnId: turn, previousPlaybackId: turn.nullable(), trackId: z.string().min(1).max(1000) }).strict());
    await engine.play(participantCredential(req), input.turnId, input.previousPlaybackId, input.trackId); res.json(engine.view(participant(req)));
  });
  app.post('/api/participant/control', async (req, res) => {
    const input = body(req, z.object({ turnId: turn, playbackId: turn, action: z.enum(['pause', 'resume', 'stop']) }).strict());
    await engine.control(participantCredential(req), input.turnId, input.playbackId, input.action); res.json(engine.view(participant(req)));
  });
  app.post('/api/participant/volume', async (req, res) => {
    const input = body(req, z.object({ turnId: turn, playbackId: turn, level: z.number().int().min(0).max(100), volumeRevision: z.string().min(1).max(200) }).strict());
    await engine.setVolume(input.level, input.turnId, participantCredential(req), input.playbackId, input.volumeRevision); res.json(engine.view(participant(req)));
  });
  app.post('/api/participant/reveal', async (req, res) => {
    const input = body(req, z.object({ turnId: turn, playbackId: turn }).strict());
    await engine.reveal(participantCredential(req), input.turnId, input.playbackId); res.json(engine.view(participant(req)));
  });

  const streams = new EventStreams(500, 'Too many live connections. Close unused tabs and try again.');
  app.get('/api/listening-order/events', (_req, res) => {
    const snapshot = (): ListeningOrderView => engine.listeningOrder();
    const initial = snapshot(); const stream = streams.reserve(res); if (!stream.open()) return;
    let previous = '';
    const send = (view = snapshot()) => {
      const key = JSON.stringify(view); if (key === previous) return;
      previous = key; stream.sendEncoded('state', key);
    };
    const changed = (kind?: EngineChange) => { if (kind !== 'playback') send(); };
    send(initial); engine.on('change', changed);
    stream.onClose(() => engine.off('change', changed));
    stream.every(() => { stream.send('state', snapshot()); }, 15_000);
  });
  // Public-role projections may be shared; participant authorization always runs per recipient.
  const publicSnapshots = new Map<'host' | 'display', string>();
  const invalidatePublic = () => publicSnapshots.clear(); engine.on('change', invalidatePublic);
  const encodedView = (role: Role) => {
    if (role.kind === 'participant') return JSON.stringify(engine.view(role));
    let encoded = publicSnapshots.get(role.kind);
    if (encoded === undefined) { encoded = JSON.stringify(engine.view(role)); publicSnapshots.set(role.kind, encoded); }
    return encoded;
  };
  const events = (res: Response, role: Role) => {
    const initial = engine.view(role); // Authorize before streaming headers.
    const stream = streams.reserve(res);
    if (!stream.open()) return;
    const send = () => {
      try {
        // Role-specific serialization is executed for every event, including removals.
        stream.sendEncoded('state', encodedView(role));
      } catch { stream.send('revoked', {}); }
    };
    stream.send('state', initial);
    engine.on('change', send);
    stream.onClose(() => engine.off('change', send));
    // Periodic filtered snapshots keep idle displays and reconnecting browsers in sync.
    stream.every(() => { invalidatePublic(); send(); }, 15_000);
  };
  app.get('/api/host/events', (_req, res) => events(res, { kind: 'host' }));
  app.get('/api/participant/events', (req, res) => events(res, participant(req)));
  app.get('/api/display/events', (_req, res) => events(res, { kind: 'display' }));

  app.use('/api', (_req, _res, next) => next(new AppError(404, 'Unknown API endpoint.')));
  mountStaticAssets(app, webDirectory);
  app.use(express.static(webDirectory, { index: false, etag: false, lastModified: false }));
  for (const path of ['/', '/join', '/participant', '/display', '/host', '/host/settings']) {
    app.get(path, async (req, res) => {
      const base = requestBase(req);
      const escape = (value: string) => value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
      let html = await readFile(resolve(webDirectory, 'index.html'), 'utf8');
      html = html.replace('</head>', `<meta name="aoty-base" content="${escape(base)}"><meta name="aoty-guest" content="${escape(config.guestUrl)}"></head>`);
      html = html.replace(/(src|href)="(?:\.\/|\/)(?!\/)/g, `$1="${base}/`);
      res.type('html').send(html);
    });
  }
  app.use((_req, _res, next) => next(new AppError(404, 'Page not found.')));
  app.use((error: unknown, req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof AppError) {
      if (error.status >= 500 || error.status === 429 || error.status === 499) diagnostics.failure(error.status === 504 ? 'TIMEOUT'
        : error.status === 499 ? 'CANCELLED' : error.status === 429 ? 'BUSY' : error.status === 502 ? 'UPSTREAM' : 'INTERNAL');
    } else if (!(error instanceof z.ZodError || error instanceof SyntaxError)) diagnostics.failure('INTERNAL');
    if (res.headersSent) { res.end(); return; }
    if (['GET', 'HEAD'].includes(req.method) && !req.path.startsWith('/api/') && req.accepts('html')) {
      const status = error instanceof AppError ? error.status : 500;
      const base = requestBase(req);
      res.status(status).type('html').send(errorPage(status === 404 ? 'Page not found' : 'Unable to open this page',
        `<p>${escapeHtml(error instanceof AppError ? error.message : 'Please try again.')}</p><p><a href="${escapeHtml(base)}/host/settings">Open Settings</a> · <a href="${escapeHtml(base)}/">Return home</a></p>`, base)); return;
    }
    if (error instanceof AppError) { res.status(error.status).json({ error: error.message }); return; }
    if (error instanceof z.ZodError || error instanceof SyntaxError) { res.status(400).json({ error: 'Invalid request. Check the supplied fields.' }); return; }
    const status = (error as { status?: number })?.status;
    res.status(status === 413 ? 413 : 500).json({ error: status === 413 ? 'Request is too large.' : 'The request could not be completed.' });
    // Do not log raw errors: upstream details may contain private metadata or secrets.
  });
  return { app, drain: () => preparations!.drain(), close: () => { engine.off('change', invalidatePublic); closeIntegrations(); closeAuthorization(); closePreparations(); checks.close(); uploads.close(); clearInterval(uploadCleanup); clearInterval(cleanup); streams.close(); } };
}
