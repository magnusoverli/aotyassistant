import type { CatalogueAlbum, CatalogueTrack, View } from '../src/model';
import type { PreparedEntryView } from '../src/preparations';
import { el } from './dom';
import { artwork } from './media';
import { PreparationController } from './preparation-controller';
import { UploadPanel } from './upload-panel';
import { workspaceGrid, slot } from './page-layout';
import { ListBar } from './list-bar';
import { ListDrag } from './list-drag';
import { ListImport } from './list-import';
import { ClearList } from './clear-list';
import { ReplaceTrack } from './replace-track';
import { ViewNodes, children, prop, text, attr } from './view-nodes';
import { buttonIcon, updateButtonIcon } from './button-icon';

type Options = { getView(): View | undefined; starting(): boolean; changed(): void; search(query: string): void;
  /** Phones: opens the full-screen search from the field at the top of the playlist. */
  openSearch(): void };

/** A magnifying glass drawn in the text colour, for the phone search field. */
export function searchIcon() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 20 20'); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('class', 'search-icon');
  svg.innerHTML = '<circle cx="8.5" cy="8.5" r="5.75" fill="none" stroke="currentColor" stroke-width="1.75"/><path d="m13 13 4.5 4.5" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"/>';
  return svg;
}
export class PreparationPanel {
  /** Drag-and-drop reordering of the upcoming songs, always available. */
  private drag?: ListDrag;
  private open = new Set<string>();
  private feedback = el('span', undefined, 'sr-only');
  private list?: HTMLElement;
  private listKey = '';
  private withSearch = true;
  private historyLimits = { played: 50, removed: 50 };
  private rows = new Map<string, { key: string; element: HTMLElement }>();
  private historyRows = new Map<string, { key: string; element: HTMLElement }>();
  readonly uploads: UploadPanel;
  private workspace?: HTMLElement;
  private uploadDisclosure?: HTMLDetailsElement;
  private nodes = new ViewNodes();
  private disclosures = new Map<string, HTMLDetailsElement>();
  private collection?: HTMLElement;
  private albumAdd?: { button: HTMLButtonElement; album: CatalogueAlbum; tracks: CatalogueTrack[]; online: boolean };
  /** Phones: the playlist's one-line summary while browsing below it. */
  readonly bar = new ListBar(() => this.focusList());
  /** Imports a list shared from SuShe Online, through Music Assistant. */
  private importer: ListImport;
  /** Empties the playlist and its history after a confirmation, to start from scratch. */
  private clearer: ClearList;
  /** Swaps a song in place, from its album or a new upload. */
  private replacer: ReplaceTrack;
  constructor(private library: PreparationController, private options: Options) {
    this.feedback.setAttribute('role', 'status'); this.feedback.setAttribute('aria-live', 'polite');
    this.importer = new ListImport({ search: query => options.search(query), changed: () => this.refresh() });
    this.clearer = new ClearList(library, () => { this.feedback.textContent = 'Your playlist and its history were cleared.'; this.focusList(); });
    this.replacer = new ReplaceTrack(library, (from, to) => { this.feedback.textContent = `Replaced ${from} with ${to}.`; }, () => Boolean(options.getView()?.me));
    this.uploads = new UploadPanel(library, () => Boolean(options.getView()?.me), () => {
      this.uploads.render(Boolean(options.getView()?.me));
      if (this.uploadDisclosure?.isConnected) { if (this.uploads.hasWork) this.uploadDisclosure.open = true; }
      else options.changed();
    }, () => {});
  }
  private button(text: string, action: () => unknown, secondary = true, key = '') {
    const button = el('button', text, secondary ? 'secondary' : ''); button.type = 'button';
    button.disabled = this.library.locked; if (key) button.dataset.focusKey = key;
    button.onclick = () => {
      void Promise.resolve(action()).finally(() => {
        // Saving temporarily disables/remounts this control. Restore keyboard focus
        // afterwards, but never steal it from a player control the listener moved to.
        if (!key || document.activeElement !== document.body) return;
        const controls = [...document.querySelectorAll<HTMLButtonElement>('[data-focus-key]')];
        controls.find(node => node.dataset.focusKey === key && !node.disabled && !node.hidden)?.focus({ preventScroll: true });
      });
    }; return button;
  }
  private control(key: string, caption: string, work: () => unknown, secondary = true) {
    const state = this.nodes.get(`control-${key}`, () => {
      const state = { work, button: undefined as unknown as HTMLButtonElement };
      state.button = this.button(caption, () => state.work(), secondary, key); return state;
    });
    // Paging through history never waits for a save.
    state.work = work; text(state.button, caption); prop(state.button, 'disabled', (this.library.saving && !key.startsWith('more-')) || !navigator.onLine); return state.button;
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
    const button = this.button('Add to list', async () => {
      if (this.library.added.has(track.id)) return;
      await this.library.add(track);
      if (this.library.added.has(track.id)) this.feedback.textContent = `Added ${track.title} to your list.`;
    }, true, `save-${track.id}`);
    button.classList.add('catalogue-action');
    button.dataset.preparationTrack = track.id;
    const short = el('span', 'Add', 'catalogue-action-short'); attr(short, 'aria-hidden', 'true');
    children(button, buttonIcon('add', 'catalogue-action-icon'), el('span', 'Add to list', 'catalogue-action-full'), short);
    this.updateAddButton(button);
    return button;
  }
  /** One persistent action for the album currently shown in the mobile search heading. */
  albumButton(album: CatalogueAlbum, tracks: CatalogueTrack[], online: boolean) {
    if (!this.albumAdd) {
      const button = this.button('', async () => {
        const current = this.albumAdd!;
        const album = current.album; const tracks = [...current.tracks];
        if (!current.online || this.library.locked || !tracks.length || tracks.every(track => this.library.added.has(track.id))) return;
        await this.library.addAlbum(album, tracks);
        if (tracks.every(track => this.library.added.has(track.id))) this.feedback.textContent = `${album.name} is in your playlist.`;
      }, true, 'save-album');
      button.classList.add('catalogue-action', 'album-add');
      children(button, buttonIcon('add', 'catalogue-action-icon'), el('span', 'Add album', 'catalogue-action-short'));
      this.albumAdd = { button, album, tracks, online };
    } else Object.assign(this.albumAdd, { album, tracks, online });
    this.updateAlbumButton(); return this.albumAdd.button;
  }
  private updateAlbumButton() {
    if (!this.albumAdd) return;
    const { button, album, tracks, online } = this.albumAdd;
    const added = tracks.length > 0 && tracks.every(track => this.library.added.has(track.id));
    const saving = !added && this.library.isQueued('add-album', body => body.albumId === album.id);
    const caption = saving ? 'Adding…' : added ? 'Added' : 'Add album';
    text(button.querySelector('.catalogue-action-short')!, caption);
    updateButtonIcon(button.querySelector<SVGSVGElement>('.catalogue-action-icon')!, saving ? 'progress' : added ? 'check' : 'add');
    attr(button, 'aria-label', saving ? `Adding ${album.name} to your playlist` : added ? `Added ${album.name} to your playlist` : `Add album ${album.name} to your playlist`);
    attr(button, 'aria-busy', saving ? 'true' : undefined); attr(button, 'aria-disabled', added ? 'true' : undefined);
    prop(button, 'disabled', !online || !tracks.length || this.library.locked || this.library.loading || !this.library.view);
  }
  render(search?: HTMLElement, player?: HTMLElement) {
    this.replacer.refresh();
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
    const list = slot(this.renderList(), 'list');
    if (search) {
      const collection = this.collection ??= el('div', undefined, 'music-collection');
      collection.id = 'music-collection'; collection.dataset.composition = 'music';
      children(collection, list, search);
      children(panel, player, this.feedback, collection);
    } else children(panel, player, this.feedback, list, uploads);
    return panel;
  }
  /** Navigate to the list without changing the browse context. */
  focusList() {
    this.list?.focus({ preventScroll: true });
    this.list?.scrollIntoView({ block: 'start', behavior: 'instant' });
  }

  /** List changes never replace the search form, result rows, or private player. */
  refresh() {
    const focused = document.activeElement instanceof HTMLElement && document.activeElement.closest('.music-workspace') ? document.activeElement : undefined;
    const key = focused?.dataset.focusKey; const id = focused?.id;
    const top = scrollY;
    // The list body is one persistent node, so it keeps its own scroll position. Every DOM write comes
    // before the one layout read below (scrollY): reading between writes would lay out the page each time.
    this.renderList();
    this.uploads.render();
    this.replacer.refresh();
    for (const button of document.querySelectorAll<HTMLButtonElement>('[data-preparation-track]')) {
      this.updateAddButton(button);
    }
    if (this.albumAdd?.button.isConnected) this.updateAlbumButton();
    const replacement = id ? document.getElementById(id) : key ? [...this.list?.querySelectorAll<HTMLElement>('[data-focus-key]') ?? []].find(node => node.dataset.focusKey === key) : undefined;
    if (focused && replacement && document.activeElement === document.body) replacement.focus({ preventScroll: true });
    if (scrollY !== top) window.scrollTo({ top, behavior: 'instant' });
  }
  stopUploads() { this.uploads.stop(); this.replacer.stop(); this.importer.dispose(); }
  updateAddButton(button: HTMLButtonElement) {
    const trackId = button.dataset.preparationTrack!;
    const added = this.library.added.has(trackId);
    const saving = !added && this.library.isQueued('add', body => body.trackId === trackId);
    // Only the queued songs say Saving. Keep both captions and the SVG mounted across state changes.
    text(button.querySelector('.catalogue-action-full')!, added ? 'Added ✓' : 'Add to list');
    text(button.querySelector('.catalogue-action-short')!, added ? 'Added' : saving ? 'Saving' : 'Add');
    updateButtonIcon(button.querySelector<SVGSVGElement>('.catalogue-action-icon')!, added ? 'check' : saving ? 'progress' : 'add');
    attr(button, 'aria-label', added ? 'Added ✓' : saving ? 'Saving to list' : 'Add to list');
    attr(button, 'aria-busy', saving ? 'true' : undefined);
    // Keep the acknowledgement focusable, so saving does not strand keyboard users on the page body.
    attr(button, 'aria-disabled', added ? 'true' : undefined);
    prop(button, 'disabled', this.library.locked || this.library.loading || !this.library.view || button.dataset.sourceSelectable === 'false');
    button.closest('.track-row')?.classList.toggle('is-prepared', added);
  }
  private renderList() {
    const library = this.library; const snapshot = library.view;
    const v = this.nodes;
    const canImport = Boolean(this.options.getView()?.catalogue?.configured);
    const key = JSON.stringify([snapshot, library.loading, library.saving, library.stalled, library.queued.length, library.pending?.title, library.error, library.warning, library.conflict,
      [...this.open], this.historyLimits.played, this.historyLimits.removed, this.withSearch, this.options.starting(), Boolean(this.options.getView()?.myTurn), navigator.onLine, canImport, this.importer.busy]);
    if (this.list && key === this.listKey) return this.list;
    this.listKey = key;
    const list = this.list ??= slot(el('aside', undefined, 'panel preparation-list'), 'list'); prop(list, 'id', 'music-list'); attr(list, 'aria-label', 'Your playlist');
    this.bar.observe(list);
    list.classList.add('is-expanded'); prop(list, 'tabIndex', -1); attr(list, 'data-my-turn', String(Boolean(this.options.getView()?.myTurn)));
    const heading = v.el('heading', 'div', undefined, 'list-heading');
    // Phones show the shorter "Playlist" (music-collection.css); the region keeps its full name everywhere.
    const title = v.get('title', () => {
      const node = el('h2'); node.id = 'music-list-title';
      node.append(el('span', 'Your playlist', 'list-title-full'), el('span', 'Playlist', 'list-title-short')); return node;
    });
    const count = snapshot?.upcoming.length;
    const countLabel = v.el('count', 'span', count === undefined ? '' : `${count} ${count === 1 ? 'track' : 'tracks'}`, 'list-count');
    prop(countLabel, 'hidden', count === undefined);
    const summary = v.el('summary', 'div', undefined, 'list-summary');
    // Every edit stays queued in this browser until the server confirms it. While the queue is being saved
    // that is normal (the list shows "Saving…"); only a change nothing is saving (a failed or interrupted
    // save) needs attention.
    const unconfirmed = Boolean(library.pending && !library.saving);
    const attention = Boolean(library.error || library.warning || unconfirmed || (snapshot?.reviewEntryId && !snapshot.starting) || snapshot?.upcoming.some(entry => entry.sourceAvailable === false));
    list.classList.toggle('needs-attention', attention);
    attr(list, 'data-save-state', library.loading ? 'loading' : library.saving ? 'saving' : library.pending ? 'pending' : !navigator.onLine ? 'offline' : 'ready');
    const preview = v.el('preview', 'p', attention ? 'Needs attention' : snapshot?.upcoming[0] ? `Your next pick: ${snapshot.upcoming[0].title}` : 'Save songs for your turn', 'list-preview');
    prop(preview, 'hidden', !attention && !snapshot?.upcoming.length);
    const meta = v.el('meta', 'div', undefined, 'list-meta');
    prop(preview, 'title', preview.textContent ?? ''); children(meta, countLabel, preview); children(summary, title, meta);
    const importButton = v.get('import', () => {
      const node = el('button', 'Import', 'secondary list-import-open'); node.type = 'button'; node.title = 'Import a list from SuShe Online';
      node.setAttribute('aria-label', 'Import a list'); node.setAttribute('aria-haspopup', 'dialog'); node.setAttribute('aria-controls', 'list-import');
      node.onclick = () => this.importer.open(); return node;
    });
    // During an import the button reopens its progress.
    prop(importButton, 'disabled', !this.importer.busy && (!snapshot || library.loading || !navigator.onLine));
    const clearButton = v.get('clear', () => {
      const node = el('button', 'Clear list', 'secondary list-clear-open'); node.type = 'button'; node.title = 'Empty your playlist and its history';
      node.setAttribute('aria-haspopup', 'dialog'); node.setAttribute('aria-controls', 'clear-list');
      node.onclick = () => this.clearer.open(); return node;
    });
    prop(clearButton, 'disabled', library.locked || library.loading || !navigator.onLine || this.importer.busy);
    // Only offered when there is something to clear.
    const clearable = Boolean(snapshot && (snapshot.upcoming.length || snapshot.played.length || snapshot.removed.length));
    const actions = v.el('heading-actions', 'div', undefined, 'list-heading-actions');
    children(actions, canImport && importButton, clearable && clearButton);
    children(heading, summary, (canImport || clearable) && actions);
    this.bar.update(count, snapshot?.upcoming[0]?.title, attention);
    const status = v.el('status', 'p', library.loading ? 'Loading your private list…' : library.saving ? 'Saving…' : library.pending ? 'Save not confirmed. Your change is kept.' : !navigator.onLine ? 'Offline · saved list retained' : snapshot ? 'Private · Saved ✓' : 'Selections unavailable', 'list-save-status'); attr(status, 'role', 'status');
    const body = v.get('body', () => { const node = el('div', undefined, 'list-body'); node.id = 'music-list-body'; node.dataset.scrollKey = 'private-list'; return node; });
    // Phones only (music-collection.css): looks like a search field and opens the search sheet.
    const find = v.get('find', () => {
      const node = el('button', undefined, 'list-search-open'); node.type = 'button'; node.id = 'music-search-open';
      node.setAttribute('aria-controls', 'music-find'); node.onclick = () => this.options.openSearch();
      node.append(searchIcon(), el('span')); return node;
    });
    text(find.lastElementChild!, 'Search for an artist');
    const bodyNodes: Node[] = []; const listNodes: Node[] = this.withSearch ? [heading, find, status] : [heading, status];
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
    // Started from another device or by automatic play: wait for it rather than review it.
    if (snapshot?.reviewEntryId && snapshot.starting && !this.options.starting()) {
      const starting = v.el('starting', 'p', 'Your first song is starting…', 'muted small list-note'); attr(starting, 'role', 'status'); bodyNodes.push(starting);
    } else if (snapshot?.reviewEntryId && !this.options.starting()) {
      const review = v.el('review', 'div', undefined, 'list-notice'); children(review, v.el('review-message', 'p', 'A previous play attempt needs review. The track is still saved; check the player before trying again.'),
        this.control('review', 'Keep in list', () => library.edit('review', { entryId: library.view?.reviewEntryId }))); bodyNodes.push(review);
    }
    if (!snapshot?.upcoming.length && !library.error && !library.loading) bodyNodes.push(v.el('empty', 'p', canImport ? 'No songs yet. Search for an artist to add one, or import a list.' : 'No songs yet.', 'muted list-empty'));
    const ordered = v.el('ordered', 'ol'); attr(ordered, 'class', `saved-tracks${!snapshot?.upcoming.length ? ' is-empty' : ''}`); attr(ordered, 'aria-label', 'Your prepared tracks');
    const drag = this.drag ??= new ListDrag(ordered, body, {
      enabled: () => !this.library.locked && !this.library.loading && (this.library.view?.upcoming.length ?? 0) > 1,
      commit: (id, ids) => this.move(id, ids),
    });
    const upcoming = snapshot?.upcoming ?? [];
    const upcomingRows = upcoming.map(entry => this.savedRow(entry, upcoming.indexOf(entry), canImport));
    // A song being dragged keeps its place only while the rows stay the same.
    drag.retain(upcomingRows);
    ordered.classList.toggle('is-reorderable', upcoming.length > 1 && !library.locked);
    children(ordered, ...upcomingRows); bodyNodes.push(ordered);
    const tools = v.el('tools', 'div', undefined, 'list-tools'); const toolNodes: Node[] = [];
    const history = v.el('history', 'div', undefined, 'list-history'); prop(history, 'id', 'list-history');
    const historyNodes: Node[] = []; const historyIds = new Set<string>();
    // Both categories are always listed, collapsed until opened (their open state survives re-renders).
    for (const kind of ['played', 'removed'] as const) {
      const entries = snapshot?.[kind] ?? [];
      const section = this.details(`history-${kind}`, `${kind === 'played' ? 'Previously played' : 'Removed'} · ${entries.length}`);
      section.classList.add('list-history-section'); historyNodes.push(section);
      const sectionNodes: Node[] = [section.querySelector('summary')!];
      if (!entries.length) {
        sectionNodes.push(v.el(`history-empty-${kind}`, 'p', kind === 'played' ? 'No songs played yet.' : 'No removed songs.', 'muted small list-history-empty'));
        children(section, ...sectionNodes); continue;
      }
      const rows = v.el(`history-${kind}`, 'ul', undefined, 'saved-tracks'); const historyEntries: Node[] = [];
      const visible = entries.slice(0, this.historyLimits[kind]);
      for (const entry of visible) {
        historyIds.add(entry.id); const key = JSON.stringify([kind, entry]);
        let cached = this.historyRows.get(entry.id);
        if (!cached || cached.key !== key) {
          // Same columns as upcoming rows: an empty number cell, the song, then its actions.
          const row = this.row(entry); const marker = el('span', '', 'saved-number'); marker.setAttribute('aria-hidden', 'true'); row.prepend(marker);
          const controls = el('div', undefined, 'saved-actions');
          controls.append(this.button('Add back', () => library.edit('restore', { entryId: entry.id }), true, `restore-${entry.id}`));
          if (kind === 'removed' && entry.source === 'upload') controls.append(this.button('Delete file permanently', () => {
            if (confirm('Permanently delete this uploaded file and all its entries from your list and history? This cannot be undone. Stop or finish it first.')) return library.edit('purge-upload', { entryId: entry.id }, entry.title);
          }, true, `purge-${entry.id}`));
          row.append(controls);
          cached = { key, element: row }; this.historyRows.set(entry.id, cached);
        }
        for (const control of cached.element.querySelectorAll('button')) prop(control, 'disabled', library.locked);
        historyEntries.push(cached.element);
      } children(rows, ...historyEntries); sectionNodes.push(rows);
      // Each category pages on its own, so one never looks empty while the other is cut off.
      if (entries.length > visible.length) sectionNodes.push(this.control(`more-${kind}`, kind === 'played' ? 'Show more played songs' : 'Show more removed songs',
        () => { this.historyLimits[kind] += 50; this.refresh(); }));
      children(section, ...sectionNodes);
    }
    children(history, ...historyNodes);
    for (const id of this.historyRows.keys()) if (!historyIds.has(id)) this.historyRows.delete(id);
    if (snapshot) toolNodes.push(history);
    // History scrolls with the list inside its own area, so it never grows the card.
    children(tools, ...toolNodes); if (toolNodes.length) bodyNodes.push(tools);
    children(body, ...bodyNodes); listNodes.push(body); children(list, ...listNodes);
    for (const id of this.rows.keys()) if (!snapshot?.upcoming.some(entry => entry.id === id)) this.rows.delete(id);
    return list;
  }

  /** Queues a dropped song's new place: before the song that now follows it. The list shows it at once. */
  private move(id: string, ids: string[]) {
    void this.library.edit('move', { entryId: id, beforeId: ids[ids.indexOf(id) + 1] ?? null });
  }

  private savedRow(entry: PreparedEntryView, index: number, catalogue: boolean) {
    const library = this.library; const key = JSON.stringify(entry);
    let cached = this.rows.get(entry.id);
    if (!cached || cached.key !== key) {
      const row = this.row(entry); row.dataset.entryId = entry.id; row.prepend(el('span', '', 'saved-number'));
      row.querySelector('.result-identity > div:last-child')!.prepend(el('span', 'Your next pick', 'saved-next-label'));
      // Reordering is by dragging the row itself; the row's buttons replace or remove the song.
      const controls = el('div', undefined, 'saved-actions');
      if (entry.source === 'music-assistant' || entry.source === 'upload') {
        const replace = this.button('⇄', () => this.replacer.open(entry), true, `replace-${entry.id}`);
        replace.classList.add('saved-replace'); replace.setAttribute('aria-label', `Replace ${entry.title}`); replace.setAttribute('aria-haspopup', 'dialog');
        replace.title = entry.source === 'upload' ? 'Replace with a new audio file' : 'Replace with another song from the album'; controls.append(replace);
      }
      const remove = this.button('✕', () => library.edit('remove', { entryId: entry.id }, entry.title), true, `remove-${entry.id}`);
      remove.classList.add('saved-remove'); remove.setAttribute('aria-label', `Remove ${entry.title}`); remove.title = 'Remove from playlist';
      controls.append(remove); row.append(controls);
      cached = { key, element: row }; this.rows.set(entry.id, cached);
    }
    const row = cached.element;
    row.classList.toggle('is-unavailable', entry.sourceAvailable === false);
    row.classList.toggle('is-next', index === 0);
    const number = row.querySelector('.saved-number')!; const text = String(index + 1).padStart(2, '0'); if (number.textContent !== text) number.textContent = text;
    const label = row.querySelector<HTMLElement>('.saved-next-label')!; if (label.hidden !== (index !== 0)) label.hidden = index !== 0;
    const disabled = library.locked;
    for (const button of row.querySelectorAll('button')) if (button.disabled !== disabled) button.disabled = disabled;
    // A new upload can replace even an unavailable file; album browsing needs its source.
    const replace = row.querySelector<HTMLButtonElement>('.saved-replace');
    if (replace) replace.hidden = entry.source !== 'upload' && (!catalogue || entry.sourceAvailable === false);
    return row;
  }

  private row(entry: PreparedEntryView) {
    const row = el('li', undefined, 'saved-track'); const identity = el('div', undefined, 'result-identity'); const copy = el('div');
    copy.append(el('strong', entry.title), el('p', [entry.artist, entry.album, entry.version].filter(Boolean).join(' · '), 'muted'), el('span', entry.source === 'upload' ? 'Uploaded file' : entry.provider, 'saved-source'));
    if (entry.sourceAvailable === false) copy.append(el('span', 'Source unavailable · entry kept', 'saved-unavailable'));
    identity.append(artwork(entry.artwork, 'Saved album artwork', 'result-artwork'), copy); row.append(identity); return row;
  }
}
