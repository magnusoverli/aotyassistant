import express, { type Request, type Response, type NextFunction } from 'express';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { publicContext } from './public-listener.js';
import type { OnlineAccess } from './online-access.js';
import { z } from 'zod';
import { AppError, autoplaySettingsSchema, type Role, type ListeningOrderView } from './model.js';
import type { Engine, EngineChange } from './engine.js';
import type { Config } from './config.js';
import type { IntegrationManager } from './integrations.js';
import { PreparationManager, PreparationFileStore, savedSourceAvailable } from './preparations.js';
import { mountPreparations } from './preparation-http.js';
import { UploadAssets } from './uploads.js';
import { MediaChecks, setupHostAllowed, guestAddressHelp } from './addressing.js';
import { artworkSize, catalogueRead, jsonBody, compressJson, sendArtwork, setParticipantCookie } from './http-utils.js';
import { RateLimiter, directHosts, loopbackHosts, readCookie } from './http-guards.js';
import { EventStreams } from './event-streams.js';
import { DisplayArtwork } from './display-artwork.js';
import { mountIntegrations } from './integration-http.js';
import { ingressContext, requestBase } from './ingress.js';
import { mountAuthorization } from './ma-authorization.js';
import type { SetupManager } from './setup.js';
import { durability } from './backup.js';
import { errorPage, escapeHtml } from './error-page.js';
import { mountStaticAssets } from './static-assets.js';
import { diagnostics } from './diagnostics.js';
import { UserManager, pinSchema } from './users.js';
import { attachAutoplay } from './autoplay.js';
import { BrowserSpeakers, requestSpeakerCookie } from './browser-speakers.js';
import { mountBrowserSpeakers } from './browser-speaker-http.js';
import { RoomLogo, maxLogoBytes } from './room-logo.js';
import { DisplayBackground, backgroundSnapshotSchema } from './display-background.js';

const turn = z.uuid();
const revision = z.number().int().nonnegative();
const cookie = (request: Request, name: string): string => {
  const value = readCookie(request, name);
  return value && /^[A-Za-z0-9_-]{43}$/.test(value) ? value : '';
};

export function createApp(engine: Engine, config: Config, webDirectory = resolve('dist/web'), integrations?: IntegrationManager,
  preparations?: PreparationManager, uploads = new UploadAssets(config.dataDir), setupManager?: SetupManager, onlineAccess?: OnlineAccess, browserSpeakers?: BrowserSpeakers) {
  integrations?.configureGuestAccess(config.guestUrl, config.addon, config.guestOverride);
  integrations?.attachUploads(uploads, config.guestUrl);
  const checks = new MediaChecks(); integrations?.attachMediaChecks(checks);
  const defaults = config;
  config = { ...defaults, get guestUrl() { return integrations?.guestOrigin || defaults.guestUrl; } };
  engine.setGuestOrigin(config.guestUrl);
  preparations ??= new PreparationManager(new PreparationFileStore(config.dataDir), Date.now, savedSourceAvailable(integrations));
  const users = new UserManager(config.dataDir, preparations, engine);
  uploads.setOwnerPolicy(ownerId => users.ownerAvailable(ownerId));
  attachAutoplay(engine, preparations, users);
  const roomLogo = new RoomLogo(config.dataDir, () => { engine.emit('change'); });
  const background = new DisplayBackground(config.dataDir, () => { engine.emit('change'); });
  void background.ready.then(() => { engine.emit('change'); });
  engine.setRoomLogo(() => roomLogo.view());
  void roomLogo.ready.then(() => { if (roomLogo.view()) engine.emit('change'); });
  const app = express();
  app.disable('x-powered-by');
  const rates = new RateLimiter();
  const cleanup = setInterval(() => rates.prune(), 60_000);
  cleanup.unref();

  app.use((req, res, next) => {
    const ingress = ingressContext(req);
    const remote = publicContext(req);
    const browserAudioOrigin = new URL(ingress?.origin ?? remote?.origin ??
      (loopbackHosts(config.port).includes(req.headers.host ?? '') ? `http://${req.headers.host}` : config.guestUrl));
    browserAudioOrigin.protocol = browserAudioOrigin.protocol === 'https:' ? 'wss:' : 'ws:';
    res.set({
      'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': ingress ? 'SAMEORIGIN' : 'DENY',
      'Content-Security-Policy': `default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self' ${browserAudioOrigin.origin}; media-src 'self' blob: data:; img-src 'self' blob: data:; object-src 'none'; base-uri 'none'; frame-ancestors ${ingress ? "'self'" : "'none'"}; form-action 'self'`,
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    });
    // Supervisor checks process liveness, never speaker recovery or dependency readiness.
    if (req.path === '/api/health' && ['GET', 'HEAD'].includes(req.method)) {
      res.status(engine.live ? 200 : 503).json({ ok: engine.live, storageAvailable: engine.storageAvailable,
        playbackAvailable: engine.playbackAvailable, mode: engine.adapter.mode, backupPaused: durability.paused }); return;
    }
    if (!engine.live) return next(new AppError(503, 'The application is shutting down. Try again after it restarts.'));
    if (ingress) {
      if (req.path === '/' && ['GET', 'HEAD'].includes(req.method)) {
        res.redirect(`${ingress.base}/host`); return;
      }
      if (!(['/host', '/host/settings', '/join', '/participant', '/display', '/demo-cover.svg'].includes(req.path) || req.path.startsWith('/assets/') || req.path.startsWith('/api/host/') || req.path.startsWith('/api/browser-speaker/') || req.path.startsWith('/api/participant/') || req.path.startsWith('/api/display/') || req.path === '/api/listening-order/events' || req.path === '/api/logo' || req.path.startsWith('/api/logo/'))) {
        return next(new AppError(404, 'Page not found.'));
      }
    }
    const mediaRead = ['GET', 'HEAD'].includes(req.method) && /^\/api\/media\/uploads\/[^/]+\/[^/]+\/track\.[a-z0-9]+$/.test(req.path);
    const host = req.headers.host ?? '';
    const setup = integrations && setupHostAllowed(host, req.socket.remoteAddress ?? '');
    const known = Boolean(ingress || remote) || directHosts(config.guestUrl, config.port).includes(host) ||
      Boolean(setup && setupManager?.allowsGuestHost(host));
    const read = ['GET', 'HEAD'].includes(req.method);
    const diagnosticRead = read && /^\/api\/media\/check\/[A-Za-z0-9_-]{43}\/track\.wav$/.test(req.path);
    const setupRoute = req.path.startsWith('/api/host/addressing') || req.path.startsWith('/api/host/auth/') || req.path === '/api/host/setup' || req.path === '/api/host/setup/refresh' ||
      (read && (req.path === '/host/settings' || req.path.startsWith('/assets/') || req.path === '/api/listening-order/events' || req.path === '/api/logo' || req.path.startsWith('/api/logo/') || req.path === '/api/host/integrations' || req.path === '/api/host/integrations/destinations' || req.path === '/api/host/integrations/events'));
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
      if (!origin || (remote ? origin !== remote.origin : ingress ? origin !== ingress.origin : origin !== config.guestUrl && origin !== localOrigin && !setupOrigin)) return next(new AppError(403, 'Cross-origin controls are not allowed.'));
      if (req.headers['sec-fetch-site'] === 'cross-site') return next(new AppError(403, 'Cross-site controls are not allowed.'));
      const fileUpload = req.method === 'POST' && (/^\/api\/participant\/preparations\/uploads\/[a-f0-9-]{36}$/.test(req.path) || req.path === '/api/host/logo') && req.is('application/octet-stream');
      if (!req.is('application/json') && !fileUpload) return next(new AppError(415, 'Send an application/json request, or one file to an upload endpoint.'));
    }
    next();
  });
  app.use('/api', (req, _res, next) => {
    if (req.path.startsWith('/participant/preparations/') && !['/participant/preparations/play', '/participant/preparations/join', '/participant/preparations/pin'].includes(req.path)) return next();
    if (req.method === 'GET') return next();
    const join = req.path.endsWith('/join');
    const key = `${publicContext(req)?.session ?? req.socket.remoteAddress}:${join ? 'join' : 'commands'}`;
    next(rates.hit(key, join ? 20 : 180) === 'limited' ? new AppError(429, 'Too many requests. Wait a minute and try again.') : undefined);
  });
  app.use(express.json({ limit: '16kb' }));
  app.use(compressJson);
  app.use('/api', async (_req, _res, next) => { try { await users.migrate(); next(); } catch (error) { next(error); } });
  if (browserSpeakers) mountBrowserSpeakers(app, browserSpeakers, () => config.guestUrl, config.port, onlineAccess,
    req => users.directoryView(participantCredential(req)).current?.nickname);
  const closePreparations = mountPreparations(app, preparations, engine, config, integrations, uploads, users);
  void uploads.cleanup();
  const uploadCleanup = setInterval(() => { void uploads.cleanup(); }, 60 * 60_000); uploadCleanup.unref();
  app.get('/api/media/uploads/:assetId/:key/:filename', async (req, res) => { await uploads.serve(req, res); });
  app.get('/api/media/check/:key/track.wav', (req, res) => { checks.serve(req, res); });
  const participant = (req: Request): Role => ({ kind: 'participant', credential: cookie(req, 'doom_room_participant') });
  const participantCredential = (req: Request) => cookie(req, 'doom_room_participant');

  app.get('/api/host/state', (_req, res) => res.json(engine.view({ kind: 'host' })));
  // Connector account approval and invitations are administered only through HA authentication.
  app.use('/api/host/online', (req, _res, next) => next(ingressContext(req) && onlineAccess ? undefined : new AppError(403, 'Open Settings through Home Assistant to manage online invitations.')));
  app.get('/api/host/online', (_req, res) => res.json(onlineAccess!.view()));
  app.post('/api/host/online', jsonBody(z.strictObject({ action: z.enum(['enable', 'disable', 'rotate']), revision }), async (input, _req, res) => {
    res.json(await onlineAccess!.change(input.action, input.revision));
  }));
  app.get('/api/host/playback-settings', (_req, res) => res.json(engine.playbackSettings()));
  app.post('/api/host/playback-settings', jsonBody(z.strictObject({ enabled: z.boolean(), revision }), async (input, _req, res) => {
    res.json(await engine.setAutoReveal(input.enabled, input.revision));
  }));
  app.get('/api/host/secret-playback-settings', (_req, res) => res.json(engine.secretPlaybackSettings()));
  app.post('/api/host/secret-playback-settings', jsonBody(z.strictObject({ enabled: z.boolean(), revision }), async (input, _req, res) => {
    res.json(await engine.setSecretPlayback(input.enabled, input.revision));
  }));
  app.get('/api/host/autoplay-settings', (_req, res) => res.json(engine.autoplaySettings()));
  app.post('/api/host/autoplay-settings', jsonBody(autoplaySettingsSchema, async (input, _req, res) => {
    res.json(await engine.setAutoplay(input.mode, input.revision));
  }));
  app.get('/api/host/diagnostics', (_req, res) => res.json(diagnostics.snapshot()));
  app.get('/api/host/background-settings', async (_req, res) => { res.json(await background.read()); });
  app.post('/api/host/background-settings', jsonBody(backgroundSnapshotSchema, async (input, _req, res) => {
    res.json(await background.save(input));
  }));
  // The room's logo. Readers use the versioned image URL from the view, so each image is cached once.
  app.get('/api/logo', async (_req, res) => { await roomLogo.ready; res.json({ logo: roomLogo.view() }); });
  app.get('/api/logo/:version', async (req, res) => {
    await roomLogo.ready;
    const image = roomLogo.image(z.string().regex(/^[a-f0-9]{16}$/).parse(req.params.version));
    res.set('Cache-Control', 'public, max-age=31536000, immutable').type('png').send(image);
  });
  const logoBody = express.raw({ type: 'application/octet-stream', limit: maxLogoBytes });
  app.post('/api/host/logo', (req, res, next) => logoBody(req, res, error => next((error as { status?: number } | undefined)?.status === 413
    ? new AppError(413, 'The logo file is larger than 10 MB. Export a smaller PNG or SVG.') : error)), async (req, res) => {
    if (!Buffer.isBuffer(req.body) || !req.body.length) throw new AppError(400, 'Choose an image file to upload.');
    res.json({ logo: await roomLogo.set(req.body) });
  });
  app.post('/api/host/logo/remove', jsonBody(z.strictObject({}), async (_input, _req, res) => {
    await roomLogo.remove(); res.json({ logo: null });
  }));
  let closeAuthorization = () => {};
  let closeIntegrations = () => {};
  if (integrations) {
    closeIntegrations = mountIntegrations(app, engine, integrations, setupManager);
    closeAuthorization = mountAuthorization(app, integrations, () => { engine.emit('change'); });
  }
  app.post('/api/host/volume', jsonBody(z.strictObject({ turnId: turn.nullable(), level: z.number().int().min(0).max(100), volumeRevision: z.string().min(1).max(200) }), async (input, _req, res) => {
    await engine.setVolume(input.level, input.turnId, undefined, undefined, input.volumeRevision); res.json(engine.view({ kind: 'host' }));
  }));
  app.get('/api/participant/state', (req, res) => res.json(engine.view(participant(req))));
  const displayArtwork = integrations ? new DisplayArtwork(() => engine.displayArtworkTarget(), (reference, context, size) => integrations.artwork(reference, context, size)) : undefined;
  const readView = (role: Role) => {
    const view = engine.view(role);
    if (role.kind === 'display') view.background = background.view();
    return role.kind === 'display' && displayArtwork ? displayArtwork.project(view) : view;
  };
  app.get('/api/display/state', async (_req, res) => { await background.ready; res.json(readView({ kind: 'display' })); });
  if (integrations) {
    app.get('/api/display/prepared-artwork/:id', async (req, res) => {
      const data = await displayArtwork!.read(turn.parse(req.params.id));
      res.type('application/octet-stream').send(data);
    });
    app.get('/api/participant/artwork/:reference', async (req, res) => {
      const started = performance.now();
      const context = engine.catalogueContext(participantCredential(req));
      const reference = z.string().max(1500).parse(req.params.reference); const size = artworkSize.parse(req.query.size);
      // Membership and reference checks run before any 304. A thumbnail still
      // waiting for a fetch slot is dropped when the browser stops asking for it.
      await catalogueRead(req, 'artwork', async () => sendArtwork(req, res, await integrations.artworkKey(reference, context, size), async () => {
        const image = await integrations.artwork(reference, context, size);
        res.set('Server-Timing', `artwork;dur=${(performance.now() - started).toFixed(1)}`);
        return image;
      }, () => { if (engine.catalogueContext(participantCredential(req)) !== context) throw new AppError(403, 'Artwork access expired.'); }));
    });
    app.get('/api/display/artwork/:id/:kind', async (req, res) => {
      const id = turn.parse(req.params.id); const kind = z.enum(['artwork', 'artistArtwork']).parse(req.params.kind);
      const access = engine.displayArtwork(id, kind);
      const image = await integrations.artwork(access.reference, access.context, artworkSize.parse(req.query.size));
      engine.displayArtwork(id, kind); // Revalidate reveal/turn after the network read.
      res.type(image.contentType).send(image.body);
    });
  }
  app.post(['/api/participant/join', '/api/participant/preparations/join'], jsonBody(z.strictObject({ nickname: z.string().trim().min(1).max(40).optional(), pin: pinSchema.optional(),
    userId: turn.optional(), operation: turn.optional() }), async (input, req, res) => {
    let credential = participantCredential(req); let user = users.current(credential);
    if (input.userId) {
      if (!input.pin) throw new AppError(400, 'Enter your four-digit PIN.');
      const login = await users.login(input.userId, input.pin); credential = login.token; user = login.user;
    } else if (!user) {
      if (!input.nickname || !input.pin) throw new AppError(400, 'Enter your name and choose a four-digit PIN.');
      const registered = await users.register(input.nickname, input.pin, input.operation, readCookie(req, 'doom_room_preparation')); credential = registered.token; user = registered.user;
    }
    await engine.joinUser(user.id, credential);
    if (credential !== participantCredential(req)) await users.logout(participantCredential(req));
    setParticipantCookie(req, res, 'doom_room_participant', credential, '/api/participant', config.guestUrl);
    // A different identity must never inherit the previous browser user's list cookie.
    if (credential !== participantCredential(req)) res.clearCookie('doom_room_preparation', { path: `${requestBase(req)}/api/participant/preparations` });
    res.json(engine.view({ kind: 'participant', credential }));
  }));
  app.get('/api/participant/identity', (req, res) => res.json(users.directoryView(participantCredential(req))));
  app.post('/api/participant/preparations/pin', jsonBody(z.strictObject({ pin: pinSchema }), async (input, req, res) => {
    const token = participantCredential(req);
    const user = users.current(token); if (!user) throw new AppError(401, 'Select your name to continue.');
    await users.ensureList(token, readCookie(req, 'doom_room_preparation'));
    await users.setPin(user.id, input.pin, token); res.json(users.directoryView(token));
  }));
  app.post('/api/participant/logout', jsonBody(z.strictObject({}), async (_input, req, res) => {
    await users.logout(participantCredential(req));
    browserSpeakers?.revokeOwner(requestSpeakerCookie(req));
    res.clearCookie('doom_room_participant', { path: `${requestBase(req)}/api/participant` });
    res.clearCookie('doom_room_preparation', { path: `${requestBase(req)}/api/participant/preparations` }); res.json({ ok: true });
  }));
  app.get('/api/host/users', (_req, res) => res.json(users.directoryView('', true)));
  app.post('/api/host/users/pin', jsonBody(z.strictObject({ userId: turn, pin: pinSchema }), async (input, _req, res) => {
    await users.setPin(input.userId, input.pin); res.json(users.directoryView('', true));
  }));
  app.post('/api/host/users/delete', jsonBody(z.strictObject({ userId: turn, confirm: z.literal(true) }), async (input, _req, res) => {
    await users.deleteUser(input.userId, ownerId => uploads.removeOwner(ownerId)); res.json(users.directoryView('', true));
  }));
  // Deliberately unauthenticated, per the owner's explicit LAN-only exception.
  app.post('/api/host/reorder', jsonBody(z.strictObject({ ids: z.array(turn).max(100), revision }), async (input, _req, res) => {
    await engine.reorder(input.ids, input.revision); res.json(engine.view({ kind: 'host' }));
  }));
  app.post('/api/host/remove', jsonBody(z.strictObject({ id: turn, revision }), async (input, _req, res) => {
    await engine.remove(input.id, input.revision); res.json(engine.view({ kind: 'host' }));
  }));
  app.post('/api/host/advance', jsonBody(z.strictObject({ turnId: turn }), async (input, _req, res) => {
    await engine.advance(input.turnId); res.json(engine.view({ kind: 'host' }));
  }));
  app.post('/api/host/stop', jsonBody(z.strictObject({ turnId: turn, playbackId: turn }), async (input, _req, res) => {
    await engine.stopForHost(input.turnId, input.playbackId); res.json(engine.view({ kind: 'host' }));
  }));
  app.post('/api/host/control', jsonBody(z.strictObject({ turnId: turn, playbackId: turn, action: z.enum(['pause', 'resume']) }), async (input, _req, res) => {
    await engine.controlForHost(input.turnId, input.playbackId, input.action); res.json(engine.view({ kind: 'host' }));
  }));
  app.post('/api/participant/finish', jsonBody(z.strictObject({ turnId: turn }), async (input, req, res) => {
    await engine.advance(input.turnId, participantCredential(req)); res.json(engine.view(participant(req)));
  }));
  app.post('/api/participant/search', jsonBody(z.strictObject({ turnId: turn, query: z.string().trim().min(1).max(200) }), async (input, req, res) => {
    await catalogueRead(req, 'search', async () => res.json(await engine.search(participantCredential(req), input.turnId, input.query)));
  }));
  app.post('/api/participant/browse', jsonBody(z.strictObject({ kind: z.enum(['artists', 'albums', 'tracks']), value: z.string().trim().min(1).max(1000) }), async (input, req, res) => {
    await catalogueRead(req, 'browse', async () => res.json(await engine.browse(participantCredential(req), input.kind, input.value)));
  }));
  app.post('/api/participant/play', jsonBody(z.strictObject({ turnId: turn, previousPlaybackId: turn.nullable(), trackId: z.string().min(1).max(1000) }), async (input, req, res) => {
    await engine.play(participantCredential(req), input.turnId, input.previousPlaybackId, input.trackId); res.json(engine.view(participant(req)));
  }));
  app.post('/api/participant/control', jsonBody(z.strictObject({ turnId: turn, playbackId: turn, action: z.enum(['pause', 'resume', 'stop']) }), async (input, req, res) => {
    await engine.control(participantCredential(req), input.turnId, input.playbackId, input.action); res.json(engine.view(participant(req)));
  }));
  app.post('/api/participant/volume', jsonBody(z.strictObject({ turnId: turn, playbackId: turn, level: z.number().int().min(0).max(100), volumeRevision: z.string().min(1).max(200) }), async (input, req, res) => {
    await engine.setVolume(input.level, input.turnId, participantCredential(req), input.playbackId, input.volumeRevision); res.json(engine.view(participant(req)));
  }));
  app.post('/api/participant/reveal', jsonBody(z.strictObject({ turnId: turn, playbackId: turn }), async (input, req, res) => {
    await engine.reveal(participantCredential(req), input.turnId, input.playbackId); res.json(engine.view(participant(req)));
  }));

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
  const invalidatePublic = () => { publicSnapshots.clear(); displayArtwork?.refresh(); }; engine.on('change', invalidatePublic);
  const encodedView = (role: Role) => {
    if (role.kind === 'participant') return JSON.stringify(engine.view(role));
    let encoded = publicSnapshots.get(role.kind);
    if (encoded === undefined) { encoded = JSON.stringify(readView(role)); publicSnapshots.set(role.kind, encoded); }
    return encoded;
  };
  const events = (res: Response, role: Role) => {
    const initial = readView(role); // Authorize before streaming headers.
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
    stream.every(() => { if (role.kind !== 'participant') publicSnapshots.delete(role.kind); send(); }, 15_000);
  };
  app.get('/api/host/events', (_req, res) => events(res, { kind: 'host' }));
  app.get('/api/participant/events', (req, res) => events(res, participant(req)));
  app.get('/api/display/events', async (_req, res) => { await background.ready; events(res, { kind: 'display' }); });

  app.use('/api', (_req, _res, next) => next(new AppError(404, 'Unknown API endpoint.')));
  mountStaticAssets(app, webDirectory);
  app.use(express.static(webDirectory, { index: false, etag: false, lastModified: false }));
  // The built shell never changes while the process runs; a failed read is retried on the next request.
  let shell: Promise<string> | undefined;
  const pageShell = () => shell ??= readFile(resolve(webDirectory, 'index.html'), 'utf8').catch(error => { shell = undefined; throw error; });
  for (const path of ['/', '/join', '/participant', '/display', '/host', '/host/settings']) {
    app.get(path, async (req, res) => {
      const base = requestBase(req);
      let html = await pageShell();
      const remote = publicContext(req);
      // The logo is known before the first paint, so its place never shifts. An online shell
      // without a valid invitation holds no room data; it asks for the logo after redeeming.
      await roomLogo.ready;
      const logo = !remote || remote.authorized ? roomLogo.view() : null;
      const logoMeta = logo ? `<meta name="doom-room-logo" content="${escapeHtml(logo.url)}" data-width="${logo.width}" data-height="${logo.height}">` : '';
      // Online pages learn whether their invitation cookie is valid without a separate round trip.
      html = html.replace('</head>', `<meta name="doom-room-base" content="${escapeHtml(base)}"><meta name="doom-room-guest" content="${escapeHtml(remote?.origin ?? config.guestUrl)}"><meta name="doom-room-public" content="${remote ? '1' : '0'}">${remote?.authorized ? '<meta name="doom-room-online-session" content="1">' : ''}${logoMeta}</head>`);
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
  return { app, close: () => { engine.off('change', invalidatePublic); displayArtwork?.close(); closeIntegrations(); closeAuthorization(); closePreparations(); checks.close(); uploads.close(); clearInterval(uploadCleanup); clearInterval(cleanup); streams.close(); } };
}
