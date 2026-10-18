import type { CatalogueTrack, View } from '../src/model';
import type { PreparedEntryView } from '../src/preparations';
import { el } from './dom';
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
        const target = controls.find(node => node.dataset.focusKey === key && !node.disabled)
          ?? controls.find(node => node.dataset.focusKey === key.replace(/^(up|down)-/, 'drag-') && !node.disabled);
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
    const library = this.library; const snapshot = library.view;
    const uploadPanel = this.uploads.render();
    const panel = workspaceGrid('music', `music-workspace${search ? '' : ' is-list-only'}`); panel.setAttribute('role', 'region'); panel.setAttribute('aria-label', 'Your private music'); panel.append(this.feedback);
    if (search) { search.id = 'music-find'; search.classList.add('panel'); panel.append(slot(search, 'find')); }
    const expanded = this.expanded || !search;
    const list = el('aside', undefined, `panel preparation-list${expanded ? ' is-expanded' : ''}`); list.id = 'music-list'; list.setAttribute('aria-labelledby', 'music-list-title');
    list.dataset.myTurn = String(Boolean(this.options.getView()?.myTurn));
    const heading = el('div', undefined, 'list-heading'); const title = el('h2', 'My list'); title.id = 'music-list-title';
    title.append(el('span', ` · ${snapshot?.upcoming.length ?? 0}`, 'list-count')); heading.append(title);
    const expand = el('button', expanded ? 'Close list' : 'Open list', 'secondary list-expand'); expand.type = 'button'; expand.id = 'music-list-expand';
    expand.setAttribute('aria-expanded', String(expanded)); expand.setAttribute('aria-controls', 'music-list-body');
    expand.onclick = () => {
      this.expanded = !expanded;
      if (expanded) this.editing = false; this.options.changed();
    };
    const summary = el('div', undefined, 'list-summary'); summary.append(title);
    const attention = Boolean(library.error || library.warning || library.pending || snapshot?.reviewEntryId || snapshot?.upcoming.some(entry => entry.sourceAvailable === false));
    const preview = el('p', attention ? 'Needs attention' : snapshot?.upcoming[0] ? `Your next pick: ${snapshot.upcoming[0].title}` : 'Save songs for your turn', 'list-preview');
    preview.hidden = !attention && !snapshot?.upcoming.length;
    preview.title = preview.textContent ?? ''; summary.append(preview); heading.replaceChildren(summary);
    if (search) heading.append(expand);
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
    snapshot?.upcoming.forEach((entry, index) => {
      const row = this.row(entry); row.classList.toggle('is-next', index === 0); row.dataset.entryId = entry.id;
      const number = el('span', String(index + 1).padStart(2, '0'), 'saved-number'); row.prepend(number);
      if (index === 0) row.querySelector('.result-identity > div:last-child')?.prepend(el('span', 'Your next pick', 'saved-next-label'));
      const controls = el('div', undefined, 'saved-actions');
      if (this.editing) {
        const handle = this.button('⋮⋮', () => {}, true, `drag-${entry.id}`); handle.classList.add('drag-handle'); handle.draggable = true; handle.setAttribute('aria-label', `Drag ${entry.title} to reorder`);
        handle.ondragstart = event => { this.dragging = entry.id; event.dataTransfer?.setData('text/plain', entry.id); };
        handle.ondragend = () => { this.dragging = undefined; };
        controls.append(handle);
        if (index > 0) { const up = this.button('↑', () => library.edit('move', { entryId: entry.id, beforeId: snapshot.upcoming[index - 1]!.id }), true, `up-${entry.id}`); up.setAttribute('aria-label', `Move ${entry.title} up`); controls.append(up); }
        if (index < snapshot.upcoming.length - 1) { const down = this.button('↓', () => library.edit('move', { entryId: entry.id, beforeId: snapshot.upcoming[index + 2]?.id ?? null }), true, `down-${entry.id}`); down.setAttribute('aria-label', `Move ${entry.title} down`); controls.append(down); }
        row.ondragover = event => { if (this.dragging) event.preventDefault(); };
        row.ondrop = event => {
          event.preventDefault(); const moving = this.dragging; this.dragging = undefined;
          if (moving && moving !== entry.id) { const after = event.clientY > row.getBoundingClientRect().top + row.clientHeight / 2; void library.edit('move', { entryId: moving, beforeId: after ? snapshot.upcoming[index + 1]?.id ?? null : entry.id }); }
        };
      }
      const menu = this.details(`entry-${entry.id}`, '⋯'); menu.classList.add('saved-menu'); menu.querySelector('summary')!.setAttribute('aria-label', `Options for ${entry.title}`);
      if (index > 0) menu.append(this.button('Make next', () => library.edit('move', { entryId: entry.id, beforeId: snapshot.upcoming[0]!.id })));
      menu.append(this.button('Remove', () => library.edit('remove', { entryId: entry.id }, entry.title))); controls.append(menu);
      for (const button of controls.querySelectorAll('button')) if (library.pending || snapshot.reviewEntryId) button.disabled = true;
      row.append(controls); ordered.append(row);
    });
    const actions = el('div', undefined, 'list-actions');
    const next = snapshot?.upcoming[0];
    if (next) {
      const play = this.button('Play this song', () => this.options.play(next), false, `play-next-${next.id}`); play.classList.add('list-play');
      play.disabled ||= !this.options.canPlay() || next.sourceAvailable === false || Boolean(library.pending || snapshot?.reviewEntryId);
      play.dataset.playerReady = String(!play.disabled); play.disabled ||= this.options.starting(); actions.append(play);
      const edit = this.button(this.editing ? 'Done' : 'Edit order', () => { this.editing = !this.editing; this.options.changed(); }, true, 'list-edit'); edit.classList.add('list-edit'); edit.setAttribute('aria-pressed', String(this.editing)); actions.append(edit);
    }
    body.append(actions, ordered);
    const tools = el('div', undefined, 'list-tools');
    const removed = snapshot?.removed.find(entry => entry.id === library.undoId);
    if (!snapshot?.reviewEntryId && removed) {
      const undo = el('div', undefined, 'list-notice'); undo.append(el('p', `Removed ${removed.title}. Undo adds it back at the end.`), this.button('Undo removal', () => library.edit('restore', { entryId: removed.id }))); list.append(undo);
    }
    const history = this.details('history', 'History');
    history.append(el('p', 'Previously played songs were started, not necessarily finished. Add back places a song at the end of your list.', 'muted small'));
    for (const kind of ['played', 'removed'] as const) {
      const entries = snapshot?.[kind] ?? []; if (!entries.length) continue;
      history.append(el('h3', `${kind === 'played' ? 'Previously played' : 'Removed'} · ${entries.length}`));
      const rows = el('ul', undefined, 'saved-tracks');
      for (const entry of entries) {
        const row = this.row(entry); const restore = this.button('Add back', () => library.edit('restore', { entryId: entry.id }), true, `restore-${entry.id}`);
        restore.disabled ||= Boolean(library.pending || snapshot?.reviewEntryId); row.append(restore); rows.append(row);
        if (kind === 'removed' && entry.source === 'upload') row.append(this.button('Delete file permanently', () => {
          if (confirm('Permanently delete this uploaded file and all its entries from your list and history? This cannot be undone. Stop or finish it first.')) return library.edit('purge-upload', { entryId: entry.id }, entry.title);
        }, true, `purge-${entry.id}`));
      } history.append(rows);
    }
    if (snapshot?.played.length || snapshot?.removed.length) tools.append(history);
    tools.append(this.recovery()); list.append(body, tools); panel.append(slot(list, 'list'));
    if (results) panel.append(slot(results, 'results'));
    const uploads = this.details('upload', 'Upload a song'); uploads.classList.add('music-upload');
    uploads.setAttribute('aria-label', 'Upload a private track'); uploads.open ||= this.uploads.hasWork; uploads.append(uploadPanel);
    if (search) search.append(uploads); else panel.append(uploads);
    return panel;
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
