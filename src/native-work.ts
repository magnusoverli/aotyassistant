import { availableParallelism } from 'node:os';
import sharp from 'sharp';
import { WorkQueue } from './serial.js';

// Filesystem and gzip share libuv with image conversion and scrypt. Coordinate the
// expensive jobs across features, leaving room for short I/O on the default pool.
const configured = Number(process.env.UV_THREADPOOL_SIZE ?? 4);
const pool = Number.isInteger(configured) && configured > 0 ? configured : 4;
const concurrency = Math.max(1, Math.min(2, availableParallelism(), pool - 2));
sharp.concurrency(Math.max(1, Math.min(2, availableParallelism())));
const queue = new WorkQueue(16, concurrency);

export function nativeWork<T>(work: () => Promise<T>): Promise<T> { return queue.run(work, 'native'); }
