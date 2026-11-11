import { join } from 'node:path';
import type { z } from 'zod';
import { AppError } from './model.js';
import { readPrivateJson, writePrivateJson } from './store.js';
import { SerialQueue } from './serial.js';

export type SettingsSnapshot<S> = { revision: number; settings: S };

/** One small durable settings record with its own revision; saving it never takes the playback lane. */
export class SettingsRecord<S extends object> {
  readonly ready: Promise<void>;
  private current: SettingsSnapshot<S>;
  private unavailable = false;
  private queue = new SerialQueue();
  /** `name` starts the error messages, for example "Background settings". */
  constructor(private directory: string, private file: string, private name: string,
    private schema: z.ZodType<SettingsSnapshot<S>>, private defaults: () => S, private changed: () => void,
    private storedSchema: z.ZodType<SettingsSnapshot<S>> = schema) {
    this.current = { revision: 0, settings: defaults() };
    this.ready = this.load();
  }
  view(): SettingsSnapshot<S> | null { return this.unavailable ? null : structuredClone(this.current); }
  async read(): Promise<SettingsSnapshot<S>> {
    await this.ready;
    if (this.unavailable) throw new AppError(503, `${this.name} could not be read. Check the app’s storage and restart it.`);
    return structuredClone(this.current);
  }
  save(input: SettingsSnapshot<S>): Promise<SettingsSnapshot<S>> {
    return this.queue.run(async () => {
      const current = await this.read();
      const parsed = this.schema.parse(input);
      if (parsed.revision !== current.revision) throw new AppError(409, `${this.name} changed. Reload settings before saving again.`);
      const next = { ...parsed, revision: current.revision + 1 };
      try { await writePrivateJson(this.directory, this.file, next, 4096); }
      catch {
        // A rename may have committed before directory sync failed. Read back before another edit.
        await this.load(); this.changed();
        throw new AppError(503, `The save could not be confirmed. Reload ${this.name.toLowerCase()} before trying again.`);
      }
      this.current = next; this.changed(); return structuredClone(next);
    });
  }
  private async load() {
    try {
      this.current = await readPrivateJson(join(this.directory, this.file), this.storedSchema, 4096)
        ?? { revision: 0, settings: this.defaults() };
      this.unavailable = false;
    } catch { this.unavailable = true; }
  }
}
