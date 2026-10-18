import type { Person } from '../src/model';
import { el } from './dom';

export function avatar(person: Person | null | undefined, size = '', variant = '') {
  const value = person?.nickname ?? '?';
  const initials = value.trim().split(/\s+/u).map(word => Array.from(word)[0] ?? '').slice(0, 2).join('').toLocaleUpperCase();
  let hash = 0; for (const char of value) hash = ((hash << 5) - hash + char.codePointAt(0)!) | 0;
  const a = el('span', initials, `avatar avatar-${Math.abs(hash % 5)} ${size} ${variant}`);
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
  owner.textContent = personalized?.owner ?? 'AOTY'; owner.title = personalized?.owner ?? '';
  owner.classList.toggle('is-long', Boolean(personalized && Array.from(personalized.owner).length > 20));
  sticker.querySelector('.vinyl-caption')!.textContent = personalized?.caption ?? 'SIDE A';
}
