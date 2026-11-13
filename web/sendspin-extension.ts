import { SendspinPlayer, type SendspinPlayerConfig, type SendspinCore, type SendspinDecoder,
  type AudioScheduler, type DecodedAudioChunk, type StreamFormat, type ClientMessage } from '@sendspin/sendspin-js';
import { AudioPolicy, browserCodecs, lanAudio, type AudioCodec, type AudioHealth, type AudioNetwork } from './audio-policy';
import { probeCodec, softwareDecoder } from './audio-probe';

/** Instance-scoped extension for @sendspin/sendspin-js 6.0.0. The SDK does not yet
 * expose decoder health or codec changes on SendspinPlayer. Keep all private
 * access here; the contract test pins the version and exercises the real SDK.
 * No monkey-patched prototypes, replaced audio output, or raw encrypted frames. */
type CoreBridge = Omit<SendspinCore, never> & {
  decoder: SendspinDecoder;
  protocolHandler: { codecs: AudioCodec[]; lastSentState: string | null; sendStateUpdate(): void };
  transport: { sendControl(message: ClientMessage, role?: string): void };
  _onAudioData?: (chunk: DecodedAudioChunk) => void;
};
type Bridge = { core: CoreBridge; scheduler: AudioScheduler };
type Capabilities = { userAgent: string; nativeOpus: boolean; probe: typeof probeCodec };

export class AutomaticAudioPlayer extends SendspinPlayer {
  private bridge: Bridge;
  private policy: AudioPolicy;
  private verified: AudioCodec[] = ['pcm'];
  private softwareOpus = false;
  private usingSoftware = false;
  private preparation: Promise<void>;
  private monitor?: ReturnType<typeof setInterval>;
  private formatDeadline?: ReturnType<typeof setTimeout>;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private stopped = false;
  private destroyed = false;
  private revision = 0;
  private advertisedFormats: StreamFormat[] = [];
  private preferredFormat?: StreamFormat;
  constructor(config: SendspinPlayerConfig, private retry: () => void, capabilities: Capabilities = {
    userAgent: navigator.userAgent, nativeOpus: typeof (globalThis as { AudioDecoder?: unknown }).AudioDecoder !== 'undefined', probe: probeCodec,
  }, network: AudioNetwork = lanAudio) {
    super({ ...config, codecs: ['pcm'], requiredLeadTimeMs: network.leadTimeMs, minBufferMs: network.minBufferMs, correctionMode: 'sync',
      ...(network.bufferCapacity ? { bufferCapacity: network.bufferCapacity } : {}) });
    this.bridge = this as unknown as Bridge;
    const { core, scheduler } = this.bridge;
    this.policy = new AudioPolicy(() => this.recover(), ms => this.setMinBufferMs(ms), network);
    // Observe the actual hello after the SDK's second compatibility filter, and
    // augment its full state (never send a partial player object). SDK 6 speaks
    // rc1/player@v1; older wire protocols cannot complete its handshake.
    const send = core.transport.sendControl.bind(core.transport);
    core.transport.sendControl = (message, role) => {
      if (message.type === 'client/hello') {
        this.advertisedFormats = message.payload['player@v1_support']?.supported_formats ?? [];
        this.policy.health.advertisedCodecs = [...new Set(this.advertisedFormats.map(format => format.codec as AudioCodec))];
        if (this.verified.includes('opus') && !this.policy.health.advertisedCodecs.includes('opus')) this.policy.health.opusSupport = 'sdk-excluded';
        if (this.preferredFormat && !this.advertisedFormats.some(format => this.sameFormat(format, this.preferredFormat!))) this.preferredFormat = undefined;
      }
      if (message.type === 'client/state' && message.payload.player && this.preferredFormat) {
        message = { ...message, payload: { ...message.payload, player: { ...message.payload.player, format: this.preferredFormat } } } as ClientMessage;
      }
      send(message, role);
    };
    const decode = core.decoder.handleBinaryMessage.bind(core.decoder);
    core.decoder.handleBinaryMessage = async (data, format, generation) => {
      if (new Uint8Array(data)[0] === 4 && data.byteLength >= 13) {
        this.policy.received(Number(new DataView(data).getBigInt64(1, false)), generation, performance.now());
      }
      try { await decode(data, format, generation); }
      catch { /* Missing decoded output is handled by the bounded watchdog. */ }
    };
    const output = core._onAudioData;
    core.onAudioData = chunk => {
      const running = scheduler.getAudioContext()?.state === 'running' && this.timeSyncInfo.synced;
      this.policy.decoded(chunk.serverTimeUs, chunk.generation, performance.now(), running
        ? chunk.serverTimeUs < this.getCurrentServerTimeUs() - 20_000 : undefined);
      output?.(chunk);
    };
    const start = core.handleStreamStart.bind(core);
    core.handleStreamStart = (format, update) => {
      start(format, update);
      this.policy.reset(core._stateManager.streamGeneration);
      this.format(format);
    };
    const clear = core.handleStreamClear.bind(core);
    core.handleStreamClear = () => { clear(); this.policy.reset(core._stateManager.streamGeneration); };
    const end = core.handleStreamEnd.bind(core);
    core.handleStreamEnd = () => {
      end(); this.policy.reset(core._stateManager.streamGeneration); this.format(null);
    };
    // Capability probing must never block the reliable PCM baseline.
    this.preparation = this.prepare(capabilities).catch(() => {});
  }
  private async prepare(capabilities: Capabilities) {
    const candidates = browserCodecs(capabilities.userAgent, capabilities.nativeOpus);
    this.policy.health.opusSupport = candidates.includes('opus') ? 'probe-failed' : 'browser-excluded';
    const probe: typeof probeCodec = async (...args) => { try { return await capabilities.probe(...args); } catch { return false; } };
    const checks = await Promise.all(candidates.map(async codec => {
      if (codec === 'pcm') return codec;
      if (codec === 'flac') return (await Promise.all([probe(codec), probe(codec, 'native', 44100)])).every(Boolean) ? codec : undefined;
      const [native, software] = await Promise.all([capabilities.nativeOpus ? probe(codec) : Promise.resolve(false), probe(codec, 'software')]);
      this.softwareOpus = software;
      this.usingSoftware = !native && software;
      this.policy.health.opusSupport = native ? 'native' : software ? 'software' : 'probe-failed';
      return native || software ? codec : undefined;
    }));
    if (this.destroyed) return;
    this.verified = checks.filter((codec): codec is AudioCodec => Boolean(codec));
    this.bridge.core.protocolHandler.codecs = [...this.verified];
  }
  private format(format: StreamFormat | null) {
    const health = this.policy.health;
    if (!format) { delete health.codec; delete health.sampleRate; delete health.bitDepth; delete health.channels; return; }
    if (!['opus', 'flac', 'pcm'].includes(format.codec)) return;
    health.codec = format.codec as AudioCodec; health.sampleRate = format.sample_rate;
    health.bitDepth = format.bit_depth; health.channels = format.channels;
    if (this.preferredFormat && this.sameFormat(format, this.preferredFormat)) {
      clearTimeout(this.formatDeadline); this.formatDeadline = undefined; health.formatRequest = 'accepted';
    }
  }
  private sameFormat(a: StreamFormat, b: StreamFormat) {
    return a.codec === b.codec && a.sample_rate === b.sample_rate && a.channels === b.channels && a.bit_depth === b.bit_depth;
  }
  private recover() {
    if (this.destroyed || this.stopped || !this.isConnected || this.formatDeadline) return;
    const codec = this.currentFormat?.codec;
    const { core } = this.bridge;
    if (codec === 'opus' && !this.usingSoftware && this.softwareOpus) {
      // Preserve the scheduler, its unlocked AudioContext, and queued audio.
      core.decoder.clearState(); softwareDecoder(core.decoder); this.usingSoftware = true;
      this.policy.health.opusSupport = 'software';
      this.policy.health.recoveries++;
      return;
    }
    if (codec !== 'opus' && codec !== 'flac') return;
    this.policy.health.recoveries++;
    this.verified = this.verified.filter(item => item !== codec);
    if (codec === 'opus') this.policy.health.opusSupport = 'decoder-failed';
    core.protocolHandler.codecs = [...this.verified];
    const next = this.verified.find(codec => this.advertisedFormats.some(format => format.codec === codec));
    const formats = this.advertisedFormats.filter(format => format.codec === next);
    this.preferredFormat = formats.find(format => format.sample_rate === this.currentFormat?.sample_rate) ?? formats[0];
    this.policy.health.requestedCodec = next; this.policy.health.formatRequest = 'pending';
    // An ignored preference (including a server override) gets one bounded
    // reconnect with reduced capabilities, not a speculative legacy message.
    this.formatDeadline = setTimeout(() => {
      this.formatDeadline = undefined;
      if (this.destroyed || this.stopped) return;
      this.policy.health.formatRequest = 'ignored';
      super.disconnect('restart'); this.policy.reset(-1);
      this.reconnectTimer = setTimeout(() => { this.reconnectTimer = undefined; if (!this.destroyed && !this.stopped) this.retry(); }, 250);
    }, 4000);
    core.protocolHandler.lastSentState = null;
    if (this.preferredFormat) core.protocolHandler.sendStateUpdate();
  }
  async connect() {
    this.stopped = false;
    const revision = ++this.revision;
    await this.preparation;
    if (this.destroyed || this.stopped || revision !== this.revision) return;
    if (this.usingSoftware) softwareDecoder(this.bridge.core.decoder);
    this.monitor ??= setInterval(() => {
      if (this.isConnected) this.policy.check(performance.now());
      else { this.policy.reset(-1); this.format(null); }
    }, 500);
    await super.connect();
  }
  diagnostics(): AudioHealth { return { ...this.policy.health,
    ...(this.policy.health.advertisedCodecs ? { advertisedCodecs: [...this.policy.health.advertisedCodecs] } : {}) }; }
  disconnect(reason?: Parameters<SendspinPlayer['disconnect']>[0]) {
    this.stopped = true; this.revision++;
    clearInterval(this.monitor); this.monitor = undefined;
    clearTimeout(this.formatDeadline); this.formatDeadline = undefined;
    clearTimeout(this.reconnectTimer); this.reconnectTimer = undefined;
    this.policy.reset(-1); this.format(null); super.disconnect(reason);
  }
  destroy(reason?: Parameters<SendspinPlayer['destroy']>[0]) {
    this.destroyed = true; super.destroy(reason);
  }
}
