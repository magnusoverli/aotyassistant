import type { Person, View } from '../src/model';
import { el, label } from './dom';

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

export function rotation(view: View, publicDisplay = false, expanded = false) {
  const panel = publicDisplay ? el('section', undefined, 'room-rotation') : el('details', undefined, 'circle-panel');
  if (panel instanceof HTMLDetailsElement) panel.open = expanded;
  const head = publicDisplay ? el('div', undefined, 'section-heading') : el('summary', undefined, 'section-heading');
  const title = el('div', undefined, publicDisplay ? '' : 'circle-position');
  if (publicDisplay) title.append(label('PARTICIPANTS'));
  else {
    title.append(el('h2', 'Listening order'));
  }
  if (!publicDisplay) head.append(title, el('span', '⌄', 'circle-caption')); else head.append(title);
  panel.append(head);
  const all = view.rotation ?? [];
  if (!all.length) { panel.append(el('p', 'No participants have joined.', 'muted')); return panel; }
  // TVs get a bounded, current-first window; phones retain the stable numbered seating order.
  const start = publicDisplay && view.current ? all.findIndex(p => p.id === view.current!.id) : 0;
  const order = publicDisplay ? [...all.slice(Math.max(0, start)), ...all.slice(0, Math.max(0, start))].slice(0, 7) : all;
  const list = el('ol', undefined, 'rotation-list'); list.setAttribute('aria-label', 'Participant rotation'); list.tabIndex = 0;
  for (const person of order) {
    const current = person.id === view.current?.id; const me = person.id === view.me?.id;
    const row = el('li', undefined, `rotation-seat${current ? ' is-current' : ''}${me ? ' is-you' : ''}`);
    row.dataset.personId = person.id;
    if (current) row.setAttribute('aria-current', 'step');
    row.append(el('span', String(all.findIndex(p => p.id === person.id) + 1).padStart(2, '0'), 'seat-number'), avatar(person),
      el('strong', person.nickname), el('span', current && me ? 'Your turn' : current ? 'Current turn' : me ? 'You' : person.id === view.next?.id ? 'Up next' : 'Listening', 'seat-state'));
    list.append(row);
  }
  panel.append(list);
  if (publicDisplay && all.length > order.length) panel.append(el('span', `+${all.length - order.length} more in the circle`, 'muted small'));
  return panel;
}
