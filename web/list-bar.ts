import { el } from './dom';
import { prop, text } from './view-nodes';

/** Phones: a one-line playlist summary while the playlist card is scrolled out of view
 * above the music results. A shortcut back to the list, never a second list. */
export class ListBar {
  readonly element = el('aside', undefined, 'mobile-list-bar');
  private count = el('span', undefined, 'list-bar-count');
  private detail = el('span', undefined, 'list-bar-detail');
  private view = el('button', 'View list', 'secondary list-bar-view');
  /** Phone search covers the list: a brief toast there confirms each added song, and stays while a save
   * needs attention (Retry is in the list, after Done). Empty, and hidden, otherwise. */
  readonly toast = el('p', undefined, 'search-sheet-toast');
  private target?: HTMLElement;
  private above = false;
  private summary = '';
  private flash?: string;
  private addedTitle?: string;
  private flashTimer?: ReturnType<typeof setTimeout>;
  private observer = new IntersectionObserver(entries => {
    // Only "scrolled past" counts: a list below the viewport is still ahead of the reader.
    for (const entry of entries) this.above = !entry.isIntersecting && entry.boundingClientRect.bottom <= (entry.rootBounds?.top ?? 0) + 1;
    this.visibility();
  });

  constructor(show: () => void) {
    this.element.setAttribute('aria-label', 'Playlist shortcut'); this.element.hidden = true; this.toast.hidden = true;
    this.view.type = 'button'; this.view.onclick = show;
    const head = el('span', undefined, 'list-bar-head'); head.append(el('strong', 'Your playlist'), this.count);
    const lines = el('span', undefined, 'list-bar-lines'); lines.append(head, this.detail);
    this.element.append(lines, this.view);
  }

  observe(target: HTMLElement) {
    if (target === this.target) return;
    this.observer.disconnect(); this.target = target; this.observer.observe(target);
  }

  update(count: number | undefined, next: string | undefined, attention: boolean) {
    text(this.count, count === undefined ? '' : `${count} ${count === 1 ? 'track' : 'tracks'}`);
    this.summary = attention ? 'Needs attention' : next ? `Next: ${next}` : 'No songs yet';
    this.paint(); this.visibility();
  }

  /** Confirms a saved song where the reader is looking, then returns to the summary. */
  added(title: string) {
    this.flash = `Added: ${title}`; this.addedTitle = title; clearTimeout(this.flashTimer);
    this.flashTimer = setTimeout(() => { this.flash = undefined; this.paint(); }, 2500);
    this.paint();
  }

  private paint() {
    text(this.detail, this.flash ?? this.summary); prop(this.detail, 'title', this.detail.textContent ?? '');
    const attention = this.summary === 'Needs attention';
    const toast = attention ? 'Your playlist needs attention. Retry it after Done.' : this.flash ? `Added ${this.addedTitle} to your playlist` : '';
    text(this.toast, toast); prop(this.toast, 'hidden', !toast); this.toast.classList.toggle('needs-attention', attention);
    this.element.classList.toggle('is-flashing', Boolean(this.flash)); this.element.classList.toggle('needs-attention', attention);
  }

  private visibility() { prop(this.element, 'hidden', !this.target?.isConnected || !this.above); }

  destroy() { this.observer.disconnect(); clearTimeout(this.flashTimer); this.element.remove(); }
}
