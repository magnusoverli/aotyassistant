import { z } from 'zod';

export const trackSchema = z.object({
  id: z.string(), title: z.string(), artist: z.string(), album: z.string(),
  duration: z.number().nonnegative(), artwork: z.string().optional(), artistArtwork: z.string().optional(),
}).strict();
export type Track = z.infer<typeof trackSchema>;

export type CatalogueSource = 'demo' | 'music-assistant';
export type CatalogueTrack = {
  id: string; title: string; artist: string; album: string; version: string;
  provider: string; duration: number | null; available: boolean; artwork?: string; artistArtwork?: string;
  sources?: CatalogueTrack[];
};
export const catalogueSearchNotice = 'Music Assistant does not report individual source failures; search coverage is unconfirmed.';
export type CatalogueSearch = { source: CatalogueSource; playbackAvailable: boolean; tracks: CatalogueTrack[]; notices?: string[] };
export type CatalogueArtist = { id: string; name: string; provider: string; artwork?: string; sources?: CatalogueArtist[] };
export type CatalogueAlbum = { id: string; name: string; artist: string; provider: string; version: string; year: number | null; artwork?: string; artistArtwork?: string; sources?: CatalogueAlbum[] };
export type CataloguePage<T> = { items: T[]; notices?: string[] };
export type CatalogueBrowse = { artists?: CatalogueArtist[]; albums?: CatalogueAlbum[]; tracks?: CatalogueTrack[]; notices?: string[]; playbackAvailable: boolean };
export interface CatalogueProvider {
  readonly configured: boolean;
  readonly playbackAvailable?: boolean;
  readonly catalogueRevision?: string | number;
  readonly configurationRevision?: string | number;
  search(query: string, context?: string): Promise<CatalogueTrack[]>;
  browse?(kind: 'artists' | 'albums' | 'tracks', value: string, turnId: string): Promise<CatalogueBrowse>;
}

const participantSchema = z.object({
  id: z.string().uuid(), nickname: z.string(), credentialHash: z.string(),
}).strict();
const roomShape = z.object({
  id: z.string().uuid(),
  revision: z.number().int().nonnegative(), turnId: z.string().uuid(),
  participants: z.array(participantSchema).max(100),
  active: z.array(z.string().uuid()).max(100),
  currentId: z.string().uuid().nullable(),
  playback: z.object({
    id: z.string().uuid(), turnId: z.string().uuid(), track: trackSchema,
    status: z.enum(['playing', 'paused', 'stopped']), revealed: z.boolean(),
  }).strict().nullable(),
}).strict();
function validPlacement(room: z.infer<typeof roomShape>, placements: string[]) {
  const ids = room.participants.map(person => person.id);
  return new Set(ids).size === ids.length && new Set(placements).size === placements.length && ids.length === placements.length &&
    placements.every(id => ids.includes(id)) && (!room.currentId || room.active.includes(room.currentId)) &&
    (!room.playback || Boolean(room.currentId && room.playback.turnId === room.turnId));
}
export const roomSchema = roomShape.refine(room => validPlacement(room, room.active) &&
  Boolean(room.currentId) === Boolean(room.active.length), 'Invalid persistent turn state.');
export const stateSchema = z.object({ schema: z.literal(3), room: roomSchema.nullable() }).strict();
export type State = z.infer<typeof stateSchema>;
export type Room = z.infer<typeof roomSchema>;
export type Role = { kind: 'host' } | { kind: 'display' } | { kind: 'participant'; credential: string };

export type Person = { id: string; nickname: string };
export type RotationPosition = { seat: number; total: number; turnsUntil: number };
export type VolumeState = { available: boolean; level: number | null; revision?: string; pending?: boolean; generation?: number };
export type PlaybackProgress = { id: string; status: 'playing' | 'paused' | 'stopped'; fraction: number | null; elapsed?: number; duration?: number };
export type View = {
  mode: 'demo' | 'music-assistant'; connected: boolean; roomId: string | null;
  revision: number; turnId: string | null; current: Person | null; next: Person | null;
  me?: Person; myTurn?: boolean; ownPlayback?: Room['playback'];
  catalogue?: { source: CatalogueSource; playbackAvailable: boolean; revision?: string | number };
  playbackIssue?: string;
  progress?: PlaybackProgress; volume?: VolumeState;
  nowPlaying?: { revealed: false } | { revealed: true; track: Track };
  active?: Person[];
  rotation?: Person[]; position?: RotationPosition;
  joinUrl?: string; displayUrl?: string;
};

export class AppError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
