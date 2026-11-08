import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { httpOrigin } from './lan-network.js';

const schema = z.object({
  port: z.coerce.number().int().min(1).max(65535),
  listenHost: z.string().min(1),
  guestUrl: httpOrigin('GUEST_URL must be an http(s) origin, without credentials, path, query, or fragment.'),
  dataDir: z.string().min(1),
  demoSeconds: z.coerce.number().int().min(1).max(3600),
  addon: z.boolean().optional(), guestOverride: z.boolean().optional(), ingressPort: z.number().int().min(1).max(65535).optional(),
});
export type Config = z.infer<typeof schema>;
export function configFromEnv(): Config {
  // Supervisor options are read from the add-on's own directory, never HA internals.
  const options = process.env.HA_ADDON === '1'
    ? JSON.parse(readFileSync('/data/options.json', 'utf8')) as Record<string, unknown> : {};
  return schema.parse({
    port: process.env.PORT ?? 3000,
    listenHost: process.env.LISTEN_HOST ?? '127.0.0.1',
    guestUrl: options.guest_url || process.env.GUEST_URL || 'http://localhost:3000',
    // `playback_mode` remains in the add-on schema only so older saved options stay valid.
    dataDir: process.env.DATA_DIR ?? './data',
    demoSeconds: options.demo_track_seconds ?? process.env.DEMO_TRACK_SECONDS ?? 30,
    addon: process.env.HA_ADDON === '1', guestOverride: Boolean(options.guest_url || process.env.GUEST_URL),
    ...(process.env.HA_ADDON === '1' ? { ingressPort: 8099 } : {}),
  });
}
