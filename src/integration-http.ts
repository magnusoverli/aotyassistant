import type { Express } from 'express';
import { z } from 'zod';
import type { Engine } from './engine.js';
import type { IntegrationManager } from './integrations.js';
import { musicAssistantUrl, maToken } from './music-assistant.js';
import { applicationOrigin } from './addressing.js';
import { body } from './http-utils.js';
import type { SetupManager } from './setup.js';
import { emptyHints } from './supervisor.js';

const revision = z.number().int().nonnegative();

/** Host integration/addressing routes. Global HTTP origin/content-type policy is mounted first. */
export function mountIntegrations(app: Express, engine: Engine, integrations: IntegrationManager, setup?: SetupManager) {
  app.get('/api/host/setup', (_req, res) => res.json(setup?.view() ?? { status: 'idle', message: 'Enter the Music Assistant address below.', supervisor: emptyHints(), servers: [] }));
  app.post('/api/host/setup/refresh', async (req, res) => {
    body(req, z.object({}).strict());
    res.json(setup ? await setup.refresh() : { status: 'idle', message: 'Enter the Music Assistant address below.', supervisor: emptyHints(), servers: [] });
  });
  app.get('/api/host/addressing', (_req, res) => res.json(integrations.addressing()));
  app.post('/api/host/addressing/guest', async (req, res) => {
    const input = body(req, z.object({ origin: applicationOrigin, revision }).strict());
    const view = await integrations.saveGuestOrigin(input.origin, input.revision);
    engine.setGuestOrigin(view.guestOrigin); res.json(view);
  });
  app.post('/api/host/addressing/test', async (req, res) => {
    const input = body(req, z.object({ origins: z.array(applicationOrigin).min(1).max(6), revision, automatic: z.boolean().default(false) }).strict());
    res.json(await integrations.checkMediaOrigins(input.origins, input.revision, input.automatic));
  });
  app.get('/api/host/integrations', (_req, res) => res.json(integrations.view()));
  app.get('/api/host/integrations/destinations', async (_req, res) => res.json(await integrations.check(integrations.view().revision)));
  app.post('/api/host/integrations/save', async (req, res) => {
    const input = body(req, z.object({ url: musicAssistantUrl, accessToken: maToken.optional(), revision }).strict());
    const result = await integrations.save(input.url, input.accessToken, input.revision);
    engine.emit('change'); res.json(result);
  });
  app.post('/api/host/integrations/media-origin', async (req, res) => {
    const input = body(req, z.object({ origin: applicationOrigin.nullable(), revision }).strict());
    const view = await integrations.saveMediaOrigin(input.origin, input.revision); engine.emit('change'); res.json(view);
  });
  app.post('/api/host/integrations/check', async (req, res) => {
    const input = body(req, z.object({ revision }).strict()); res.json(await integrations.check(input.revision));
  });
  app.post('/api/host/integrations/destination', async (req, res) => {
    const input = body(req, z.object({ id: z.string().min(1).max(500), revision }).strict());
    const result = await integrations.selectDestination(input.id, input.revision); engine.emit('change'); res.json(result);
  });
  for (const action of ['clear', 'recover'] as const) {
    app.post(`/api/host/integrations/${action}`, async (req, res) => {
      const input = body(req, z.object({ revision }).strict());
      const result = action === 'clear' ? await integrations.clear(input.revision) : await integrations.recoverPlayback(input.revision);
      engine.emit('change'); res.json(result);
    });
  }
}
