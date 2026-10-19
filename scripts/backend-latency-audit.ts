import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { presentCatalogueItems } from '../src/catalogue-grouping.js';
import { PreparationManager, type PreparationState } from '../src/preparations.js';
import { SerialQueue } from '../src/serial.js';
import { operation, playbackResolution } from '../src/operation.js';
import { MusicAssistantTransport } from '../src/music-assistant-transport.js';

// Synthetic fixtures only; no installed catalogue, credentials, speakers or private lists.
const elapsed = (start: number) => Math.round((performance.now() - start) * 10) / 10;
function gate() {
  let release!: () => void; let enter!: () => void;
  return { pending: new Promise<void>(resolve => { release = resolve; }), entered: new Promise<void>(resolve => { enter = resolve; }),
    release: () => release(), enter: () => enter() };
}
const grouping = [20, 200, 500, 1000, 2000].map(count => {
  const items = Array.from({ length: count }, (_, i) => ({ item_id: `album-${i}`, provider: i % 2 ? 'spotify' : 'tidal',
    name: 'Greatest Hits', version: '', artists: [{ name: 'Same Artist' }], external_ids: [] as [string, string][], provider_mappings: [] }));
  const samples = Array.from({ length: 3 }, () => { const start = performance.now(); presentCatalogueItems('album', items); return elapsed(start); });
  return { count, samplesMs: samples, medianMs: [...samples].sort((a, b) => a - b)[1] };
});

const queue = new SerialQueue(); const heldQueue = gate();
const first = queue.run(async () => { heldQueue.enter(); await heldQueue.pending; }); await heldQueue.entered;
const queuedAt = performance.now();
const timeout = operation('audit-queue', () => queue.run(async () => {}), 40).then(() => ({ expired: false, elapsedMs: elapsed(queuedAt) }), () => ({ expired: true, elapsedMs: elapsed(queuedAt) }));
await delay(250); heldQueue.release(); await first;
const queueDeadline = { budgetMs: 40, heldMs: 250, ...await timeout };

const states = new Map<string, PreparationState>();
const lists = new PreparationManager({ load: async id => structuredClone(states.get(id) ?? null), save: async state => { states.set(state.ownerId, structuredClone(state)); } });
const owner = await lists.createOwner(); const heldCapture = gate();
const capturing = lists.addCaptured(owner.credential, { id: randomUUID(), revision: 0, issuedAt: Date.now() }, 'synthetic-reference', async () => {
  heldCapture.enter(); await heldCapture.pending;
  return { source: 'demo', trackId: 'demo:aurora', metadata: { title: 'Fixture', artist: '', album: '', duration: 60, version: '', provider: 'Demo' } };
});
await heldCapture.entered; const readAt = performance.now();
const reading = lists.read(owner.credential).then(() => elapsed(readAt)); await delay(250); heldCapture.release(); await capturing;
const privateCapture = { heldMs: 250, readMs: await reading };

const heldSearches = gate(); let searches = 0;
const server = createServer(async (req, res) => {
  let raw = ''; for await (const chunk of req) raw += chunk;
  if (JSON.parse(raw).command === 'music/search') { if (++searches === 4) heldSearches.enter(); await heldSearches.pending; }
  res.setHeader('Content-Type', 'application/json'); res.end('{}');
});
server.listen(0, '127.0.0.1'); await once(server, 'listening');
const transport = new MusicAssistantTransport(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, 'synthetic-token');
let poolContention;
try {
  const pending = Array.from({ length: 4 }, () => transport.read('/api', 'music/search', {})); await heldSearches.entered;
  const started = performance.now();
  const resolving = playbackResolution(() => transport.read('/api', 'music/item_by_uri', {})).then(() => elapsed(started));
  await delay(250); heldSearches.release(); await Promise.all(pending);
  poolContention = { searches: 4, heldMs: 250, resolutionMs: await resolving };
} finally { heldSearches.release(); transport.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
console.log(JSON.stringify({ synthetic: true, grouping, queueDeadline, privateCapture, poolContention }, null, 2));
