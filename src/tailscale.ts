import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';

export const onlinePort = 8098;
export const funnelTarget = `http://127.0.0.1:${onlinePort}`;
export type TailStatus = { BackendState?: string; AuthURL?: string; Self?: { DNSName?: string; Online?: boolean; KeyExpiry?: string } };
export interface TunnelConnector {
  start(): Promise<void>;
  stop(): Promise<void>;
  status(): Promise<TailStatus>;
  configured(host: string): Promise<boolean>;
  connect(url: (value: string) => void): void;
  publish(url: (value: string) => void): void;
  readonly busy: boolean;
}

/** Never render arbitrary CLI output, errors, QR images, or URLs from a child process. */
export function tailscaleApproval(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (url.origin === 'https://login.tailscale.com' && !url.username && !url.password && /^\/(a|f)\/[a-zA-Z0-9/_-]+$/.test(url.pathname)) return url.href;
  } catch { /* Untrusted or incomplete output. */ }
}
export function tailscaleHost(value: string | undefined): string | undefined {
  const host = value?.replace(/\.$/, '').toLowerCase();
  return host && /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.){2}ts\.net$/.test(host) ? host : undefined;
}
export function exactFunnel(config: unknown, host: string): boolean {
  // A dedicated daemon must expose exactly our guest listener, not any LAN/admin port.
  const hp = `${host}:443`;
  return z.object({
    TCP: z.object({ '443': z.object({ HTTPS: z.literal(true) }).strict() }).strict(),
    Web: z.object({ [hp]: z.object({ Handlers: z.object({ '/': z.object({ Proxy: z.literal(funnelTarget) }).strict() }).strict() }).strict() }).strict(),
    AllowFunnel: z.object({ [hp]: z.literal(true) }).strict(),
    Services: z.object({}).strict().optional(), Foreground: z.object({}).strict().optional(),
  }).strict().safeParse(config).success;
}

/** Pinned bundled binaries; no shell, auth keys, root, TUN, routes, DNS changes, or host networking. */
export class TailscaleConnector implements TunnelConnector {
  private daemon?: ChildProcess;
  private action?: ChildProcess;
  private children = new Set<ChildProcess>();
  private stopping?: Promise<void>;
  private generation = 0;
  private socket: string;
  constructor(private directory: string, private runtime = '/run/aoty') { this.socket = join(runtime, 'tailscaled.sock'); }
  get busy() { return Boolean(this.action); }
  async start() {
    const generation = this.generation;
    if (this.stopping) await this.stopping;
    if (this.daemon) return;
    await mkdir(join(this.directory, 'tailscale'), { recursive: true, mode: 0o700 });
    await mkdir(this.runtime, { recursive: true, mode: 0o700 });
    if (generation !== this.generation) return;
    const child = spawn('/usr/local/bin/tailscaled', ['--tun=userspace-networking', `--statedir=${join(this.directory, 'tailscale')}`, `--socket=${this.socket}`, '--port=0'],
      { stdio: 'ignore', env: { PATH: process.env.PATH, HOME: this.directory, TS_NO_LOGS_NO_SUPPORT: 'true' } });
    this.daemon = child;
    const clear = () => { if (this.daemon === child) this.daemon = undefined; };
    child.on('error', clear); child.once('exit', clear);
  }
  async stop() {
    this.generation++;
    if (this.stopping) return this.stopping;
    this.stopping = Promise.all([...this.children, ...(this.daemon ? [this.daemon] : [])].map(child => new Promise<void>(resolve => {
      if (child.exitCode !== null || child.signalCode !== null || !child.pid) { resolve(); return; }
      const timer = setTimeout(() => child.kill('SIGKILL'), 3000); timer.unref();
      child.once('exit', () => { clearTimeout(timer); resolve(); }); child.kill('SIGTERM');
    }))).then(() => { this.daemon = undefined; this.action = undefined; }).finally(() => { this.stopping = undefined; });
    return this.stopping;
  }
  private run(args: string[], approval?: (value: string) => void): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn('/usr/local/bin/tailscale', [`--socket=${this.socket}`, ...args], { stdio: ['ignore', 'pipe', 'pipe'], env: { PATH: process.env.PATH, HOME: this.directory } });
      this.children.add(child); if (approval) this.action = child;
      let output = ''; let combined = ''; let overflow = false;
      const timer = setTimeout(() => child.kill('SIGKILL'), approval ? 10 * 60_000 : 8000); timer.unref();
      const inspect = (chunk: Buffer) => {
        combined = (combined + chunk.toString()).slice(-8192);
        for (const match of combined.matchAll(/https:\/\/login\.tailscale\.com\/[^\s"<>]+/g)) {
          const url = tailscaleApproval(match[0]); if (url) approval?.(url);
        }
      };
      child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString(); if (output.length > 1024 * 1024) { overflow = true; child.kill('SIGKILL'); } inspect(chunk); });
      child.stderr.on('data', inspect);
      const cleanup = () => { clearTimeout(timer); this.children.delete(child); if (this.action === child) this.action = undefined; };
      child.once('error', () => { cleanup(); reject(new Error('Tailscale connector unavailable.')); });
      child.once('close', code => { cleanup(); if (code === 0 && !overflow) resolve(output); else reject(new Error('Tailscale command did not complete.')); });
    });
  }
  async status(): Promise<TailStatus> { return JSON.parse(await this.run(['status', '--json', '--peers=false'])); }
  async configured(host: string) { return exactFunnel(JSON.parse(await this.run(['funnel', 'status', '--json'])), host); }
  connect(url: (value: string) => void) {
    if (!this.busy) void this.run(['up', '--hostname=listening-room', '--accept-dns=false', '--accept-routes=false', '--advertise-tags=', '--ssh=false', '--timeout=10m'], url).catch(() => {});
  }
  publish(url: (value: string) => void) {
    if (this.busy) return;
    const generation = this.generation;
    // This private daemon belongs exclusively to the app. Remove stale mappings,
    // including an old DNS name after device renaming, before publishing one target.
    void (async () => {
      await this.run(['funnel', 'reset'], url);
      if (generation === this.generation) await this.run(['funnel', '--bg', '--https=443', funnelTarget], url);
    })().catch(() => {});
  }
}
