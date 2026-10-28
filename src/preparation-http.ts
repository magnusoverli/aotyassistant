import type { Express, Request, Response } from 'express';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { AppError } from './model.js';
import type { Engine } from './engine.js';
import type { IntegrationManager } from './integrations.js';
import type { Config } from './config.js';
import { PreparationManager, preparationOperationSchema } from './preparations.js';
import { UploadAssets, uploadTextSchema } from './uploads.js';
import { artworkSize, body, rawCookie, setPrivateCookie } from './http-utils.js';
import { EventStreams } from './event-streams.js';
import { maOperation } from './ma-operation.js';
import type { UserManager } from './users.js';

const prefix = '/api/participant/preparations';
const uuid = z.string().uuid();
const cookieName = 'aoty_preparation';
const empty = z.object({}).strict();

/** Private library routes deliberately use a separate credential, revision, rate lane, and event stream. */
export function mountPreparations(app: Express, manager: PreparationManager, engine: Engine, config: Config, integrations: IntegrationManager | undefined, uploads: UploadAssets, users: UserManager) {
  const streams = new EventStreams(200, 'Too many private-list connections. Close unused tabs.');
  const rates = new Map<string, { count: number; start: number }>();
  const member = (req: Request) => rawCookie(req, 'aoty_participant');
  const credential = (req: Request) => rawCookie(req, cookieName);
  const setCookie = (res: Response, value: string) => setPrivateCookie(res, cookieName, value, prefix, config.guestUrl);
  const timer = setInterval(() => {
    const now = Date.now(); for (const [key, value] of rates) if (now - value.start > 60_000) rates.delete(key);
  }, 60_000); timer.unref();
  app.use(prefix, (req, _res, next) => {
    if (req.method === 'GET' || ['/play', '/join', '/pin'].includes(req.path)) return next();
    const initializing = req.path === '/init';
    const key = initializing ? `identity:${createHash('sha256').update(member(req)).digest('hex')}` : `owner:${createHash('sha256').update(credential(req)).digest('hex')}`;
    const now = Date.now(); let rate = rates.get(key); if (!rate || now - rate.start > 60_000) rate = { count: 0, start: now };
    if (rates.size > 5000) return next(new AppError(503, 'Private lists are busy. Try again shortly.'));
    rates.set(key, rate); rate.count++; next(rate.count > (initializing ? 60 : 180) ? new AppError(429, 'Too many list changes. Wait a minute; saved entries were kept.') : undefined);
  });
  app.get(`${prefix}/state`, async (req, res) => {
    if (!credential(req)) throw new AppError(401, 'Your selections are not ready. Reload the participant page.');
    const view = await manager.read(credential(req)); setCookie(res, credential(req)); res.json(view);
    void manager.cleanupDeletedUploads(credential(req), (ownerId, assetId) => uploads.remove(ownerId, assetId)).catch(() => {});
  });
  app.post(`${prefix}/init`, async (req, res) => {
    body(req, empty);
    const context = engine.catalogueContext(member(req));
    const owner = await users.ensureList(member(req), credential(req));
    if (engine.catalogueContext(member(req)) !== context) throw new AppError(401, 'Room membership changed before selections were ready.');
    setCookie(res, owner.credential); res.json(owner.view);
    void manager.cleanupDeletedUploads(owner.credential, (ownerId, assetId) => uploads.remove(ownerId, assetId)).catch(() => {});
  });
  app.post(`${prefix}/add`, async (req, res) => {
    const input = body(req, z.object({ operation: preparationOperationSchema, trackId: z.string().min(1).max(1000) }).strict());
    res.json(await manager.addCaptured(credential(req), input.operation, input.trackId, async () => {
      const context = engine.catalogueContext(member(req));
      const saved = integrations?.configured ? await integrations.captureSaved(input.trackId, context) : await engine.captureDemo(member(req), input.trackId);
      if (engine.catalogueContext(member(req)) !== context) throw new AppError(401, 'Room membership changed. Your list was kept.'); return saved;
    }));
  });
  app.post(`${prefix}/uploads/:uploadId`, async (req, res) => {
    const uploadId = uuid.parse(req.params.uploadId);
    if (!req.is('application/octet-stream')) throw new AppError(415, 'Upload one file as application/octet-stream.');
    const owner = await manager.read(credential(req)); const context = engine.catalogueContext(member(req));
    let filename: string;
    try { const header = req.headers['x-upload-filename']; if (typeof header !== 'string' || header.length > 12_000) throw new Error(); filename = decodeURIComponent(header); }
    catch { throw new AppError(400, 'The selected file needs a valid filename.'); }
    const abort = new AbortController(); const aborted = () => abort.abort(); req.once('aborted', aborted);
    const closed = () => { if (!res.writableFinished) abort.abort(); }; res.once('close', closed);
    req.setTimeout(60_000, () => req.destroy());
    try {
      const preview = await uploads.receive(owner.ownerId, uploadId, filename, req, abort.signal);
      await manager.read(credential(req));
      if (engine.catalogueContext(member(req)) !== context) throw new AppError(401, 'Room membership changed. Recover the completed upload from your private list before adding it.');
      res.json(preview);
    } finally { req.off('aborted', aborted); res.off('close', closed); req.setTimeout(0); }
  });
  app.get(`${prefix}/uploads/:uploadId`, async (req, res) => {
    const owner = await manager.read(credential(req)); const preview = await uploads.inspect(owner.ownerId, uuid.parse(req.params.uploadId));
    await manager.read(credential(req)); res.json(preview);
  });
  app.get(`${prefix}/uploads/:uploadId/artwork`, async (req, res) => {
    const owner = await manager.read(credential(req)); const image = await uploads.artwork(uuid.parse(req.params.uploadId), owner.ownerId);
    await manager.read(credential(req)); res.type(image.contentType).send(image.body);
  });
  app.post(`${prefix}/uploads/:uploadId/discard`, async (req, res) => {
    body(req, empty); const discarded = await manager.discardUpload(credential(req), uuid.parse(req.params.uploadId), (ownerId, assetId) => uploads.remove(ownerId, assetId));
    res.json({ discarded, saved: !discarded }); // Forgetting a local draft must never delete an ambiguously acknowledged saved entry.
  });
  app.post(`${prefix}/add-upload`, async (req, res) => {
    const input = body(req, z.object({ operation: preparationOperationSchema, uploadId: uuid, text: uploadTextSchema }).strict());
    const owner = await manager.read(credential(req));
    const result = await manager.addCaptured(credential(req), input.operation, JSON.stringify(['upload', input.uploadId, input.text]), async () => {
      const context = engine.catalogueContext(member(req));
      const saved = await uploads.capture(owner.ownerId, input.uploadId, input.text);
      if (engine.catalogueContext(member(req)) !== context) throw new AppError(401, 'Room membership changed. Your upload was kept.');
      return saved;
    });
    // An exact duplicate may reuse an existing entry; discard only an unreferenced extra asset.
    await manager.discardUpload(credential(req), input.uploadId, (ownerId, assetId) => uploads.remove(ownerId, assetId)).catch(() => {});
    res.json(result);
  });
  app.post(`${prefix}/purge-upload`, async (req, res) => {
    const input = body(req, z.object({ operation: preparationOperationSchema, entryId: uuid }).strict());
    res.json(await manager.purgeUpload(credential(req), input.operation, input.entryId, assetId => uploads.busy(assetId), (ownerId, assetId) => uploads.remove(ownerId, assetId)));
  });
  for (const action of ['move', 'remove', 'restore', 'review'] as const) {
    app.post(`${prefix}/${action}`, async (req, res) => {
      const input = body(req, z.object({ operation: preparationOperationSchema, entryId: uuid, beforeId: uuid.nullable().optional() }).strict());
      const result = action === 'move' ? await manager.move(credential(req), input.operation, input.entryId, input.beforeId ?? null)
        : action === 'restore' ? await manager.restore(credential(req), input.operation, input.entryId, input.beforeId ?? null)
        : action === 'review' ? await manager.acknowledgeReview(credential(req), input.operation, input.entryId)
        : await manager.remove(credential(req), input.operation, input.entryId);
      res.json(result);
    });
  }
  app.post(`${prefix}/play`, async (req, res) => {
    const input = body(req, z.object({ entryId: uuid, revision: z.number().int().nonnegative(), turnId: uuid, previousPlaybackId: uuid.nullable() }).strict());
    const role = { kind: 'participant' as const, credential: member(req) }; const view = engine.view(role);
    if (!view.myTurn || view.turnId !== input.turnId) throw new AppError(403, 'Only the current participant can play their next track.');
    const result = await maOperation('prepared-play', () => manager.playHead(credential(req), input.entryId, input.revision, async selection => {
      const playbackId = await engine.playPrepared(member(req), input.turnId, input.previousPlaybackId, selection, input.entryId);
      return { playbackId, value: engine.view(role) };
    }));
    res.json({ view: result.value, preparation: result.preparation, warning: result.warning });
  });
  app.get(`${prefix}/artwork/:entryId/:kind`, async (req, res) => {
    const entryId = uuid.parse(req.params.entryId); const kind = z.enum(['artwork', 'artistArtwork']).parse(req.params.kind);
    const selection = await manager.selection(credential(req), entryId);
    let image;
    if (selection.source === 'upload' && kind === 'artwork' && selection.artworkAssetId) {
      const owner = await manager.read(credential(req)); image = await uploads.artwork(selection.assetId, owner.ownerId);
    } else if (integrations && selection.source === 'music-assistant') {
      image = await integrations.savedArtwork(selection, kind, artworkSize.parse(req.query.size));
    }
    else throw new AppError(404, 'Artwork unavailable.');
    const latest = await manager.selection(credential(req), entryId);
    if (JSON.stringify(selection) !== JSON.stringify(latest)) throw new AppError(403, 'Saved artwork access changed.');
    res.type(image.contentType).send(image.body);
  });
  // This path receives both HttpOnly cookies. One connection carries independently filtered feeds.
  app.get(`${prefix}/live`, async (req, res) => {
    const role = { kind: 'participant' as const, credential: member(req) };
    engine.view(role);
    const stream = streams.reserve(res);
    try {
      let previousRoom = ''; let previousList = ''; let ready = false;
      let pending: Awaited<ReturnType<PreparationManager['read']>> | null | undefined;
      const sendRoom = () => {
        try {
          const view = engine.view(role); const key = JSON.stringify(view);
          if (key !== previousRoom) { previousRoom = key; stream.sendEncoded('state', key); }
        } catch { stream.send('revoked', {}); }
      };
      const sendList = (view: Awaited<ReturnType<PreparationManager['read']>> | null) => {
        if (!ready) { pending = view; return; }
        if (!view) { stream.send('preparation-revoked', {}); return; }
        const key = JSON.stringify(view);
        if (key !== previousList) { previousList = key; stream.sendEncoded('preparation', key); }
      };
      if (credential(req)) {
        try {
          const off = await manager.subscribe(credential(req), sendList); stream.onClose(off);
          const latest = await manager.read(credential(req));
          if (pending !== null && (!pending || pending.revision < latest.revision)) pending = latest;
        } catch { pending = null; }
      }
      // Membership can be revoked while awaiting private authorization.
      engine.view(role);
      if (!stream.open()) return;
      ready = true; sendRoom(); if (pending !== undefined) sendList(pending);
      engine.on('change', sendRoom); stream.onClose(() => engine.off('change', sendRoom));
      let reading = false;
      stream.every(() => {
        sendRoom(); stream.heartbeat();
        if (!credential(req) || reading || stream.closed) return;
        reading = true;
        void manager.read(credential(req)).then(sendList).catch(() => sendList(null)).finally(() => { reading = false; });
      }, 15_000);
    } catch (error) { stream.release(); throw error; }
  });
  app.get(`${prefix}/events`, async (req, res) => {
    const stream = streams.reserve(res);
    try {
      let ready = false; let queued: Awaited<ReturnType<PreparationManager['read']>> | null | undefined;
      let previous = '';
      const send = (view: Awaited<ReturnType<PreparationManager['read']>> | null) => {
        if (!view) { stream.send('revoked', {}); return; }
        const key = JSON.stringify(view);
        if (key !== previous) { previous = key; stream.sendEncoded('state', key); }
      };
      const subscription = await manager.subscribe(credential(req), view => {
        if (stream.closed) return;
        if (!ready) { queued = view; return; }
        send(view);
      });
      stream.onClose(subscription);
      if (stream.closed) return;
      const latest = await manager.read(credential(req));
      if (!stream.open()) return;
      ready = true;
      if (queued === null) { stream.send('revoked', {}); return; }
      send(queued && queued.revision > latest.revision ? queued : latest);
      let reading = false;
      stream.every(() => {
        if (reading) return;
        reading = true;
        stream.heartbeat();
        void manager.read(credential(req)).then(send)
          .catch(() => stream.send('revoked', {})).finally(() => { reading = false; });
      }, 15_000);
    } catch (error) { stream.release(); throw error; }
  });
  return () => { clearInterval(timer); streams.close(); };
}
