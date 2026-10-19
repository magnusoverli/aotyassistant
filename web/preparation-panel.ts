import type { CatalogueTrack, View } from '../src/model';
import type { PreparedEntryView } from '../src/preparations';
import { el } from './dom';
import { artwork } from './media';
import { PreparationController } from './preparation-controller';
import { UploadPanel } from './upload-panel';
import { copyButton } from './copy-text';
import { workspaceGrid, slot } from './page-layout';
import { ViewNodes, children, prop, text, attr } from './view-nodes';

type Options = { getView(): View | undefined; starting(): boolean; changed(): void };
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
  private historyRows = new Map<string, { key: string; element: HTMLElement }>();
  readonly uploads: UploadPanel;
  private workspace?: HTMLElement;
  private uploadDisclosure?: HTMLDetailsElement;
  private nodes = new ViewNodes();
  private disclosures = new Map<string, HTMLDetailsElement>();
  constructor(private library: PreparationController, private options: Options) {
    this.feedback.setAttribute('role', 'status'); this.feedback.setAttribute('aria-live', 'polite');
    this.uploads = new UploadPanel(library, () => Boolean(options.getView()?.me), () => {
      this.uploads.render(Boolean(options.getView()?.me));
      if (this.uploadDisclosure?.isConnected) { if (this.uploads.hasWork) this.uploadDisclosure.open = true; }
      else options.changed();
    }, () => {});
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
  private control(key: string, caption: string, work: () => void | Promise<void>, secondary = true) {
    const state = this.nodes.get(`control-${key}`, () => {
      const state = { work, button: undefined as unknown as HTMLButtonElement };
      state.button = this.button(caption, () => state.work(), secondary, key); return state;
    });
    state.work = work; text(state.button, caption); prop(state.button, 'disabled', this.library.saving || !navigator.onLine); return state.button;
  }
  private details(key: string, caption: string) {
    const cached = this.disclosures.get(key);
    if (cached) { text(cached.querySelector('summary')!, caption); return cached; }
    const details = el('details', undefined, 'list-disclosure'); details.open = this.open.has(key);
    const summary = el('summary', caption); summary.id = `list-${key}`; details.append(summary);
    details.addEventListener('toggle', () => { if (details.isConnected) { if (details.open) this.open.add(key); else this.open.delete(key); } });
    this.disclosures.set(key, details); return details;
  }
  addButton(track: CatalogueTrack) {
    const added = this.library.added.has(track.id);
    const button = this.button(added ? 'Added ✓' : 'Add to list', async () => {
      if (this.library.added.has(track.id)) return;
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
    this.listKey = '';
    const library = this.library;
    const v = this.nodes;
    const access = v.el('entry', 'section', undefined, 'entry-library-access'); attr(access, 'aria-label', 'Saved music access'); const content: Node[] = [];
    if (library.loading) { const status = v.el('entry-loading', 'p', 'Checking your saved music…', 'muted small'); attr(status, 'role', 'status'); content.push(status); }
    if (library.recovered) {
      const status = v.el('entry-recovered', 'p', 'List recovered. Enter a display name to join the room.', 'muted small'); attr(status, 'role', 'status'); content.push(status);
    }
    if (library.pending) {
      const notice = v.el('entry-pending', 'p', 'Your unsynced list change is kept. Join the room to review it.', 'muted small'); attr(notice, 'role', 'status'); content.push(notice);
    } else if (library.error) {
      const notice = v.el('entry-error', 'div', undefined, 'list-notice'); attr(notice, 'role', 'alert'); children(notice, v.el('entry-error-message', 'p', library.error),
        this.control('entry-refresh-library', 'Retry saved music', () => library.start())); content.push(notice);
    }
    content.push(this.recovery(true));
    const uploadPanel = this.uploads.render(false);
    if (this.uploads.hasWork) {
      const upload = v.el('entry-upload', 'section', undefined, 'music-upload'); attr(upload, 'aria-label', 'Upload a private track');
      children(upload, v.el('entry-upload-help', 'p', 'Your unfinished upload is kept. Join the room to finish adding it.', 'muted small'), uploadPanel); content.push(upload);
    }
    children(access, ...content);
    return access;
  }

  render(search?: HTMLElement, player?: HTMLElement) {
    this.withSearch = Boolean(search);
    const panel = this.workspace ??= workspaceGrid('music', 'music-workspace');
    attr(panel, 'role', 'region'); attr(panel, 'aria-label', 'Your private music');
    panel.classList.toggle('is-list-only', !search);
    if (search) { prop(search, 'id', 'music-find'); if (!search.classList.contains('panel')) search.classList.add('panel'); slot(search, 'find'); }
    const uploads = this.uploadDisclosure ??= this.details('upload', 'Upload a song');
    if (!uploads.classList.contains('music-upload')) uploads.classList.add('music-upload');
    attr(uploads, 'aria-label', 'Upload a private track'); if (this.uploads.hasWork && !uploads.open) uploads.open = true;
    children(uploads, uploads.firstChild!, this.uploads.render());
    if (search && uploads.parentElement !== search) search.insertBefore(uploads, search.querySelector('.catalogue-results'));
    children(panel, player, this.feedback, slot(this.renderList(), 'list'), search, !search && uploads);
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
    const body = this.list?.querySelector('.list-body'); if (body) prop(body, 'scrollTop', scroll);
    const replacement = id ? document.getElementById(id) : key ? [...this.list?.querySelectorAll<HTMLElement>('[data-focus-key]') ?? []].find(node => node.dataset.focusKey === key) : undefined;
    if (focused && replacement && document.activeElement === document.body) replacement.focus({ preventScroll: true });
    if (scrollY !== top) window.scrollTo({ top, behavior: 'instant' });
    for (const button of document.querySelectorAll<HTMLButtonElement>('[data-preparation-track]')) {
      this.updateAddButton(button);
    }
  }
  updateAddButton(button: HTMLButtonElement) {
      const added = this.library.added.has(button.dataset.preparationTrack!);
      text(button, added ? 'Added ✓' : 'Add to list');
      attr(button, 'aria-disabled', added ? 'true' : undefined);
      prop(button, 'disabled', this.library.saving || !navigator.onLine || Boolean(this.library.pending || this.library.view?.reviewEntryId) || this.library.loading ||
        (!this.library.view && !this.library.missing) || button.dataset.sourceSelectable === 'false');
      button.closest('.track-row')?.classList.toggle('is-prepared', added);
  }
  private renderList() {
    const library = this.library; const snapshot = library.view;
    const v = this.nodes;
    const key = JSON.stringify([snapshot, library.loading, library.saving, library.pending, library.error, library.warning, library.conflict,
      library.recoveryKey, this.expanded, this.editing, [...this.open], this.historyLimit, this.withSearch, this.options.starting(), Boolean(this.options.getView()?.myTurn), navigator.onLine]);
    if (this.list && key === this.listKey) return this.list;
    this.listKey = key;
    const expanded = this.expanded || !this.withSearch;
    const list = this.list ??= slot(el('aside', undefined, 'panel preparation-list'), 'list'); prop(list, 'id', 'music-list'); attr(list, 'aria-labelledby', 'music-list-title');
    list.classList.toggle('is-expanded', expanded); attr(list, 'data-my-turn', String(Boolean(this.options.getView()?.myTurn)));
    const heading = v.el('heading', 'div', undefined, 'list-heading');
    const title = v.get('title', () => { const node = el('h2', 'Saved list'); node.id = 'music-list-title'; node.append(el('span', '', 'list-count')); return node; });
    text(title.querySelector('.list-count')!, ` · ${snapshot?.upcoming.length ?? 0}`);
    const expand = v.el('expand', 'button', expanded ? 'Close list' : 'Open list', 'secondary list-expand'); prop(expand, 'type', 'button'); prop(expand, 'id', 'music-list-expand');
    attr(expand, 'aria-expanded', String(expanded)); attr(expand, 'aria-controls', 'music-list-body');
    expand.onclick = () => {
      this.expanded = !expanded;
      if (expanded) this.editing = false; this.refresh();
    };
    const summary = v.el('summary', 'div', undefined, 'list-summary');
    const attention = Boolean(library.error || library.warning || library.pending || snapshot?.reviewEntryId || snapshot?.upcoming.some(entry => entry.sourceAvailable === false));
    const preview = v.el('preview', 'p', attention ? 'Needs attention' : snapshot?.upcoming[0] ? `Your next pick: ${snapshot.upcoming[0].title}` : 'Save songs for your turn', 'list-preview');
    prop(preview, 'hidden', !attention && !snapshot?.upcoming.length);
    prop(preview, 'title', preview.textContent ?? ''); children(summary, title, preview); children(heading, summary, this.withSearch && expand);
    const status = v.el('status', 'p', library.loading ? 'Loading your private list…' : library.saving ? 'Saving…' : library.pending ? 'Save not confirmed. Your change is kept.' : !navigator.onLine ? 'Offline · saved list retained' : snapshot ? 'Private · Saved ✓' : 'Private · saved when you add a song', 'list-save-status'); attr(status, 'role', 'status');
    const body = v.get('body', () => { const node = el('div', undefined, 'list-body'); node.id = 'music-list-body'; node.dataset.scrollKey = 'private-list'; return node; });
    const bodyNodes: Node[] = []; const listNodes: Node[] = [heading, status];
    if (library.error) {
      const notice = v.el('error', 'div', undefined, 'list-notice'); attr(notice, 'role', 'alert'); const messages: Node[] = [v.el('error-message', 'p', library.error)];
      if (library.pending) {
        messages.push(v.el('pending-title', 'p', library.pending.title || 'Your requested list change is retained.', 'muted small'),
          this.control('retry', library.conflict ? 'Apply this change' : 'Retry save', () => library.retry(library.conflict)),
          this.control('discard', 'Discard unsaved change', () => { if (confirm('Discard this local draft? Tracks already saved on the server will be kept.')) return library.discardDraft(); }));
      } else messages.push(this.control('refresh', 'Refresh list', () => library.start()));
      children(notice, ...messages); bodyNodes.push(notice);
    }
    if (library.warning) bodyNodes.push(v.el('warning', 'p', library.warning, 'muted small list-note'));
    if (snapshot?.reviewEntryId && !this.options.starting()) {
      const review = v.el('review', 'div', undefined, 'list-notice'); children(review, v.el('review-message', 'p', 'A previous play attempt needs review. The track is still saved; check the player before trying again.'),
        this.control('review', 'Keep in list', () => library.edit('review', { entryId: library.view?.reviewEntryId }))); bodyNodes.push(review);
    }
    if (!snapshot?.upcoming.length) bodyNodes.push(v.el('empty', 'p', 'Add songs as you browse.', 'muted list-empty'));
    const ordered = v.el('ordered', 'ol'); attr(ordered, 'class', `saved-tracks${!snapshot?.upcoming.length ? ' is-empty' : ''}`); attr(ordered, 'aria-label', 'Your prepared tracks');
    const upcomingRows: HTMLElement[] = [];
    snapshot?.upcoming.forEach((entry, index) => {
      upcomingRows.push(this.savedRow(entry, index, snapshot.upcoming.length));
    });
    const actions = v.el('actions', 'div', undefined, 'list-actions'); const actionNodes: Node[] = [];
    const next = snapshot?.upcoming[0];
    if (next) {
      const edit = v.get('edit', () => { const node = this.button('Edit order', () => { this.editing = !this.editing; this.refresh(); }, true, 'list-edit'); node.classList.add('list-edit'); return node; });
      text(edit, this.editing ? 'Done' : 'Edit order'); prop(edit, 'disabled', library.saving || !navigator.onLine); attr(edit, 'aria-pressed', String(this.editing)); actionNodes.push(edit);
    }
    children(actions, ...actionNodes); children(ordered, ...upcomingRows); bodyNodes.push(actions, ordered); children(body, ...bodyNodes);
    const tools = v.el('tools', 'div', undefined, 'list-tools'); const toolNodes: Node[] = [];
    const history = this.details('history', 'History');
    const historyNodes: Node[] = [history.firstElementChild!, v.el('history-help', 'p', 'Previously played songs were started, not necessarily finished. Add back places a song at the end of your list.', 'muted small')];
    let remaining = this.historyLimit; const historyIds = new Set<string>();
    for (const kind of ['played', 'removed'] as const) {
      const entries = snapshot?.[kind] ?? []; if (!entries.length) continue;
      historyNodes.push(v.el(`history-title-${kind}`, 'h3', `${kind === 'played' ? 'Previously played' : 'Removed'} · ${entries.length}`));
      if (!this.open.has('history')) continue;
      const rows = v.el(`history-${kind}`, 'ul', undefined, 'saved-tracks'); const historyEntries: Node[] = [];
      const visible = entries.slice(0, remaining); remaining -= visible.length;
      for (const entry of visible) {
        historyIds.add(entry.id); const key = JSON.stringify([kind, entry]);
        let cached = this.historyRows.get(entry.id);
        if (!cached || cached.key !== key) {
          const row = this.row(entry);
          row.append(this.button('Add back', () => library.edit('restore', { entryId: entry.id }), true, `restore-${entry.id}`));
          if (kind === 'removed' && entry.source === 'upload') row.append(this.button('Delete file permanently', () => {
            if (confirm('Permanently delete this uploaded file and all its entries from your list and history? This cannot be undone. Stop or finish it first.')) return library.edit('purge-upload', { entryId: entry.id }, entry.title);
          }, true, `purge-${entry.id}`));
          cached = { key, element: row }; this.historyRows.set(entry.id, cached);
        }
        for (const control of cached.element.querySelectorAll('button')) prop(control, 'disabled', library.saving || !navigator.onLine || Boolean(library.pending || snapshot?.reviewEntryId));
        historyEntries.push(cached.element);
      } children(rows, ...historyEntries); historyNodes.push(rows);
    }
    if (this.open.has('history') && (snapshot?.played.length ?? 0) + (snapshot?.removed.length ?? 0) > this.historyLimit) {
      historyNodes.push(this.control('more-history', 'Show more history', () => { this.historyLimit += 50; this.refresh(); }));
    }
    history.ontoggle = () => { if (history.isConnected && history.open !== this.open.has('history')) return; if (history.isConnected) this.refresh(); };
    children(history, ...historyNodes);
    for (const id of this.historyRows.keys()) if (!historyIds.has(id)) this.historyRows.delete(id);
    if (snapshot?.played.length || snapshot?.removed.length) toolNodes.push(history);
    toolNodes.push(this.recovery()); children(tools, ...toolNodes); listNodes.push(body, tools); children(list, ...listNodes);
    for (const id of this.rows.keys()) if (!snapshot?.upcoming.some(entry => entry.id === id)) { this.rows.delete(id); this.disclosures.delete(`entry-${id}`); }
    return list;
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
      children(menu, menu.firstElementChild!, next, this.button('Remove', () => library.edit('remove', { entryId: entry.id }, entry.title))); controls.append(menu); row.append(controls);
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
    const v = this.nodes;
    const recovery = this.details('recovery', compact ? 'Recover a saved list' : 'List access');
    const content: Node[] = [recovery.firstElementChild!, v.el('recovery-help', 'p', 'Your songs stay saved. Keep a private recovery key to open your list on another device.', 'muted small')];
    if (snapshot) {
      content.push(v.el('backup-title', 'h3', 'Back up access'), this.control('recovery-create', snapshot.recoveryKeyCreated ? 'Replace recovery key' : 'Create recovery key', () => {
        if (!snapshot.recoveryKeyCreated || confirm('Replace your private recovery key? The previous key will stop working.')) return library.createRecoveryKey();
      }));
    }
    if (library.recoveryKey) {
      const key = v.get('recovery-key', () => { const node = el('textarea'); node.readOnly = true; node.setAttribute('aria-label', 'Your private recovery key'); node.rows = 3; return node; }); prop(key, 'value', library.recoveryKey);
      content.push(key, v.el('recovery-private', 'p', 'Keep this private. It grants access to your list.', 'small muted'), v.get('recovery-copy', () => copyButton('Copy key', key)), this.control('recovery-hide', 'Hide key', () => library.hideRecoveryKey()));
    }
    content.push(v.el('recovery-title', 'h3', 'Use a recovery key'));
    const form = v.el('recovery-form', 'form', undefined, 'list-recovery-form');
    const input = v.get('recovery-input', () => { const node = el('input'); node.type = 'password'; node.autocomplete = 'off'; node.maxLength = 100; node.placeholder = 'Private recovery key'; node.id = 'preparation-recovery-key'; node.setAttribute('aria-label', 'Recover with a private key'); node.oninput = () => { this.recoveryDraft = node.value; }; return node; });
    prop(input, 'value', this.recoveryDraft);
    const recover = v.el('recovery-submit', 'button', 'Recover list', compact ? 'secondary' : ''); prop(recover, 'type', 'submit'); prop(recover, 'disabled', library.loading || library.saving || !navigator.onLine); children(form, input, recover);
    form.onsubmit = event => { event.preventDefault(); if (snapshot && !confirm('Replace this browser’s list access? Save its recovery key first; its saved tracks will not be deleted.')) return; const key = input.value; this.recoveryDraft = ''; void library.recover(key, Boolean(snapshot)); };
    content.push(form);
    if (snapshot) content.push(v.el('devices-title', 'h3', 'Other devices'), this.control('revoke', 'Revoke other devices', () => { if (confirm('End private-list access on your other devices? Their saved songs will be kept.')) return library.revokeOtherDevices(); }));
    children(recovery, ...content);
    return recovery;
  }
  private row(entry: PreparedEntryView) {
    const row = el('li', undefined, 'saved-track'); const identity = el('div', undefined, 'result-identity'); const copy = el('div');
    copy.append(el('strong', entry.title), el('p', [entry.artist, entry.album, entry.version].filter(Boolean).join(' · '), 'muted'), el('span', entry.source === 'upload' ? 'Uploaded file' : entry.provider, 'saved-source'));
    if (entry.sourceAvailable === false) copy.append(el('span', 'Source unavailable · entry kept', 'saved-unavailable'));
    identity.append(artwork(entry.artwork, 'Saved album artwork', 'result-artwork'), copy); row.append(identity); return row;
  }
}
