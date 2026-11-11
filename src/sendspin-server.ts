// Bundled separately for Node: the pinned SDK publishes extensionless ESM imports.
// Core decodes PCM and synchronizes clocks without creating an audio output device.
import { SendspinCore, loadSendspinClientIdentity } from '@sendspin/sendspin-js';

// Explicit boundary types also isolate NodeNext consumers from the SDK's browser declarations.
export type VisualizerStorage = { getItem(key: string): string | null; setItem(key: string, value: string): void };
export type VisualizerChunk = { samples: Float32Array[]; sampleRate: number; serverTimeUs: number; generation: number };
export type VisualizerClientConfig = {
  webSocket: unknown; storage: VisualizerStorage; clientName: string; productName: string; manufacturer: string;
  codecs: ['pcm']; unpairedAccess: false; bufferCapacity: number; requiredLeadTimeMs: number; minBufferMs: number;
};
export interface VisualizerClient {
  readonly clientId: string;
  readonly pairingToken: string;
  readonly isConnected: boolean;
  readonly timeSyncInfo: { synced: boolean };
  readonly _timeFilter: { computeClientTime(serverTimeUs: number): number };
  onAudioData: ((chunk: VisualizerChunk) => void) | undefined;
  onStreamStart: ((format: { codec: string; sample_rate: number; channels: number; bit_depth: number }, update: boolean) => void) | undefined;
  onStreamClear: (() => void) | undefined;
  onStreamEnd: (() => void) | undefined;
  onConnectionClose: (() => void) | undefined;
  connect(): Promise<void>;
  disconnect(): void;
}
export function visualizerIdentity(storage: VisualizerStorage): { clientId: string; pairingToken: string | null } {
  return loadSendspinClientIdentity(storage);
}
export function createVisualizerClient(config: VisualizerClientConfig): VisualizerClient {
  return new SendspinCore(config as ConstructorParameters<typeof SendspinCore>[0]);
}
