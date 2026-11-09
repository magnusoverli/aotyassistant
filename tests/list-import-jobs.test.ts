import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { AppError } from '../src/model.js';
import { ListImports } from '../src/list-import-jobs.js';
import { PreparationManager, preparationStateSchema, type PreparationState, type PreparationStore, type SavedSelection } from '../src/preparations.js';
import type { SharedSong } from '../src/shared-list.js';

class MemoryStore implements PreparationStore {
  states = new Map<string, PreparationState>();
  async load(id: string) { return structuredClone(this.states.get(id) ?? null); }
  async save(state: PreparationState) { this.states.set(state.ownerId, preparationStateSchema.parse(structuredClone(state))); }
}
const binding = randomUUID();
const selection = (title: string): SavedSelection => ({ source: 'music-assistant', sourceBindingId: binding,
  recording: { provider: 'tidal--instance', itemId: `track-${title}`, uri: `tidal://track/track-${title}`, version: '' },
  metadata: { title, artist: 'Artist', album: 'Album', version: '', provider: 'tidal', duration: 200 } });
const song = (rank: number): SharedSong => ({ rank, artist: 'Artist', title: `Song ${rank}`, album: 'Album', trackNumber: null, duration: null, albumLinks: [] });
const list = (count: number) => ({ list: { name: 'Best of 2025', year: 2025 }, leftOut: { noPick: 1, disqualified: 0 }, skipped: 0,
  songs: Array.from({ length: count }, (_, index) => song(index + 1)) });

async function fixture(find: (song: SharedSong) => Promise<SavedSelection | undefined>) {
  const preparations = new PreparationManager(new MemoryStore()); const owner = await preparations.createOwner();
  const imports = new ListImports(preparations, find);
  const finished = async () => { for (let i = 0; i < 500; i++) { const view = await imports.current(owner.credential); if (view?.finished) return view; await delay(5); } throw new Error('Import did not finish'); };
  return { preparations, owner, imports, finished, titles: async () => (await preparations.read(owner.credential)).upcoming.map(entry => entry.title) };
}

test('songs are saved last album first, even when their lookups finish out of order', async () => {
  const f = await fixture(async item => { await delay((item.rank * 7) % 13); return item.rank === 4 ? undefined : selection(item.title); });
  const started = await f.imports.start(f.owner.credential, list(10));
  assert.deepEqual([started.total, started.finished, started.leftOut.noPick], [10, false, 1]);
  const view = await f.finished();
  assert.deepEqual([view.added, view.already, view.checked, view.stopped], [9, 0, 10, undefined]);
  assert.deepEqual(view.missing.map(item => [item.rank, item.failed]), [[4, false]]);
  assert.deepEqual(await f.titles(), [10, 9, 8, 7, 6, 5, 3, 2, 1].map(rank => `Song ${rank}`));
  // Importing again only reports what is already there.
  await f.imports.start(f.owner.credential, list(10));
  const again = await f.finished(); assert.deepEqual([again.added, again.already], [0, 9]);
});

test('one import per person at a time, visible only with the playlist’s credential', async () => {
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  const f = await fixture(async item => { await gate; return selection(item.title); });
  await f.imports.start(f.owner.credential, list(3));
  await assert.rejects(f.imports.start(f.owner.credential, list(3)), (error: unknown) => error instanceof AppError && error.status === 409);
  const other = await f.preparations.createOwner();
  assert.equal(await f.imports.current(other.credential), null);
  release(); assert.equal((await f.finished()).added, 3);
});

test('stopping keeps what was saved and adds nothing after the stop', async () => {
  let calls = 0;
  const f = await fixture(async item => { calls++; if (item.rank > 15) return selection(item.title); await delay(1000); return selection(item.title); });
  await f.imports.start(f.owner.credential, list(20));
  for (let i = 0; i < 100 && (await f.imports.current(f.owner.credential))!.added < 4; i++) await delay(5);
  const stopped = await f.imports.stop(f.owner.credential);
  assert.equal(stopped?.stopped, 'You stopped the import.');
  const view = await f.finished();
  assert.equal(view.stopped, 'You stopped the import.');
  assert.deepEqual(await f.titles(), ['Song 20', 'Song 19', 'Song 18', 'Song 17', 'Song 16']);
  assert.ok(calls < 20, 'no new lookups start after a stop');
});

test('a full playlist, repeated failures, or a changed connection stop the import with a clear reason', async () => {
  const full = await fixture(async item => selection(item.title));
  for (let i = 0; i < 199; i++) await full.preparations.appendImported(full.owner.credential, [selection(`Existing ${i}`)]);
  await full.imports.start(full.owner.credential, list(5));
  const fullView = await full.finished();
  assert.equal(fullView.stopped, 'Your playlist is full (200 songs).'); assert.equal(fullView.added, 1);

  const failing = await fixture(async item => { if (item.rank <= 9) throw new AppError(504, 'Music Assistant did not respond in time.'); return selection(item.title); });
  await failing.imports.start(failing.owner.credential, list(12));
  const failingView = await failing.finished();
  assert.match(failingView.stopped ?? '', /Music Assistant isn’t answering right now/);
  assert.ok(failingView.missing.every(item => item.failed));

  const changed = await fixture(async item => { if (item.rank === 2) throw new AppError(409, 'The music connection changed during the import.'); return selection(item.title); });
  await changed.imports.start(changed.owner.credential, list(2));
  const changedView = await changed.finished();
  assert.equal(changedView.stopped, 'The music connection changed during the import.');
});
