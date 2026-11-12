import { AppError, type Track, type VolumeState } from '../../src/model.js';
import type { PlaybackAdapter } from '../../src/playback.js';
import type { SavedSelection } from '../../src/preparations.js';

/** Test-only player: a small synthetic catalogue and timed "songs" without audio or Music Assistant.
 * The app itself always plays through Music Assistant; this stands in for it where a test only
 * needs turns, saved songs or playback state. */
export class FakePlayback implements PlaybackAdapter {
  connected = true;
  onComplete: (id: string) => void = () => {};
  onProgress: () => void = () => {};
  volume: VolumeState = { available: true, level: 35, revision: 'fake', generation: 0 };
  async setVolume(level: number) { this.volume = { ...this.volume, available: true, level, generation: (this.volume.generation ?? 0) + 1 }; this.onProgress(); }
  readonly catalogue: Track[];
  private timer?: NodeJS.Timeout;
  private playbackId?: string;
  private remaining = 0;
  private startedAt = 0;
  private duration = 0;
  private heartbeat?: NodeJS.Timeout;
  private stopped?: { id: string; elapsed: number; duration: number };
  progress(id: string) {
    if (this.stopped?.id === id) return this.stopped;
    if (this.playbackId !== id) return null;
    const remaining = this.remaining - (this.timer ? Date.now() - this.startedAt : 0);
    return { elapsed: Math.max(0, Math.min(this.duration, this.duration - remaining / 1000)), duration: this.duration };
  }

  constructor(seconds = 30) {
    this.catalogue = [
      { id: 'demo:aurora', title: 'Northern Lights', artist: 'The Paper Satellites', album: 'After the Winter', duration: seconds, artwork: '/fake-cover.svg' },
      { id: 'demo:summer', title: 'Late Summer', artist: 'Velvet Harbour', album: 'Windows Open', duration: seconds, artwork: '/fake-cover.svg' },
      { id: 'demo:night', title: 'Night Bus Home', artist: 'Echo Garden', album: 'Small Hours', duration: seconds },
    ];
  }
  /** Tests pick tracks by text; the app never searches for tracks. */
  async search(query: string): Promise<Track[]> {
    return structuredClone(this.catalogue.filter(t => `${t.title} ${t.artist} ${t.album}`.toLowerCase().includes(query.toLowerCase())));
  }
  async resolve(id: string): Promise<Track> {
    const track = this.catalogue.find(t => t.id === id);
    if (!track) throw new AppError(422, 'This test track is unavailable.');
    return structuredClone(track);
  }
  async resolveSaved(selection: SavedSelection, _context: string, trackId: string): Promise<Track> {
    if (selection.source !== 'demo') throw new AppError(409, 'Connect the saved source before playing this track.');
    return { ...await this.resolve(selection.trackId), id: trackId };
  }
  async play(track: Track, playbackId: string): Promise<void> {
    this.close(); this.stopped = undefined; this.playbackId = playbackId; this.duration = track.duration; this.remaining = track.duration * 1000; this.schedule();
    this.heartbeat = setInterval(() => this.onProgress(), 1000); this.heartbeat.unref();
  }
  async control(action: 'pause' | 'resume' | 'stop'): Promise<void> {
    if (action === 'stop') { const id = this.playbackId; const position = id ? this.progress(id) : null; this.close(); if (id && position) this.stopped = { id, ...position }; return; }
    if (action === 'pause' && this.timer) {
      clearTimeout(this.timer); this.timer = undefined;
      this.remaining = Math.max(0, this.remaining - (Date.now() - this.startedAt));
    }
    if (action === 'resume' && !this.timer && this.playbackId) this.schedule();
  }
  async seek(position: number): Promise<void> {
    if (!this.playbackId) throw new AppError(409, 'There is no song to move within.');
    this.remaining = Math.max(0, this.duration - Math.max(0, Math.min(this.duration, position))) * 1000;
    if (this.timer) { clearTimeout(this.timer); this.schedule(); }
    this.onProgress();
  }
  private schedule(): void {
    this.startedAt = Date.now();
    this.timer = setTimeout(() => {
      const id = this.playbackId;
      this.close();
      if (id) this.onComplete(id);
    }, this.remaining);
    this.timer.unref();
  }
  close(): void {
    clearTimeout(this.timer); clearInterval(this.heartbeat); this.timer = undefined; this.playbackId = undefined; this.stopped = undefined;
  }
}
