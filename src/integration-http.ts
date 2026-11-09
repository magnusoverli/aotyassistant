import type { Express } from 'express';
import { z } from 'zod';
import type { Engine } from './engine.js';
import type { IntegrationManager } from './integrations.js';
import { musicAssistantUrl, maToken } from './music-assistant.js';
import { applicationOrigin } from './addressing.js';
import { jsonBody } from './http-utils.js';
import type { SetupManager } from './setup.js';
import { emptyHints } from './supervisor.js';
import { EventStreams } from './event-streams.js';

const revision = z.number().int().nonnegative();
const idleSetup = () => ({ status: 'idle', message: 'Enter the Music Assistant address below.', supervisor: emptyHints(), servers: [] });

/** Host integration/addressing routes. Global HTTP origin/content-type policy is mounted first. */
export function mountIntegrations(app: Express, engine: Engine, integrations: IntegrationManager, setup?: SetupManager) {
  const streams = new EventStreams(100, 'Too many Settings connections. Close unused tabs and try again.');
  // Every integration change reaches room views through this one subscription.
  const unsubscribe = integrations.subscribe(() => engine.emit('change', 'output'));
  integrations.startMonitoring();
  app.get('/api/host/integrations/events', (_req, res) => {
    const stream = streams.reserve(res); if (!stream.open()) return;
    let previous = '';
    const send = () => {
      const view = integrations.view(); const key = JSON.stringify(view);
      if (key !== previous) { previous = key; stream.sendEncoded('state', key); }
    };
    send(); stream.onClose(integrations.subscribe(send));
    if (setup) {
      const sendSetup = () => stream.send('setup', setup.view());
      sendSetup(); stream.onClose(setup.subscribe(sendSetup));
    }
    stream.every(() => { send(); stream.heartbeat(); }, 15_000);
    integrations.refreshOutputSoon();
  });
  app.get('/api/host/setup', (_req, res) => res.json(setup?.view() ?? idleSetup()));
  app.post('/api/host/setup/refresh', jsonBody(z.strictObject({}), async (_input, _req, res) => {
    res.json(setup ? await setup.refresh() : idleSetup());
  }));
  app.get('/api/host/addressing', (_req, res) => res.json(integrations.addressing()));
  app.post('/api/host/addressing/guest', jsonBody(z.strictObject({ origin: applicationOrigin.nullable(), revision }), async (input, _req, res) => {
    const view = await integrations.saveGuestOrigin(input.origin, input.revision);
    engine.setGuestOrigin(view.guestOrigin); res.json(view);
  }));
  app.post('/api/host/addressing/test', jsonBody(z.strictObject({ origins: z.array(applicationOrigin).min(1).max(6), revision, automatic: z.boolean().default(false) }), async (input, _req, res) => {
    res.json(await integrations.checkMediaOrigins(input.origins, input.revision, input.automatic));
  }));
  app.get('/api/host/integrations', (_req, res) => res.json(integrations.view()));
  app.get('/api/host/integrations/destinations', async (_req, res) => res.json(await integrations.check(integrations.view().revision)));
  app.post('/api/host/integrations/save', jsonBody(z.strictObject({ url: musicAssistantUrl, accessToken: maToken.optional(), revision }), async (input, _req, res) => {
    res.json(await integrations.save(input.url, input.accessToken, input.revision));
  }));
  app.post('/api/host/integrations/media-origin', jsonBody(z.strictObject({ origin: applicationOrigin.nullable(), revision }), async (input, _req, res) => {
    res.json(await integrations.saveMediaOrigin(input.origin, input.revision));
  }));
  app.post('/api/host/integrations/check', jsonBody(z.strictObject({ revision }), async (input, _req, res) => {
    res.json(await integrations.check(input.revision));
  }));
  app.post('/api/host/integrations/destination', jsonBody(z.strictObject({ id: z.string().min(1).max(500), revision, playbackId: z.string().uuid().optional() }), async (input, _req, res) => {
    res.json(await integrations.selectDestination(input.id, input.revision, input.playbackId,
      work => engine.changeSpeaker(input.playbackId ?? null, work)));
  }));
  for (const action of ['clear', 'recover'] as const) {
    app.post(`/api/host/integrations/${action}`, jsonBody(z.strictObject({ revision }), async (input, _req, res) => {
      res.json(action === 'clear' ? await integrations.clear(input.revision) : await integrations.recoverPlayback(input.revision));
    }));
  }
  return () => { unsubscribe(); integrations.stopMonitoring(); streams.close(); };
}
