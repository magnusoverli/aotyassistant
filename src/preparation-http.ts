import type { Express, Request, Response } from 'express';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { AppError } from './model.js';
import type { Engine } from './engine.js';
import type { IntegrationManager } from './integrations.js';
import type { Config } from './config.js';
import { PreparationManager, preparationOperationSchema, preparationLimits, encodePreparationView } from './preparations.js';
import { UploadAssets, uploadTextSchema } from './uploads.js';
import { artworkSize, body, catalogueRead, jsonBody, sendArtwork, setParticipantCookie } from './http-utils.js';
import type { ArtworkData } from './music-assistant-transport.js';
import { RateLimiter, readCookie } from './http-guards.js';
import { EventStreams } from './event-streams.js';
import type { SpectrumBroadcast } from './spectrum-broadcast.js';
import { operation } from './operation.js';
import type { UserManager } from './users.js';
import { ListImports } from './list-import-jobs.js';
import { fetchSharedList, sharedListLink } from './shared-list.js';

const prefix = '/api/participant/preparations';
const uuid = z.uuid();
const cookieName = 'doom_room_preparation';
const empty = z.object({}).strict();

/** Private library routes deliberately use a separate credential, revision, rate lane, and event stream. */
export function mountPreparations(app: Express, manager: PreparationManager, engine: Engine, config: Config, integrations: IntegrationManager | undefined, uploads: UploadAssets, users: UserManager, spectrum?: SpectrumBroadcast) {
  const streams = new EventStreams(200, 'Too many private-list connections. Close unused tabs.');
  const rates = new RateLimiter(5000);
  const member = (req: Request) => readCookie(req, 'doom_room_participant');
  const credential = (req: Request) => readCookie(req, cookieName);
  const setCookie = (res: Response, value: string) => setParticipantCookie(res.req, res, cookieName, value, prefix, config.guestUrl);
  const timer = setInterval(() => rates.prune(), 60_000); timer.unref();
  app.use(prefix, (req, _res, next) => {
    if (req.method === 'GET' || ['/play', '/join', '/pin'].includes(req.path)) return next();
    const initializing = req.path === '/init';
    const key = initializing ? `identity:${createHash('sha256').update(member(req)).digest('hex')}` : `owner:${createHash('sha256').update(credential(req)).digest('hex')}`;
    const rate = rates.hit(key, initializing ? 60 : 180);
    next(rate === 'full' ? new AppError(503, 'Private lists are busy. Try again shortly.')
      : rate === 'limited' ? new AppError(429, 'Too many list changes. Wait a minute; saved entries were kept.') : undefined);
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
  app.post(`${prefix}/add`, jsonBody(z.strictObject({ operation: preparationOperationSchema, trackId: z.string().min(1).max(1000) }), async (input, req, res) => {
    res.json(await manager.addCaptured(credential(req), input.operation, input.trackId, async () => {
      const context = engine.catalogueContext(member(req));
      if (!integrations?.configured) throw new AppError(409, 'Connect Music Assistant in Settings before adding songs. Your list was kept.');
      const saved = await integrations.captureSaved(input.trackId, context);
      if (engine.catalogueContext(member(req)) !== context) throw new AppError(401, 'Room membership changed. Your list was kept.'); return saved;
    }));
  }));
  app.post(`${prefix}/add-album`, jsonBody(z.strictObject({ operation: preparationOperationSchema, albumId: z.string().min(1).max(1000),
    trackIds: z.array(z.string().min(1).max(1000)).min(1).max(preparationLimits.albumTracks),
  }), async (input, req, res) => {
    res.json(await operation('add-album', () => manager.addAlbumCaptured(credential(req), input.operation, input.albumId, input.trackIds, async () => {
      const context = engine.catalogueContext(member(req));
      if (!integrations?.configured) throw new AppError(409, 'Connect Music Assistant in Settings before adding songs. Your list was kept.');
      const saved = await integrations.captureSavedAlbum(input.trackIds, context);
      if (engine.catalogueContext(member(req)) !== context) throw new AppError(401, 'Room membership changed. Your list was kept.');
      return saved;
    }), 90_000));
  }));
  app.post(`${prefix}/uploads/:uploadId`, async (req, res) => {
    const uploadId = uuid.parse(req.params.uploadId);
    if (!req.is('application/octet-stream')) throw new AppError(415, 'Upload one file as application/octet-stream.');
    const owner = await manager.read(credential(req)); const context = engine.catalogueContext(member(req));
    let filename: string;
    try { const header = req.headers['x-upload-filename']; if (typeof header !== 'string' || header.length > 12_000) throw new Error(); filename = decodeURIComponent(header); }
    catch { throw new AppError(400, 'The selected file needs a valid filename.'); }
    req.setTimeout(60_000, () => req.destroy());
    try {
      const preview = await uploads.receive(owner.ownerId, uploadId, filename, req, req.signal);
      await manager.read(credential(req));
      if (engine.catalogueContext(member(req)) !== context) throw new AppError(401, 'Room membership changed. Recover the completed upload from your private list before adding it.');
      res.json(preview);
    } finally { req.setTimeout(0); }
  });
  app.get(`${prefix}/uploads/:uploadId`, async (req, res) => {
    const owner = await manager.read(credential(req)); const preview = await uploads.inspect(owner.ownerId, uuid.parse(req.params.uploadId));
    await manager.read(credential(req)); res.json(preview);
  });
  app.get(`${prefix}/uploads/:uploadId/artwork`, async (req, res) => {
    const owner = await manager.read(credential(req)); const assetId = uuid.parse(req.params.uploadId);
    await uploads.inspect(owner.ownerId, assetId); await manager.read(credential(req));
    const size = artworkSize.parse(req.query.size);
    await sendArtwork(req, res, `upload:${await uploads.artworkKey(assetId, owner.ownerId, size)}`,
      () => uploads.artwork(assetId, owner.ownerId, size), () => manager.read(credential(req)));
  });
  app.post(`${prefix}/uploads/:uploadId/discard`, async (req, res) => {
    body(req, empty); const discarded = await manager.discardUpload(credential(req), uuid.parse(req.params.uploadId), (ownerId, assetId) => uploads.remove(ownerId, assetId));
    res.json({ discarded, saved: !discarded }); // Forgetting a local draft must never delete an ambiguously acknowledged saved entry.
  });
  app.post(`${prefix}/add-upload`, jsonBody(z.strictObject({ operation: preparationOperationSchema, uploadId: uuid, text: uploadTextSchema }), async (input, req, res) => {
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
  }));
  app.post(`${prefix}/purge-upload`, jsonBody(z.strictObject({ operation: preparationOperationSchema, entryId: uuid }), async (input, req, res) => {
    res.json(await manager.purgeUpload(credential(req), input.operation, input.entryId, assetId => uploads.busy(assetId), (ownerId, assetId) => uploads.remove(ownerId, assetId)));
  }));
  app.post(`${prefix}/replace-upload`, jsonBody(z.strictObject({ operation: preparationOperationSchema, entryId: uuid, uploadId: uuid, text: uploadTextSchema }), async (input, req, res) => {
    const owner = await manager.read(credential(req));
    const result = await manager.replaceCaptured(credential(req), input.operation, input.entryId, JSON.stringify(['upload', input.uploadId, input.text]), async () => {
      const context = engine.catalogueContext(member(req));
      const original = await manager.selection(credential(req), input.entryId);
      if (original.source !== 'upload') throw new AppError(422, 'Choose an uploaded song to replace with a new file.');
      const saved = await uploads.capture(owner.ownerId, input.uploadId, input.text);
      if (engine.catalogueContext(member(req)) !== context) throw new AppError(401, 'Room membership changed. Your playlist was kept.');
      return saved;
    });
    // Same recording: the original entry wins. Only discard extra bytes after a confirmed save.
    await manager.discardUpload(credential(req), input.uploadId, (ownerId, assetId) => uploads.remove(ownerId, assetId)).catch(() => {});
    res.json(result);
  }));
  // Importing a list shared from SuShe Online runs on the server; the page only starts it and follows its progress.
  const imports = new ListImports(manager, song => {
    if (!integrations?.configured) throw new AppError(409, 'Importing a list needs a Music Assistant connection.');
    return integrations.importSong(song);
  });
  // Reading a link contacts another server; a person rarely needs more than a few a minute.
  const importReads = new RateLimiter(1000); const importTimer = setInterval(() => importReads.prune(), 60_000); importTimer.unref();
  app.get(`${prefix}/import`, async (req, res) => { res.json({ import: await imports.current(credential(req)) }); });
  app.post(`${prefix}/import`, jsonBody(z.strictObject({ link: z.string().trim().min(1).max(2000) }), async (input, req, res) => {
    engine.catalogueContext(member(req));
    if (!integrations?.configured) throw new AppError(422, 'Importing a list needs a Music Assistant connection.');
    const ownerId = await manager.ownerOf(credential(req));
    if (importReads.hit(ownerId, 10) !== 'ok') throw new AppError(429, 'Too many imports. Wait a minute and try again.');
    const link = sharedListLink(input.link);
    const shared = await operation('list-import', () => fetchSharedList(link), 15_000, req.signal);
    res.json({ import: await imports.start(credential(req), shared) });
  }));
  // Replacing a song with another from its album: list the album, then swap in place.
  app.post(`${prefix}/album`, jsonBody(z.strictObject({ entryId: uuid }), async (input, req, res) => {
    const context = engine.catalogueContext(member(req));
    if (!integrations?.configured) throw new AppError(422, 'Replacing a song needs a Music Assistant connection.');
    const selection = await manager.selection(credential(req), input.entryId);
    if (selection.source !== 'music-assistant') throw new AppError(422, 'Only songs from Music Assistant can be replaced with another song from their album.');
    const album = await operation('album-for-saved', () => integrations.albumForSaved(selection, context), 30_000, req.signal);
    if (engine.catalogueContext(member(req)) !== context) throw new AppError(401, 'Room membership changed. Your list was kept.');
    res.json(album);
  }));
  app.post(`${prefix}/replace`, jsonBody(z.strictObject({ operation: preparationOperationSchema, entryId: uuid, trackId: z.string().min(1).max(1000) }), async (input, req, res) => {
    res.json(await manager.replaceCaptured(credential(req), input.operation, input.entryId, input.trackId, async () => {
      const context = engine.catalogueContext(member(req));
      if (!integrations?.configured) throw new AppError(422, 'Replacing a song needs a Music Assistant connection.');
      const saved = await integrations.captureSaved(input.trackId, context);
      if (engine.catalogueContext(member(req)) !== context) throw new AppError(401, 'Room membership changed. Your list was kept.'); return saved;
    }));
  }));
  app.post(`${prefix}/import/stop`, jsonBody(empty, async (_input, req, res) => { res.json({ import: await imports.stop(credential(req)) }); }));
  app.post(`${prefix}/clear`, jsonBody(z.strictObject({ operation: preparationOperationSchema }), async (input, req, res) => {
    res.json(await manager.clear(credential(req), input.operation, assetId => uploads.busy(assetId), (ownerId, assetId) => uploads.remove(ownerId, assetId)));
  }));
  for (const action of ['move', 'remove', 'restore', 'review'] as const) {
    app.post(`${prefix}/${action}`, jsonBody(z.strictObject({ operation: preparationOperationSchema, entryId: uuid, beforeId: uuid.nullable().optional() }), async (input, req, res) => {
      const result = action === 'move' ? await manager.move(credential(req), input.operation, input.entryId, input.beforeId ?? null)
        : action === 'restore' ? await manager.restore(credential(req), input.operation, input.entryId, input.beforeId ?? null)
        : action === 'review' ? await manager.acknowledgeReview(credential(req), input.operation, input.entryId)
        : await manager.remove(credential(req), input.operation, input.entryId);
      res.json(result);
    }));
  }
  app.post(`${prefix}/play`, jsonBody(z.strictObject({ entryId: uuid, revision: z.number().int().nonnegative(), turnId: uuid, previousPlaybackId: uuid.nullable() }), async (input, req, res) => {
    const role = { kind: 'participant' as const, credential: member(req) }; const view = engine.view(role);
    if (!view.myTurn || view.turnId !== input.turnId) throw new AppError(403, 'Only the current participant can play their next track.');
    const result = await operation('prepared-play', () => manager.playHead(credential(req), input.entryId, input.revision, async selection => {
      const playbackId = await engine.playPrepared(member(req), input.turnId, input.previousPlaybackId, selection, input.entryId);
      return { playbackId, value: engine.view(role) };
    }));
    res.json({ view: result.value, preparation: result.preparation, warning: result.warning });
  }));
  app.get(`${prefix}/artwork/:entryId/:kind`, async (req, res) => catalogueRead(req, 'saved-artwork', async () => {
    const entryId = uuid.parse(req.params.entryId); const kind = z.enum(['artwork', 'artistArtwork']).parse(req.params.kind);
    const selection = await manager.selection(credential(req), entryId);
    // Served here rather than redirected to the catalogue URL: one request per cover
    // instead of two. The pixel tag is shared, so either URL revalidates without a read.
    const size = artworkSize.parse(req.query.size);
    let key: string; let read: () => Promise<ArtworkData>;
    if (selection.source === 'upload' && kind === 'artwork' && selection.artworkAssetId) {
      const owner = await manager.read(credential(req));
      key = `upload:${await uploads.artworkKey(selection.assetId, owner.ownerId, size)}`; read = () => uploads.artwork(selection.assetId, owner.ownerId, size);
    } else if (integrations && selection.source === 'music-assistant') {
      key = integrations.savedArtworkKey(selection, kind, size); read = () => integrations.savedArtwork(selection, kind, size);
    }
    else throw new AppError(404, 'Artwork unavailable.');
    await sendArtwork(req, res, key, read, async () => {
      const latest = await manager.selection(credential(req), entryId);
      if (JSON.stringify(selection) !== JSON.stringify(latest)) throw new AppError(403, 'Saved artwork access changed.');
    });
  }));
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
        const key = encodePreparationView(view);
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
      // The room's spectrum rides on this one connection, as on every other room stream.
      if (spectrum) stream.onClose(spectrum.subscribe(json => stream.sendEncoded('spectrum', json)));
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
        const key = encodePreparationView(view);
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
  return () => { clearInterval(timer); clearInterval(importTimer); imports.close(); streams.close(); };
}
