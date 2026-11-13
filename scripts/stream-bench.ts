/** Loopback SSE payload/CPU/flush benchmark. No live services or browser required.
 * Run: node --import tsx scripts/stream-bench.ts */
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer, get } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createGunzip } from 'node:zlib';
import { randomUUID } from 'node:crypto';
import express from 'express';
import { EventStreams } from '../src/event-streams.js';
import { SpectrumBuffer } from '../src/spectrum.js';
import { PreparationManager, type PreparationStore } from '../src/preparations.js';

const frames: { event: 'spectrum' | 'preparation'; json: string }[] = [];
const spectrum = new SpectrumBuffer(); const epoch = randomUUID(); const roomId = randomUUID(); const participantId = randomUUID();
let next = 0; let seed = 42;
for (let tick = 0; tick < 300; tick++) {
  const now = 10_000 + tick * 200;
  while (next * 1000 / 60 <= now + 1500) {
    const at = next++ * 1000 / 60;
    spectrum.push({ at, bins: Array.from({ length: 24 }, () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed >>> 24; }) }, now);
  }
  frames.push({ event: 'spectrum', json: JSON.stringify({ epoch, roomId, participantId, active: true, sensitivity: .9, frames: spectrum.window(now, 0) }) });
}
let state: Awaited<ReturnType<PreparationStore['load']>> = null;
const manager = new PreparationManager({ load: async () => structuredClone(state), snapshot: async () => state, save: async value => { state = structuredClone(value); } });
const owner = await manager.createOwner();
for (let i = 0; i < 1000; i++) {
  const id = randomUUID();
  state!.entries.push({ id, state: i < 200 ? 'upcoming' : 'removed', addedAt: 1, ...(i >= 200 ? { removedAt: 2 } : {}), playbackIds: [],
    selection: { source: 'music-assistant', sourceBindingId: randomUUID(), recording: { itemId: `track-${i}`, provider: 'library', uri: `library://track/${i}`, version: '' },
      metadata: { title: `Representative song ${i}`, artist: 'Representative artist', album: 'Representative album', version: '', provider: 'library', duration: 240, artworkId: `image:${'b'.repeat(64)}` } } });
  if (i < 200) state!.order.push(id);
}
const list = JSON.stringify(await manager.read(owner.credential));

async function measure(label: string, frames: { event: 'spectrum' | 'preparation'; json: string }[], gzip: boolean, viewers: number) {
  const streams = new EventStreams(viewers, 'Full'); const sessions: ReturnType<EventStreams['reserve']>[] = [];
  const app = express(); app.get('/', (_req, res) => { const stream = streams.reserve(res); stream.open(); sessions.push(stream); });
  const server = createServer(app); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  let bytes = 0;
  const clients = await Promise.all(Array.from({ length: viewers }, async () => {
    const req = get(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, { headers: { 'Accept-Encoding': gzip ? 'gzip' : 'identity' } });
    const [res] = await once(req, 'response'); res.on('data', (chunk: Buffer) => { bytes += chunk.length; });
    const decoded = gzip ? res.pipe(createGunzip()) : res;
    let text = ''; decoded.setEncoding('utf8'); decoded.on('data', (chunk: string) => { text += chunk; });
    return { req, decoded, receive: async (expected: string) => { while (text.length < expected.length) await once(decoded, 'data'); assert.equal(text, expected); text = ''; } };
  }));
  const cpu = process.cpuUsage(); const started = performance.now(); const latencies: number[] = [];
  try {
    for (const frame of frames) {
      const sent = performance.now(); const expected = `event: ${frame.event}\ndata: ${frame.json}\n\n`;
      const delivered = clients.map(async client => { await client.receive(expected); latencies.push(performance.now() - sent); });
      for (const stream of sessions) stream.sendEncoded(frame.event, frame.json);
      await Promise.all(delivered);
    }
    const ended = clients.map(client => once(client.decoded, 'end')); streams.close(); await Promise.all(ended);
    const usage = process.cpuUsage(cpu); latencies.sort((a, b) => a - b);
    const round = (n: number) => +n.toFixed(3);
    console.log(JSON.stringify({ label, gzip, viewers, events: frames.length, payloadBytesPerViewer: bytes / viewers,
      ...(label === 'spectrum-60s' ? { kbpsPerViewer: round(bytes / viewers * 8 / 60_000) } : {}),
      cpuMs: round((usage.user + usage.system) / 1000), wallMs: round(performance.now() - started),
      deliveryP50Ms: round(latencies[Math.floor(latencies.length * .5)]!), deliveryP95Ms: round(latencies[Math.floor(latencies.length * .95)]!),
      deliveryMaxMs: round(latencies.at(-1)!) }));
  } finally { clients.forEach(client => client.req.destroy()); streams.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
}

for (const viewers of [1, 20]) for (const gzip of [false, true]) await measure('spectrum-60s', frames, gzip, viewers);
for (const gzip of [false, true]) await measure('list-1000', [{ event: 'preparation', json: list }], gzip, 1);
