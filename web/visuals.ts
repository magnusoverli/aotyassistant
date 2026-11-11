import type { Person } from '../src/model';
import { el } from './dom';
import { appPath } from './paths';

const avatarKeys = new WeakMap<HTMLElement, string>();

/** Retain the node, but update cached picker/settings avatars when the photo version changes. */
export function updateAvatar(node: HTMLElement, person: Person | null | undefined) {
  const value = person?.nickname ?? '?';
  const key = JSON.stringify([value, person?.avatarUrl]);
  if (avatarKeys.get(node) === key) return;
  avatarKeys.set(node, key);
  let hash = 0; for (const char of value) hash = ((hash << 5) - hash + char.codePointAt(0)!) | 0;
  for (let i = 0; i < 5; i++) node.classList.toggle(`avatar-${i}`, i === Math.abs(hash % 5));
  node.textContent = Array.from(value.trim().toLocaleUpperCase())[0] ?? '?';
  if (person?.avatarUrl) {
    const image = el('img'); image.alt = ''; image.decoding = 'async'; image.draggable = false;
    image.hidden = true;
    image.onload = () => { if (avatarKeys.get(node) === key) image.hidden = false; };
    image.onerror = () => image.remove();
    image.src = appPath(person.avatarUrl); node.append(image);
  }
}

export function avatar(person: Person | null | undefined, size = '', variant = '') {
  const a = el('span', undefined, `avatar ${size} ${variant}`); updateAvatar(a, person);
  a.setAttribute('aria-hidden', 'true'); return a;
}

export function vinyl(personalized?: { owner: string; caption: string }) {
  const record = el('div', undefined, 'vinyl');
  const sticker = el('div', undefined, 'vinyl-label');
  sticker.append(el('span', undefined, 'vinyl-owner'), el('i', undefined, 'vinyl-hole'), el('span', undefined, 'vinyl-caption'));
  record.append(sticker); updateVinylLabel(record, personalized); return record;
}

/** Update only the sticker text, retaining the record and its animation timeline. */
export function updateVinylLabel(record: HTMLElement, personalized?: { owner: string; caption: string }) {
  if (personalized) {
    record.removeAttribute('aria-hidden'); record.setAttribute('role', 'img'); record.setAttribute('aria-label', `${personalized.owner} — ${personalized.caption}`);
  } else {
    record.setAttribute('aria-hidden', 'true'); record.removeAttribute('role'); record.removeAttribute('aria-label');
  }
  const sticker = record.querySelector<HTMLElement>('.vinyl-label')!;
  const owner = sticker.querySelector<HTMLElement>('.vinyl-owner')!;
  sticker.classList.toggle('is-personalized', Boolean(personalized));
  owner.textContent = personalized?.owner ?? 'LISTEN'; owner.title = personalized?.owner ?? '';
  owner.classList.toggle('is-long', Boolean(personalized && Array.from(personalized.owner).length > 20));
  sticker.querySelector('.vinyl-caption')!.textContent = personalized?.caption ?? 'SIDE A';
}
