import type { Person } from '../src/model';
import { el } from './dom';

export type OrderMove = { id: string; ids: string[]; revision: number };
type State = { enabled: boolean; roomId: string | null; revision: number; people: Person[] };
type Options = { state(): State; commit(move: OrderMove): Promise<void>; announce(message: string): void };
type Drag = {
  state: State; source: HTMLElement; id: string; name: string; index: number; active: boolean;
  pointer?: number; x: number; y: number; startX: number; startY: number; offsetX: number; offsetY: number;
  valid: boolean; ghost?: HTMLElement;
};

/** Pointer and keyboard previews stay local; only a completed drop writes the captured order. */
export class OrderDrag {
  private drag?: Drag;
  private marker = el('div', undefined, 'order-drop-marker');
  private frame = 0;
  private lastFrame = 0;
  private blockClick = false;

  constructor(private list: HTMLElement, private options: Options) {
    this.marker.setAttribute('aria-hidden', 'true');
    list.addEventListener('pointerdown', this.pointerDown);
    list.addEventListener('pointermove', this.pointerMove);
    list.addEventListener('pointerup', this.pointerUp);
    list.addEventListener('pointercancel', () => this.cancel());
    list.addEventListener('lostpointercapture', () => this.cancel());
    list.addEventListener('keydown', this.keydown);
    list.addEventListener('dragstart', event => { if (this.options.state().enabled) event.preventDefault(); });
    list.addEventListener('click', event => {
      if (this.blockClick) { event.preventDefault(); event.stopImmediatePropagation(); this.blockClick = false; }
    }, true);
    window.addEventListener('blur', () => this.cancel());
    window.addEventListener('pagehide', () => this.cancel());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.cancel(); });
  }

  update() {
    const drag = this.drag; if (!drag) return;
    const state = this.options.state();
    if (!state.enabled || state.roomId !== drag.state.roomId || state.revision !== drag.state.revision) {
      this.cancel('The room changed. Pick up the participant again to reorder.');
    }
  }

  cancel(message = 'Reordering cancelled.') {
    const active = this.drag?.active; this.clear();
    if (active) this.options.announce(message);
  }

  private create(source: HTMLElement, pointer?: PointerEvent): Drag | undefined {
    const state = this.options.state(); if (!state.enabled || state.people.length < 2) return;
    const index = state.people.findIndex(person => person.id === source.dataset.personId); const person = state.people[index];
    if (!person) return;
    const box = source.getBoundingClientRect(); const x = pointer?.clientX ?? box.x; const y = pointer?.clientY ?? box.y;
    return { state: { ...state, people: [...state.people] }, source, id: person.id, name: person.nickname, index, active: false,
      pointer: pointer?.pointerId, x, y, startX: x, startY: y, offsetX: x - box.x, offsetY: y - box.y, valid: true };
  }

  private begin(drag: Drag) {
    drag.active = true;
    if (drag.pointer !== undefined) {
      const box = drag.source.getBoundingClientRect(); const ghost = drag.source.cloneNode(true) as HTMLElement;
      ghost.classList.add('order-drag-preview'); ghost.setAttribute('aria-hidden', 'true'); ghost.inert = true;
      for (const node of [ghost, ...ghost.querySelectorAll('[id], [data-focus-key], [tabindex]')]) {
        node.removeAttribute('id'); node.removeAttribute('data-focus-key'); node.removeAttribute('tabindex');
      }
      ghost.removeAttribute('aria-current'); ghost.style.width = `${box.width}px`; ghost.style.height = `${box.height}px`;
      document.body.append(ghost); drag.ghost = ghost; drag.source.classList.add('is-dragging'); this.list.classList.add('is-dragging');
      this.lastFrame = performance.now(); this.frame = requestAnimationFrame(this.tick);
    } else drag.source.classList.add('is-keyboard-dragging');
    this.options.announce(`Picked up ${drag.name}, position ${drag.index + 1} of ${drag.state.people.length}. Use arrow keys to move, Enter or Space to drop, Escape to cancel.`);
    this.paint(drag);
  }

  private pointerDown = (event: PointerEvent) => {
    if (this.drag || !event.isPrimary || event.button !== 0 || !(event.target instanceof Element) || event.target.closest('button, a, input, select, textarea')) return;
    const source = event.target.closest<HTMLElement>('.rotation-seat'); if (!source || !this.list.contains(source)) return;
    this.drag = this.create(source, event); if (!this.drag) return;
    source.focus({ preventScroll: true }); this.list.setPointerCapture(event.pointerId);
  };

  private pointerMove = (event: PointerEvent) => {
    const drag = this.drag; if (!drag || event.pointerId !== drag.pointer) return;
    drag.x = event.clientX; drag.y = event.clientY;
    if (!drag.active && Math.hypot(drag.x - drag.startX, drag.y - drag.startY) >= 8) this.begin(drag);
    if (drag.active) { event.preventDefault(); this.pointerPosition(drag); }
  };

  private pointerUp = (event: PointerEvent) => {
    const drag = this.drag; if (!drag || event.pointerId !== drag.pointer) return;
    if (!drag.active) { this.clear(); return; }
    drag.x = event.clientX; drag.y = event.clientY; this.pointerPosition(drag);
    this.blockClick = true; setTimeout(() => { this.blockClick = false; }, 0);
    if (drag.valid) this.drop(); else this.cancel();
  };

  private keydown = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && this.drag) { event.preventDefault(); this.cancel(); return; }
    if (event.key === 'Tab' && this.drag) { this.cancel(); return; }
    if (!(event.target instanceof HTMLElement) || !event.target.matches('.rotation-seat')) return;
    if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault(); if (event.repeat) return;
      if (this.drag) { if (this.drag.pointer === undefined) this.drop(); }
      else { this.drag = this.create(event.target); if (this.drag) this.begin(this.drag); }
      return;
    }
    const drag = this.drag; if (!drag?.active || drag.pointer !== undefined) return;
    const shift = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }[event.key];
    if (shift === undefined && event.key !== 'Home' && event.key !== 'End') return;
    event.preventDefault();
    const index = event.key === 'Home' ? 0 : event.key === 'End' ? drag.state.people.length - 1 : drag.index + shift!;
    this.position(drag, Math.max(0, Math.min(drag.state.people.length - 1, index)));
    const rows = this.remaining(drag); const target = rows[drag.index] ?? rows.at(-1);
    target?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' }); this.paint(drag);
  };

  private tick = (now: number) => {
    this.frame = 0; const drag = this.drag; if (!drag?.active || drag.pointer === undefined) return;
    const box = this.list.getBoundingClientRect(); const edge = Math.min(48, box.width / 5);
    const elapsed = Math.min(32, now - this.lastFrame); this.lastFrame = now;
    if (drag.y >= box.top - 12 && drag.y <= box.bottom + 12 && drag.x >= box.left - 28 && drag.x <= box.right + 28) {
      const speed = drag.x < box.left + edge ? -Math.min(1, (box.left + edge - drag.x) / edge)
        : drag.x > box.right - edge ? Math.min(1, (drag.x - box.right + edge) / edge) : 0;
      this.list.scrollLeft += speed * elapsed * .7;
    }
    this.pointerPosition(drag); this.frame = requestAnimationFrame(this.tick);
  };

  private remaining(drag: Drag) {
    return [...this.list.querySelectorAll<HTMLElement>('.rotation-seat')].filter(row => row.dataset.personId !== drag.id);
  }

  private pointerPosition(drag: Drag) {
    const box = this.list.getBoundingClientRect();
    drag.valid = drag.x >= box.left - 28 && drag.x <= box.right + 28 && drag.y >= box.top - 12 && drag.y <= box.bottom + 12;
    const rows = this.remaining(drag);
    const index = rows.findIndex(row => { const rect = row.getBoundingClientRect(); return drag.x < rect.left + rect.width / 2; });
    if (drag.valid) this.position(drag, index < 0 ? rows.length : index);
    this.paint(drag);
  }

  private position(drag: Drag, index: number) {
    if (index === drag.index) return;
    drag.index = index;
    this.options.announce(`${drag.name}: position ${index + 1} of ${drag.state.people.length}. Drop to save the order.`);
  }

  private paint(drag: Drag) {
    if (drag.ghost) {
      drag.ghost.style.transform = `translate(${drag.x - drag.offsetX}px,${drag.y - drag.offsetY}px)`;
      drag.ghost.classList.toggle('is-invalid-drop', !drag.valid);
      drag.ghost.querySelector('.seat-number')!.textContent = String(drag.index + 1).padStart(2, '0');
    }
    const rows = this.remaining(drag); const target = rows[drag.index] ?? rows.at(-1);
    if (!drag.valid || !target || drag.state.people[drag.index]?.id === drag.id) { this.marker.remove(); return; }
    const box = target.getBoundingClientRect(); const list = this.list.getBoundingClientRect();
    const gap = parseFloat(getComputedStyle(this.list).columnGap);
    const x = rows[drag.index] ? box.left - gap / 2 : box.right + gap / 2;
    this.marker.style.left = `${Math.max(list.left + 2, Math.min(list.right - 4, x - 1.5))}px`;
    this.marker.style.top = `${box.top}px`; this.marker.style.height = `${box.height}px`;
    if (!this.marker.isConnected) document.body.append(this.marker);
  }

  private drop() {
    this.update(); const drag = this.drag; if (!drag?.active) return;
    const ids = drag.state.people.filter(person => person.id !== drag.id).map(person => person.id); ids.splice(drag.index, 0, drag.id);
    this.clear();
    if (ids.every((id, index) => id === drag.state.people[index]?.id)) { this.options.announce('Listening order unchanged.'); return; }
    this.options.announce(`Saving ${drag.name} at position ${drag.index + 1}…`);
    void this.options.commit({ id: drag.id, ids, revision: drag.state.revision }).then(() => {
      if (!this.options.state().enabled) return;
      const row = [...this.list.querySelectorAll<HTMLElement>('.rotation-seat')].find(row => row.dataset.personId === drag.id);
      if (row && (document.activeElement === drag.source || document.activeElement === document.body || document.activeElement === this.list)) {
        row.focus({ preventScroll: true }); row.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
      }
    });
  }

  private clear() {
    const drag = this.drag; this.drag = undefined; cancelAnimationFrame(this.frame); this.frame = 0;
    this.marker.remove(); drag?.ghost?.remove(); drag?.source.classList.remove('is-dragging', 'is-keyboard-dragging');
    this.list.classList.remove('is-dragging');
    if (drag?.pointer !== undefined && this.list.hasPointerCapture(drag.pointer)) this.list.releasePointerCapture(drag.pointer);
  }
}
