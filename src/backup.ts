import { AsyncLocalStorage } from 'node:async_hooks';
import { createServer } from 'node:net';
import { chmod, lstat, mkdir, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';

/** Reentrant write barrier shared by all JSON commits and upload filesystem transactions. */
export class DurabilityBarrier {
  private context = new AsyncLocalStorage<boolean>();
  private active = 0;
  private resume?: () => void;
  private waiting?: Promise<void>;
  private drained?: () => void;
  get paused() { return Boolean(this.waiting); }
  async run<T>(work: () => Promise<T>): Promise<T> {
    if (this.context.getStore()) return work();
    while (this.waiting) await this.waiting;
    this.active++;
    try { return await this.context.run(true, work); }
    finally { if (--this.active === 0) this.drained?.(); }
  }
  async freeze(timeoutMs = 15_000) {
    if (this.paused) throw new Error('A backup is already in progress.');
    this.waiting = new Promise(resolve => { this.resume = resolve; });
    let timer: NodeJS.Timeout | undefined;
    try {
      if (this.active) await new Promise<void>((resolve, reject) => {
        this.drained = resolve;
        timer = setTimeout(() => reject(new Error('An upload or persistent write is still running. Retry the backup after it completes.')), timeoutMs);
      });
    } catch (error) { this.thaw(); throw error; }
    finally { clearTimeout(timer); this.drained = undefined; }
  }
  thaw() { const resume = this.resume; this.waiting = undefined; this.resume = undefined; resume?.(); }
}
export const durability = new DurabilityBarrier();
export const backupSocket = '/run/aoty/backup.sock';

/** Local file permissions, not an HTTP route, protect Supervisor's pre/post hooks. */
export async function startBackupControl(path = backupSocket) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const existing = await lstat(path).catch(error => { if (error.code !== 'ENOENT') throw error; return null; });
  if (existing) { if (!existing.isSocket()) throw new Error('Backup control path is occupied.'); await unlink(path); }
  const sockets = new Set<import('node:net').Socket>();
  const server = createServer(socket => {
    sockets.add(socket); socket.once('close', () => sockets.delete(socket)); socket.on('error', () => {});
    let command = ''; let handling = false;
    socket.setTimeout(20_000, () => socket.destroy());
    socket.on('data', chunk => {
      if (handling) return;
      command += chunk.toString('utf8');
      if (command.length > 16) { socket.destroy(); return; }
      if (!command.endsWith('\n')) return;
      handling = true;
      void (async () => {
        try {
          if (command === 'freeze\n') await durability.freeze();
          else if (command === 'thaw\n') durability.thaw();
          else throw new Error();
          socket.end('ok\n');
        } catch { socket.end('error\n'); }
      })();
    });
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(path, () => { server.off('error', reject); resolve(); }); });
  await chmod(path, 0o600);
  return () => { durability.thaw(); for (const socket of sockets) socket.destroy(); server.close(); void unlink(path).catch(() => {}); };
}
