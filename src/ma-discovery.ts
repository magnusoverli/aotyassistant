import { Bonjour } from 'bonjour-service';
import { isIP } from 'node:net';
import { z } from 'zod';
import { MusicAssistantTransport, musicAssistantUrl, isAllowedAddress } from './music-assistant-transport.js';

export const serverInfoSchema = z.object({ server_id: z.string().min(1).max(200), server_version: z.string().max(80),
  server_name: z.string().max(200).optional(), name: z.string().max(200).optional(), schema_version: z.number().int(), min_supported_schema_version: z.number().int(),
  onboard_done: z.boolean().optional(), base_url: z.string().optional() });
export type ServerInfo = z.infer<typeof serverInfoSchema>;
export type DiscoveredServer = { id: string; name: string; url: string; browserUrl: string | null; version: string;
  ready: boolean; playbackCompatible: boolean };
export async function readServerInfo(url: string): Promise<ServerInfo> {
  const transport = new MusicAssistantTransport(url, '', 3000);
  try { return serverInfoSchema.parse(await transport.read('/info')); } finally { transport.close(); }
}

/** Best-effort, bounded LAN discovery. No multicast/host-network permission is required. */
export async function mdnsOrigins(timeoutMs = 2000): Promise<string[]> {
  return new Promise(resolve => {
    const found = new Set<string>(); let bonjour: Bonjour | undefined; let done = false;
    const finish = () => {
      if (done) return; done = true; clearTimeout(timer);
      try { bonjour?.destroy(); } catch { /* A failed multicast socket is a discovery miss. */ }
      resolve([...found]);
    };
    const timer = setTimeout(finish, timeoutMs); timer.unref();
    try {
      bonjour = new Bonjour({}, finish);
      bonjour.find({ type: 'mass', protocol: 'tcp' }, service => {
        if (done || found.size >= 4) return;
        const advertised = musicAssistantUrl.safeParse(service.txt?.base_url);
        if (advertised.success) found.add(advertised.data);
        if (service.port > 0 && service.port <= 65535 && found.size < 4) {
          const ip = service.addresses?.find(address => isAllowedAddress(address));
          if (ip) found.add(`http://${ip.includes(':') ? `[${ip}]` : ip}:${service.port}`);
        }
      });
    } catch { finish(); }
  });
}

export async function discoverServers(origins: string[], read = readServerInfo): Promise<DiscoveredServer[]> {
  const results = await Promise.all([...new Set(origins)].slice(0, 12).map(async url => {
    try {
      url = musicAssistantUrl.parse(url); const info = await read(url);
      let browserUrl: string | null = null;
      const advertised = musicAssistantUrl.safeParse(info.base_url);
      if (advertised.success && (advertised.data === url || (await read(advertised.data)).server_id === info.server_id)) browserUrl = advertised.data;
      // IP/ .local URLs are usable candidates for browsers; private Docker DNS is not.
      const hostname = new URL(url).hostname.replace(/^\[|\]$/g, '');
      if (!browserUrl && (hostname.endsWith('.local') || isIP(hostname) && !/^172\.30\.(32|33)\./.test(hostname))) browserUrl = url;
      return { id: info.server_id, name: info.name || info.server_name || 'Music Assistant', url, browserUrl, version: info.server_version,
        ready: info.onboard_done !== false, playbackCompatible: info.schema_version === 65 } satisfies DiscoveredServer;
    } catch { return null; }
  }));
  const byId = new Map<string, DiscoveredServer>();
  for (const result of results) if (result && (!byId.has(result.id) || !byId.get(result.id)!.browserUrl && result.browserUrl)) byId.set(result.id, result);
  return [...byId.values()];
}
