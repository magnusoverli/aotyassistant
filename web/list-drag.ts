/** Reorders the playlist by dragging a song's row. A mouse starts after a short move;
 * touch starts after a press-and-hold, so an ordinary swipe still scrolls the list.
 * Only the drop is saved: the preview moves rows with transforms and never reorders
 * the DOM, which the playlist owns. */
type Slot = { node: HTMLElement; id: string; top: number; height: number };
type Drag = {
  // For touch gestures, pointer is the Touch.identifier, not a PointerEvent ID.
  id: string; source: HTMLElement; pointer: number; touch: boolean; active: boolean;
  startX: number; startY: number; y: number; offsetY: number;
  slots: Slot[]; from: number; index: number; hold?: ReturnType<typeof setTimeout>;
};
type Options = { enabled(): boolean; commit(id: string, ids: string[]): void };

const holdMs = 350;   // Touch: press this long to pick a song up.
const mouseSlop = 6;  // Mouse: move this far to start dragging.
const touchSlop = 8;  // Touch: moving this far before the hold completes is a scroll.
const edge = 44;      // Dragging this close to the list's visible edge scrolls it.

export class ListDrag {
  private drag?: Drag;
  private frame = 0;
  private last = 0;

  constructor(private list: HTMLElement, private scroller: HTMLElement, private options: Options) {
    list.addEventListener('pointerdown', this.down);
    list.addEventListener('pointermove', this.move);
    list.addEventListener('pointerup', this.up);
    list.addEventListener('pointercancel', event => {
      if (this.drag && !this.drag.touch && event.pointerId === this.drag.pointer) this.cancel();
    });
    list.addEventListener('lostpointercapture', event => {
      if (event.target === list && this.drag && !this.drag.touch && event.pointerId === this.drag.pointer) this.cancel();
    });
    // Android can cancel the pointer stream for a native touch gesture. Keep touch
    // on its own stream; touch events stay targeted at the original row without capture.
    list.addEventListener('touchstart', this.touchStart, { passive: true });
    list.addEventListener('touchmove', this.touchMove, { passive: false });
    list.addEventListener('touchend', this.touchEnd, { passive: false });
    list.addEventListener('touchcancel', () => { if (this.drag?.touch) this.cancel(); });
    // Never start the browser's own drag of a cover image or text.
    list.addEventListener('dragstart', event => event.preventDefault());
    list.addEventListener('contextmenu', event => { if (this.drag?.touch) event.preventDefault(); });
  }

  get busy() { return Boolean(this.drag); }

  /** The playlist re-rendered: a drag can continue only over the same rows in the same order. */
  retain(rows: HTMLElement[]) {
    const slots = this.drag?.slots;
    if (slots && (slots.length !== rows.length || slots.some((slot, index) => slot.node !== rows[index]))) this.cancel();
  }

  cancel() { this.clear(); }

  private rows() { return [...this.list.children].filter((node): node is HTMLElement => node instanceof HTMLElement && Boolean(node.dataset.entryId)); }

  private down = (event: PointerEvent) => {
    if (event.pointerType === 'touch' || !event.isPrimary || event.button !== 0) return;
    const drag = this.start(event.target, event.pointerId, event.clientX, event.clientY, false);
    if (drag) this.list.setPointerCapture(event.pointerId);
  };

  private touchStart = (event: TouchEvent) => {
    if (event.touches.length !== 1) { this.cancel(); return; }
    const touch = event.changedTouches[0]; if (!touch) return;
    const drag = this.start(event.target, touch.identifier, touch.clientX, touch.clientY, true);
    if (!drag) return;
    drag.hold = setTimeout(() => {
      if (this.drag !== drag || drag.active) return;
      if (!this.options.enabled()) { this.clear(); return; }
      try { navigator.vibrate?.(12); } catch { /* Optional feedback. */ }
      this.begin(drag);
    }, holdMs);
  };

  private start(target: EventTarget | null, pointer: number, x: number, y: number, touch: boolean) {
    if (this.drag || !this.options.enabled()) return;
    if (!(target instanceof Element) || target.closest('button, a, input, select, textarea, summary')) return;
    const source = target.closest<HTMLElement>('[data-entry-id]');
    const rows = this.rows(); const from = source ? rows.indexOf(source) : -1;
    if (!source || from < 0 || rows.length < 2) return;
    const top = this.list.getBoundingClientRect().top;
    const slots = rows.map(node => { const box = node.getBoundingClientRect(); return { node, id: node.dataset.entryId!, top: box.top - top, height: box.height }; });
    const drag: Drag = { id: source.dataset.entryId!, source, pointer, touch, active: false,
      startX: x, startY: y, y, offsetY: y - source.getBoundingClientRect().top, slots, from, index: from };
    this.drag = drag;
    return drag;
  }

  private touchMove = (event: TouchEvent) => {
    const drag = this.drag; if (!drag?.touch) return;
    if (event.touches.length !== 1) { this.clear(); return; }
    const touch = [...event.changedTouches].find(touch => touch.identifier === drag.pointer); if (!touch) return;
    if (!drag.active) {
      // A swipe before the hold belongs to native scrolling. Do not prevent it.
      if (Math.hypot(touch.clientX - drag.startX, touch.clientY - drag.startY) >= touchSlop || !event.cancelable) this.clear();
      return;
    }
    if (!event.cancelable) { this.clear(); return; }
    event.preventDefault(); drag.y = touch.clientY; this.position(drag);
  };

  private touchEnd = (event: TouchEvent) => {
    const drag = this.drag; if (!drag?.touch) return;
    const touch = [...event.changedTouches].find(touch => touch.identifier === drag.pointer); if (!touch) return;
    if (drag.active && event.cancelable) event.preventDefault();
    this.drop(drag, touch.clientY);
  };

  private move = (event: PointerEvent) => {
    const drag = this.drag; if (!drag || drag.touch || event.pointerId !== drag.pointer) return;
    if (!drag.active) {
      const moved = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
      if (moved < mouseSlop) return;
      this.begin(drag);
    }
    event.preventDefault(); drag.y = event.clientY; this.position(drag);
  };

  private up = (event: PointerEvent) => {
    const drag = this.drag; if (!drag || drag.touch || event.pointerId !== drag.pointer) return;
    this.drop(drag, event.clientY);
  };

  private drop(drag: Drag, y: number) {
    if (!drag.active) { this.clear(); return; }
    drag.y = y; this.position(drag);
    const ids = this.order(drag).map(slot => slot.id);
    this.clear();
    if (drag.index !== drag.from) this.options.commit(drag.id, ids);
  }

  private begin(drag: Drag) {
    drag.active = true;
    drag.source.classList.add('is-drag-source'); this.list.classList.add('is-sorting');
    this.last = performance.now(); this.frame = requestAnimationFrame(this.tick);
    this.position(drag);
  }

  /** Slots in their previewed order: the dragged song removed and inserted at its target. */
  private order(drag: Drag) {
    const slots = drag.slots.filter(slot => slot.node !== drag.source);
    slots.splice(drag.index, 0, drag.slots[drag.from]!);
    return slots;
  }

  private position(drag: Drag) {
    const source = drag.slots[drag.from]!; const first = drag.slots[0]!; const last = drag.slots.at(-1)!;
    // The dragged song follows the pointer within the list.
    const top = Math.max(first.top, Math.min(last.top + last.height - source.height, drag.y - drag.offsetY - this.list.getBoundingClientRect().top));
    drag.source.style.transform = `translateY(${top - source.top}px)`;
    // Hit-test the stable original slots, so a still pointer never makes rows oscillate.
    const center = top + source.height / 2;
    const index = drag.slots.reduce((nearest, slot, i) =>
      Math.abs(center - slot.top - slot.height / 2) < Math.abs(center - drag.slots[nearest]!.top - drag.slots[nearest]!.height / 2) ? i : nearest, 0);
    if (index === drag.index) return;
    drag.index = index;
    // The others slide aside to show where the song will land.
    const gap = drag.slots.length > 1 ? drag.slots[1]!.top - first.top - first.height : 0;
    let y = first.top;
    for (const slot of this.order(drag)) {
      if (slot !== source) { const offset = y - slot.top; slot.node.style.transform = offset ? `translateY(${offset}px)` : ''; }
      y += slot.height + gap;
    }
  }

  /** Near the list's visible top or bottom, scroll the list (or the page once the list is at its end). */
  private tick = (now: number) => {
    this.frame = 0; const drag = this.drag; if (!drag?.active) return;
    const elapsed = Math.min(32, now - this.last); this.last = now;
    const box = this.scroller.getBoundingClientRect();
    const top = Math.max(box.top, 0); const bottom = Math.min(box.bottom, innerHeight);
    const speed = drag.y < top + edge ? -Math.min(1, (top + edge - drag.y) / edge) : drag.y > bottom - edge ? Math.min(1, (drag.y - bottom + edge) / edge) : 0;
    if (speed) {
      const before = this.scroller.scrollTop; this.scroller.scrollTop += speed * elapsed * .6;
      if (this.scroller.scrollTop === before && (drag.y < edge || drag.y > innerHeight - edge)) window.scrollBy({ top: speed * elapsed * .6, behavior: 'instant' });
      this.position(drag);
    }
    this.frame = requestAnimationFrame(this.tick);
  };

  private clear() {
    const drag = this.drag; this.drag = undefined;
    cancelAnimationFrame(this.frame); this.frame = 0;
    if (!drag) return;
    clearTimeout(drag.hold);
    // Without transitions, so the next render shows the final order without rows sliding back.
    this.list.classList.remove('is-sorting'); drag.source.classList.remove('is-drag-source');
    for (const slot of drag.slots) slot.node.style.removeProperty('transform');
    if (!drag.touch && this.list.hasPointerCapture(drag.pointer)) this.list.releasePointerCapture(drag.pointer);
  }
}
