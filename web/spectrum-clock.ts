import { spectrumBins, visualizerSensitivity, type SpectrumPacket } from '../src/spectrum';

/** Use the least-delayed clock probe, not SSE arrival time, as the presentation clock. */
export class SpectrumClock {
  private probes: { rtt: number; offset: number }[] = [];
  private packet?: SpectrumPacket;
  private receivedAt = 0;
  reset() { this.probes = []; this.clear(); }
  clear() { this.packet = undefined; }
  synchronize(sent: number, received: number, server: number) {
    if (![sent, received, server].every(Number.isFinite) || received < sent || received - sent > 2000) return;
    this.probes.push({ rtt: received - sent, offset: server - (sent + received) / 2 });
    this.probes = this.probes.slice(-8);
  }
  accept(packet: SpectrumPacket, now: number) {
    if (!packet || typeof packet.epoch !== 'string' || !Array.isArray(packet.frames) || packet.frames.length > 100 ||
      typeof packet.sensitivity !== 'number' || !(packet.sensitivity >= visualizerSensitivity.min && packet.sensitivity <= visualizerSensitivity.max) ||
      packet.frames.some(frame => !Number.isFinite(frame.at) || !Array.isArray(frame.bins) || frame.bins.length !== spectrumBins ||
        frame.bins.some(bin => !Number.isFinite(bin) || bin < 0 || bin > 255))) { this.clear(); return; }
    this.packet = packet; this.receivedAt = now;
  }
  sample(now: number, roomId: string | null, participantId: string | null): number[] | undefined {
    const packet = this.packet;
    if (!packet?.active || !this.probes.length || packet.roomId !== roomId || packet.participantId !== participantId || now - this.receivedAt > 1500) return;
    const offset = this.probes.reduce((best, probe) => probe.rtt < best.rtt ? probe : best).offset;
    const time = now + offset;
    const next = packet.frames.findIndex(frame => frame.at > time);
    const previous = packet.frames[next < 0 ? packet.frames.length - 1 : next - 1];
    if (!previous || time - previous.at > 150) return;
    const following = next >= 0 ? packet.frames[next] : undefined;
    const mix = following ? Math.min(1, (time - previous.at) / Math.max(1, following.at - previous.at)) : 0;
    // Applied per sample so a sensitivity change reaches the needles with the next 200 ms packet.
    const scale = packet.sensitivity / 255;
    return previous.bins.map((value, i) => Math.min(1, (value + ((following?.bins[i] ?? value) - value) * mix) * scale));
  }
}
