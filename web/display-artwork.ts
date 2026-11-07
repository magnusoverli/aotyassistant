import type { View } from '../src/model';
import { displayArtworkLimit, unpackDisplayImages, type DisplayImages } from '../src/display-artwork-format';
import { appPath } from './paths';
import { gcm } from '@noble/ciphers/aes.js';

export async function fetchDisplayArtwork(id: string, signal: AbortSignal): Promise<Uint8Array> {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw Error('Invalid artwork preparation.');
  const response = await fetch(appPath(`/api/display/prepared-artwork/${id}`), {
    signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]), credentials: 'same-origin', cache: 'no-store',
  });
  if (!response.ok || !response.body) throw Error('Artwork unavailable.');
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let length = 0;
  try {
    for (;;) {
      const part = await reader.read(); if (part.done) break;
      length += part.value.length;
      if (length > displayArtworkLimit + 28) throw Error('Artwork too large.');
      chunks.push(part.value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  const data = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.length; }
  return data;
}

export async function unlockDisplayArtwork(data: Uint8Array, encodedKey: string): Promise<DisplayImages> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(encodedKey) || data.length < 29 || data.length > displayArtworkLimit + 28) throw Error('Invalid artwork preparation.');
  const key = Uint8Array.from(atob(encodedKey.replace(/-/g, '+').replace(/_/g, '/') + '='), c => c.charCodeAt(0));
  const nonce = new Uint8Array(data.subarray(0, 12)); const encrypted = new Uint8Array(data.subarray(12));
  let plain: Uint8Array;
  if (globalThis.crypto?.subtle) {
    const cryptoKey = await crypto.subtle.importKey('raw', key, 'AES-GCM', false, ['decrypt']);
    plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, cryptoKey, encrypted));
  } else {
    // LAN HTTP displays lack Web Crypto's secure context. Use the same audited
    // AES-GCM implementation already included by the browser-audio dependency.
    plain = gcm(key, nonce).decrypt(encrypted);
  }
  return unpackDisplayImages(plain);
}

type Options = {
  load(id: string, signal: AbortSignal): Promise<Uint8Array>;
  unlock(data: Uint8Array, key: string): Promise<DisplayImages>;
  ready(images: DisplayImages): void;
  failed(): void;
};
/** Download while concealed, decrypt only with the reveal key. One request per
 * playback preparation; late completion cannot cross a turn or page boundary. */
export class DisplayArtworkLoader {
  private current?: { id: string; scope: string; abort: AbortController; data: Promise<Uint8Array | undefined>; unlocking: boolean };
  constructor(private options: Options) {}
  clear() { this.current?.abort.abort(); this.current = undefined; }
  update(prepared: View['preparedArtwork'], scope: string, revealed: boolean) {
    if (!prepared || !scope) { this.clear(); return; }
    if (!revealed && this.current?.unlocking) this.clear();
    if (this.current?.id !== prepared.id || this.current.scope !== scope) {
      this.clear(); const abort = new AbortController();
      this.current = { id: prepared.id, scope, abort, unlocking: false,
        data: this.options.load(prepared.id, abort.signal).catch(() => undefined) };
    }
    const current = this.current;
    if (!revealed || !prepared.key || current.unlocking) return;
    current.unlocking = true;
    void current.data.then(async data => {
      if (this.current !== current) return;
      if (!data) throw Error('Artwork unavailable.');
      const images = await this.options.unlock(data, prepared.key!);
      if (this.current === current) this.options.ready(images);
    }).catch(() => { if (this.current === current) this.options.failed(); });
  }
}
