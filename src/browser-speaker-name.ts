import { productName } from './product.js';

export const browserDevices = ['iPhone', 'iPad', 'Android phone', 'Android tablet', 'Mac', 'Windows PC', 'Chromebook', 'Linux PC', 'Mobile', 'Browser'] as const;
export type BrowserDevice = typeof browserDevices[number];

/** A friendly display label, independent of the player's identity. */
export function browserSpeakerName(device: BrowserDevice, username?: string) {
  const end = `${device})`;
  const user = username?.replace(/[\p{Cc}\p{Cf}]/gu, '').replace(/\s+/g, ' ').trim();
  const prefix = `${productName} (`;
  let label = '';
  for (const character of user ?? '') {
    if (label.length + character.length > 60 - prefix.length - end.length - 3) break;
    label += character;
  }
  if (label) label += ' · ';
  return prefix + label + end;
}
