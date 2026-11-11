import type { ListeningOrderView, Person, View } from '../src/model';
import { el, link } from './dom';
import { avatar } from './visuals';
import { appPath } from './paths';
import { ViewNodes, children, prop, attr, text } from './view-nodes';
import { OrderDrag, type OrderMove } from './order-drag';
import { stackedLayout } from './page-layout';
import { turnFirst, canonicalInsertion } from './order-presentation';
import { fittingSeats } from './display-stage';
import { seatEq } from './seat-eq';

type Management = { disabled(): boolean; reorder(move: OrderMove): Promise<void> };

/** One persistent participant bar, shared by every application route. */
export class ListeningOrder {
  readonly element = el('div', undefined, 'listening-order');
  private list = el('ol', undefined, 'rotation-list');
  private status = el('span', undefined, 'order-status');
  private qr = link('', '', 'order-qr');
  private qrImage = el('img');
  private empty = el('p', 'Loading listening order…', 'muted order-empty');
  private announcement = el('p', undefined, 'sr-only order-announcement');
  private help = el('p', 'Drag cards to reorder. Keyboard: Space to pick up, arrows to move, Enter to drop, Esc to cancel.', 'sr-only order-help');
  private drag?: OrderDrag;
  private snapshot?: ListeningOrderView;
  private me?: Person;
  private source?: EventSource;
  private key = '';
  private rows = new Map<string, ViewNodes>();
  private mobile = stackedLayout();
  private display = false;
  private more = el('li', undefined, 'rotation-more');
  private measure = el('div', undefined, 'order-measure');
  private seatMeasure = el('span', undefined, 'order-measure-seat');
  private moreMeasure = el('span', undefined, 'order-measure-more');
  private fitObserver?: ResizeObserver;
  private fit?: { total: number; shown: number };
  private presentedTurnFirst = false;
  private presentedCurrent?: string;

  constructor(private management?: Management) {
    const bar = el('section', undefined, 'order-bar'); bar.setAttribute('aria-label', 'Listening order');
    this.list.setAttribute('aria-label', 'Participant rotation'); this.list.tabIndex = 0; this.list.id = 'participant-rotation';
    this.list.classList.toggle('is-editable', Boolean(management));
    this.announcement.setAttribute('role', 'status'); this.announcement.setAttribute('aria-atomic', 'true');
    this.qr.hidden = true; this.qr.setAttribute('aria-label', 'Join room');
    this.qrImage.alt = 'Scan to join the room'; this.qr.append(this.qrImage);
    bar.append(this.empty, this.list, this.status, this.qr);
    this.help.id = 'order-drag-help'; this.help.hidden = true;
    this.element.append(bar);
    this.element.append(this.help, this.announcement);
    // Resolve fluid CSS lengths without measuring already-flexed participant cards.
    this.measure.setAttribute('aria-hidden', 'true'); this.measure.hidden = true;
    this.measure.append(this.seatMeasure, this.moreMeasure); this.element.append(this.measure);
    this.drag = new OrderDrag(this.list, {
      state: () => ({ enabled: Boolean(this.management && !this.management.disabled()) && this.element.dataset.online === 'true',
        roomId: this.snapshot?.roomId ?? null, revision: this.snapshot?.revision ?? 0, people: this.presentedPeople() }),
      commit: async move => this.management?.reorder(this.mobile ? { ...move,
        ids: canonicalInsertion((this.snapshot?.rotation ?? []).map(person => person.id), move.id, move.ids),
      } : move), announce: message => this.announce(message),
    });
    window.addEventListener('resize', () => {
      const mobile = stackedLayout();
      if (mobile === this.mobile) return;
      this.mobile = mobile; this.render();
    });
  }

  setManagement(management: Management | undefined) {
    const changed = Boolean(this.management) !== Boolean(management);
    this.management = management;
    this.list.classList.toggle('is-editable', Boolean(management));
    if (changed) { this.drag?.cancel(); this.key = ''; this.render(); }
    this.updateControls();
  }

  /** A shared screen always starts with Now and Next, without changing the saved order. */
  setDisplay(display: boolean) {
    if (this.display === display) return;
    this.display = display;
    this.measure.hidden = !display;
    this.fitObserver?.disconnect(); this.fitObserver = undefined; this.fit = undefined;
    if (display && typeof ResizeObserver !== 'undefined') {
      this.fitObserver = new ResizeObserver(() => this.refit());
      for (const node of [this.list, this.seatMeasure, this.moreMeasure]) this.fitObserver.observe(node);
    }
    this.render();
  }

  /** The display shows the listeners that fit; call this when its size or text size changes. */
  refit() { this.fit = undefined; if (this.display) this.render(); }

  /** A shared screen cannot be scrolled, so the display's order ends in "+N more" when it is too long. */
  private seatsShown(total: number) {
    if (!this.display || !total) return total;
    if (this.fit?.total === total) return this.fit.shown;
    const style = getComputedStyle(this.list);
    const shown = fittingSeats(total, this.list.clientWidth, {
      seat: this.seatMeasure.getBoundingClientRect().width,
      gap: parseFloat(style.columnGap), more: this.moreMeasure.getBoundingClientRect().width,
    });
    this.fit = { total, shown }; return shown;
  }

  /** Authenticated pages already have a room stream; entry/settings use the public order feed. */
  update(view: View | undefined, online: boolean) {
    if (view) {
      this.stop();
      if (view.me) this.me = view.me;
      this.accept({ roomId: view.roomId, revision: view.revision, current: view.current, next: view.next, rotation: view.rotation ?? [], playbackStatus: view.playbackStatus ?? 'unavailable' });
      this.connection(online);
    } else {
      if (!navigator.onLine) { this.stop(); this.connection(false); }
      else if (!this.source) {
        // A route change hands off between feeds without making the retained
        // order flash a reconnecting row. Actual connection errors still surface.
        if (!this.snapshot) text(this.status, 'Connecting…');
        const source = new EventSource(appPath('/api/listening-order/events')); this.source = source;
        source.addEventListener('state', event => {
          if (this.source !== source) return;
          this.accept(JSON.parse((event as MessageEvent).data) as ListeningOrderView); this.connection(true);
        });
        source.onerror = () => { if (this.source === source) this.connection(false); };
      }
      this.render();
    }
  }

  /** Announce keyboard progress without adding visible messages or changing the bar's height. */
  announce(message: string) { text(this.announcement, message); }

  /** Only the room display supplies an invitation; other routes clear the retained header. */
  setDisplayInvitation(url?: string, image?: string) {
    const visible = Boolean(url && image);
    prop(this.qr, 'hidden', !visible);
    this.element.classList.toggle('has-display-qr', visible);
    attr(this.qr, 'href', visible ? url : undefined);
    attr(this.qrImage, 'src', visible ? image : undefined);
  }

  private accept(snapshot: ListeningOrderView) {
    if (this.snapshot?.roomId === snapshot.roomId && this.snapshot.revision > snapshot.revision) return;
    if (!snapshot.rotation.some(person => person.id === this.me?.id)) this.me = undefined;
    this.snapshot = snapshot; this.render();
  }

  private connection(online: boolean) {
    text(this.status, online ? '' : navigator.onLine ? 'Reconnecting…' : 'Offline');
    attr(this.element, 'data-online', String(online));
    this.updateControls();
  }

  private updateControls() {
    const disabled = !this.management || this.management.disabled() || this.element.dataset.online !== 'true';
    for (const row of this.list.querySelectorAll<HTMLElement>('.rotation-seat')) attr(row, 'aria-disabled', this.management ? String(disabled) : undefined);
    this.drag?.update();
  }

  private presentedPeople() {
    const people = this.snapshot?.rotation ?? [];
    return this.mobile || this.display ? turnFirst(people, this.snapshot?.current?.id) : people;
  }

  private render() {
    this.drag?.update();
    const view = this.snapshot; const everyone = this.presentedPeople();
    // The current card's light follows the room's playback (listening-order.css).
    attr(this.element, 'data-playback', view?.playbackStatus ?? 'unavailable');
    text(this.empty, view ? 'No participants have joined.' : 'Loading listening order…');
    prop(this.empty, 'hidden', everyone.length > 0); prop(this.list, 'hidden', !everyone.length);
    const people = everyone.slice(0, this.seatsShown(everyone.length)); const hidden = everyone.length - people.length;
    prop(this.help, 'hidden', !this.management || people.length < 2);
    const turnFirst = this.mobile || this.display;
    const key = JSON.stringify([people, hidden, view?.current?.id, view?.next?.id, this.me?.id, this.mobile, this.display]);
    if (key !== this.key) {
      this.key = key;
      const left = turnFirst && (!this.presentedTurnFirst || this.presentedCurrent !== view?.current?.id) ? 0 : this.list.scrollLeft;
      this.presentedTurnFirst = turnFirst; this.presentedCurrent = view?.current?.id;
      const focused = document.activeElement instanceof HTMLElement && this.list.contains(document.activeElement) ? document.activeElement.dataset.focusKey : undefined;
      text(this.more, `+${hidden} more`); attr(this.more, 'aria-label', `${hidden} more ${hidden === 1 ? 'participant' : 'participants'}`);
      children(this.list, ...people.map(person => {
        let nodes = this.rows.get(person.id); if (!nodes) { nodes = new ViewNodes(); this.rows.set(person.id, nodes); } const v = nodes;
        const current = person.id === view?.current?.id; const me = person.id === this.me?.id;
        const next = !current && person.id === view?.next?.id;
        const row = v.el('row', 'li', undefined, `rotation-seat${current ? ' is-current' : ''}${me ? ' is-you' : ''}${next ? ' is-next' : ''}`);
        attr(row, 'data-person-id', person.id); attr(row, 'aria-current', current ? 'step' : undefined);
        attr(row, 'data-focus-key', `person-${person.id}`); attr(row, 'tabindex', this.management ? '0' : undefined);
        attr(row, 'aria-roledescription', this.management ? 'draggable participant' : undefined);
        attr(row, 'aria-describedby', this.management ? this.help.id : undefined);
        const name = v.el('name', 'strong', person.nickname); prop(name, 'title', person.nickname);
        const image = v.get('avatar', () => ({ key: '', node: avatar(person) }));
        const imageKey = JSON.stringify(person); if (image.key !== imageKey) { image.key = imageKey; image.node = avatar(person); }
        // The light sits first, behind the avatar and name; it is kept, mid-motion, across updates.
        const content: Node[] = [...(current ? [v.get('eq', seatEq)] : []), image.node, name,
          v.el('state', 'span', current && me ? 'Your turn' : current ? 'Current turn' : next && me ? 'You’re next' : next ? 'Up next' : me ? 'You' : '', 'seat-state'),
          v.el('compact-state', 'span', current ? `Now${me ? ' · You' : ''}` : next ? `Next${me ? ' · You' : ''}` : me ? 'You' : '', 'seat-state seat-state-compact')];
        children(row, ...content);
        return row;
      }), ...(hidden ? [this.more] : []));
      for (const id of this.rows.keys()) if (!everyone.some(person => person.id === id)) this.rows.delete(id);
      this.list.scrollLeft = left;
      if (focused) [...this.list.querySelectorAll<HTMLElement>('[data-focus-key]')].find(node => node.dataset.focusKey === focused)?.focus({ preventScroll: true });
    }
    this.updateControls();
  }

  stop() { this.source?.close(); this.source = undefined; }
}
