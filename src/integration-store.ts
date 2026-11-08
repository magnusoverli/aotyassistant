import { join } from 'node:path';
import { z } from 'zod';
import { applicationOrigin } from './addressing.js';
import { musicAssistantUrl, maToken } from './lan-network.js';
import { readPrivateJson, writePrivateJson } from './store.js';

export const integrationSchema = z.object({
  schema: z.literal(1), revision: z.number().int().nonnegative(),
  mediaOrigin: applicationOrigin.nullable().optional(),
  guestOrigin: applicationOrigin.optional(), automaticMediaOrigin: applicationOrigin.optional(),
  guestSelection: z.enum(['manual', 'automatic']).optional(), automaticGuestOrigin: applicationOrigin.optional(),
  musicAssistant: z.object({ url: musicAssistantUrl, accessToken: maToken,
    sourceBindingId: z.string().uuid().optional(),
    serverId: z.string().min(1).max(200).optional(), browserUrl: musicAssistantUrl.optional(), tokenExpiresAt: z.number().int().positive().optional(),
    destination: z.object({ id: z.string(), name: z.string() }).strict().nullable(),
  }).strict().nullable(),
}).strict();
export type IntegrationState = z.infer<typeof integrationSchema>;
export interface IntegrationStore { load(): Promise<IntegrationState>; save(state: IntegrationState): Promise<void> }

export class IntegrationFileStore implements IntegrationStore {
  constructor(private directory: string) {}
  async load(): Promise<IntegrationState> {
    let state: IntegrationState | undefined;
    try { state = await readPrivateJson(join(this.directory, 'integrations.json'), integrationSchema, 1024 * 1024); }
    catch { throw new Error('Integration settings could not be loaded. Check the application data directory; nothing was overwritten.'); }
    return state ?? { schema: 1, revision: 0, musicAssistant: null };
  }
  async save(state: IntegrationState): Promise<void> { await writePrivateJson(this.directory, 'integrations.json', integrationSchema.parse(state)); }
}
