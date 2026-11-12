import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IntegrationManager } from '../src/integrations.js';
import type { IntegrationState } from '../src/integration-store.js';
import { emptyHints, supervisorHints, type SupervisorHints } from '../src/supervisor.js';
import { SetupManager } from '../src/setup.js';

const lan = 'http://192.168.1.8:4000';
const nextLan = 'http://192.168.1.9:4000';
const hints = (...origins: string[]): SupervisorHints => ({ ...emptyHints(true), available: true, networkAvailable: true, guestPort: 4000, guestOrigins: origins, preferredGuestOrigins: origins });
async function fixture(initial: Partial<IntegrationState> = {}) {
  let saved: IntegrationState = { schema: 1, revision: 0, musicAssistant: null, ...initial };
  const manager = new IntegrationManager({ load: async () => structuredClone(saved), save: async value => { saved = structuredClone(value); } });
  await manager.init(); manager.configureGuestAccess('http://localhost:3000', true);
  return { manager, saved: () => saved };
}

test('automatic guest discovery is stable, refreshes after two observations, and does not overwrite manual or legacy selections', async () => {
  const { manager, saved } = await fixture();
  assert.equal(manager.guestAccess.status, 'checking');
  await manager.updateGuestDiscovery(hints(lan));
  assert.equal(manager.guestOrigin, lan); assert.equal(manager.guestAccess.status, 'ready');
  assert.equal(saved().guestOrigin, undefined); assert.equal(saved().automaticGuestOrigin, lan);
  const revision = saved().revision;
  await manager.updateGuestDiscovery(hints(nextLan, lan));
  assert.equal(manager.guestOrigin, lan); assert.equal(saved().revision, revision);
  await manager.updateGuestDiscovery(hints(nextLan));
  assert.equal(manager.guestOrigin, lan); assert.equal(manager.guestAccess.status, 'checking');
  await manager.updateGuestDiscovery(hints(nextLan)); assert.equal(manager.guestOrigin, nextLan);
  await manager.saveGuestOrigin('http://room.local:4000', saved().revision);
  await manager.updateGuestDiscovery(hints(lan)); await manager.updateGuestDiscovery(hints(lan));
  assert.equal(manager.guestOrigin, 'http://room.local:4000'); assert.equal(manager.guestAccess.source, 'manual');
  await manager.saveGuestOrigin(null, saved().revision); assert.equal(manager.guestOrigin, lan);
  const legacy = await fixture({ guestOrigin: 'http://old.local:4000' });
  await legacy.manager.updateGuestDiscovery(hints(lan));
  assert.equal(legacy.manager.guestOrigin, 'http://old.local:4000'); assert.equal(legacy.manager.guestAccess.source, 'legacy');
});

test('disabled ports, ambiguous networks and failed reads do not advertise an unusable automatic invitation', async () => {
  const { manager } = await fixture();
  await manager.updateGuestDiscovery(hints(lan, nextLan)); assert.equal(manager.guestAccess.status, 'ambiguous');
  await manager.updateGuestDiscovery({ ...hints(lan, nextLan), preferredGuestOrigins: [lan] }); assert.equal(manager.guestOrigin, lan);
  await manager.updateGuestDiscovery({ ...hints(), guestPort: null }); assert.equal(manager.guestAccess.status, 'unavailable');
  assert.equal(manager.guestOrigin, lan);
  await manager.updateGuestDiscovery(emptyHints(true)); assert.equal(manager.guestAccess.status, 'checking'); assert.equal(manager.guestOrigin, lan);
  await manager.updateGuestDiscovery(hints(lan)); assert.equal(manager.guestAccess.status, 'ready');
});

test('deployment override wins over discovery, known internal addresses get an actionable repair, and active playback defers changes', async () => {
  const { manager, saved } = await fixture();
  manager.configureGuestAccess('http://override.local:4000', true, true);
  await manager.updateGuestDiscovery(hints(lan)); assert.equal(manager.guestOrigin, 'http://override.local:4000');
  await manager.saveGuestOrigin('http://172.23.0.2:3000', saved().revision);
  await manager.updateGuestDiscovery({ ...hints(lan), internalHosts: ['172.23.0.2'] });
  assert.equal(manager.guestAccess.status, 'unavailable'); assert.match(manager.guestAccess.message, /automatic/);
  await manager.saveGuestOrigin(null, saved().revision); assert.equal(manager.guestOrigin, 'http://override.local:4000');
  manager.configureGuestAccess('http://localhost:3000', true);
  let playing = true;
  manager.attachPlayback({ get ownsPlayback() { return playing; }, issue: '', configurationChanged() {}, async recover() {} });
  await manager.updateGuestDiscovery(hints(nextLan)); await manager.updateGuestDiscovery(hints(nextLan)); assert.equal(manager.guestOrigin, lan);
  await assert.rejects(manager.saveGuestOrigin(nextLan, saved().revision), /finish/);
  playing = false; await manager.updateGuestDiscovery(hints(nextLan)); assert.equal(manager.guestOrigin, nextLan);
});

test('Supervisor retains real LAN bridges and private 172 networks while excluding container interfaces and addresses', async () => {
  const found = await supervisorHints({ read: async path => path === '/addons/self/info' ? { ip_address: '172.23.0.2', network: { '3000/tcp': 4000 } }
    : path === '/network/info' ? { interfaces: [
      { interface: 'br-lan', type: 'bridge', primary: true, ipv4: { address: ['172.23.5.10/24'] } },
      { interface: 'br-123456abcdef', type: 'bridge', ipv4: { address: ['172.20.0.1/16'] } },
      { interface: 'veth1', ipv4: { address: ['172.23.0.2/24'] } },
      { interface: 'eth9', ipv4: { address: ['172.23.0.2/24'] } },
      { interface: 'wlan0', ipv4: { address: ['192.168.5.8/24'] } },
    ] } : {} }, 3000);
  assert.deepEqual(found.guestOrigins, ['http://172.23.5.10:4000', 'http://192.168.5.8:4000']);
  assert.deepEqual(found.preferredGuestOrigins, ['http://172.23.5.10:4000']);
});

test('guest address discovery completes before slow Music Assistant browsing', async () => {
  const { manager } = await fixture();
  let finishBrowse!: (value: string[]) => void;
  const pending = new Promise<string[]>(resolve => { finishBrowse = resolve; });
  let addressReady!: (value: string) => void;
  const ready = new Promise<string>(resolve => { addressReady = resolve; });
  const setup = new SetupManager({ port: 3000, listenHost: '0.0.0.0', guestUrl: 'http://localhost:3000', dataDir: '.', addon: true }, manager, addressReady,
    { read: async path => path === '/addons/self/info' ? { network: { '3000/tcp': 4000 } } : path === '/network/info' ? { interfaces: [{ primary: true, ipv4: { address: ['192.168.1.8/24'] } }] } : {} },
    () => pending, async () => []);
  const scan = setup.refresh();
  try { assert.equal(await ready, lan); } finally { finishBrowse([]); await scan; setup.close(); }
});
