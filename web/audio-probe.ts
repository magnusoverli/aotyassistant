import { SendspinDecoder, type StreamFormat } from '@sendspin/sendspin-js';
import type { AudioCodec, DecoderMode } from './audio-policy';

// Tiny generated silence fixtures: a standard 20ms raw Opus silence packet,
// and a 16-sample, two-channel, 16-bit FLAC constant frame (no external media).
function crc(bytes: number[], bits: 8 | 16, polynomial: number) {
  let value = 0;
  for (const byte of bytes) {
    value ^= byte << (bits - 8);
    for (let bit = 0; bit < 8; bit++) value = (value << 1) ^ (value & (1 << (bits - 1)) ? polynomial : 0);
    value &= (1 << bits) - 1;
  }
  return value;
}
export function probeFrame(codec: AudioCodec, sampleRate = 48000): { data: ArrayBuffer; format: StreamFormat } {
  const format: StreamFormat = { codec, sample_rate: sampleRate, channels: 2, bit_depth: 16 };
  let bytes = codec === 'opus' ? [0xf8, 0xff, 0xfe] : Array<number>(64).fill(0);
  if (codec === 'flac') {
    const info = Array<number>(34).fill(0); info[1] = info[3] = 16;
    let packed = (BigInt(sampleRate) << 44n) | (1n << 41n) | (15n << 36n) | 16n;
    for (let index = 17; index >= 10; index--) { info[index] = Number(packed & 255n); packed >>= 8n; }
    format.codec_header = btoa(String.fromCharCode(0x66, 0x4c, 0x61, 0x43, 0x80, 0, 0, 34, ...info));
    bytes = [0xff, 0xf8, 0x60, 0x18, 0, 15]; bytes.push(crc(bytes, 8, 7));
    bytes.push(0, 0, 0, 0, 0, 0); // Two constant-zero subframes.
    const checksum = crc(bytes, 16, 0x8005); bytes.push(checksum >> 8, checksum & 255);
  }
  const data = new ArrayBuffer(13 + bytes.length); new Uint8Array(data)[0] = 4;
  new Uint8Array(data, 13).set(bytes);
  return { data, format };
}

/** Scoped access to the pinned SDK's decoder switch; no global/prototype patch. */
export function softwareDecoder(decoder: SendspinDecoder) {
  (decoder as unknown as { useNativeOpus: boolean }).useNativeOpus = false;
}

export async function probeCodec(codec: AudioCodec, mode: DecoderMode = 'native', sampleRate = 48000): Promise<boolean> {
  return new Promise(resolve => {
    let done = false;
    const finish = (success: boolean) => {
      if (done) return; done = true; clearTimeout(timer); decoder.close(); resolve(success);
    };
    const decoder = new SendspinDecoder(chunk => {
      finish(chunk.sampleRate === sampleRate && chunk.samples.length === 2 && chunk.samples.every(samples => samples.length > 0 && samples.every(Number.isFinite)));
    }, () => done ? 1 : 0);
    if (mode === 'software') softwareDecoder(decoder);
    else if (codec === 'opus') {
      // Probe native decoding independently; otherwise the SDK's own fallback
      // could hide a broken native path and race the software module's onready.
      (decoder as unknown as { decodeOpusWithEncdec: () => Promise<null> }).decodeOpusWithEncdec = async () => null;
    }
    const timer = setTimeout(() => finish(false), 1500);
    const { data, format } = probeFrame(codec, sampleRate);
    void decoder.handleBinaryMessage(data, format, 0).catch(() => finish(false)).finally(() => {
      if (codec === 'opus' && mode === 'native' && !(decoder as unknown as { useNativeOpus: boolean }).useNativeOpus) finish(false);
      if (done) decoder.close();
    });
  });
}
