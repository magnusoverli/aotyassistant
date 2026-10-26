import { el } from './dom';
import { attr, children, prop, ViewNodes } from './view-nodes';

type Details = { title?: string; artist?: string; album?: string; next?: string; error?: string };

/** Read-only mobile details: long metadata and errors never expand the player itself. */
export class ParticipantPlayerDetails {
  readonly button = el('button', undefined, 'player-mobile-only player-details-open');
  readonly dialog = el('dialog', undefined, 'player-details-dialog');
  private nodes = new ViewNodes();
  private mobile = matchMedia('(max-width:1099px)');
  private resized = () => { if (!this.mobile.matches) this.dialog.close(); };

  constructor() {
    this.button.type = 'button'; this.button.setAttribute('aria-label', 'Player details');
    this.button.setAttribute('aria-haspopup', 'dialog'); this.button.setAttribute('aria-controls', 'participant-player-details');
    this.button.title = 'View full song details';
    this.dialog.id = 'participant-player-details'; this.dialog.setAttribute('aria-labelledby', 'player-details-title');
    this.button.onclick = () => { if (this.mobile.matches && !this.dialog.open) this.dialog.showModal(); };
    this.dialog.addEventListener('click', event => {
      if (event.target !== this.dialog) return;
      const box = this.dialog.getBoundingClientRect();
      if (event.clientY < box.top || event.clientX < box.left || event.clientX > box.right) this.dialog.close();
    });
    this.mobile.addEventListener('change', this.resized);
  }

  update(details: Details) {
    const v = this.nodes;
    const heading = v.el('heading', 'h2', 'Player details'); heading.id = 'player-details-title';
    const close = v.get('close', () => {
      const button = el('button', 'Close', 'secondary'); button.type = 'button'; button.autofocus = true;
      button.onclick = () => this.dialog.close(); return button;
    });
    const header = v.el('header', 'div', undefined, 'player-details-header'); children(header, heading, close);
    const error = v.el('error', 'p', details.error ?? '', 'player-details-error'); prop(error, 'hidden', !details.error);
    const song = v.el('song', 'h3', details.title ?? 'No song selected');
    const artist = v.el('artist', 'p', details.artist ?? 'Search for a song or choose one from your saved selections.');
    const album = v.el('album', 'p', details.album ?? '', 'muted'); prop(album, 'hidden', !details.album);
    const next = v.el('next', 'p', details.next ? `First saved selection: ${details.next}` : 'No saved selections.', 'muted');
    children(this.dialog, header, error, song, artist, album, next);
    attr(this.button, 'aria-description', details.error ? `Action failed: ${details.error}` : details.title);
  }

  destroy() { this.dialog.close(); this.mobile.removeEventListener('change', this.resized); }
}
