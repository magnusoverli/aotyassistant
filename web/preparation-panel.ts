import type { CatalogueTrack, View } from '../src/model';
import type { PreparedEntryView } from '../src/preparations';
import { el, syncChildren } from './dom';
import { artwork } from './media';
import { PreparationController } from './preparation-controller';
import { UploadPanel } from './upload-panel';
import { copyButton } from './copy-text';
import { workspaceGrid, slot } from './page-layout';

type Options = { getView(): View | undefined; starting(): boolean; canPlay(): boolean; play(entry: PreparedEntryView): void; changed(): void };
export class PreparationPanel {
  private expanded = false;
  private editing = false;
  private dragging?: string;
  private recoveryDraft = '';
  private open = new Set<string>();
  private feedback = el('span', undefined, 'sr-only');
  private list?: HTMLElement;
  private listKey = '';
  private withSearch = true;
  private historyLimit = 50;
  private rows = new Map<string, { key: string; element: HTMLElement }>();
  readonly uploads: UploadPanel;
  constructor(private library: PreparationController, private options: Options) {
    this.feedback.setAttribute('role', 'status'); this.feedback.setAttribute('aria-live', 'polite');
    this.uploads = new UploadPanel(library, () => Boolean(options.getView()?.me), options.changed, () => {});
  }
  private button(text: string, action: () => void | Promise<void>, secondary = true, key = '') {
    const button = el('button', text, secondary ? 'secondary' : ''); button.type = 'button';
    button.disabled = this.library.saving || !navigator.onLine; if (key) button.dataset.focusKey = key;
    button.onclick = () => {
      void Promise.resolve(action()).finally(() => {
        // Saving temporarily disables/remounts this control. Restore keyboard focus
        // afterwards, but never steal it from a player control the listener moved to.
        if (!key || document.activeElement !== document.body) return;
        const controls = [...document.querySelectorAll<HTMLButtonElement>('[data-focus-key]')];
        const target = controls.find(node => node.dataset.focusKey === key && !node.disabled && !node.hidden)
          ?? controls.find(node => node.dataset.focusKey === key.replace(/^(up|down)-/, 'drag-') && !node.disabled && !node.hidden);
        target?.focus({ preventScroll: true });
      });
    }; return button;
  }
  private details(key: string, caption: string) {
    const details = el('details', undefined, 'list-disclosure'); details.open = this.open.has(key);
    const summary = el('summary', caption); summary.id = `list-${key}`; details.append(summary);
    details.addEventListener('toggle', () => { if (details.isConnected) { if (details.open) this.open.add(key); else this.open.delete(key); } }); return details;
  }
  addButton(track: CatalogueTrack) {
    const added = this.library.added.has(track.id);
    const button = this.button(added ? 'Added ✓' : 'Add to my list', async () => {
      if (added) return;
      await this.library.add(track);
      if (this.library.added.has(track.id)) this.feedback.textContent = `Added ${track.title} to your list.`;
    }, true, `save-${track.id}`);
    // Keep the acknowledgement focusable, so saving does not strand keyboard users on the page body.
    if (added) button.setAttribute('aria-disabled', 'true');
    button.dataset.preparationTrack = track.id;
    button.disabled ||= Boolean(this.library.pending || this.library.view?.reviewEntryId) || this.library.loading || (!this.library.view && !this.library.missing);
    return button;
  }
  renderEntry() {
    const library = this.library;
    const access = el('section', undefined, 'entry-library-access'); access.setAttribute('aria-label', 'Saved music access');
    if (library.loading) { const status = el('p', 'Checking your saved music…', 'muted small'); status.setAttribute('role', 'status'); access.append(status); }
    if (library.recovered) {
      const status = el('p', 'Your list is recovered. Enter your name to join the room.', 'muted small'); status.setAttribute('role', 'status'); access.append(status);
    }
    if (library.pending) {
      const notice = el('p', 'Your unsynced list change is kept. Join the room to review it.', 'muted small'); notice.setAttribute('role', 'status'); access.append(notice);
    } else if (library.error) {
      const notice = el('div', undefined, 'list-notice'); notice.setAttribute('role', 'alert'); notice.append(el('p', library.error));
      notice.append(this.button('Retry saved music', () => library.start(), true, 'entry-refresh-library')); access.append(notice);
    }
    access.append(this.recovery(true));
    const uploadPanel = this.uploads.render(false);
    if (this.uploads.hasWork) {
      const upload = el('section', undefined, 'music-upload'); upload.setAttribute('aria-label', 'Upload a private track');
      upload.append(el('p', 'Your unfinished upload is kept. Join the room to finish adding it.', 'muted small'), uploadPanel); access.append(upload);
    }
    return access;
  }

  render(search?: HTMLElement, results?: HTMLElement) {
    this.withSearch = Boolean(search);
    const panel = workspaceGrid('music', `music-workspace${search ? '' : ' is-list-only'}`); panel.setAttribute('role', 'region'); panel.setAttribute('aria-label', 'Your private music'); panel.append(this.feedback);
    if (search) { search.id = 'music-find'; search.classList.add('panel'); panel.append(slot(search, 'find')); }
    panel.append(slot(this.renderList(), 'list'));
    if (results) panel.append(slot(results, 'results'));
    const uploads = this.details('upload', 'Upload a song'); uploads.classList.add('music-upload');
    uploads.setAttribute('aria-label', 'Upload a private track'); uploads.open ||= this.uploads.hasWork; uploads.append(this.uploads.render());
    if (search) search.append(uploads); else panel.append(uploads);
    return panel;
  }
  /** The phone shortcut opens the same list, retaining the current browse context. */
  openList() {
    this.expanded = true; this.refresh();
    this.list?.querySelector<HTMLButtonElement>('.list-expand')?.focus({ preventScroll: true });
    this.list?.scrollIntoView({ block: 'start', behavior: 'instant' });
  }

  /** List changes never replace the search form, result rows, or private player. */
  refresh() {
    const focused = document.activeElement instanceof HTMLElement && document.activeElement.closest('.music-workspace') ? document.activeElement : undefined;
    const key = focused?.dataset.focusKey; const id = focused?.id;
    const scroll = this.list?.querySelector('.list-body')?.scrollTop ?? 0;
    const top = scrollY;
    this.renderList();
    this.uploads.render();
    const body = this.list?.querySelector('.list-body'); if (body) body.scrollTop = scroll;
    const replacement = id ? document.getElementById(id) : key ? [...this.list?.querySelectorAll<HTMLElement>('[data-focus-key]') ?? []].find(node => node.dataset.focusKey === key) : undefined;
    if (focused && replacement && document.activeElement === document.body) replacement.focus({ preventScroll: true });
    window.scrollTo({ top, behavior: 'instant' });
    for (const button of document.querySelectorAll<HTMLButtonElement>('[data-preparation-track]')) {
      const added = this.library.added.has(button.dataset.preparationTrack!);
      button.textContent = added ? 'Added ✓' : 'Add to my list';
      if (added) button.setAttribute('aria-disabled', 'true'); else button.removeAttribute('aria-disabled');
      button.disabled = this.library.saving || !navigator.onLine || Boolean(this.library.pending || this.library.view?.reviewEntryId) || this.library.loading ||
        (!this.library.view && !this.library.missing) || button.dataset.sourceSelectable === 'false';
      button.closest('.track-row')?.classList.toggle('is-prepared', added);
    }
  }
  private renderList() {
    const library = this.library; const snapshot = library.view;
    const key = JSON.stringify([snapshot, library.loading, library.saving, library.pending, library.error, library.warning, library.conflict,
      library.undoId, library.recoveryKey, this.expanded, this.editing, [...this.open], this.historyLimit, this.withSearch, this.options.starting(), this.options.canPlay(), navigator.onLine]);
    if (this.list && key === this.listKey) return this.list;
    this.listKey = key;
    const previous = this.list;
    const expanded = this.expanded || !this.withSearch;
    const list = slot(el('aside', undefined, `panel preparation-list${expanded ? ' is-expanded' : ''}`), 'list'); list.id = 'music-list'; list.setAttribute('aria-labelledby', 'music-list-title');
    list.dataset.myTurn = String(Boolean(this.options.getView()?.myTurn));
    const heading = el('div', undefined, 'list-heading'); const title = el('h2', 'My list'); title.id = 'music-list-title';
    title.append(el('span', ` · ${snapshot?.upcoming.length ?? 0}`, 'list-count')); heading.append(title);
    const expand = el('button', expanded ? 'Close list' : 'Open list', 'secondary list-expand'); expand.type = 'button'; expand.id = 'music-list-expand';
    expand.setAttribute('aria-expanded', String(expanded)); expand.setAttribute('aria-controls', 'music-list-body');
    expand.onclick = () => {
      this.expanded = !expanded;
      if (expanded) this.editing = false; this.refresh();
    };
    const summary = el('div', undefined, 'list-summary'); summary.append(title);
    const attention = Boolean(library.error || library.warning || library.pending || snapshot?.reviewEntryId || snapshot?.upcoming.some(entry => entry.sourceAvailable === false));
    const preview = el('p', attention ? 'Needs attention' : snapshot?.upcoming[0] ? `Your next pick: ${snapshot.upcoming[0].title}` : 'Save songs for your turn', 'list-preview');
    preview.hidden = !attention && !snapshot?.upcoming.length;
    preview.title = preview.textContent ?? ''; summary.append(preview); heading.replaceChildren(summary);
    if (this.withSearch) heading.append(expand);
    const status = el('p', library.loading ? 'Loading your private list…' : library.saving ? 'Saving…' : library.pending ? 'Save not confirmed. Your change is kept.' : !navigator.onLine ? 'Offline · saved list retained' : snapshot ? 'Private · Saved ✓' : 'Private · saved when you add a song', 'list-save-status'); status.setAttribute('role', 'status');
    list.append(heading, status);
    const body = el('div', undefined, 'list-body'); body.id = 'music-list-body'; body.dataset.scrollKey = 'private-list';
    if (library.error) {
      const notice = el('div', undefined, 'list-notice'); notice.setAttribute('role', 'alert'); notice.append(el('p', library.error));
      if (library.pending) {
        notice.append(el('p', library.pending.title || 'Your requested list change is retained.', 'muted small'),
          this.button(library.conflict ? 'Apply this change' : 'Retry save', () => library.retry(library.conflict)),
          this.button('Discard unsaved change', () => { if (confirm('Discard this local draft? Tracks already saved on the server will be kept.')) return library.discardDraft(); }));
      } else notice.append(this.button('Refresh list', () => library.start()));
      body.append(notice);
    }
    if (library.warning) body.append(el('p', library.warning, 'muted small list-note'));
    if (snapshot?.reviewEntryId && !this.options.starting()) {
      const review = el('div', undefined, 'list-notice'); review.append(el('p', 'A previous play attempt needs review. The track is still saved; check the player before trying again.'),
        this.button('Keep it in my list', () => library.edit('review', { entryId: snapshot.reviewEntryId }))); body.append(review);
    }
    if (!snapshot?.upcoming.length) body.append(el('p', 'Add songs as you browse.', 'muted list-empty'));
    const ordered = el('ol', undefined, 'saved-tracks'); ordered.setAttribute('aria-label', 'Your prepared tracks'); ordered.classList.toggle('is-empty', !snapshot?.upcoming.length);
    const upcomingRows: HTMLElement[] = [];
    snapshot?.upcoming.forEach((entry, index) => {
      upcomingRows.push(this.savedRow(entry, index, snapshot.upcoming.length));
    });
    const actions = el('div', undefined, 'list-actions');
    const next = snapshot?.upcoming[0];
    if (next) {
      const play = this.button('Play this song', () => this.options.play(next), false, `play-next-${next.id}`); play.classList.add('list-play');
      play.disabled ||= !this.options.canPlay() || next.sourceAvailable === false || Boolean(library.pending || snapshot?.reviewEntryId);
      play.dataset.playerReady = String(!play.disabled); play.disabled ||= this.options.starting(); actions.append(play);
      const edit = this.button(this.editing ? 'Done' : 'Edit order', () => { this.editing = !this.editing; this.refresh(); }, true, 'list-edit'); edit.classList.add('list-edit'); edit.setAttribute('aria-pressed', String(this.editing)); actions.append(edit);
    }
    body.append(actions, ordered);
    const tools = el('div', undefined, 'list-tools');
    const removed = snapshot?.removed.find(entry => entry.id === library.undoId);
    if (!snapshot?.reviewEntryId && removed) {
      const undo = el('div', undefined, 'list-notice'); undo.append(el('p', `Removed ${removed.title}. Undo adds it back at the end.`), this.button('Undo removal', () => library.edit('restore', { entryId: removed.id }))); list.append(undo);
    }
    const history = this.details('history', 'History');
    history.append(el('p', 'Previously played songs were started, not necessarily finished. Add back places a song at the end of your list.', 'muted small'));
    let remaining = this.historyLimit;
    for (const kind of ['played', 'removed'] as const) {
      const entries = snapshot?.[kind] ?? []; if (!entries.length) continue;
      history.append(el('h3', `${kind === 'played' ? 'Previously played' : 'Removed'} · ${entries.length}`));
      if (!this.open.has('history')) continue;
      const rows = el('ul', undefined, 'saved-tracks');
      const visible = entries.slice(0, remaining); remaining -= visible.length;
      for (const entry of visible) {
        const row = this.row(entry); const restore = this.button('Add back', () => library.edit('restore', { entryId: entry.id }), true, `restore-${entry.id}`);
        restore.disabled ||= Boolean(library.pending || snapshot?.reviewEntryId); row.append(restore); rows.append(row);
        if (kind === 'removed' && entry.source === 'upload') row.append(this.button('Delete file permanently', () => {
          if (confirm('Permanently delete this uploaded file and all its entries from your list and history? This cannot be undone. Stop or finish it first.')) return library.edit('purge-upload', { entryId: entry.id }, entry.title);
        }, true, `purge-${entry.id}`));
      } history.append(rows);
    }
    if (this.open.has('history') && (snapshot?.played.length ?? 0) + (snapshot?.removed.length ?? 0) > this.historyLimit) {
      history.append(this.button('Show more history', () => { this.historyLimit += 50; this.refresh(); }));
    }
    history.addEventListener('toggle', () => { if (history.isConnected && history.open !== this.open.has('history')) return; if (history.isConnected) this.refresh(); });
    if (snapshot?.played.length || snapshot?.removed.length) tools.append(history);
    tools.append(this.recovery()); list.append(body, tools);
    for (const id of this.rows.keys()) if (!snapshot?.upcoming.some(entry => entry.id === id)) this.rows.delete(id);
    if (previous) {
      const oldBody = previous.querySelector<HTMLElement>('.list-body')!;
      const oldOrdered = oldBody.querySelector<HTMLElement>('.saved-tracks[aria-label="Your prepared tracks"]')!;
      if (oldOrdered.className !== ordered.className) oldOrdered.className = ordered.className;
      syncChildren(oldOrdered, upcomingRows);
      syncChildren(oldBody, [...body.childNodes].map(node => node === ordered ? oldOrdered : node));
      for (const attribute of [...previous.attributes]) if (!list.hasAttribute(attribute.name)) previous.removeAttribute(attribute.name);
      for (const attribute of [...list.attributes]) if (previous.getAttribute(attribute.name) !== attribute.value) previous.setAttribute(attribute.name, attribute.value);
      syncChildren(previous, [...list.childNodes].map(node => node === body ? oldBody : node));
      return previous;
    }
    syncChildren(ordered, upcomingRows); this.list = list; return list;
  }

  private savedRow(entry: PreparedEntryView, index: number, count: number) {
    const library = this.library; const key = JSON.stringify(entry);
    let cached = this.rows.get(entry.id);
    if (!cached || cached.key !== key) {
      const row = this.row(entry); row.dataset.entryId = entry.id; row.prepend(el('span', '', 'saved-number'));
      row.querySelector('.result-identity > div:last-child')!.prepend(el('span', 'Your next pick', 'saved-next-label'));
      const controls = el('div', undefined, 'saved-actions');
      const handle = this.button('⋮⋮', () => {}, true, `drag-${entry.id}`); handle.classList.add('drag-handle'); handle.draggable = true; handle.setAttribute('aria-label', `Drag ${entry.title} to reorder`);
      handle.ondragstart = event => { this.dragging = entry.id; event.dataTransfer?.setData('text/plain', entry.id); }; handle.ondragend = () => { this.dragging = undefined; };
      const move = (shift: number) => {
        const upcoming = library.view?.upcoming ?? []; const position = upcoming.findIndex(item => item.id === entry.id);
        if (position < 0 || position + shift < 0 || position + shift >= upcoming.length) return;
        return library.edit('move', { entryId: entry.id, beforeId: upcoming[position + (shift < 0 ? -1 : 2)]?.id ?? null });
      };
      const up = this.button('↑', () => move(-1), true, `up-${entry.id}`); up.setAttribute('aria-label', `Move ${entry.title} up`);
      const down = this.button('↓', () => move(1), true, `down-${entry.id}`); down.setAttribute('aria-label', `Move ${entry.title} down`);
      controls.append(handle, up, down);
      row.ondragover = event => { if (this.dragging) event.preventDefault(); };
      row.ondrop = event => {
        event.preventDefault(); const moving = this.dragging; this.dragging = undefined;
        const upcoming = library.view?.upcoming ?? []; const position = upcoming.findIndex(item => item.id === entry.id);
        if (moving && moving !== entry.id && position >= 0) {
          const after = event.clientY > row.getBoundingClientRect().top + row.clientHeight / 2;
          void library.edit('move', { entryId: moving, beforeId: after ? upcoming[position + 1]?.id ?? null : entry.id });
        }
      };
      const menu = this.details(`entry-${entry.id}`, '⋯'); menu.classList.add('saved-menu'); menu.querySelector('summary')!.setAttribute('aria-label', `Options for ${entry.title}`);
      const next = this.button('Make next', () => library.edit('move', { entryId: entry.id, beforeId: library.view?.upcoming[0]?.id ?? null })); next.dataset.makeNext = 'true';
      menu.append(next, this.button('Remove', () => library.edit('remove', { entryId: entry.id }, entry.title))); controls.append(menu); row.append(controls);
      cached = { key, element: row }; this.rows.set(entry.id, cached);
    }
    const row = cached.element;
    row.classList.toggle('is-next', index === 0);
    const number = row.querySelector('.saved-number')!; const text = String(index + 1).padStart(2, '0'); if (number.textContent !== text) number.textContent = text;
    const hide = (selector: string, hidden: boolean) => { const node = row.querySelector<HTMLElement>(selector)!; if (node.hidden !== hidden) node.hidden = hidden; };
    hide('.saved-next-label', index !== 0); hide('.drag-handle', !this.editing);
    hide(`[data-focus-key="up-${entry.id}"]`, !this.editing || index === 0); hide(`[data-focus-key="down-${entry.id}"]`, !this.editing || index === count - 1); hide('[data-make-next]', index === 0);
    const disabled = library.saving || !navigator.onLine || Boolean(library.pending || library.view?.reviewEntryId);
    for (const button of row.querySelectorAll('button')) if (button.disabled !== disabled) button.disabled = disabled;
    return row;
  }

  private recovery(compact = false) {
    const library = this.library; const snapshot = library.view;
    const recovery = this.details('recovery', compact ? 'Recover a saved list' : 'List access');
    recovery.append(el('p', 'Your songs stay saved. Keep a private recovery key to open your list on another device.', 'muted small'));
    if (snapshot) {
      recovery.append(el('h3', 'Back up access'), this.button(snapshot.recoveryKeyCreated ? 'Replace recovery key' : 'Create recovery key', () => {
        if (!snapshot.recoveryKeyCreated || confirm('Replace your private recovery key? The previous key will stop working.')) return library.createRecoveryKey();
      }));
    }
    if (library.recoveryKey) {
      const key = el('textarea'); key.readOnly = true; key.value = library.recoveryKey; key.setAttribute('aria-label', 'Your private recovery key'); key.rows = 3;
      recovery.append(key, el('p', 'Keep this private. It grants access to your list.', 'small muted'), copyButton('Copy key', key), this.button('Hide key', () => library.hideRecoveryKey()));
    }
    recovery.append(el('h3', 'Use a recovery key'));
    const form = el('form', undefined, 'list-recovery-form'); const input = el('input'); input.type = 'password'; input.autocomplete = 'off'; input.maxLength = 100; input.value = this.recoveryDraft; input.placeholder = 'Private recovery key'; input.id = 'preparation-recovery-key'; input.setAttribute('aria-label', 'Recover with a private key'); input.oninput = () => { this.recoveryDraft = input.value; };
    const recover = el('button', 'Recover my list', compact ? 'secondary' : ''); recover.type = 'submit'; recover.disabled = library.loading || library.saving || !navigator.onLine; form.append(input, recover);
    form.onsubmit = event => { event.preventDefault(); if (snapshot && !confirm('Replace this browser’s list access? Save its recovery key first; its saved tracks will not be deleted.')) return; const key = input.value; this.recoveryDraft = ''; void library.recover(key, Boolean(snapshot)); };
    recovery.append(form);
    if (snapshot) recovery.append(el('h3', 'Other devices'), this.button('Revoke other devices', () => { if (confirm('End private-list access on your other devices? Their saved songs will be kept.')) return library.revokeOtherDevices(); }));
    return recovery;
  }
  private row(entry: PreparedEntryView) {
    const row = el('li', undefined, 'saved-track'); const identity = el('div', undefined, 'result-identity'); const copy = el('div');
    copy.append(el('strong', entry.title), el('p', [entry.artist, entry.album, entry.version].filter(Boolean).join(' · '), 'muted'), el('span', entry.source === 'upload' ? 'Uploaded file' : entry.provider, 'saved-source'));
    if (entry.sourceAvailable === false) copy.append(el('span', 'Source unavailable · entry kept', 'saved-unavailable'));
    identity.append(artwork(entry.artwork, 'Saved album artwork', 'result-artwork'), copy); row.append(identity); return row;
  }
}
