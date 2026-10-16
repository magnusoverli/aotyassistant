import { readFileSync } from 'node:fs';
import { z } from 'zod';

const schema = z.object({
  port: z.coerce.number().int().min(1).max(65535),
  listenHost: z.string().min(1),
  guestUrl: z.string().url().transform(value => {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
      throw new Error('GUEST_URL must be an http(s) origin, without credentials, path, query, or fragment.');
    }
    return url.origin;
  }),
  dataDir: z.string().min(1), mode: z.literal('demo'),
  demoSeconds: z.coerce.number().int().min(1).max(3600),
});
export type Config = z.infer<typeof schema>;
export function configFromEnv(): Config {
  // Supervisor options are read from the add-on's own directory, never HA internals.
  const options = process.env.HA_ADDON === '1'
    ? JSON.parse(readFileSync('/data/options.json', 'utf8')) as Record<string, unknown> : {};
  return schema.parse({
    port: process.env.PORT ?? 3000,
    listenHost: process.env.LISTEN_HOST ?? '127.0.0.1',
    guestUrl: options.guest_url ?? process.env.GUEST_URL ?? 'http://localhost:3000',
    dataDir: process.env.DATA_DIR ?? './data',
    mode: options.playback_mode ?? process.env.PLAYBACK_MODE ?? 'demo',
    demoSeconds: options.demo_track_seconds ?? process.env.DEMO_TRACK_SECONDS ?? 30,
  });
}
