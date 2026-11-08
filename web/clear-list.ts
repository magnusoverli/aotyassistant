import { el } from './dom';
import type { PreparationController } from './preparation-controller';

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

/** Confirms emptying Your playlist and its history, to start again from scratch. */
export class ClearList {
  readonly dialog = el('dialog', undefined, 'list-dialog');
  private clearing = false;

  constructor(private library: PreparationController, private cleared: () => void) {
    this.dialog.id = 'clear-list'; this.dialog.setAttribute('aria-labelledby', 'clear-list-title');
    this.dialog.addEventListener('cancel', event => { if (this.clearing) event.preventDefault(); });
    this.dialog.addEventListener('click', event => {
      if (event.target !== this.dialog || this.clearing) return;
      const box = this.dialog.getBoundingClientRect();
      if (event.clientY < box.top || event.clientY > box.bottom || event.clientX < box.left || event.clientX > box.right) this.dialog.close();
    });
  }

  open() {
    if (!this.dialog.isConnected) document.body.append(this.dialog);
    this.show();
    if (!this.dialog.open) this.dialog.showModal();
  }

  private button(caption: string, work: () => void, className = 'secondary') {
    const button = el('button', caption, className); button.type = 'button'; button.onclick = work; return button;
  }

  private show(error = '') {
    const view = this.library.view;
    const upcoming = view?.upcoming.length ?? 0; const history = (view?.played.length ?? 0) + (view?.removed.length ?? 0);
    const uploads = [...view?.upcoming ?? [], ...view?.played ?? [], ...view?.removed ?? []].some(entry => entry.source === 'upload');
    const heading = el('h2', 'Clear your playlist?'); heading.id = 'clear-list-title';
    const header = el('div', undefined, 'list-dialog-header'); header.append(heading);
    const summary = upcoming && history ? `This removes ${plural(upcoming, 'song')} from Your playlist and ${history} from its history (Previously played and Removed).`
      : upcoming ? `This removes ${plural(upcoming, 'song')} from Your playlist.`
      : history ? `This removes ${plural(history, 'song')} from your history (Previously played and Removed).`
      : 'Your playlist and its history are already empty.';
    const nodes: Node[] = [header, el('p', summary)];
    if (uploads) nodes.push(el('p', 'Your uploaded songs are permanently deleted too.'));
    nodes.push(el('p', 'This can’t be undone. Your place in the listening order is kept.', 'muted'));
    if (error) { const alert = el('p', error, 'list-dialog-error'); alert.setAttribute('role', 'alert'); nodes.push(alert); }
    const confirm = this.button(this.clearing ? 'Clearing…' : 'Clear list', () => void this.clear(), 'danger');
    const cancel = this.button('Cancel', () => this.dialog.close());
    confirm.disabled = cancel.disabled = this.clearing; cancel.autofocus = true;
    const actions = el('div', undefined, 'list-dialog-actions'); actions.append(confirm, cancel); nodes.push(actions);
    this.dialog.replaceChildren(...nodes);
    if (!this.clearing) cancel.focus();
  }

  private async clear() {
    if (this.clearing) return;
    if (this.library.locked || !this.library.view) { this.show('Wait until your playlist shows Saved, then try again.'); return; }
    this.clearing = true; this.show();
    try { await this.library.edit('clear', {}, 'Clear list'); }
    finally { this.clearing = false; }
    if (this.library.pending || this.library.error) { this.show(this.library.error || 'The list could not be cleared. Try again.'); return; }
    this.dialog.close(); this.cleared();
  }
}
