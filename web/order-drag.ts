import type { Person } from '../src/model';

export type OrderMove = { id: string; ids: string[]; revision: number };
type State = { enabled: boolean; roomId: string | null; revision: number; people: Person[] };
type Options = { state(): State; commit(move: OrderMove): Promise<void>; announce(message: string): void };
type Slot = { node: HTMLElement; left: number; width: number };
type Drag = {
  state: State; source: HTMLElement; id: string; name: string; index: number; active: boolean;
  pointer?: number; x: number; y: number; startX: number; startY: number; offsetX: number; offsetY: number;
  valid: boolean; ghost?: HTMLElement; slots: Slot[]; gap: number; targetLeft: number;
};

/** Pointer and keyboard previews stay local; only a completed drop writes the captured order. */
export class OrderDrag {
  private drag?: Drag;
  private pending?: Drag;
  private motions = new Map<HTMLElement, Animation>();
  private reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  private frame = 0;
  private lastFrame = 0;
  private blockClick = false;
  private press?: { pointer: number; x: number; y: number };

  constructor(private list: HTMLElement, private options: Options) {
    list.addEventListener('pointerdown', this.pointerDown);
    list.addEventListener('pointermove', this.pointerMove);
    list.addEventListener('pointerup', this.pointerUp);
    list.addEventListener('pointercancel', () => this.cancel());
    list.addEventListener('lostpointercapture', () => this.cancel());
    list.addEventListener('keydown', this.keydown);
    list.addEventListener('dragstart', event => { if (this.options.state().enabled) event.preventDefault(); });
    // Track the whole gesture, including presses on the trash icon and releases after cancellation.
    document.addEventListener('pointermove', event => this.trackPress(event), true);
    document.addEventListener('pointerup', event => {
      this.trackPress(event); if (this.press?.pointer === event.pointerId) this.press = undefined;
    }, true);
    document.addEventListener('pointercancel', event => { if (this.press?.pointer === event.pointerId) { this.blockClick = true; this.press = undefined; } }, true);
    list.addEventListener('click', event => {
      if (event.detail > 0 && this.blockClick) { event.preventDefault(); event.stopImmediatePropagation(); this.blockClick = false; }
    }, true);
    window.addEventListener('blur', () => this.cancel());
    window.addEventListener('pagehide', () => this.cancel());
    window.addEventListener('resize', () => { this.cancel('Reordering cancelled.', false); this.finishPending(false); });
    this.reducedMotion.addEventListener('change', () => { if (this.reducedMotion.matches) for (const animation of this.motions.values()) animation.cancel(); });
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.cancel(); });
  }

  update() {
    const state = this.options.state();
    if (this.pending && (state.roomId !== this.pending.state.roomId || state.revision !== this.pending.state.revision)) this.finishPending(false);
    const drag = this.drag; if (!drag) return;
    if (!state.enabled || state.roomId !== drag.state.roomId || state.revision !== drag.state.revision) {
      this.cancel('The room changed. Pick up the participant again to reorder.', false);
    }
  }

  cancel(message = 'Reordering cancelled.', animate = true) {
    const drag = this.drag; const active = drag?.active; this.clear();
    if (active) this.restore(drag, animate);
    if (active) this.options.announce(message);
  }

  private create(source: HTMLElement, pointer?: PointerEvent): Drag | undefined {
    const state = this.options.state(); if (!state.enabled || state.people.length < 2) return;
    const index = state.people.findIndex(person => person.id === source.dataset.personId); const person = state.people[index];
    if (!person) return;
    const box = source.getBoundingClientRect(); const x = pointer?.clientX ?? box.x; const y = pointer?.clientY ?? box.y;
    const list = this.list.getBoundingClientRect();
    const slots = [...this.list.querySelectorAll<HTMLElement>('.rotation-seat')].map(node => {
      const rect = node.getBoundingClientRect(); const offset = new DOMMatrix(getComputedStyle(node).transform).m41;
      return { node, left: rect.left - offset - list.left + this.list.scrollLeft, width: rect.width };
    });
    return { state: { ...state, people: [...state.people] }, source, id: person.id, name: person.nickname, index, active: false,
      pointer: pointer?.pointerId, x, y, startX: x, startY: y, offsetX: x - box.x, offsetY: y - box.y, valid: true,
      slots, gap: parseFloat(getComputedStyle(this.list).columnGap), targetLeft: slots[index]!.left };
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
    if (!event.isPrimary || event.button !== 0) return;
    this.blockClick = false; this.press = { pointer: event.pointerId, x: event.clientX, y: event.clientY };
    if (this.drag || !(event.target instanceof Element) || event.target.closest('button, a, input, select, textarea')) return;
    const source = event.target.closest<HTMLElement>('.rotation-seat'); if (!source || !this.list.contains(source)) return;
    this.drag = this.create(source, event); if (!this.drag) return;
    source.focus({ preventScroll: true }); this.list.setPointerCapture(event.pointerId);
  };

  private trackPress(event: PointerEvent) {
    if (this.press?.pointer === event.pointerId && Math.hypot(event.clientX - this.press.x, event.clientY - this.press.y) >= 8) this.blockClick = true;
  }

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
    this.blockClick = true;
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
    const right = drag.targetLeft + drag.slots.find(slot => slot.node === drag.source)!.width;
    if (drag.targetLeft < this.list.scrollLeft) this.list.scrollLeft = drag.targetLeft;
    else if (right > this.list.scrollLeft + this.list.clientWidth) this.list.scrollLeft = right - this.list.clientWidth;
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

  private pointerPosition(drag: Drag) {
    const box = this.list.getBoundingClientRect();
    drag.valid = drag.x >= box.left - 28 && drag.x <= box.right + 28 && drag.y >= box.top - 12 && drag.y <= box.bottom + 12;
    // Hit-test stable layout slots, never the moving neighbours: a stationary pointer must not oscillate the order.
    const width = drag.slots.find(slot => slot.node === drag.source)!.width;
    const center = drag.x - drag.offsetX + width / 2 - box.left + this.list.scrollLeft;
    const index = drag.slots.reduce((nearest, slot, index, slots) =>
      Math.abs(center - slot.left - slot.width / 2) < Math.abs(center - slots[nearest]!.left - slots[nearest]!.width / 2) ? index : nearest, 0);
    if (drag.valid) this.position(drag, index);
    this.paint(drag);
  }

  private position(drag: Drag, index: number) {
    if (index === drag.index) return;
    drag.index = index;
    const slots = drag.slots.filter(slot => slot.node !== drag.source); slots.splice(index, 0, drag.slots.find(slot => slot.node === drag.source)!);
    let left = drag.slots[0]!.left;
    for (const [position, slot] of slots.entries()) {
      this.shift(slot.node, left - slot.left, slot.node !== drag.source || drag.pointer === undefined);
      slot.node.querySelector('.seat-number')!.textContent = String(position + 1).padStart(2, '0');
      if (slot.node === drag.source) drag.targetLeft = left;
      left += slot.width + drag.gap;
    }
    this.options.announce(`${drag.name}: position ${index + 1} of ${drag.state.people.length}. Drop to save the order.`);
  }

  private paint(drag: Drag) {
    if (drag.ghost) {
      drag.ghost.style.transform = `translate(${drag.x - drag.offsetX}px,${drag.y - drag.offsetY}px)`;
      drag.ghost.classList.toggle('is-invalid-drop', !drag.valid);
      drag.ghost.querySelector('.seat-number')!.textContent = String(drag.index + 1).padStart(2, '0');
    }
  }

  private shift(node: HTMLElement, offset: number, animate: boolean) {
    const from = getComputedStyle(node).transform;
    this.motions.get(node)?.cancel(); this.motions.delete(node);
    const to = offset ? `translateX(${offset}px)` : 'none';
    if (offset) node.style.transform = to; else node.style.removeProperty('transform');
    if (!animate || this.reducedMotion.matches || Math.abs(new DOMMatrix(from).m41 - offset) < .5) return;
    const motion = node.animate([{ transform: from }, { transform: to }], { duration: 200, easing: 'cubic-bezier(.2,.8,.2,1)' });
    this.motions.set(node, motion);
    const finished = () => { if (this.motions.get(node) === motion) this.motions.delete(node); };
    void motion.finished.then(finished, finished);
  }

  private restore(drag: Drag, animate: boolean) {
    for (const slot of drag.slots) this.shift(slot.node, 0, animate);
    // A live update may already have changed membership/order; restore the current DOM's numbering.
    this.list.querySelectorAll('.seat-number').forEach((number, index) => { number.textContent = String(index + 1).padStart(2, '0'); });
  }

  private finishPending(animate: boolean) {
    if (this.pending) this.restore(this.pending, animate);
    this.pending = undefined;
  }

  private drop() {
    this.update(); const drag = this.drag; if (!drag?.active) return;
    const ids = drag.state.people.filter(person => person.id !== drag.id).map(person => person.id); ids.splice(drag.index, 0, drag.id);
    this.clear();
    if (ids.every((id, index) => id === drag.state.people[index]?.id)) { this.restore(drag, true); this.options.announce('Listening order unchanged.'); return; }
    // Hold the preview until the authoritative update arrives, avoiding a jump back on release.
    this.pending = drag;
    this.options.announce(`Saving ${drag.name} at position ${drag.index + 1}…`);
    void this.options.commit({ id: drag.id, ids, revision: drag.state.revision }).then(() => {
      if (this.pending === drag) this.finishPending(true);
      if (!this.options.state().enabled) return;
      const row = [...this.list.querySelectorAll<HTMLElement>('.rotation-seat')].find(row => row.dataset.personId === drag.id);
      if (row && (document.activeElement === drag.source || document.activeElement === document.body || document.activeElement === this.list)) {
        row.focus({ preventScroll: true }); row.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
      }
    });
  }

  private clear() {
    const drag = this.drag; this.drag = undefined; cancelAnimationFrame(this.frame); this.frame = 0;
    drag?.ghost?.remove(); drag?.source.classList.remove('is-dragging', 'is-keyboard-dragging');
    this.list.classList.remove('is-dragging');
    if (drag?.pointer !== undefined && this.list.hasPointerCapture(drag.pointer)) this.list.releasePointerCapture(drag.pointer);
  }
}
