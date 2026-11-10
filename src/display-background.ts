import { join } from 'node:path';
import { z } from 'zod';
import { AppError } from './model.js';
import { defaultBackgroundSettings, maxBackgroundGrowSeconds, type BackgroundSettings, type BackgroundSnapshot } from './background-settings.js';
import { readPrivateJson, writePrivateJson } from './store.js';
import { SerialQueue } from './serial.js';

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
export class DisplayBackground {
  readonly ready: Promise<void>;
  private current: BackgroundSnapshot = { revision: 0, settings: { ...defaultBackgroundSettings } };
  private unavailable = false;
  private queue = new SerialQueue();
  constructor(private directory: string, private changed: () => void) {
    this.ready = this.load();
  }
  view(): BackgroundSnapshot | null { return this.unavailable ? null : structuredClone(this.current); }
  async read(): Promise<BackgroundSnapshot> {
    await this.ready;
    if (this.unavailable) throw new AppError(503, 'Background settings could not be read. Check the app’s storage and restart it.');
    return structuredClone(this.current);
  }
  save(input: BackgroundSnapshot): Promise<BackgroundSnapshot> {
    return this.queue.run(async () => {
      const current = await this.read();
      const parsed = backgroundSnapshotSchema.parse(input);
      if (parsed.revision !== current.revision) throw new AppError(409, 'Background settings changed. Reload settings before saving again.');
      const next = { ...parsed, revision: current.revision + 1 };
      try { await writePrivateJson(this.directory, 'display-background.json', next, 4096); }
      catch {
        // A rename may have committed before directory sync failed. Read back before another edit.
        await this.load(); this.changed();
        throw new AppError(503, 'The save could not be confirmed. Reload background settings before trying again.');
      }
      this.current = next; this.changed(); return structuredClone(next);
    });
  }
  private async load() {
    try {
      this.current = await readPrivateJson(join(this.directory, 'display-background.json'), backgroundSnapshotSchema, 4096)
        ?? { revision: 0, settings: { ...defaultBackgroundSettings } };
      this.unavailable = false;
    } catch { this.unavailable = true; }
  }
}
