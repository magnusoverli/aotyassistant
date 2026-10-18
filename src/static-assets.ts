import type { Express } from 'express';
import { resolve } from 'node:path';

/** Only content-addressed public build assets may override the private no-store default. */
export function mountStaticAssets(app: Express, directory: string) {
  app.use('/assets', (req, res, next) => {
    if (!['GET', 'HEAD'].includes(req.method) || !/^\/[\w-]+-[\w-]{8}\.(js|css)$/.test(req.path)) return next();
    const encoding = req.acceptsEncodings('br', 'gzip', 'identity');
    if (!encoding) { res.sendStatus(406); return; }
    const suffix = encoding === 'br' ? '.br' : encoding === 'gzip' ? '.gz' : '';
    res.vary('Accept-Encoding');
    res.type(req.path.endsWith('.css') ? 'text/css' : 'application/javascript');
    if (suffix) res.setHeader('Content-Encoding', encoding);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.sendFile(resolve(directory, 'assets', req.path.slice(1) + suffix), { lastModified: false }, error => {
      if (!error) return;
      if (res.headersSent) { next(error); return; }
      res.removeHeader('Content-Encoding'); res.setHeader('Cache-Control', 'no-store'); next(error);
    });
  });
}
