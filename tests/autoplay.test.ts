import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { Engine } from '../src/engine.js';
import type { Store } from '../src/store.js';
import { DemoAdapter } from '../src/playback.js';
import { PreparationManager, preparationStateSchema, type PreparationState, type PreparationStore, type PreparationView, type SavedSelection } from '../src/preparations.js';
import { attachAutoplay } from '../src/autoplay.js';
import { AppError, stateSchema, type State, type Track, type AutoplayTarget } from '../src/model.js';

class MemoryRoom implements Store {
  state: State = { schema: 3, room: null };
  async load() { return stateSchema.parse(structuredClone(this.state)); }
  async save(state: State) { this.state = stateSchema.parse(structuredClone(state)); }
}
class MemoryLists implements PreparationStore {
  states = new Map<string, PreparationState>();
  async load(id: string) { return structuredClone(this.states.get(id) ?? null); }
  async save(state: PreparationState) { this.states.set(state.ownerId, preparationStateSchema.parse(structuredClone(state))); }
}

// Demo catalogue titles: demo:aurora "Northern Lights", demo:summer "Late Summer", demo:night "Night Bus Home".
const song = (trackId: string): SavedSelection => ({ source: 'demo', trackId,
  metadata: { title: `Saved ${trackId}`, artist: 'Private artist', album: 'Private album', version: '', provider: 'Demo', duration: 100 } });

/** A speaker that records what it was asked to play and ends songs only when told to. */
class Speaker extends DemoAdapter {
  plays: { id: string; title: string }[] = []; controls: string[] = [];
  failResolve = false; failPlay = false; lookup?: Promise<void>; looking?: () => void;
  override async resolveSaved(selection: SavedSelection, context: string, trackId: string) {
    this.looking?.(); await this.lookup;
    if (this.failResolve) throw new AppError(422, 'This song is unavailable.');
    return super.resolveSaved(selection, context, trackId);
  }
  override async play(track: Track, id: string) {
    if (this.failPlay) throw new AppError(502, 'Play could not be confirmed.');
    this.plays.push({ id, title: track.title });
  }
  override async control(action: 'pause' | 'resume' | 'stop') { this.controls.push(action); }
  /** Music Assistant confirms the current song ended naturally. */
  end() { this.onComplete(this.plays.at(-1)!.id); }
}

/** Signed-in users, each with one private list. The user manager itself is covered in users.test.ts. */
async function fixture(t: TestContext, names = ['Alex', 'Blair']) {
  const store = new MemoryRoom(); const speaker = new Speaker(100);
  const engine = new Engine(store, speaker, 'http://localhost:3000'); await engine.init();
  const lists = new PreparationManager(new MemoryLists());
  const people: { id: string; nickname: string; token: string; ownerId: string; list: string; add: (trackId: string) => Promise<string>; view: () => ReturnType<Engine['view']> }[] = [];
  const deleted = new Set<string>();
  engine.attachUsers(token => { const person = people.find(item => item.token === token); return person && { id: person.id, nickname: person.nickname, pinRequired: false }; });
  attachAutoplay(engine, lists, { listOwner: userId => people.find(item => item.id === userId)?.ownerId, ownerAvailable: ownerId => !deleted.has(ownerId) });
  const settle = async () => { await engine.drain(); await lists.drain(); };
  t.after(async () => { engine.beginShutdown(); await settle(); speaker.close(); });
  for (const nickname of names) {
    const owner = await lists.createOwner(); const token = randomBytes(32).toString('base64url'); const list = owner.credential;
    const add = async (trackId: string) => (await lists.add(list, { id: randomUUID(), revision: (await lists.read(list)).revision, issuedAt: Date.now() }, song(trackId))).entryId;
    const person = { id: randomUUID(), nickname, token, ownerId: owner.view.ownerId, list, add, view: () => engine.view({ kind: 'participant', credential: token }) };
    people.push(person); await engine.joinUser(person.id, token);
  }
  const host = () => engine.view({ kind: 'host' });
  /** The first person starts the round with a search result, not a saved song. */
  const start = () => engine.play(people[0]!.token, host().turnId!, null, 'demo:night');
  const titles = () => speaker.plays.map(play => play.title);
  return { store, speaker, engine, lists, people, deleted, host, settle, start, titles };
}

test('automatic play is off by default: a finished song passes the turn and the next person chooses', async t => {
  const f = await fixture(t); const [, blair] = f.people;
  const saved = await blair!.add('demo:summer');
  assert.deepEqual(f.engine.autoplaySettings(), { mode: 'off', revision: 0 });
  await f.start(); f.speaker.end(); await f.settle();
  assert.equal(f.host().current?.id, blair!.id); assert.equal(f.host().hostPlayback, null);
  assert.deepEqual(f.titles(), ['Night Bus Home']);
  const list = await f.lists.read(blair!.list);
  assert.deepEqual(list.upcoming.map(entry => entry.id), [saved]); assert.equal(list.reviewEntryId, undefined);
});

test('when on, a natural ending starts the next person’s first saved song, records it as played and keeps it private', async t => {
  const f = await fixture(t, ['Alex', 'Blair', 'Casey']); const [alex, blair, casey] = f.people;
  const first = await blair!.add('demo:summer'); const second = await blair!.add('demo:aurora');
  assert.deepEqual(await f.engine.setAutoplay('next-participant', 0), { mode: 'next-participant', revision: 1 });
  assert.deepEqual(f.titles(), [], 'Switching it on never starts music.');
  await f.start(); f.speaker.end(); await f.settle();
  const host = f.host();
  assert.equal(host.current?.id, blair!.id); assert.equal(host.hostPlayback?.status, 'playing'); assert.equal(host.hostPlayback?.revealed, false);
  assert.deepEqual(f.titles(), ['Night Bus Home', 'Late Summer']); assert.equal(f.speaker.plays[1]!.id, host.hostPlayback!.id);
  const own = blair!.view();
  assert.equal(own.myTurn, true); assert.equal(own.ownPlayback?.track.title, 'Late Summer');
  assert.equal(f.engine.view({ kind: 'display' }).nowPlaying?.revealed, false);
  for (const view of [host, f.engine.view({ kind: 'display' }), alex!.view(), casey!.view()]) {
    for (const secret of ['Late Summer', 'Saved demo:summer', 'Private artist']) assert.ok(!JSON.stringify(view).includes(secret));
  }
  const list = await f.lists.read(blair!.list);
  assert.deepEqual(list.upcoming.map(entry => entry.id), [second]);
  assert.equal(list.played[0]!.id, first); assert.equal(list.played[0]!.playCount, 1);
  assert.equal(list.reviewEntryId, undefined); assert.equal(list.starting, undefined);
});

test('the round keeps going in listening order until someone has no song ready', async t => {
  const f = await fixture(t); const [alex, blair] = f.people;
  await alex!.add('demo:aurora'); await blair!.add('demo:summer'); await blair!.add('demo:night');
  await f.engine.setAutoplay('next-participant', 0);
  await f.start();
  for (let i = 0; i < 4; i++) { f.speaker.end(); await f.settle(); }
  assert.deepEqual(f.titles(), ['Night Bus Home', 'Late Summer', 'Northern Lights', 'Night Bus Home']);
  // Alex's playlist is now empty: the turn waits for them, with nothing playing.
  assert.equal(f.host().current?.id, alex!.id); assert.equal(f.host().hostPlayback, null);
  assert.equal((await f.lists.read(alex!.list)).upcoming.length, 0);
  assert.equal((await f.lists.read(blair!.list)).played.length, 2);
});

for (const mode of ['next-participant', 'same-participant'] as const) test(`${mode}: Finish turn, Skip turn and Stop song never start the next song`, async t => {
  const f = await fixture(t); const [alex, blair] = f.people;
  await alex!.add('demo:aurora'); await blair!.add('demo:summer');
  await f.engine.setAutoplay(mode, 0);
  await f.start(); await f.engine.advance(f.host().turnId!, alex!.token); await f.settle();
  assert.equal(f.host().current?.id, blair!.id); assert.equal(f.host().hostPlayback, null);
  await f.engine.advance(f.host().turnId!); await f.settle();
  assert.equal(f.host().current?.id, alex!.id); assert.equal(f.host().hostPlayback, null);
  await f.start(); await f.engine.stopForHost(f.host().turnId!, f.host().hostPlayback!.id);
  f.speaker.end(); await f.settle(); // A late "ended" for a stopped song is not a natural ending.
  assert.equal(f.host().current?.id, alex!.id);
  assert.deepEqual(f.titles(), ['Night Bus Home', 'Night Bus Home']);
  assert.equal((await f.lists.read(blair!.list)).upcoming.length, 1); assert.equal((await f.lists.read(alex!.list)).upcoming.length, 1);
});

test('switching it off during the lookup cancels the start; every device sees "starting", never a review', async t => {
  const f = await fixture(t); const [, blair] = f.people;
  const saved = await blair!.add('demo:summer'); await f.engine.setAutoplay('next-participant', 0);
  const seen: PreparationView[] = [];
  const unsubscribe = await f.lists.subscribe(blair!.list, view => { if (view) seen.push(view); }); t.after(unsubscribe);
  let release!: () => void; f.speaker.lookup = new Promise(resolve => { release = resolve; });
  const looking = new Promise<void>(resolve => { f.speaker.looking = resolve; });
  await f.start(); f.speaker.end(); await looking;
  const during = await f.lists.read(blair!.list);
  assert.equal(during.reviewEntryId, saved); assert.equal(during.starting, true);
  await f.engine.setAutoplay('off', 1); release(); await f.settle();
  assert.deepEqual(f.titles(), ['Night Bus Home']); assert.equal(f.host().current?.id, blair!.id); assert.equal(f.host().hostPlayback, null);
  const list = await f.lists.read(blair!.list);
  assert.deepEqual(list.upcoming.map(entry => entry.id), [saved]); assert.equal(list.played.length, 0);
  assert.equal(list.reviewEntryId, undefined); assert.equal(list.starting, undefined);
  assert.ok(seen.some(view => view.starting), 'The reservation reached the person’s devices as a start in progress.');
  assert.ok(!seen.some(view => view.reviewEntryId && !view.starting), 'No device was asked to review an automatic start.');
});

test('a song that cannot be looked up stays first without a review; an uncertain start keeps the usual review', async t => {
  const f = await fixture(t); const [alex, blair] = f.people;
  const blairs = await blair!.add('demo:summer'); const alexs = await alex!.add('demo:aurora');
  await f.engine.setAutoplay('next-participant', 0);
  f.speaker.failResolve = true;
  await f.start(); f.speaker.end(); await f.settle();
  assert.equal(f.host().current?.id, blair!.id); assert.equal(f.host().hostPlayback, null);
  let list = await f.lists.read(blair!.list);
  assert.deepEqual(list.upcoming.map(entry => entry.id), [blairs]); assert.equal(list.reviewEntryId, undefined);
  // Blair plays something else; when it ends, the speaker fails to confirm Alex's song.
  f.speaker.failResolve = false;
  await f.engine.play(blair!.token, f.host().turnId!, null, 'demo:night');
  f.speaker.failPlay = true; const controls = f.speaker.controls.length;
  f.speaker.end(); await f.settle();
  assert.equal(f.host().current?.id, alex!.id); assert.equal(f.host().hostPlayback, null);
  assert.deepEqual(f.speaker.controls.slice(controls), ['stop'], 'Only the ended song is stopped; the failed Play is never retried.');
  list = await f.lists.read(alex!.list);
  assert.deepEqual(list.upcoming.map(entry => entry.id), [alexs]); assert.equal(list.reviewEntryId, alexs); assert.equal(list.starting, undefined);
});

test('a user being deleted is skipped: their list is never opened and the turn waits', async t => {
  const f = await fixture(t); const [, blair] = f.people;
  const saved = await blair!.add('demo:summer'); await f.engine.setAutoplay('next-participant', 0);
  f.deleted.add(blair!.ownerId);
  await f.start(); f.speaker.end(); await f.settle();
  assert.deepEqual(f.titles(), ['Night Bus Home']); assert.equal(f.host().current?.id, blair!.id); assert.equal(f.host().hostPlayback, null);
  f.deleted.clear();
  const list = await f.lists.read(blair!.list);
  assert.deepEqual(list.upcoming.map(entry => entry.id), [saved]); assert.equal(list.reviewEntryId, undefined);
});

test('the setting survives a restart, rejects stale changes and is independent of automatic reveal', async t => {
  const f = await fixture(t);
  await f.engine.setAutoplay('next-participant', 0);
  await assert.rejects(f.engine.setAutoplay('off', 0), /settings changed/);
  const restored = new Engine(f.store, new DemoAdapter(100), 'http://localhost:3000'); await restored.init();
  t.after(() => restored.adapter.close());
  assert.deepEqual(restored.autoplaySettings(), { mode: 'next-participant', revision: 1 });
  assert.deepEqual(restored.playbackSettings(), { enabled: true, revision: 0 });
  assert.equal(restored.view({ kind: 'host' }).hostPlayback, null, 'A restart never resumes or starts audio.');
});

test('same-participant mode drains only their upcoming playlist, resets reveal, and waits on their empty list', async t => {
  const f = await fixture(t); const [alex, blair] = f.people;
  const first = await alex!.add('demo:summer'); const second = await alex!.add('demo:aurora');
  const other = await blair!.add('demo:night');
  await f.engine.setAutoplay('same-participant', 0);
  assert.deepEqual(f.titles(), [], 'Choosing the mode never starts music.');
  await f.start();
  const order = f.engine.listeningOrder().rotation;
  const ended = f.host().hostPlayback!.id;
  await f.engine.reveal(alex!.token, f.host().turnId!, ended);
  // Duplicate completion cannot consume two entries or pass the turn.
  await Promise.all([f.engine.complete(ended), f.engine.complete(ended)]); await f.settle();
  assert.deepEqual(f.titles(), ['Night Bus Home', 'Late Summer']);
  assert.equal(f.host().current?.id, alex!.id); assert.equal(f.host().next?.id, blair!.id);
  assert.deepEqual(f.engine.listeningOrder().rotation, order);
  assert.equal(f.host().hostPlayback!.revealed, false);
  assert.equal(alex!.view().ownPlayback!.track.title, 'Late Summer');
  for (const view of [f.host(), blair!.view(), f.engine.view({ kind: 'display' })]) {
    assert.ok(!JSON.stringify(view).includes('Late Summer'));
  }
  await f.engine.reveal(alex!.token, f.host().turnId!, f.host().hostPlayback!.id);
  f.speaker.end(); await f.settle();
  assert.deepEqual(f.titles(), ['Night Bus Home', 'Late Summer', 'Northern Lights']);
  assert.equal(f.host().hostPlayback!.revealed, false);
  const list = await f.lists.read(alex!.list);
  assert.deepEqual(list.upcoming, []);
  assert.deepEqual(new Set(list.played.map(entry => entry.id)), new Set([first, second]));
  assert.ok(list.played.every(entry => entry.playCount === 1));
  f.speaker.end(); await f.settle();
  assert.equal(f.host().current?.id, alex!.id); assert.equal(f.host().hostPlayback, null);
  assert.deepEqual((await f.lists.read(blair!.list)).upcoming.map(entry => entry.id), [other]);
  await alex!.add('demo:night'); await f.settle();
  assert.equal(f.titles().length, 3, 'Adding a song while waiting does not start it.');
  await f.engine.advance(f.host().turnId!, alex!.token); await f.settle();
  assert.equal(f.host().current?.id, blair!.id); assert.equal(f.host().hostPlayback, null);
});

for (const failure of ['lookup', 'play'] as const) test(`same-participant mode keeps the turn and saved song after ${failure} failure`, async t => {
  const f = await fixture(t); const [alex] = f.people;
  const first = await alex!.add('demo:summer'); const second = await alex!.add('demo:aurora');
  await f.engine.setAutoplay('same-participant', 0); await f.start();
  if (failure === 'lookup') f.speaker.failResolve = true; else f.speaker.failPlay = true;
  f.speaker.end(); await f.settle();
  assert.equal(f.host().current?.id, alex!.id); assert.equal(f.host().hostPlayback, null);
  assert.deepEqual(f.titles(), ['Night Bus Home']);
  const list = await f.lists.read(alex!.list);
  assert.deepEqual(list.upcoming.map(entry => entry.id), [first, second]);
  assert.equal(list.reviewEntryId, failure === 'play' ? first : undefined);
});

for (const change of ['next-participant', 'off-and-back'] as const) test(`same-participant pending lookup is cancelled by ${change}`, async t => {
  const f = await fixture(t); const [alex] = f.people; const saved = await alex!.add('demo:summer');
  await f.engine.setAutoplay('same-participant', 0); await f.start();
  let release!: () => void; f.speaker.lookup = new Promise(resolve => { release = resolve; });
  const looking = new Promise<void>(resolve => { f.speaker.looking = resolve; });
  f.speaker.end(); await looking;
  await f.engine.setAutoplay(change === 'off-and-back' ? 'off' : change, 1);
  if (change === 'off-and-back') await f.engine.setAutoplay('same-participant', 2);
  release(); await f.settle();
  assert.deepEqual(f.titles(), ['Night Bus Home']); assert.equal(f.host().current?.id, alex!.id);
  const list = await f.lists.read(alex!.list);
  assert.deepEqual(list.upcoming.map(entry => entry.id), [saved]); assert.equal(list.reviewEntryId, undefined);
});

test('changing modes during a song applies at its natural end, without starting or stopping it immediately', async t => {
  const f = await fixture(t); const [alex, blair] = f.people;
  await alex!.add('demo:summer'); await blair!.add('demo:aurora');
  await f.start(); const playing = f.host().hostPlayback!.id;
  await f.engine.setAutoplay('same-participant', 0);
  assert.equal(f.host().hostPlayback!.id, playing); assert.deepEqual(f.speaker.controls, []);
  f.speaker.end(); await f.settle();
  assert.equal(f.host().current?.id, alex!.id);
  await f.engine.setAutoplay('next-participant', 1);
  f.speaker.end(); await f.settle();
  assert.equal(f.host().current?.id, blair!.id);
  assert.deepEqual(f.titles(), ['Night Bus Home', 'Late Summer', 'Northern Lights']);
});

test('a delayed same-participant start cannot survive a later completion for the same seat', async t => {
  const f = await fixture(t); const [alex] = f.people; const targets: AutoplayTarget[] = [];
  f.engine.attachAutoplay(async target => { targets.push(target); });
  await f.engine.setAutoplay('same-participant', 0); await f.start(); f.speaker.end(); await f.settle();
  await f.start(); f.speaker.end(); await f.settle();
  assert.equal(f.host().current?.id, alex!.id); assert.equal(targets.length, 2);
  assert.equal(f.engine.autoplayReady(targets[0]!), false);
  assert.equal(await f.engine.autoplay(targets[0]!, song('demo:summer'), randomUUID()), null);
  assert.equal(f.engine.autoplayReady(targets[1]!), true);
  assert.deepEqual(f.titles(), ['Night Bus Home', 'Night Bus Home']);
});

test('same-participant mode survives restart without starting music', async t => {
  const f = await fixture(t); await f.engine.setAutoplay('same-participant', 0); await f.start();
  const restored = new Engine(f.store, new DemoAdapter(100), 'http://localhost:3000'); await restored.init();
  t.after(() => restored.adapter.close());
  assert.deepEqual(restored.autoplaySettings(), { mode: 'same-participant', revision: 1 });
  assert.equal(restored.view({ kind: 'host' }).current?.id, f.people[0]!.id);
  assert.equal(restored.view({ kind: 'host' }).hostPlayback, null);
});

for (const enabled of [false, true]) test(`legacy autoplay enabled=${enabled} migrates with its saved revision`, async t => {
  const f = await fixture(t);
  const legacy = { ...f.store.state, room: { ...f.store.state.room!, autoplay: { enabled, revision: 7 } } };
  f.store.state = stateSchema.parse(legacy);
  const restored = new Engine(f.store, new DemoAdapter(100), 'http://localhost:3000'); await restored.init();
  t.after(() => restored.adapter.close());
  assert.deepEqual(restored.autoplaySettings(), { mode: enabled ? 'next-participant' : 'off', revision: 7 });
  assert.equal('enabled' in f.store.state.room!.autoplay!, false);
  await assert.rejects(restored.setAutoplay('same-participant', 6), /settings changed/);
  assert.deepEqual(await restored.setAutoplay('same-participant', 7), { mode: 'same-participant', revision: 8 });
});
