import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Engine } from '../src/engine.js';
import { DemoAdapter, type PlaybackAdapter } from '../src/playback.js';
import { FileStore, type Store } from '../src/store.js';
import { AppError, type State, type CatalogueProvider, type CatalogueTrack } from '../src/model.js';

class MemoryStore implements Store {
  state: State = { schema: 3, room: null };
  fail = false;
  async load() { return structuredClone(this.state); }
  async save(state: State) { if (this.fail) throw new Error(); this.state = structuredClone(state); }
}
async function fixture(catalogue?: CatalogueProvider) {
  const store = new MemoryStore(); const adapter = new DemoAdapter(3600);
  const engine = new Engine(store, adapter, 'http://localhost:3000', catalogue); await engine.init();
  const host = () => engine.view({ kind: 'host' });
  const alex = await engine.join('Alex'); const sam = await engine.join('Sam');
  const participant = (credential: string) => engine.view({ kind: 'participant', credential });
  const display = () => engine.view({ kind: 'display' });
  return { engine, adapter, store, host, alex, sam, participant, display };
}
const status = (code: number) => (error: unknown) => error instanceof AppError && error.status === code;

test('role serializers conceal metadata until reveal, and never disclose it to other participants', async t => {
  const f = await fixture(); t.after(() => f.adapter.close());
  await f.engine.play(f.alex, f.host().turnId!, null, 'demo:aurora');
  const own = f.participant(f.alex); const id = own.ownPlayback!.id;
  for (const data of [f.display(), f.participant(f.sam), f.host()]) {
    const json = JSON.stringify(data);
    for (const sensitive of ['Northern Lights', 'The Paper Satellites', '/demo-cover.svg', 'credentialHash']) assert.ok(!json.includes(sensitive));
  }
  assert.equal(own.ownPlayback!.track.title, 'Northern Lights');
  assert.deepEqual(f.host().hostPlayback, { id, status: 'playing', revealed: false });
  assert.equal(typeof f.host().progress?.fraction, 'number');
  assert.equal(f.host().progress?.duration, undefined); assert.equal(f.host().progress?.elapsed, undefined);
  assert.equal(f.participant(f.sam).hostPlayback, undefined); assert.equal(f.display().hostPlayback, undefined);
  await f.engine.reveal(f.alex, own.turnId!, id);
  assert.equal(f.display().nowPlaying!.revealed, true);
  assert.ok(JSON.stringify(f.display()).includes('Northern Lights'));
  assert.ok(!JSON.stringify(f.participant(f.sam)).includes('Northern Lights'));
  assert.equal(f.host().hostPlayback?.revealed, true); assert.equal(f.host().progress?.duration, 3600);
  assert.ok(!JSON.stringify(f.host()).includes('Northern Lights'));
  await f.engine.play(f.alex, own.turnId!, id, 'demo:aurora');
  assert.notEqual(f.participant(f.alex).ownPlayback!.id, id);
  assert.deepEqual(f.display().nowPlaying, { revealed: false });
  await assert.rejects(f.engine.reveal(f.alex, own.turnId!, id), status(409));
});

test('host stop keeps the turn, deduplicates repeated stops and rejects stale playback before touching audio', async t => {
  const f = await fixture(); t.after(() => f.adapter.close());
  const turn = f.host().turnId!;
  await f.engine.play(f.alex, turn, null, 'demo:aurora'); const id = f.host().hostPlayback!.id;
  await f.engine.control(f.alex, turn, id, 'pause');
  const order = f.host().rotation; let stops = 0; const control = f.adapter.control.bind(f.adapter);
  f.adapter.control = async action => { if (action === 'stop') stops++; await control(action); };
  await f.engine.stopForHost(turn, id); await f.engine.stopForHost(turn, id); await f.engine.complete(id);
  assert.equal(stops, 1); assert.equal(f.host().turnId, turn); assert.deepEqual(f.host().rotation, order);
  assert.equal(f.host().current!.nickname, 'Alex'); assert.equal(f.host().hostPlayback?.status, 'stopped');
  assert.equal(f.host().progress, undefined); assert.equal(f.participant(f.alex).ownPlayback?.status, 'stopped');
  await f.engine.play(f.alex, turn, id, 'demo:night'); const replacement = f.host().hostPlayback!.id;
  await assert.rejects(f.engine.stopForHost(turn, id), status(409)); assert.equal(stops, 1);
  await f.engine.advance(turn); const afterAdvance = stops;
  await assert.rejects(f.engine.stopForHost(turn, replacement), status(409)); assert.equal(stops, afterAdvance);
  assert.equal(f.host().current!.nickname, 'Sam');
});

test('host pause and resume preserve the turn, privacy and exact playback guards', async t => {
  const f = await fixture(); t.after(() => f.adapter.close());
  const turn = f.host().turnId!; await f.engine.play(f.alex, turn, null, 'demo:aurora');
  const id = f.host().hostPlayback!.id; const order = f.host().rotation;
  let calls = 0; const control = f.adapter.control.bind(f.adapter);
  f.adapter.control = async action => { calls++; await control(action); };
  await f.engine.controlForHost(turn, id, 'pause');
  assert.equal(f.host().hostPlayback!.status, 'paused'); assert.equal(f.participant(f.alex).ownPlayback!.status, 'paused');
  assert.equal(f.host().turnId, turn); assert.deepEqual(f.host().rotation, order);
  assert.ok(!JSON.stringify(f.host()).includes('Northern Lights')); assert.equal(f.host().ownPlayback, undefined);
  await f.engine.controlForHost(turn, id, 'resume'); assert.equal(f.host().hostPlayback!.status, 'playing');
  await assert.rejects(f.engine.controlForHost(turn, crypto.randomUUID(), 'pause'), status(409)); assert.equal(calls, 2);
  await f.engine.stopForHost(turn, id);
  await assert.rejects(f.engine.controlForHost(turn, id, 'resume'), status(409)); assert.equal(calls, 3);
  await f.engine.advance(turn);
  const afterAdvance = calls;
  await assert.rejects(f.engine.controlForHost(turn, id, 'pause'), status(409)); assert.equal(calls, afterAdvance);
});

test('a rejected host pause never reports a paused track or changes the turn', async t => {
  const f = await fixture(); t.after(() => f.adapter.close());
  const turn = f.host().turnId!; await f.engine.play(f.alex, turn, null, 'demo:aurora'); const before = f.host();
  f.adapter.control = async () => { throw new AppError(503, 'Pause could not be confirmed.'); };
  await assert.rejects(f.engine.controlForHost(turn, before.hostPlayback!.id, 'pause'), status(503));
  assert.equal(f.host().revision, before.revision); assert.equal(f.host().hostPlayback!.status, 'playing'); assert.equal(f.host().turnId, turn);
});

test('host stop and natural completion serialize without stopping or advancing a subsequent turn', async t => {
  for (const stopFirst of [true, false]) {
    const f = await fixture(); t.after(() => f.adapter.close());
    const turn = f.host().turnId!; await f.engine.play(f.alex, turn, null, 'demo:aurora'); const id = f.host().hostPlayback!.id;
    const results = await Promise.allSettled(stopFirst
      ? [f.engine.stopForHost(turn, id), f.engine.complete(id)]
      : [f.engine.complete(id), f.engine.stopForHost(turn, id)]);
    assert.equal(results[0]!.status, 'fulfilled');
    assert.equal(results[1]!.status, stopFirst ? 'fulfilled' : 'rejected');
    assert.equal(f.host().current!.nickname, stopFirst ? 'Alex' : 'Sam');
    if (stopFirst) assert.equal(f.host().turnId, turn);
    await f.engine.complete(id); assert.equal(f.host().current!.nickname, stopFirst ? 'Alex' : 'Sam');
  }
});

test('an unconfirmed host stop preserves playback state and turn instead of reporting success', async t => {
  const f = await fixture(); t.after(() => f.adapter.close());
  const turn = f.host().turnId!; await f.engine.play(f.alex, turn, null, 'demo:aurora'); const before = f.host();
  f.adapter.control = async () => { throw new AppError(503, 'Stop could not be confirmed.'); };
  await assert.rejects(f.engine.stopForHost(turn, before.hostPlayback!.id), status(503));
  assert.equal(f.host().revision, before.revision); assert.equal(f.host().turnId, turn);
  assert.equal(f.host().hostPlayback?.status, 'playing');
  f.adapter.connected = false;
  assert.equal(f.host().hostPlayback, null); assert.equal(f.host().progress, undefined);
});

test('non-current participants may search, but cannot play, control, reveal, or finish', async t => {
  const f = await fixture(); t.after(() => f.adapter.close());
  const turn = f.host().turnId!;
  await f.engine.play(f.alex, turn, null, 'demo:aurora');
  const id = f.participant(f.alex).ownPlayback!.id;
  assert.equal((await f.engine.search(f.sam, turn, 'Night')).tracks.length, 1);
  for (const work of [
    () => f.engine.play(f.sam, turn, id, 'demo:night'),
    () => f.engine.control(f.sam, turn, id, 'stop'), () => f.engine.reveal(f.sam, turn, id),
    () => f.engine.advance(turn, f.sam),
  ]) await assert.rejects(work(), status(403));
});

test('two simultaneous advances result in exactly one transition', async t => {
  const f = await fixture(); t.after(() => f.adapter.close());
  const turn = f.host().turnId!;
  const results = await Promise.allSettled([f.engine.advance(turn), f.engine.advance(turn, f.alex)]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(f.host().current!.nickname, 'Sam');
  await assert.rejects(f.engine.reveal(f.alex, turn, crypto.randomUUID()), status(409));
});

test('a stale polled status cannot overwrite a newer explicit transport command', async t => {
  const f = await fixture(); t.after(() => f.adapter.close());
  await f.engine.play(f.alex, f.host().turnId!, null, 'demo:aurora'); const id = f.participant(f.alex).ownPlayback!.id;
  const original = f.adapter.control.bind(f.adapter);
  f.adapter.control = async action => { (f.adapter as PlaybackAdapter).onStatus?.(id, 'paused'); await original(action); };
  await f.engine.control(f.alex, f.host().turnId!, id, 'resume');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.participant(f.alex).ownPlayback!.status, 'playing');
});

test('late playback callbacks cannot conceal a replacement or revive a stopped track', async t => {
  const f = await fixture(); t.after(() => f.adapter.close());
  const turn = f.host().turnId!;
  await f.engine.play(f.alex, turn, null, 'demo:aurora');
  const previous = f.participant(f.alex).ownPlayback!.id;
  await f.engine.play(f.alex, turn, previous, 'demo:night');
  const current = f.participant(f.alex).ownPlayback!.id;
  await f.engine.reveal(f.alex, turn, current);
  (f.adapter as PlaybackAdapter).onInvalidated?.(previous, 'Delayed old callback');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.display().nowPlaying?.revealed, true);
  await f.engine.control(f.alex, turn, current, 'stop');
  (f.adapter as PlaybackAdapter).onStatus?.(current, 'playing');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.participant(f.alex).ownPlayback!.status, 'stopped');
});

test('a replacement rejected before touching playback retains the previous reveal and progress', async t => {
  const f = await fixture(); t.after(() => f.adapter.close());
  const turn = f.host().turnId!;
  await f.engine.play(f.alex, turn, null, 'demo:aurora');
  const id = f.participant(f.alex).ownPlayback!.id;
  await f.engine.reveal(f.alex, turn, id);
  f.adapter.play = async () => { throw new AppError(422, 'Preflight rejected'); };
  await assert.rejects(f.engine.play(f.alex, turn, id, 'demo:night'), status(422));
  assert.equal(f.display().nowPlaying?.revealed, true);
  assert.equal(f.display().progress?.id, id);
});

test('completion is deduplicated and races safely with host advancement', async t => {
  const f = await fixture(); t.after(() => f.adapter.close());
  const turn = f.host().turnId!;
  await f.engine.play(f.alex, turn, null, 'demo:aurora');
  const id = f.participant(f.alex).ownPlayback!.id;
  await Promise.allSettled([f.engine.complete(id), f.engine.advance(turn), f.engine.complete(id)]);
  assert.equal(f.host().current!.nickname, 'Sam');
  assert.deepEqual(f.display().nowPlaying, { revealed: false });
  await f.engine.complete(id); assert.equal(f.host().current!.nickname, 'Sam');
});

test('pause, explicit stop, and stale playback completion never advance', async t => {
  const f = await fixture(); t.after(() => f.adapter.close());
  const turn = f.host().turnId!;
  await f.engine.play(f.alex, turn, null, 'demo:aurora');
  const id = f.participant(f.alex).ownPlayback!.id;
  await f.engine.control(f.alex, turn, id, 'pause'); await f.engine.complete(id);
  assert.equal(f.host().current!.nickname, 'Alex');
  await f.engine.control(f.alex, turn, id, 'resume');
  await f.engine.control(f.alex, turn, id, 'stop'); await f.engine.complete(id);
  assert.equal(f.host().current!.nickname, 'Alex');
  await f.engine.play(f.alex, turn, id, 'demo:night');
  await f.engine.complete(id); assert.equal(f.host().current!.nickname, 'Alex');
});

test('late joins and reordering preserve current; removal chooses a deterministic successor', async t => {
  const f = await fixture(); t.after(() => f.adapter.close());
  const turn = f.host().turnId!;
  await f.engine.join('Jordan');
  assert.deepEqual(f.host().active!.map(person => person.nickname), ['Alex', 'Sam', 'Jordan']);
  assert.equal(f.host().current!.nickname, 'Alex'); assert.equal(f.host().turnId, turn);
  const ids = f.host().active!.map(p => p.id).reverse();
  await f.engine.reorder(ids, f.host().revision);
  assert.equal(f.host().current!.nickname, 'Alex');
  const successor = f.host().next!.nickname;
  await f.engine.remove(f.host().current!.id, f.host().revision);
  assert.equal(f.host().current!.nickname, successor);
  for (const p of [...f.host().active!]) await f.engine.remove(p.id, f.host().revision);
  assert.equal(f.host().current, null); assert.equal(f.host().next, null);
  await f.engine.join('New arrival');
  assert.equal(f.host().current!.nickname, 'New arrival');
});

test('rejoin preserves identity; removal revokes membership but leaves the display open', async t => {
  const f = await fixture(); t.after(() => f.adapter.close());
  const original = f.participant(f.alex).me!.id;
  await f.engine.join('Changed', f.alex);
  assert.equal(f.participant(f.alex).me!.id, original); assert.equal(f.host().active!.length, 2);
  await f.engine.remove(original, f.host().revision);
  assert.throws(() => f.participant(f.alex), status(401)); assert.doesNotThrow(f.display);
  const replacement = await f.engine.join('Alex', f.alex); assert.notEqual(replacement, f.alex);
  assert.notEqual(f.participant(replacement).me!.id, original);
});

test('unsupported tracks and invalid requests preserve state; uncertain connectivity blocks mutations', async t => {
  const f = await fixture(); t.after(() => f.adapter.close());
  const before = f.host();
  await assert.rejects(f.engine.play(f.alex, before.turnId!, null, 'https://spotify.com/track/anything'), status(422));
  await assert.rejects(f.engine.reorder([before.current!.id, before.current!.id], before.revision), status(400));
  assert.deepEqual(f.host(), before);
  f.adapter.connected = false;
  await assert.rejects(f.engine.advance(before.turnId!), status(503));
  assert.equal(f.host().current!.nickname, 'Alex');
});

test('storage failures fail closed, stop playback, and do not commit a turn transition', async t => {
  const f = await fixture(); t.after(() => f.adapter.close());
  f.store.fail = true;
  await assert.rejects(f.engine.advance(f.host().turnId!), status(503));
  assert.equal(f.host().connected, false); assert.equal(f.host().current!.nickname, 'Alex');
  await assert.rejects(f.engine.advance(f.host().turnId!), status(503));
});

test('a reservation rejected after slow resolution releases only the prepared selection and sends no Play', async t => {
  const f = await fixture(); t.after(() => f.adapter.close());
  let release!: () => void; let entered!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; }); const resolving = new Promise<void>(resolve => { entered = resolve; });
  const resolve = f.adapter.resolve.bind(f.adapter); let discarded = 0; let plays = 0;
  f.adapter.resolve = async id => { entered(); await held; return resolve(id); };
  (f.adapter as PlaybackAdapter).discardSelection = () => { discarded++; };
  f.adapter.play = async () => { plays++; };
  t.after(() => release());
  const playing = assert.rejects(f.engine.play(f.alex, f.host().turnId!, null, 'demo:aurora'), status(503));
  await resolving; f.store.fail = true; await assert.rejects(f.engine.join('Storage failure'), status(503));
  release(); await playing; assert.equal(discarded, 1); assert.equal(plays, 0);
});

test('restart restores membership/order, but not playback, reveal, or old action identities', async t => {
  const f = await fixture(); t.after(() => f.adapter.close());
  const turn = f.host().turnId!;
  await f.engine.play(f.alex, turn, null, 'demo:aurora');
  const id = f.participant(f.alex).ownPlayback!.id; await f.engine.reveal(f.alex, turn, id);
  f.adapter.close();
  const adapter = new DemoAdapter(); t.after(() => adapter.close());
  const recovered = new Engine(f.store, adapter, 'http://localhost:3000'); await recovered.init();
  assert.equal(recovered.view({ kind: 'participant', credential: f.alex }).me!.nickname, 'Alex');
  assert.equal(recovered.view({ kind: 'host' }).current!.nickname, 'Alex');
  assert.equal(recovered.view({ kind: 'participant', credential: f.alex }).ownPlayback, null);
  assert.notEqual(recovered.view({ kind: 'host' }).turnId, turn);
  await recovered.complete(id); assert.equal(recovered.view({ kind: 'host' }).current!.nickname, 'Alex');
});

test('file store persists privately and refuses to overwrite malformed saved state', async () => {
  const directory = await mkdtemp('/tmp/opencode/aoty-store-'); const store = new FileStore(directory);
  const state: State = { schema: 3, room: null }; await store.save(state);
  assert.deepEqual(await store.load(), state);
  assert.equal((await stat(join(directory, 'state.json'))).mode & 0o777, 0o600);
  await writeFile(join(directory, 'state.json'), 'broken json');
  await assert.rejects(store.load());
  assert.equal(await readFile(join(directory, 'state.json'), 'utf8'), 'broken json');
});

test('demo adapter emits actual timer completion but not stop/pause completion', async t => {
  const adapter = new DemoAdapter(.03); t.after(() => adapter.close());
  const ids: string[] = []; adapter.onComplete = id => ids.push(id);
  await adapter.play(await adapter.resolve('demo:night'), 'first'); await adapter.control('pause');
  await new Promise(resolve => setTimeout(resolve, 50)); assert.deepEqual(ids, []);
  await adapter.control('resume'); await new Promise(resolve => setTimeout(resolve, 50));
  assert.deepEqual(ids, ['first']);
  await adapter.play(await adapter.resolve('demo:night'), 'second'); await adapter.control('stop');
  await new Promise(resolve => setTimeout(resolve, 50)); assert.deepEqual(ids, ['first']);
});

test('actual demo completion stops and advances the authoritative engine once', async t => {
  const f = await fixture(); t.after(() => f.adapter.close());
  f.adapter.catalogue[0]!.duration = .02;
  await f.engine.play(f.alex, f.host().turnId!, null, 'demo:aurora');
  const id = f.participant(f.alex).ownPlayback!.id;
  await new Promise(resolve => setTimeout(resolve, 80));
  assert.equal(f.host().current!.nickname, 'Sam');
  await f.engine.complete(id); assert.equal(f.host().current!.nickname, 'Sam');
});

test('stable room links and membership survive restart without invitation expiry', async t => {
  const f = await fixture(); t.after(() => f.adapter.close());
  const adapter = new DemoAdapter(); t.after(() => adapter.close());
  const engine = new Engine(f.store, adapter, 'http://localhost:3000'); await engine.init();
  await engine.join('Jordan');
  assert.equal(await engine.join('Alex', f.alex), f.alex);
  assert.equal(engine.view({ kind: 'host' }).joinUrl, 'http://localhost:3000/join');
  assert.equal(engine.view({ kind: 'host' }).displayUrl, 'http://localhost:3000/display');
});

test('stale host mutations are rejected after a room change', async t => {
  const f = await fixture(); t.after(() => f.adapter.close());
  const oldRevision = f.host().revision;
  await f.engine.join('Jordan');
  assert.ok(f.host().revision > oldRevision);
  await assert.rejects(f.engine.remove(f.host().current!.id, oldRevision), status(409));
  assert.equal(f.host().active!.length, 3);
});

test('connected catalogue search is private for every member and cannot play without a configured destination', async t => {
  const track: CatalogueTrack = { id: 'ma:opaque', title: 'Private catalogue result', artist: 'Private artist', album: 'Private album', version: 'Live', provider: 'spotify', duration: 180, available: true };
  let calls = 0;
  const f = await fixture({ configured: true, async search() { calls++; return [track]; } }); t.after(() => f.adapter.close());
  let events = 0; f.engine.on('change', () => events++);
  assert.equal((await f.engine.search(f.sam, f.host().turnId!, 'query')).tracks.length, 1); assert.equal(calls, 1);
  const result = await f.engine.search(f.alex, f.host().turnId!, 'query');
  assert.equal(result.source, 'music-assistant'); assert.equal(result.playbackAvailable, false); assert.deepEqual(result.tracks, [track]);
  assert.equal(calls, 2); assert.equal(events, 0);
  for (const view of [f.host(), f.display(), f.participant(f.sam), f.participant(f.alex), f.store.state]) {
    assert.ok(!JSON.stringify(view).includes(track.title));
  }
  assert.equal(f.participant(f.alex).catalogue!.source, 'music-assistant');
  assert.equal(f.participant(f.sam).catalogue!.source, 'music-assistant');
  for (const id of ['ma:opaque', 'demo:aurora']) await assert.rejects(f.engine.play(f.alex, f.host().turnId!, null, id), status(422));
  assert.equal(f.participant(f.alex).ownPlayback, null);
});

test('private browsing survives turn changes but cannot cross connection or membership changes', async t => {
  let resolveSearch!: (tracks: CatalogueTrack[]) => void;
  const catalogue = { configured: true, catalogueRevision: 'catalogue-a', configurationRevision: 'routing-a', playbackAvailable: true,
    search: () => new Promise<CatalogueTrack[]>(resolve => { resolveSearch = resolve; }) };
  const f = await fixture(catalogue); t.after(() => f.adapter.close());
  const result = f.engine.search(f.alex, f.host().turnId!, 'query');
  await f.engine.advance(f.host().turnId!); resolveSearch([]);
  assert.deepEqual((await result).tracks, []);
  const changedDestination = f.engine.search(f.sam, f.host().turnId!, 'query');
  catalogue.configurationRevision = 'routing-b'; catalogue.playbackAvailable = false; resolveSearch([]);
  assert.equal((await changedDestination).playbackAvailable, false, 'Routing changes must preserve results with fresh playback availability.');
  const changedCredentials = f.engine.search(f.sam, f.host().turnId!, 'query');
  catalogue.catalogueRevision = 'catalogue-b'; resolveSearch([]); await assert.rejects(changedCredentials, status(409));
  const changedSource = f.engine.search(f.sam, f.host().turnId!, 'query');
  catalogue.configured = false; resolveSearch([]); await assert.rejects(changedSource, status(409));
  catalogue.configured = true;
  const removed = f.engine.search(f.alex, f.host().turnId!, 'query');
  await f.engine.remove(f.participant(f.alex).me!.id, f.host().revision); resolveSearch([]);
  await assert.rejects(removed, status(401));
});

test('search failures never silently fall back to the demo catalogue', async t => {
  const f = await fixture({ configured: true, async search() { throw new AppError(502, 'Music Assistant search unavailable.'); } }); t.after(() => f.adapter.close());
  await assert.rejects(f.engine.search(f.alex, f.host().turnId!, 'Northern'), status(502));
  assert.equal(f.host().current!.nickname, 'Alex');
});

test('role-filtered rotation positions stay authoritative through wrapping, reordering, direct joining, and removal', async t => {
  const f = await fixture(); t.after(() => f.adapter.close());
  assert.deepEqual(f.participant(f.alex).position, { seat: 1, total: 2, turnsUntil: 0 });
  assert.deepEqual(f.participant(f.sam).position, { seat: 2, total: 2, turnsUntil: 1 });
  assert.deepEqual(f.display().rotation, f.host().active);
  assert.equal(f.display().position, undefined); assert.equal(f.host().position, undefined);
  await f.engine.advance(f.host().turnId!);
  assert.deepEqual(f.participant(f.alex).position, { seat: 1, total: 2, turnsUntil: 1 });
  assert.deepEqual(f.participant(f.sam).position, { seat: 2, total: 2, turnsUntil: 0 });
  const current = f.host().current!.id; const turn = f.host().turnId;
  await f.engine.reorder(f.host().active!.map(p => p.id).reverse(), f.host().revision);
  assert.equal(f.host().current!.id, current); assert.equal(f.host().turnId, turn);
  assert.equal(f.participant(f.sam).position!.seat, 1);
  const jordan = await f.engine.join('Jordan');
  assert.deepEqual(f.participant(jordan).position, { seat: 3, total: 3, turnsUntil: 2 });
  assert.ok(f.display().rotation!.some(p => p.nickname === 'Jordan'));
  await f.engine.reorder([f.participant(f.sam).me!.id, f.participant(jordan).me!.id, f.participant(f.alex).me!.id], f.host().revision);
  assert.equal(f.host().current!.id, current);
  assert.deepEqual(f.participant(jordan).position, { seat: 2, total: 3, turnsUntil: 1 });
  await f.engine.remove(current, f.host().revision);
  assert.equal(f.host().current!.nickname, 'Jordan');
  assert.deepEqual(f.participant(jordan).position, { seat: 1, total: 2, turnsUntil: 0 });
  assert.deepEqual(f.participant(f.alex).position, { seat: 2, total: 2, turnsUntil: 1 });
  for (const person of f.display().rotation!) assert.deepEqual(Object.keys(person).sort(), ['id', 'nickname']);
});

test('empty persistent rooms and single-person circles have a valid first turn without host startup', async t => {
  const f = await fixture(); t.after(() => f.adapter.close());
  for (const person of f.host().active!) await f.engine.remove(person.id, f.host().revision);
  const person = await f.engine.join('Solo');
  assert.deepEqual(f.participant(person).position, { seat: 1, total: 1, turnsUntil: 0 });
  await f.engine.advance(f.host().turnId!);
  assert.equal(f.participant(person).position!.turnsUntil, 0);
});
