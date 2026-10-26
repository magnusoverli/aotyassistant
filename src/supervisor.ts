import { request } from 'node:http';
import { z } from 'zod';
import { isAllowedAddress, musicAssistantUrl } from './music-assistant-transport.js';

const port = z.coerce.number().int().min(1).max(65535);
const host = z.string().max(253).regex(/^[a-zA-Z0-9][a-zA-Z0-9.-]*$/);
const appInfo = z.object({ slug: z.string().optional(), hostname: host.nullish(), ip_address: z.string().nullish(),
  state: z.string().nullish(), host_network: z.boolean().optional(), ingress_port: port.nullish(),
  discovery: z.array(z.string()).optional(), url: z.string().nullish(), network: z.record(z.string(), z.unknown()).nullable().optional() });
export type SupervisorHints = {
  enabled: boolean; available: boolean; versions: { core?: string; supervisor?: string };
  guestOrigins: string[]; mediaOrigins: string[]; maOrigins: string[]; guestPort: number | null; message: string;
};
export const emptyHints = (enabled = false): SupervisorHints => ({ enabled, available: false, versions: {},
  guestOrigins: [], mediaOrigins: [], maOrigins: [], guestPort: null,
  message: enabled ? 'Waiting for Home Assistant Supervisor.' : 'Enter a server address or look for Music Assistant on the local network.' });
const origin = (hostname: string, value: number) => `http://${hostname.includes(':') ? `[${hostname}]` : hostname}:${value}`;
const privateIP = (value: string) => isAllowedAddress(value) && !/^(127\.|::1$)/.test(value);

/** Fixed-origin, read-only client. The injected token never enters a user-directed request. */
export class SupervisorClient {
  constructor(private token: string) {}
  read(path: string): Promise<unknown> {
    if (!/^\/(?:info|network\/info|supervisor\/info|addons\/(?:self|[a-zA-Z0-9_-]+)\/info)$/.test(path)) throw new Error('Unsupported Supervisor read.');
    return new Promise((resolve, reject) => {
      const req = request({ hostname: 'supervisor', port: 80, path, method: 'GET', agent: false,
        headers: { Authorization: `Bearer ${this.token}`, Accept: 'application/json' } }, res => {
        if (res.statusCode !== 200) { res.destroy(); reject(new Error('Supervisor information unavailable.')); return; }
        const chunks: Buffer[] = []; let size = 0;
        res.on('data', (chunk: Buffer) => { size += chunk.length; if (size > 512 * 1024) res.destroy(new Error('Response too large.')); else chunks.push(chunk); });
        res.on('error', () => reject(new Error('Supervisor read interrupted.')));
        res.on('end', () => { try {
          const result = z.object({ result: z.literal('ok'), data: z.unknown() }).parse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
          resolve(result.data);
        } catch { reject(new Error('Unsupported Supervisor information.')); } });
      });
      const timer = setTimeout(() => req.destroy(new Error('Supervisor read timed out.')), 4000); timer.unref();
      req.on('close', () => clearTimeout(timer)); req.on('error', () => reject(new Error('Cannot reach Supervisor.'))); req.end();
    });
  }
}

export async function supervisorHints(client: Pick<SupervisorClient, 'read'>, containerPort: number): Promise<SupervisorHints> {
  const result = emptyHints(true);
  const [info, self, network, supervisor] = await Promise.all(['/info', '/addons/self/info', '/network/info', '/supervisor/info']
    .map(path => client.read(path).catch(() => null)));
  const versions = z.object({ homeassistant: z.string(), supervisor: z.string() }).safeParse(info);
  if (versions.success) result.versions = { core: versions.data.homeassistant, supervisor: versions.data.supervisor };
  const own = appInfo.safeParse(self);
  if (own.success) {
    result.available = true;
    const mapping = own.data.network?.[`${containerPort}/tcp`];
    const mapped = mapping == null ? undefined : port.safeParse(mapping);
    if (mapped?.success) result.guestPort = mapped.data;
    if (own.data.hostname) result.mediaOrigins.push(origin(own.data.hostname, containerPort));
    if (own.data.ip_address && privateIP(own.data.ip_address)) result.mediaOrigins.push(origin(own.data.ip_address, containerPort));
  }
  const interfaces = z.object({ interfaces: z.array(z.object({ primary: z.boolean().optional(), enabled: z.boolean().optional(),
    type: z.string().optional(), interface: z.string().optional(), ipv4: z.object({ address: z.array(z.string()) }).nullable().optional(),
    ipv6: z.object({ address: z.array(z.string()) }).nullable().optional() })).max(100) }).safeParse(network);
  const candidates = interfaces.success ? interfaces.data.interfaces.filter(i => i.enabled !== false &&
    !/^(tun|tap|tailscale|wg|docker|veth|hassio|lo)/i.test(i.interface ?? '') && !/bridge|loopback|tun|wireguard/i.test(i.type ?? '')) : [];
  const primary = candidates.filter(i => i.primary);
  const interfacesToUse = primary.length ? primary : candidates;
  const addresses = [...new Set(interfacesToUse.flatMap(i => {
    const v4 = (i.ipv4?.address ?? []).map(a => a.split('/')[0]!).filter(privateIP);
    return v4.length ? v4 : (i.ipv6?.address ?? []).map(a => a.split('/')[0]!).filter(privateIP);
  }))].slice(0, 4);
  if (result.guestPort) result.guestOrigins = addresses.map(ip => origin(ip, result.guestPort!));
  result.mediaOrigins = [...result.mediaOrigins, ...result.guestOrigins].slice(0, 4);
  // The v1 embedded list is optional/legacy. Never escalate to manager for /addons.
  const apps = z.object({ addons: z.array(z.object({ slug: z.string().regex(/^[a-zA-Z0-9_-]+$/), name: z.string().optional() })).max(500) }).safeParse(supervisor);
  const matches = apps.success ? apps.data.addons.filter(a => /music[_-]?assistant/i.test(a.slug) || /music assistant/i.test(a.name ?? '')).slice(0, 6) : [];
  for (const candidate of matches) {
    const parsed = appInfo.safeParse(await client.read(`/addons/${candidate.slug}/info`).catch(() => null));
    if (!parsed.success) continue;
    const app = parsed.data;
    if (!app.discovery?.includes('music_assistant') && !/^https:\/\/(?:www\.)?(?:music-assistant\.io|github\.com\/music-assistant)(?:\/|$)/.test(app.url ?? '')) continue;
    if (app.state !== 'started') continue;
    // Prefer a LAN address usable by both the browser and server. Verify /info later.
    if (app.host_network) result.maOrigins.push(...addresses.map(ip => origin(ip, 8095)));
    if (app.ip_address && privateIP(app.ip_address)) result.maOrigins.push(origin(app.ip_address, app.ingress_port ?? 8095));
    if (!app.host_network && app.hostname) result.maOrigins.push(origin(app.hostname, 8095));
  }
  result.maOrigins = [...new Set(result.maOrigins)].filter(value => musicAssistantUrl.safeParse(value).success).slice(0, 8);
  result.message = !result.available ? 'Supervisor information is unavailable. Manual setup is available.'
    : !result.guestPort ? 'Guest access needs a published port in the app’s Network settings.'
      : !result.guestOrigins.length ? 'Choose a LAN guest address; no suitable host interface was detected.'
        : result.guestOrigins.length > 1 ? 'Choose the LAN address your guests can reach.' : 'Home Assistant network settings detected.';
  return result;
}
