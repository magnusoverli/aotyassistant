import express, { type Express, type Request } from 'express';
import { z } from 'zod';
import { AppError } from './model.js';
import type { UserManager } from './users.js';
import type { Engine, EngineChange } from './engine.js';
import type { EventStreams } from './event-streams.js';
import { UserPictures, prepareUserPicture } from './user-pictures.js';
import { maxUserPictureBytes, userPictureVersionPattern } from './user-picture-format.js';
import { jsonBody } from './http-utils.js';
import { RateLimiter } from './http-guards.js';

const revision = z.union([z.literal('none'), z.string().regex(userPictureVersionPattern)]);

export function mountUserPictures(app: Express, users: UserManager, pictures: UserPictures, credential: (req: Request) => string) {
  const rates = new RateLimiter(1000);
  const raw = express.raw({ type: 'application/octet-stream', limit: maxUserPictureBytes });
  app.get('/api/user-pictures/:userId/:version.webp', async (req, res) => {
    await pictures.ready;
    const id = z.uuid().parse(req.params.userId); const version = z.string().regex(userPictureVersionPattern).parse(req.params.version);
    const url = `/api/user-pictures/${id}/${version}.webp`;
    if (users.pictureUrl(id) !== url) throw new AppError(404, 'This picture is no longer in use.');
    const bytes = await pictures.image(id, version);
    // Recheck after the file read, including before returning a cached response.
    if (users.pictureUrl(id) !== url) throw new AppError(404, 'This picture is no longer in use.');
    const etag = `"${version}"`;
    res.set({ 'Cache-Control': 'private, no-cache', ETag: etag });
    if (req.headers['if-none-match'] === etag) { res.status(304).end(); return; }
    res.type('image/webp').send(bytes);
  });
  for (const host of [false, true]) {
    const path = host ? '/api/host/users/:userId/picture' : '/api/participant/picture';
    const identity = (req: Request) => {
      if (host) return { id: z.uuid().parse(req.params.userId), token: undefined };
      const token = credential(req); const user = users.current(token);
      if (!user) throw new AppError(401, 'Select your name and sign in to change your picture.');
      return { id: user.id, token };
    };
    app.post(path, async (req, _res, next) => {
      const { id, token } = identity(req);
      await users.withProfile(id, token, async () => {});
      revision.parse(req.get('X-Picture-Version'));
      rates.prune();
      if (rates.hit(id, 12) !== 'ok') throw new AppError(429, 'Too many picture uploads. Try again in a minute.');
      next();
    }, (req, res, next) => raw(req, res, error => next((error as { status?: number } | undefined)?.status === 413
      ? new AppError(413, 'Choose a picture smaller than 10 MB.') : error)), async (req, res) => {
      const { id, token } = identity(req);
      if (!Buffer.isBuffer(req.body)) throw new AppError(400, 'Choose or take a photo first.');
      const prepared = await prepareUserPicture(req.body);
      const avatarUrl = await users.withProfile(id, token, () => pictures.set(id, prepared, revision.parse(req.get('X-Picture-Version'))));
      res.json({ avatarUrl: avatarUrl ?? null });
    });
    app.post(`${path}/remove`, jsonBody(z.strictObject({ version: revision }), async (input, req, res) => {
      const { id, token } = identity(req);
      await users.withProfile(id, token, () => pictures.remove(id, input.version)); res.json({ avatarUrl: null });
    }));
  }
}

/** Directories include users outside the current order, so they have their own lightweight feed. */
export function mountUserDirectoryEvents(app: Express, users: UserManager, engine: Engine, streams: EventStreams, credential: (req: Request) => string) {
  for (const host of [false, true]) app.get(host ? '/api/host/users/events' : '/api/participant/identity/events', (req, res) => {
    const stream = streams.reserve(res); if (!stream.open()) return;
    let previous = '';
    const send = () => {
      try {
        const encoded = JSON.stringify(users.directoryView(host ? '' : credential(req), host));
        if (encoded !== previous) { previous = encoded; stream.sendEncoded('state', encoded); }
      } catch { stream.end(); }
    };
    const changed = (kind?: EngineChange) => { if (kind !== 'playback') send(); };
    send(); engine.on('change', changed);
    stream.onClose(() => engine.off('change', changed)); stream.every(() => { send(); stream.heartbeat(); }, 15_000);
  });
}
