import { AppError } from './model.js';
import { background, operation } from './operation.js';
import type { PreparationManager, SavedSelection } from './preparations.js';
import type { SharedList, SharedSong } from './shared-list.js';

export type ImportMissing = { rank: number; artist: string; title: string; album: string; failed: boolean };
export type ImportView = {
  list: SharedList['list']; leftOut: SharedList['leftOut']; unreadable: number;
  /** Songs in the link; `checked` of them were looked up so far. */
  total: number; checked: number; added: number; already: number;
  missing: ImportMissing[]; finished: boolean; stopped?: string;
};
type Finder = (song: SharedSong) => Promise<SavedSelection | undefined>;
type Job = { ownerId: string; credential: string; songs: SharedSong[]; abort: AbortController; finishedAt?: number; view: ImportView };

/** Songs looked up at once. Per-service pacing in the finder keeps slow services to one request at a time. */
const workers = 6;
/** Found songs are saved a few at a time, always in list order. */
const commitSize = 4;
/** Lookups failing in a row before the import stops: Music Assistant or a service is not answering. */
const failureLimit = 4;
/** A finished import's summary stays available this long, for example after a reload. */
const keepFinished = 15 * 60_000;

/** Imports run on the server, so a sleeping phone or a reload never interrupts them. One per person at a time. */
export class ListImports {
  private jobs = new Map<string, Job>();
  constructor(private preparations: PreparationManager, private find: Finder, private now = Date.now) {}

  /** Starts importing a fetched list: last album first, after the songs already in the playlist. */
  async start(credential: string, shared: SharedList & { skipped: number }): Promise<ImportView> {
    const ownerId = await this.preparations.ownerOf(credential); this.prune();
    if (this.jobs.get(ownerId)?.view.finished === false) throw new AppError(409, 'An import is already running. Wait for it to finish, or stop it.');
    const songs = [...shared.songs].sort((a, b) => b.rank - a.rank);
    const job: Job = { ownerId, credential, songs, abort: new AbortController(), view: { list: shared.list, leftOut: shared.leftOut,
      unreadable: shared.skipped, total: songs.length, checked: 0, added: 0, already: 0, missing: [], finished: false } };
    this.jobs.set(ownerId, job);
    // Detached from the request that started it: its deadline and disconnect never end the import.
    void background(() => this.run(job));
    return this.copy(job);
  }
  /** The person's running or recently finished import, or null. */
  async current(credential: string): Promise<ImportView | null> {
    const ownerId = await this.preparations.ownerOf(credential); this.prune();
    const job = this.jobs.get(ownerId); return job ? this.copy(job) : null;
  }
  /** Stops at once: songs already saved stay; nothing after the stop is added. */
  async stop(credential: string): Promise<ImportView | null> {
    const ownerId = await this.preparations.ownerOf(credential);
    const job = this.jobs.get(ownerId);
    if (job && !job.view.finished) { job.view.stopped ??= 'You stopped the import.'; job.abort.abort(); }
    return job ? this.copy(job) : null;
  }
  close() { for (const job of this.jobs.values()) job.abort.abort(); }

  private copy(job: Job): ImportView {
    const view = structuredClone(job.view); view.missing.sort((a, b) => b.rank - a.rank); return view;
  }
  private prune() {
    for (const [ownerId, job] of this.jobs) if (job.finishedAt !== undefined && this.now() - job.finishedAt > keepFinished) this.jobs.delete(ownerId);
  }

  private async run(job: Job) {
    const { songs, view } = job;
    // undefined: not looked up yet; null: not found, failed or skipped.
    const results: (SavedSelection | null | undefined)[] = new Array(songs.length);
    let next = 0; let committed = 0; let failures = 0; let saving = Promise.resolve();
    const stop = (reason: string) => { view.stopped ??= reason; job.abort.abort(); };
    // Saves the found songs whose earlier songs are all settled, so the playlist keeps the list's order.
    const save = async (all: boolean) => {
      let end = committed; while (end < songs.length && results[end] !== undefined) end++;
      if (end === committed || (!all && end - committed < commitSize)) return;
      const selections = results.slice(committed, end).filter(item => item) as SavedSelection[]; committed = end;
      if (!selections.length) return;
      try {
        const result = await this.preparations.appendImported(job.credential, selections);
        view.added += result.added; view.already += result.already;
        if (result.full) stop('Your playlist is full (200 songs).');
      } catch (error) { stop(error instanceof Error && error.message ? error.message : 'The playlist could not be saved.'); }
    };
    const queueSave = (all: boolean) => (saving = saving.then(() => save(all)));
    await Promise.all(Array.from({ length: Math.min(workers, songs.length) }, async () => {
      while (!job.abort.signal.aborted && next < songs.length) {
        const index = next++; const song = songs[index]!;
        try {
          const selection = await operation('import-song', () => this.find(song), 90_000, job.abort.signal);
          // A lookup that finishes after a stop is not added.
          if (job.abort.signal.aborted) break;
          results[index] = selection ?? null; failures = 0;
          if (!selection) view.missing.push(missing(song, false));
        } catch (error) {
          if (job.abort.signal.aborted) break;
          results[index] = null; view.missing.push(missing(song, true));
          if (error instanceof AppError && error.status === 409) stop(error.message);
          else if (++failures >= failureLimit) stop('Music Assistant isn’t answering right now, possibly because a music service is limiting requests. Wait a minute and import the list again; songs already added are skipped.');
        }
        view.checked++;
        await queueSave(false);
      }
    }));
    // After a stop, only the songs before the first unfinished one are saved, keeping the order.
    await queueSave(true);
    view.finished = true; job.finishedAt = this.now();
  }
}
const missing = (song: SharedSong, failed: boolean): ImportMissing => ({ rank: song.rank, artist: song.artist, title: song.title, album: song.album, failed });
