import type { ListeningOrderView, Person, View } from '../src/model';
import { el } from './dom';
import { avatar } from './visuals';
import { appPath } from './paths';
import { ViewNodes, children, prop, attr, text } from './view-nodes';

type Management = { disabled(): boolean; move(id: string, shift: number): void; remove(id: string): void };

/** One persistent names-only bar, shared by every application route. */
export class ListeningOrder {
  readonly element = el('div', undefined, 'listening-order');
  readonly mobileManagement = el('button', 'Manage people', 'secondary order-manage-mobile');
  private list = el('ol', undefined, 'rotation-list');
  private status = el('span', undefined, 'order-status');
  private empty = el('p', 'Loading listening order…', 'muted order-empty');
  private manage = el('button', 'Manage people', 'secondary order-manage-desktop');
  private feedback = el('p', undefined, 'muted small order-feedback');
  private managing = false;
  private snapshot?: ListeningOrderView;
  private me?: Person;
  private source?: EventSource;
  private key = '';
  private rows = new Map<string, ViewNodes>();

  constructor(private management?: Management) {
    const bar = el('section', undefined, 'order-bar'); bar.setAttribute('aria-label', 'Listening order');
    this.list.setAttribute('aria-label', 'Participant rotation'); this.list.tabIndex = 0; this.list.id = 'participant-rotation';
    this.mobileManagement.id = 'manage-people-mobile';
    for (const button of [this.manage, this.mobileManagement]) {
      button.type = 'button'; button.hidden = !management; button.setAttribute('aria-controls', this.list.id);
      button.onclick = () => { this.managing = !this.managing; this.render(); };
    }
    this.feedback.hidden = true; this.feedback.setAttribute('role', 'status');
    bar.append(this.empty, this.list, this.status, this.manage);
    this.element.append(bar, this.feedback);
  }

  /** Authenticated pages already have a room stream; entry/settings use the public order feed. */
  update(view: View | undefined, online: boolean) {
    if (view) {
      this.stop();
      this.me = view.me;
      this.accept({ roomId: view.roomId, revision: view.revision, current: view.current, next: view.next, rotation: view.rotation ?? [] });
      this.connection(online);
    } else {
      this.me = undefined;
      if (!navigator.onLine) { this.stop(); this.connection(false); }
      else if (!this.source) {
        this.status.textContent = this.snapshot ? 'Reconnecting…' : 'Connecting…';
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

  message(text: string) { this.feedback.textContent = text; this.feedback.hidden = !text; }

  private accept(snapshot: ListeningOrderView) {
    if (this.snapshot?.roomId === snapshot.roomId && this.snapshot.revision > snapshot.revision) return;
    this.snapshot = snapshot; this.render();
  }

  private connection(online: boolean) {
    text(this.status, online ? '' : navigator.onLine ? 'Reconnecting…' : 'Offline');
    attr(this.element, 'data-online', String(online));
    this.updateControls();
  }

  private updateControls() {
    const disabled = !this.management || this.management.disabled() || this.element.dataset.online !== 'true';
    for (const button of [this.manage, this.mobileManagement]) prop(button, 'disabled', disabled);
    for (const button of this.list.querySelectorAll('button')) prop(button, 'disabled', disabled);
  }

  private render() {
    const view = this.snapshot; const people = view?.rotation ?? [];
    text(this.empty, view ? 'No participants have joined.' : 'Loading listening order…');
    prop(this.empty, 'hidden', people.length > 0); prop(this.list, 'hidden', !people.length);
    for (const button of [this.manage, this.mobileManagement]) {
      prop(button, 'hidden', !this.management || !people.length);
      text(button, this.managing ? 'Done managing' : 'Manage people');
      attr(button, 'aria-expanded', String(this.managing));
    }
    this.list.classList.toggle('is-managing', this.managing);
    const key = JSON.stringify([people, view?.current?.id, view?.next?.id, this.me?.id, this.managing]);
    if (key !== this.key) {
      this.key = key;
      const left = this.list.scrollLeft;
      const focused = document.activeElement instanceof HTMLElement && this.list.contains(document.activeElement) ? document.activeElement.dataset.focusKey : undefined;
      children(this.list, ...people.map((person, index) => {
        let nodes = this.rows.get(person.id); if (!nodes) { nodes = new ViewNodes(); this.rows.set(person.id, nodes); } const v = nodes;
        const current = person.id === view?.current?.id; const me = person.id === this.me?.id;
        const next = !current && person.id === view?.next?.id;
        const row = v.el('row', 'li', undefined, `rotation-seat${current ? ' is-current' : ''}${me ? ' is-you' : ''}${next ? ' is-next' : ''}`);
        attr(row, 'data-person-id', person.id); attr(row, 'aria-current', current ? 'step' : undefined);
        const name = v.el('name', 'strong', person.nickname); prop(name, 'title', person.nickname);
        const image = v.get('avatar', () => ({ key: '', node: avatar(person) }));
        const imageKey = JSON.stringify(person); if (image.key !== imageKey) { image.key = imageKey; image.node = avatar(person); }
        const content: Node[] = [v.el('number', 'span', String(index + 1).padStart(2, '0'), 'seat-number'), image.node, name,
          v.el('state', 'span', current && me ? 'Your turn' : current ? 'Current turn' : next && me ? 'You’re next' : next ? 'Up next' : me ? 'You' : 'Listening', 'seat-state'),
          v.el('compact-state', 'span', current ? `Now${me ? ' · You' : ''}` : next ? `Next${me ? ' · You' : ''}` : me ? 'You' : 'Listening', 'seat-state seat-state-compact')];
        if (this.managing && this.management) {
          const actions = v.el('actions', 'div', undefined, 'order-actions'); const controls: Node[] = [];
          const action = (text: string, key: string, label: string, work: () => void) => {
            const button = v.el(key, 'button', text, 'secondary'); prop(button, 'type', 'button'); attr(button, 'data-focus-key', key);
            attr(button, 'aria-label', label); button.onclick = work; controls.push(button);
          };
          if (index > 0) action('↑', `up-${person.id}`, `Move ${person.nickname} up`, () => this.management!.move(person.id, -1));
          if (index < people.length - 1) action('↓', `down-${person.id}`, `Move ${person.nickname} down`, () => this.management!.move(person.id, 1));
          action('Remove', `remove-${person.id}`, `Remove ${person.nickname}`, () => this.management!.remove(person.id));
          children(actions, ...controls); content.push(actions);
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
