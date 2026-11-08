import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import type { StreamFormat, SendspinDecoder, DecodedAudioChunk } from '@sendspin/sendspin-js';
import { AutomaticAudioPlayer } from '../web/sendspin-extension.js';
import { AudioPolicy, lanAudio, onlineAudio, type AudioCodec, type DecoderMode } from '../web/audio-policy.js';
import { probeFrame } from '../web/audio-probe.js';

// Exercise the real pinned SDK. Only the browser output and network boundary
// are replaced: protocol, decoder, state, identity and extension are real.
type Internals = {
  preparation: Promise<void>; policy: AudioPolicy;
  core: {
    connect(): Promise<void>; handleStreamStart(format: StreamFormat, update: boolean): void;
    handleStreamEnd(): void; handleStreamClear(): void;
    _stateManager: { currentStreamFormat: StreamFormat | null; streamGeneration: number };
    protocolHandler: { codecs: AudioCodec[]; sendClientHello(): void; requiredLeadTimeMs: number; minBufferMs: number };
    transport: { sendControl(message: unknown): void };
    decoder: Omit<SendspinDecoder, never> & { useNativeOpus: boolean };
  };
  scheduler: {
    initAudioContext(): void; resumeAudioContext(): Promise<void>; startAudioElement(): void;
    handleDecodedChunk(chunk: DecodedAudioChunk): void; close(): void;
  };
};
async function fixture(t: TestContext, probe: (codec: AudioCodec, mode?: DecoderMode, rate?: number) => Promise<boolean> = async () => true, ua = 'Chrome/130 Safari/537', network = lanAudio) {
  const store = new Map<string, string>(); let retries = 0; let output = 0; let closes = 0;
  const player = new AutomaticAudioPlayer({ clientName: 'Fixture', url: 'ws://localhost/sendspin', storage: {
    getItem: key => store.get(key) ?? null, setItem: (key, value) => { store.set(key, value); },
  } }, () => { retries++; }, { userAgent: ua, nativeOpus: true, probe }, network);
  const internals = player as unknown as Internals;
  const core = internals.core; const scheduler = internals.scheduler; const messages: unknown[] = [];
  core.connect = async () => {};
  Object.defineProperty(core, 'isConnected', { get: () => true });
  core.transport.sendControl = message => { messages.push(message); };
  scheduler.initAudioContext = () => {}; scheduler.resumeAudioContext = async () => {}; scheduler.startAudioElement = () => {};
  scheduler.handleDecodedChunk = () => { output++; }; scheduler.close = () => { closes++; };
  t.after(() => player.destroy());
  await internals.preparation;
  const start = (codec: AudioCodec, update = false) => {
    const format = { codec, sample_rate: 48000, channels: 2, bit_depth: 16 };
    core._stateManager.currentStreamFormat = format; core.handleStreamStart(format, update);
  };
  const fail = () => {
    for (let n = 0; n < 3; n++) internals.policy.received(n, core._stateManager.streamGeneration, 0);
    internals.policy.check(3000);
  };
  return { player, internals, core, scheduler, messages, start, fail, store, retries: () => retries, output: () => output, closes: () => closes };
}

test('SDK extension contract is pinned and real client hello advertises only verified codecs', async t => {
  const pkg = JSON.parse(await readFile(new URL('../node_modules/@sendspin/sendspin-js/package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.version, '6.0.0', 'Revalidate this scoped extension before upgrading the SDK.');
  const f = await fixture(t); f.core.protocolHandler.sendClientHello();
  const hello = f.messages.at(-1) as { payload: { 'player@v1_support': { supported_formats: StreamFormat[]; buffer_capacity: number } } };
  // Node lacks WebCodecs: the actual SDK applies its own compatibility filter.
  assert.deepEqual([...new Set(hello.payload['player@v1_support'].supported_formats.map(format => format.codec))], ['flac', 'pcm']);
  assert.deepEqual(f.core.protocolHandler.codecs, ['opus', 'flac', 'pcm']);
  assert.equal(f.core.protocolHandler.requiredLeadTimeMs, 250); assert.equal(f.core.protocolHandler.minBufferMs, 500);
  assert.ok(hello.payload['player@v1_support'].buffer_capacity > 5_000_000, 'LAN keeps the SDK default stream-ahead bytes.');
});

test('online (Funnel) speakers start later, buffer more and cap stream-ahead bytes at Opus maximum for 30 s', async t => {
  const f = await fixture(t, undefined, undefined, onlineAudio); f.core.protocolHandler.sendClientHello();
  const hello = f.messages.at(-1) as { payload: { 'player@v1_support': { buffer_capacity: number } } };
  assert.equal(hello.payload['player@v1_support'].buffer_capacity, 1_920_000);
  assert.equal(f.core.protocolHandler.requiredLeadTimeMs, 1000); assert.equal(f.core.protocolHandler.minBufferMs, 1500);
  assert.equal(f.player.diagnostics().minBufferMs, 1500);
});

test('failed capability probes automatically select PCM; denied probes cannot prevent connection', async t => {
  const f = await fixture(t, async () => false); assert.deepEqual(f.core.protocolHandler.codecs, ['pcm']);
  await f.player.connect();
  const rejected = await fixture(t, async () => { throw new Error('Decoder unavailable'); });
  await rejected.player.connect(); assert.deepEqual(rejected.core.protocolHandler.codecs, ['pcm']);
});

test('native failure uses verified software Opus before negotiating another codec without replacing audio output', async t => {
  const f = await fixture(t); await f.player.connect(); f.start('opus');
  const id = f.player.clientId; const token = f.player.pairingToken;
  f.fail(); assert.equal(f.core.decoder.useNativeOpus, false); assert.equal(f.messages.length, 0);
  f.fail();
  assert.deepEqual(f.messages.at(-1), { type: 'stream/request-format', payload: { player: { codec: 'flac', sample_rate: 48000, channels: 2, bit_depth: 16 } } });
  f.start('flac', true); assert.equal(f.player.diagnostics().codec, 'flac');
  f.fail(); assert.deepEqual(f.core.protocolHandler.codecs, ['pcm']); f.start('pcm', true);
  assert.equal(f.player.clientId, id); assert.equal(f.player.pairingToken, token);
  assert.equal(f.internals.scheduler, f.scheduler); assert.equal(f.closes(), 0);
  assert.equal(f.player.diagnostics().recoveries, 3);
  const { data, format } = probeFrame('pcm');
  await f.core.decoder.handleBinaryMessage(data, format, f.core._stateManager.streamGeneration);
  assert.equal(f.output(), 1); assert.equal(f.player.diagnostics().decodedChunks, 1);
  f.core.handleStreamEnd(); assert.equal(f.player.diagnostics().codec, undefined);
});

test('ignored format requests re-register the same identity automatically and retain the unlocked output', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const f = await fixture(t, async (_codec, mode) => mode !== 'software');
  await f.player.connect(); f.start('opus'); const id = f.player.clientId;
  f.fail(); t.mock.timers.tick(4000); assert.equal(f.retries(), 0);
  t.mock.timers.tick(250); assert.equal(f.retries(), 1); assert.equal(f.closes(), 0);
  await f.player.connect(); assert.equal(f.player.clientId, id); assert.deepEqual(f.core.protocolHandler.codecs, ['flac', 'pcm']);
});

test('stop cancels codec fallback deadlines and late probe completion cannot reconnect a destroyed player', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const f = await fixture(t, async (_codec, mode) => mode !== 'software');
  await f.player.connect(); f.start('opus'); f.fail(); f.player.disconnect();
  t.mock.timers.tick(5000); assert.equal(f.retries(), 0);
  let release!: (value: boolean) => void;
  const pending = new Promise<boolean>(resolve => { release = resolve; });
  const player = new AutomaticAudioPlayer({ clientName: 'Fixture', storage: null }, () => assert.fail('Destroyed player retried'),
    { userAgent: 'Chrome/130', nativeOpus: true, probe: () => pending });
  let connections = 0; (player as unknown as Internals).core.connect = async () => { connections++; };
  const connected = player.connect(); player.destroy(); release(true); await connected;
  assert.equal(connections, 0);
});
