import { type StreamInfo, type Track, type VolumeState } from './model.js';
import type { SavedSelection } from './preparations.js';
import type { PlaybackProblem } from './playback-problem.js';

export interface PlaybackAdapter {
  /** Playback controls are usable; this is not process liveness or catalogue health. */
  readonly connected: boolean;
  readonly issue?: string;
  readonly problem?: PlaybackProblem;
  readonly volume?: VolumeState;
  setVolume?(level: number, playbackId?: string): Promise<void>;
  progress?(id: string): { elapsed: number; duration: number } | null;
  streamInfo?(id: string): StreamInfo | undefined;
  onProgress?: () => void;
  resolve(id: string, context?: string): Promise<Track>;
  resolveSaved?(selection: SavedSelection, context: string, trackId: string): Promise<Track>;
  discardSelection?(track: Track): void;
  play(track: Track, playbackId: string): Promise<void>;
  control(action: 'pause' | 'resume' | 'stop'): Promise<void>;
  /** Moves the playing song to `position` seconds. Absent where the speaker cannot. */
  seek?(position: number): Promise<void>;
  onComplete: (playbackId: string) => void;
  onInvalidated?: (playbackId: string, message: string) => void;
  onStatus?: (playbackId: string, status: 'playing' | 'paused') => void;
  close(): void;
}

