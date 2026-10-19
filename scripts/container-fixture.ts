import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer, type AddressInfo } from 'node:net';
import { once } from 'node:events';

// Smoke tests use a dedicated tag and disposable data, never a released installation.
export const image = 'aotyassistant:smoke';
const exec = promisify(execFile);
export const docker = async (...args: string[]) => (await exec('docker', args, { timeout: 30_000, maxBuffer: 4 * 1024 * 1024 })).stdout.trim();

export async function availablePort() {
  const reservation = createServer(); reservation.listen(0, '127.0.0.1'); await once(reservation, 'listening');
  const port = (reservation.address() as AddressInfo).port;
  await new Promise<void>((resolve, reject) => reservation.close(error => error ? reject(error) : resolve()));
  return port;
}
