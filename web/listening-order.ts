import type { ListeningOrderView, Person, View } from '../src/model';
import { el } from './dom';
import { avatar } from './visuals';
import { appPath } from './paths';
import { ViewNodes, children, prop, attr, text } from './view-nodes';
import { OrderDrag, type OrderMove } from './order-drag';
import { stackedLayout } from './page-layout';
import { turnFirst, canonicalInsertion } from './order-presentation';

type Management = { disabled(): boolean; reorder(move: OrderMove): Promise<void>; remove(id: string): void };

let turnBorderSequence = 0;

/** A diffuse point light follows a normalized perimeter, clipped to the actual border. */
function turnBorder() {
  const namespace = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(namespace, 'svg');
  svg.classList.add('order-trace'); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('focusable', 'false');
  const rect = (className: string) => {
    const node = document.createElementNS(namespace, 'rect'); node.classList.add(className);
    node.setAttribute('x', '.5'); node.setAttribute('y', '.5'); node.setAttribute('pathLength', '100'); return node;
  };
  const definitions = document.createElementNS(namespace, 'defs');
  const mask = document.createElementNS(namespace, 'mask'); const id = `order-border-${++turnBorderSequence}`;
  mask.id = id; mask.setAttribute('maskUnits', 'userSpaceOnUse');
  mask.setAttribute('x', '0'); mask.setAttribute('y', '0'); mask.setAttribute('width', '100%'); mask.setAttribute('height', '100%');
  mask.append(rect('order-trace-mask')); definitions.append(mask); svg.append(definitions);
  const light = () => {
    const clipped = document.createElementNS(namespace, 'g'); clipped.setAttribute('mask', `url(#${id})`);
    clipped.append(rect('order-trace-light')); return clipped;
  };
  // Blur a copy after masking, so only the border casts a halo into its surroundings.
  const halo = document.createElementNS(namespace, 'g'); halo.classList.add('order-trace-halo'); halo.append(light());
  svg.append(halo, light());
  return svg;
}

/** One persistent participant bar, shared by every application route. */
export class ListeningOrder {
  readonly element = el('div', undefined, 'listening-order');
  private list = el('ol', undefined, 'rotation-list');
  private status = el('span', undefined, 'order-status');
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
  private presentedMobile = false;
  private presentedCurrent?: string;

  constructor(private management?: Management) {
    const bar = el('section', undefined, 'order-bar'); bar.setAttribute('aria-label', 'Listening order');
    this.list.setAttribute('aria-label', 'Participant rotation'); this.list.tabIndex = 0; this.list.id = 'participant-rotation';
    this.list.classList.toggle('is-editable', Boolean(management));
    this.announcement.setAttribute('role', 'status'); this.announcement.setAttribute('aria-atomic', 'true');
    bar.append(this.empty, this.list, this.status);
    this.help.id = 'order-drag-help'; this.help.hidden = true;
    this.element.append(bar);
    this.element.append(this.help, this.announcement);
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
    for (const button of this.list.querySelectorAll('button')) prop(button, 'disabled', disabled);
    for (const row of this.list.querySelectorAll<HTMLElement>('.rotation-seat')) attr(row, 'aria-disabled', this.management ? String(disabled) : undefined);
    this.drag?.update();
  }

  private presentedPeople() {
    const people = this.snapshot?.rotation ?? [];
    return this.mobile ? turnFirst(people, this.snapshot?.current?.id) : people;
  }

  private render() {
    this.drag?.update();
    const view = this.snapshot; const people = this.presentedPeople();
    text(this.empty, view ? 'No participants have joined.' : 'Loading listening order…');
    prop(this.empty, 'hidden', people.length > 0); prop(this.list, 'hidden', !people.length);
    prop(this.help, 'hidden', !this.management || people.length < 2);
    const key = JSON.stringify([people, view?.current?.id, view?.next?.id, this.me?.id, this.mobile]);
    if (key !== this.key) {
      this.key = key;
      const left = this.mobile && (!this.presentedMobile || this.presentedCurrent !== view?.current?.id) ? 0 : this.list.scrollLeft;
      this.presentedMobile = this.mobile; this.presentedCurrent = view?.current?.id;
      const focused = document.activeElement instanceof HTMLElement && this.list.contains(document.activeElement) ? document.activeElement.dataset.focusKey : undefined;
      children(this.list, ...people.map(person => {
        let nodes = this.rows.get(person.id); if (!nodes) { nodes = new ViewNodes(); this.rows.set(person.id, nodes); } const v = nodes;
        const current = person.id === view?.current?.id; const me = person.id === this.me?.id;
        const next = !current && person.id === view?.next?.id;
        const row = v.el('row', 'li', undefined, `rotation-seat${current ? ' is-current' : ''}${me ? ' is-you' : ''}${next ? ' is-next' : ''}${this.management ? ' is-manageable' : ''}`);
        attr(row, 'data-person-id', person.id); attr(row, 'aria-current', current ? 'step' : undefined);
        attr(row, 'data-focus-key', `person-${person.id}`); attr(row, 'tabindex', this.management ? '0' : undefined);
        attr(row, 'aria-roledescription', this.management ? 'draggable participant' : undefined);
        attr(row, 'aria-describedby', this.management ? this.help.id : undefined);
        const name = v.el('name', 'strong', person.nickname); prop(name, 'title', person.nickname);
        const image = v.get('avatar', () => ({ key: '', node: avatar(person) }));
        const imageKey = JSON.stringify(person); if (image.key !== imageKey) { image.key = imageKey; image.node = avatar(person); }
        const content: Node[] = [image.node, name,
          v.el('state', 'span', current && me ? 'Your turn' : current ? 'Current turn' : next && me ? 'You’re next' : next ? 'Up next' : me ? 'You' : '', 'seat-state'),
          v.el('compact-state', 'span', current ? `Now${me ? ' · You' : ''}` : next ? `Next${me ? ' · You' : ''}` : me ? 'You' : '', 'seat-state seat-state-compact'),
          v.get('turn-border', turnBorder)];
        if (this.management) {
          const actions = v.el('actions', 'div', undefined, 'order-actions');
          const button = v.el('remove', 'button', '', 'secondary order-remove'); prop(button, 'type', 'button');
          attr(button, 'data-focus-key', `remove-${person.id}`); attr(button, 'aria-label', `Remove ${person.nickname}`); prop(button, 'title', `Remove ${person.nickname}`);
          button.onclick = () => this.management!.remove(person.id);
          children(actions, button); content.push(actions);
        }
        children(row, ...content);
        return row;
      }));
      for (const id of this.rows.keys()) if (!people.some(person => person.id === id)) this.rows.delete(id);
      this.list.scrollLeft = left;
      if (focused) [...this.list.querySelectorAll<HTMLElement>('[data-focus-key]')].find(node => node.dataset.focusKey === focused)?.focus({ preventScroll: true });
    }
    this.updateControls();
  }

  stop() { this.source?.close(); this.source = undefined; }
}
