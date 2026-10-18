import type { ListeningOrderView, Person, View } from '../src/model';
import { el } from './dom';
import { avatar } from './visuals';
import { appPath } from './paths';

type Management = { disabled(): boolean; move(id: string, shift: number): void; remove(id: string): void };

/** One persistent names-only bar, shared by every application route. */
export class ListeningOrder {
  readonly element = el('div', undefined, 'listening-order');
  private list = el('ol', undefined, 'rotation-list');
  private status = el('span', undefined, 'order-status');
  private empty = el('p', 'Loading listening order…', 'muted order-empty');
  private manage = el('button', 'Manage people', 'secondary');
  private feedback = el('p', undefined, 'muted small order-feedback');
  private managing = false;
  private snapshot?: ListeningOrderView;
  private me?: Person;
  private source?: EventSource;
  private key = '';

  constructor(private management?: Management) {
    const bar = el('section', undefined, 'order-bar'); bar.setAttribute('aria-label', 'Listening order');
    this.list.setAttribute('aria-label', 'Participant rotation'); this.list.tabIndex = 0;
    this.manage.type = 'button'; this.manage.hidden = !management;
    this.manage.onclick = () => { this.managing = !this.managing; this.render(); };
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
    this.status.textContent = online ? '' : navigator.onLine ? 'Reconnecting…' : 'Offline';
    this.element.dataset.online = String(online);
    this.updateControls();
  }

  private updateControls() {
    const disabled = !this.management || this.management.disabled() || this.element.dataset.online !== 'true';
    this.manage.disabled = disabled;
    for (const button of this.list.querySelectorAll('button')) button.disabled = disabled;
  }

  private render() {
    const view = this.snapshot; const people = view?.rotation ?? [];
    this.empty.textContent = view ? 'No participants have joined.' : 'Loading listening order…';
    this.empty.hidden = people.length > 0; this.list.hidden = !people.length;
    this.manage.hidden = !this.management || !people.length;
    this.manage.textContent = this.managing ? 'Done managing' : 'Manage people';
    const key = JSON.stringify([people, view?.current?.id, view?.next?.id, this.me?.id, this.managing]);
    if (key !== this.key) {
      this.key = key;
      const left = this.list.scrollLeft;
      const focused = document.activeElement instanceof HTMLElement && this.list.contains(document.activeElement) ? document.activeElement.dataset.focusKey : undefined;
      this.list.replaceChildren(...people.map((person, index) => {
        const current = person.id === view?.current?.id; const me = person.id === this.me?.id;
        const next = !current && person.id === view?.next?.id;
        const row = el('li', undefined, `rotation-seat${current ? ' is-current' : ''}${me ? ' is-you' : ''}${next ? ' is-next' : ''}`);
        row.dataset.personId = person.id; if (current) row.setAttribute('aria-current', 'step');
        const name = el('strong', person.nickname); name.title = person.nickname;
        row.append(el('span', String(index + 1).padStart(2, '0'), 'seat-number'), avatar(person), name,
          el('span', current && me ? 'Your turn' : current ? 'Current turn' : me ? 'You' : next ? 'Up next' : 'Listening', 'seat-state'));
        if (this.managing && this.management) {
          const actions = el('div', undefined, 'order-actions');
          const action = (text: string, key: string, label: string, work: () => void) => {
            const button = el('button', text, 'secondary'); button.type = 'button'; button.dataset.focusKey = key;
            button.setAttribute('aria-label', label); button.onclick = work; actions.append(button);
          };
          if (index > 0) action('↑', `up-${person.id}`, `Move ${person.nickname} up`, () => this.management!.move(person.id, -1));
          if (index < people.length - 1) action('↓', `down-${person.id}`, `Move ${person.nickname} down`, () => this.management!.move(person.id, 1));
          action('Remove', `remove-${person.id}`, `Remove ${person.nickname}`, () => this.management!.remove(person.id));
          row.append(actions);
        }
        return row;
      }));
      this.list.scrollLeft = left;
      if (focused) [...this.list.querySelectorAll<HTMLElement>('[data-focus-key]')].find(node => node.dataset.focusKey === focused)?.focus({ preventScroll: true });
    }
    this.updateControls();
  }

  stop() { this.source?.close(); this.source = undefined; }
}
