import { z } from 'zod';
import { defaultDisplaySettings, viewingDistances, type DisplaySettings, type DisplaySnapshot } from './viewing-distance.js';
import { SettingsRecord } from './settings-record.js';

export const displaySettingsSchema = z.object({
  distance: z.enum(viewingDistances.map(distance => distance.id)),
}).strict() satisfies z.ZodType<DisplaySettings>;
export const displaySnapshotSchema = z.object({
  revision: z.number().int().nonnegative(), settings: displaySettingsSchema,
}).strict() satisfies z.ZodType<DisplaySnapshot>;

/** The room's viewing distance. Separate from the background record, so changing it
 * applies at once and never replays the animation. */
export class DisplaySettingsStore extends SettingsRecord<DisplaySettings> {
  constructor(directory: string, changed: () => void) {
    super(directory, 'display-settings.json', 'Display settings', displaySnapshotSchema,
      () => ({ ...defaultDisplaySettings }), changed);
  }
}
