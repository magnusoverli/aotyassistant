/** Shared browser/server format; validation and persistence stay in display-background.ts. */
export type BackgroundSettings = {
  enabled: boolean;
  order: 'random' | 'center' | 'edges' | 'left' | 'right';
  origin: 'random' | 'base' | 'top';
  jitter: number; sprouts: number; duration: number; spread: number; bloomDuration: number;
  loop: boolean; hold: number; fade: number; seed: number | null;
  continuous: boolean; coverage: number; cycleDuration: number;
  opacity: number; width: number;
  qrPlacement: 'bottom-right' | 'play-order';
};
export type BackgroundSnapshot = { revision: number; settings: BackgroundSettings };
export const maxBackgroundGrowSeconds = 60;

export const defaultBackgroundSettings: Readonly<BackgroundSettings> = {
  enabled: true, order: 'random', origin: 'random', jitter: .5, sprouts: 2,
  duration: 1.1, spread: 1.2, bloomDuration: .6, loop: true, hold: 1.6, fade: .45,
  seed: null, opacity: .12, width: 80,
  continuous: false, coverage: 40, cycleDuration: 20,
  qrPlacement: 'bottom-right',
};
