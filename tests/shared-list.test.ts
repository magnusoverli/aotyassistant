import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import type { IncomingMessage } from 'node:http';
import { fetchSharedList, parseSharedList, publicAddress, sharedListLink, type SharedListTransport } from '../src/shared-list.js';
import { AppError } from '../src/model.js';

const token = 'AbCdEfGhIjKlMnOpQrStUv';
const song = { rank: 1, artist: 'Artist', album: 'Album', title: 'Song', trackNumber: 3, duration: 245,
  albumLinks: [{ service: 'spotify', url: 'https://open.spotify.com/album/4aawyAB9vmqN3uQ7FjRGTy' }] };
const shared = { format: 'sushe-listening-room', version: 1, list: { name: 'Best of 2025', year: 2025 },
  expiresAt: '2026-11-15T13:32:00.000Z', leftOut: { noPick: 2, disqualified: 1 }, songs: [song] };
const status = (code: number) => (error: unknown) => error instanceof AppError && error.status === code;

function response(statusCode: number, body: string, contentType = 'application/json; charset=utf-8') {
  return Object.assign(Readable.from([Buffer.from(body)]), { statusCode, headers: { 'content-type': contentType } }) as unknown as IncomingMessage;
}
function fixture(reply: () => IncomingMessage, addresses = [{ address: '93.184.216.34', family: 4 }]) {
  const connections: string[] = [];
  const transport: SharedListTransport = async (_url, address) => { connections.push(address.address); return reply(); };
  return { connections, options: { transport, resolve: async () => addresses } };
}

test('a share link is found in pasted text and reduced to its address', () => {
  assert.equal(sharedListLink(`Here it is: https://sushe.example/lr/${token}.`).href, `https://sushe.example/lr/${token}`);
  assert.equal(sharedListLink(`https://sushe.example/app/lr/${token}/?utm=chat#top`).href, `https://sushe.example/app/lr/${token}`);
  // A token may end with a dash; only punctuation around the link is dropped.
  assert.equal(sharedListLink(`(https://sushe.example/lr/AbCdEfGhIjKlMnOpQrSt-_)`).href, 'https://sushe.example/lr/AbCdEfGhIjKlMnOpQrSt-_');
  for (const input of ['', 'not a link', `http://sushe.example/lr/${token}`, `https://user:pass@sushe.example/lr/${token}`,
    'https://sushe.example/lr/short', `https://sushe.example/lists/${token}`]) assert.throws(() => sharedListLink(input), status(422), input);
});

test('only public internet addresses are contacted', () => {
  for (const address of ['93.184.216.34', '2606:2800:220:1:248:1893:25c8:1946']) assert.equal(publicAddress(address), true, address);
  for (const address of ['127.0.0.1', '10.0.0.5', '192.168.1.20', '172.16.4.1', '169.254.169.254', '100.64.0.1', '0.0.0.0',
    '::1', 'fd00::1', 'fe80::1', '::ffff:192.168.1.20', '224.0.0.1', 'not-an-ip']) assert.equal(publicAddress(address), false, address);
});

test('a shared list is read; songs that cannot be read are counted, not fatal', () => {
  const read = parseSharedList({ ...shared, extra: true, songs: [song, { rank: 2, artist: '', title: 'No artist' }, { ...song, rank: 3, duration: 'long', albumLinks: 'none' }] });
  assert.deepEqual(read.list, { name: 'Best of 2025', year: 2025 });
  assert.deepEqual(read.leftOut, { noPick: 2, disqualified: 1 });
  assert.equal(read.skipped, 1);
  assert.deepEqual(read.songs.map(item => [item.rank, item.duration, item.albumLinks.length]), [[1, 245, 1], [3, null, 0]]);
  assert.throws(() => parseSharedList({ ...shared, version: 2 }), (error: unknown) => error instanceof AppError && /newer SuShe Online/.test(error.message));
  assert.throws(() => parseSharedList({ list: shared.list, songs: [] }), status(502));
});

test('a working link returns the list over a checked address', async () => {
  const f = fixture(() => response(200, JSON.stringify(shared)), [{ address: '10.0.0.8', family: 4 }, { address: '93.184.216.34', family: 4 }]);
  const read = await fetchSharedList(sharedListLink(`https://sushe.example/lr/${token}`), f.options);
  assert.equal(read.songs[0]!.title, 'Song');
  // A home-network answer from DNS is skipped; only the public address is used.
  assert.deepEqual(f.connections, ['93.184.216.34']);
});

test('expired, redirected, oversized and private links are refused clearly', async () => {
  const link = sharedListLink(`https://sushe.example/lr/${token}`);
  await assert.rejects(fetchSharedList(link, fixture(() => response(404, '{"error":"not_found"}')).options),
    (error: unknown) => error instanceof AppError && error.status === 404 && /one week/.test(error.message));
  await assert.rejects(fetchSharedList(link, fixture(() => response(302, '')).options), status(422));
  await assert.rejects(fetchSharedList(link, fixture(() => response(500, '')).options), status(502));
  await assert.rejects(fetchSharedList(link, fixture(() => response(200, '<html></html>', 'text/html')).options), status(502));
  await assert.rejects(fetchSharedList(link, fixture(() => response(200, JSON.stringify({ ...shared, padding: 'x'.repeat(600 * 1024) }))).options),
    (error: unknown) => error instanceof AppError && /too large/.test(error.message));
  const home = fixture(() => response(200, JSON.stringify(shared)), [{ address: '192.168.1.20', family: 4 }]);
  await assert.rejects(fetchSharedList(link, home.options), status(422));
  assert.deepEqual(home.connections, []);
  await assert.rejects(fetchSharedList(sharedListLink(`https://127.0.0.1/lr/${token}`), fixture(() => response(200, '')).options), status(422));
});
