/** Shared browser/server format; validation and persistence stay in display-background.ts. */
export type BackgroundSettings = {
  enabled: boolean;
  order: 'random' | 'center' | 'edges' | 'left' | 'right';
  origin: 'random' | 'base' | 'top';
  jitter: number; sprouts: number; duration: number; spread: number; bloomDuration: number;
  loop: boolean; hold: number; fade: number; seed: number | null;
  opacity: number; width: number;
};
export type BackgroundSnapshot = { revision: number; settings: BackgroundSettings };

export const defaultBackgroundSettings: Readonly<BackgroundSettings> = {
  enabled: true, order: 'random', origin: 'random', jitter: .5, sprouts: 2,
  duration: 1.1, spread: 1.2, bloomDuration: .6, loop: true, hold: 1.6, fade: .45,
  seed: null, opacity: .12, width: 80,
};
