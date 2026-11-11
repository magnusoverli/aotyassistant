import { z } from 'zod';
import { defaultBackgroundSettings, maxBackgroundGrowSeconds, type BackgroundSettings, type BackgroundSnapshot } from './background-settings.js';
import { SettingsRecord } from './settings-record.js';

export const backgroundSettingsSchema = z.object({
  enabled: z.boolean(),
  qrPlacement: z.enum(['bottom-right', 'play-order']).default(defaultBackgroundSettings.qrPlacement),
  order: z.enum(['random', 'center', 'edges', 'left', 'right']),
  origin: z.enum(['random', 'base', 'top']),
  jitter: z.number().min(0).max(1), sprouts: z.number().int().min(1).max(4),
  duration: z.number().min(.2).max(maxBackgroundGrowSeconds), spread: z.number().min(0).max(5),
  bloomDuration: z.number().min(.1).max(2),
  loop: z.boolean(), hold: z.number().min(0).max(30), fade: z.number().min(.05).max(5),
  // Older saved records keep their intro loop and gain controls for the optional continuous mode.
  continuous: z.boolean().default(defaultBackgroundSettings.continuous),
  coverage: z.number().min(5).max(95).default(defaultBackgroundSettings.coverage),
  cycleDuration: z.number().min(2).max(120).default(defaultBackgroundSettings.cycleDuration),
  seed: z.number().int().min(0).max(2147483647).nullable(),
  opacity: z.number().min(.01).max(1), width: z.number().min(20).max(100),
}).strict() satisfies z.ZodType<BackgroundSettings>;
export const backgroundSnapshotSchema = z.object({
  revision: z.number().int().nonnegative(), settings: backgroundSettingsSchema,
}).strict() satisfies z.ZodType<BackgroundSnapshot>;

/** Appearance has its own durable record; saving it never takes the playback lane. */
export class DisplayBackground extends SettingsRecord<BackgroundSettings> {
  constructor(directory: string, changed: () => void) {
    super(directory, 'display-background.json', 'Background settings', backgroundSnapshotSchema,
      () => ({ ...defaultBackgroundSettings }), changed);
  }
}
