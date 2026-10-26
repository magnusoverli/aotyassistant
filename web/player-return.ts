import type { View } from '../src/model';
import { el, link } from './dom';
import { text, attr, prop } from './view-nodes';

/** A navigation shortcut, never a second player or a source of optimistic public state. */
export class PlayerReturn {
  readonly element = el('aside', undefined, 'mobile-player-return');
  private status = el('span');
  private jump = link('Go to player', '#participant-player', 'player-return-link');
  private target?: HTMLElement;
  private available = false;
  private failed = false;
  private reviewPlayer = false;
  private observer = new IntersectionObserver(() => this.visibility());

  constructor() {
    this.element.setAttribute('aria-label', 'Playback shortcut');
    this.status.setAttribute('role', 'status'); this.element.hidden = true;
    this.jump.onclick = event => {
      if (!this.target) return;
      const destination = this.failed && !this.reviewPlayer ? document.getElementById('main-content')! : this.target;
      event.preventDefault(); destination.focus({ preventScroll: true });
      destination.scrollIntoView({ block: 'start', behavior: 'instant' });
      if (this.failed && this.reviewPlayer) destination.querySelector<HTMLButtonElement>('.player-details-open')?.click();
    };
    this.element.append(this.status, this.jump);
    window.visualViewport?.addEventListener('resize', () => this.visibility());
  }

  update(view: View | undefined, starting: boolean, connected: boolean, error: string) {
    this.reviewPlayer = Boolean(error && document.getElementById('participant-player'));
    const target = (error && !this.reviewPlayer ? document.querySelector<HTMLElement>('.app-content > .error') : document.getElementById('participant-player')) ?? undefined;
    if (target !== this.target) {
      this.observer.disconnect(); this.target = target;
      if (target) this.observer.observe(target);
    }
    const playback = view?.myTurn ? view.ownPlayback : undefined;
    this.failed = Boolean(error);
    text(this.jump, error ? 'Review status' : 'Go to player');
    attr(this.jump, 'href', error && !this.reviewPlayer ? '#main-content' : '#participant-player');
    this.available = Boolean(target && view?.myTurn && (starting || playback || error));
    // Only authoritative snapshots can say Playing, Paused or Revealed.
    const caption = error ? 'Check playback' : !connected ? 'Connection lost' : starting ? 'Starting…'
      : playback ? `${playback.status === 'playing' ? 'Playing' : playback.status === 'paused' ? 'Paused' : 'Stopped'} · ${playback.revealed ? 'Revealed' : 'Hidden'}` : '';
    text(this.status, caption);
    this.visibility();
  }

  private visibility() {
    const rect = this.target?.getBoundingClientRect();
    const viewport = window.visualViewport;
    const top = viewport?.offsetTop ?? 0;
    const bottom = top + (viewport?.height ?? innerHeight);
    prop(this.element, 'hidden', !this.available || !rect || (rect.bottom > top && rect.top < bottom));
  }
}
