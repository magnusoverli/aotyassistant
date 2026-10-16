import type { View } from '../src/model';
import { el } from './dom';
import { avatar } from './visuals';

type PlaybackState = 'playing' | 'paused' | 'idle' | 'unavailable';

/** A names-only window in actual turn order, not the original seat numbering. */
export function publicTurnOrder(view: View, limit = 7) {
  const people = view.rotation ?? [];
  const start = Math.max(0, people.findIndex(person => person.id === view.current?.id));
  const ordered = [...people.slice(start), ...people.slice(0, start)];
  const visible = ordered.slice(0, Math.max(2, Math.min(7, Math.floor(limit))));
  return { visible, remaining: people.length - visible.length };
}

export class PublicTurnOrder {
  readonly element = el('section', undefined, 'room-turn-order');
  private list = el('ol', undefined, 'turn-order-list');
  private more = el('p', undefined, 'turn-order-more');
  private currentLabel?: HTMLElement;
  private view?: View;
  private state: PlaybackState = 'idle';
  private limit = 7;
  private key = '';
  private resize?: ResizeObserver;

  constructor() {
    const title = el('h2', 'Turn order'); title.id = 'room-order-title';
    this.element.setAttribute('aria-labelledby', title.id);
    this.list.setAttribute('aria-label', 'Participant rotation'); this.list.tabIndex = 0;
    this.more.id = 'room-order-more';
    this.element.append(title, this.list, this.more);
    this.resize = new ResizeObserver(entries => {
      const width = entries[0]?.contentRect.width ?? 0;
      if (!width) return;
      // Keep at least current + next visible, without squeezing a large roster onto a TV.
      const limit = Math.max(2, Math.min(7, Math.floor((width + 24) / (width < 700 ? 160 : 200))));
      if (limit !== this.limit) { this.limit = limit; if (this.view) this.update(this.view, this.state); }
    });
    this.resize.observe(this.element);
  }

  update(view: View, state: PlaybackState) {
    this.view = view; this.state = state;
    const { visible, remaining } = publicTurnOrder(view, this.limit);
    this.element.hidden = !visible.length;
    const key = JSON.stringify([visible, view.current?.id, view.next?.id, remaining]);
    if (this.key !== key) {
      this.key = key; this.currentLabel = undefined;
      const rows = visible.map(person => {
        const current = person.id === view.current?.id;
        const next = !current && person.id === view.next?.id;
        const row = el('li', undefined, `turn-person${current ? ' is-current' : next ? ' is-next' : ''}`);
        row.dataset.personId = person.id;
        if (current) row.setAttribute('aria-current', 'step');
        const copy = el('div', undefined, 'turn-person-copy');
        if (current || next) {
          const label = el('span', next ? 'Next' : '', 'turn-person-label'); copy.append(label);
          if (current) this.currentLabel = label;
        }
        const name = el('strong', person.nickname); name.title = person.nickname;
        copy.append(name); row.append(avatar(person), copy); return row;
      });
      // The list itself stays mounted: telemetry/pause updates never reset focus or scroll.
      this.list.replaceChildren(...rows);
      this.more.textContent = remaining ? `+${remaining} more in the circle` : '';
      this.more.hidden = !remaining;
      if (remaining) this.list.setAttribute('aria-describedby', this.more.id); else this.list.removeAttribute('aria-describedby');
    }
    if (this.currentLabel) this.currentLabel.textContent = state === 'playing' ? 'Playing' : state === 'paused' ? 'Paused' : 'Current turn';
  }

  destroy() { this.resize?.disconnect(); }
}
