import type { CatalogueTrack } from '../src/model';
import type { PreparedEntryView } from '../src/preparations';
import { el } from './dom';
import { requestJson } from './request';
import type { PreparationController } from './preparation-controller';
import { UploadPanel } from './upload-panel';

type Album = { album: { name: string; artist: string }; tracks: CatalogueTrack[]; current: number; notices?: string[] };
const length = (seconds: number | null) => seconds ? `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, '0')}` : '';
const message = (error: unknown, fallback: string) => error instanceof Error && error.message ? error.message : fallback;

/** Replaces in place, using album choices for catalogue songs or a new file for uploads. */
export class ReplaceTrack {
  readonly dialog = el('dialog', undefined, 'list-dialog');
  private sequence = 0;
  private saving = false;
  private upload?: UploadPanel;
  private ownerId?: string;
  private closing = false;
  private get locked() { return this.saving || Boolean(this.upload && this.library.saving); }

  constructor(private library: PreparationController, private replaced: (from: string, to: string) => void, private member = () => true) {
    this.dialog.id = 'replace-track'; this.dialog.setAttribute('aria-labelledby', 'replace-track-title');
    this.dialog.addEventListener('cancel', event => { if (this.locked) event.preventDefault(); });
    this.dialog.addEventListener('click', event => {
      if (event.target !== this.dialog || this.locked) return;
      const box = this.dialog.getBoundingClientRect();
      if (event.clientY < box.top || event.clientY > box.bottom || event.clientX < box.left || event.clientX > box.right) this.dialog.close();
    });
    // A late album answer never replaces a newer one.
    this.dialog.addEventListener('close', () => {
      this.sequence++;
      const upload = this.upload; this.upload = undefined;
      if (upload) {
        this.closing = true;
        void upload.cancel().finally(() => { this.closing = false; });
      }
    });
  }

  open(entry: PreparedEntryView) {
    if (this.closing || this.upload || this.locked || this.dialog.open || !this.member() || !this.library.view) return;
    this.ownerId = this.library.view.ownerId;
    if (!this.dialog.isConnected) document.body.append(this.dialog);
    if (entry.source === 'upload') {
      const upload = new UploadPanel(this.library, this.member, () => { if (this.upload === upload) this.refresh(); }, title => {
        this.dialog.close(); this.replaced(entry.title, title || 'uploaded song');
      }, { entryId: entry.id });
      this.upload = upload;
      this.show(entry, el('p', 'The original file stays in Removed, or Previously played if it has history. You can delete it separately.', 'muted small'), upload.render());
      this.dialog.showModal(); return;
    }
    this.show(entry, el('p', 'Loading the album…', 'import-status'));
    if (!this.dialog.open) this.dialog.showModal();
    void this.load(entry);
  }

  refresh() {
    if (!this.dialog.open) return;
    if (!this.member() || this.ownerId !== this.library.view?.ownerId) { this.stop(); return; }
    this.upload?.render();
    const close = this.dialog.querySelector<HTMLButtonElement>('.list-dialog-header button');
    if (close) close.disabled = this.locked;
  }
  stop() { this.sequence++; this.dialog.close(); this.upload?.stop(); this.dialog.remove(); }

  private header() {
    const header = el('div', undefined, 'list-dialog-header'); const heading = el('h2', 'Replace song'); heading.id = 'replace-track-title';
    const close = el('button', 'Close', 'secondary'); close.type = 'button'; close.onclick = () => { if (!this.locked) this.dialog.close(); }; close.disabled = this.locked;
    header.append(heading, close); return header;
  }
  private show(entry: PreparedEntryView, ...body: Node[]) {
    const intro = el('p'); intro.append(entry.source === 'upload' ? 'Upload a new file to take the place of ' : 'Choose a song to take the place of ', el('strong', entry.title), '.');
    this.dialog.replaceChildren(this.header(), intro, ...body);
  }

  private async load(entry: PreparedEntryView) {
    const sequence = ++this.sequence;
    try {
      const album = await requestJson<Album>('/api/participant/preparations/album', { entryId: entry.id }, 35_000);
      if (sequence === this.sequence) this.showAlbum(entry, album);
    } catch (error) {
      if (sequence !== this.sequence) return;
      const alert = el('p', message(error, 'The album could not be loaded.'), 'list-dialog-error'); alert.setAttribute('role', 'alert');
      const retry = el('button', 'Try again', 'secondary'); retry.type = 'button'; retry.onclick = () => {
        this.show(entry, el('p', 'Loading the album…', 'import-status')); void this.load(entry);
      };
      const actions = el('div', undefined, 'list-dialog-actions'); actions.append(retry);
      this.show(entry, alert, actions);
    }
  }

  private showAlbum(entry: PreparedEntryView, album: Album, error = '') {
    const title = el('h3', [album.album.name, album.album.artist].filter(Boolean).join(' · '));
    const notices = (album.notices ?? []).map(notice => el('p', notice, 'muted small'));
    const list = el('ol', undefined, 'replace-tracks'); list.setAttribute('aria-label', `Songs on ${album.album.name}`);
    album.tracks.forEach((track, index) => {
      const current = index === album.current;
      const option = el('button', undefined, 'replace-option'); option.type = 'button';
      option.disabled = this.saving || current || !track.available;
      option.append(el('span', String(index + 1), 'replace-number'), el('span', track.version ? `${track.title} (${track.version})` : track.title, 'replace-title'),
        el('span', current ? 'In your list' : !track.available ? 'Unavailable' : length(track.duration), 'replace-meta'));
      option.setAttribute('aria-label', current ? `${track.title}, in your list` : `Replace with ${track.title}`);
      if (current) option.setAttribute('aria-current', 'true');
      option.onclick = () => void this.choose(entry, album, track);
      const item = el('li'); item.append(option); list.append(item);
    });
    const nodes: Node[] = [title, ...notices, list];
    if (!album.tracks.length) nodes.push(el('p', 'This album has no songs to choose from.', 'muted'));
    if (error) { const alert = el('p', error, 'list-dialog-error'); alert.setAttribute('role', 'alert'); nodes.push(alert); }
    if (this.saving) { const status = el('p', 'Replacing…', 'import-status'); status.setAttribute('role', 'status'); nodes.push(status); }
    const cancel = el('button', 'Cancel', 'secondary'); cancel.type = 'button'; cancel.disabled = this.saving; cancel.onclick = () => this.dialog.close();
    const actions = el('div', undefined, 'list-dialog-actions'); actions.append(cancel); nodes.push(actions);
    this.show(entry, ...nodes);
    // Start at the song being replaced, so its neighbours are in view.
    list.querySelector<HTMLElement>('[aria-current]')?.scrollIntoView({ block: 'nearest' });
  }

  private async choose(entry: PreparedEntryView, album: Album, track: CatalogueTrack) {
    if (this.saving) return;
    if (this.library.locked || !this.library.view) { this.showAlbum(entry, album, 'Wait until your playlist shows Saved, then try again.'); return; }
    this.saving = true; this.showAlbum(entry, album);
    try { await this.library.edit('replace', { entryId: entry.id, trackId: track.id }, track.title); }
    finally { this.saving = false; }
    if (this.library.pending || this.library.error) { this.showAlbum(entry, album, this.library.error || 'The song could not be replaced. Try again.'); return; }
    this.dialog.close(); this.replaced(entry.title, track.title);
  }
}
