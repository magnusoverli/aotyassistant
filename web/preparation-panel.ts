import type { CatalogueTrack, View } from '../src/model';
import type { PreparedEntryView } from '../src/preparations';
import { el } from './dom';
import { artwork } from './media';
import { PreparationController } from './preparation-controller';
import { UploadPanel } from './upload-panel';
import { workspaceGrid, slot } from './page-layout';
import { ListBar } from './list-bar';
import { ListDrag } from './list-drag';
import { ViewNodes, children, prop, text, attr } from './view-nodes';

type Options = { getView(): View | undefined; starting(): boolean; changed(): void };
export class PreparationPanel {
  /** Drag-and-drop reordering of the upcoming songs, always available. */
  private drag?: ListDrag;
  /** The order shown while a dropped move is being saved, so the song does not jump back. */
  private moving?: string[];
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
  private collection?: HTMLElement;
  /** Phones: the playlist's one-line summary while browsing below it. */
  readonly bar = new ListBar(() => this.focusList());
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
        controls.find(node => node.dataset.focusKey === key && !node.disabled && !node.hidden)?.focus({ preventScroll: true });
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
    const button = this.button('Add to list', async () => {
      if (this.library.added.has(track.id)) return;
      await this.library.add(track);
      if (this.library.added.has(track.id)) { this.feedback.textContent = `Added ${track.title} to your list.`; this.bar.added(track.title); }
    }, true, `save-${track.id}`);
    button.dataset.preparationTrack = track.id;
    this.updateAddButton(button);
    return button;
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
    // Keep the acknowledgement focusable, so saving does not strand keyboard users on the page body.
    attr(button, 'aria-disabled', added ? 'true' : undefined);
    prop(button, 'disabled', this.library.locked || this.library.loading || !this.library.view || button.dataset.sourceSelectable === 'false');
    button.closest('.track-row')?.classList.toggle('is-prepared', added);
  }
  private renderList() {
    const library = this.library; const snapshot = library.view;
    const v = this.nodes;
    const key = JSON.stringify([snapshot, library.loading, library.saving, library.pending, library.error, library.warning, library.conflict,
      this.moving, [...this.open], this.historyLimit, this.withSearch, this.options.starting(), Boolean(this.options.getView()?.myTurn), navigator.onLine]);
    if (this.list && key === this.listKey) return this.list;
    this.listKey = key;
    const list = this.list ??= slot(el('aside', undefined, 'panel preparation-list'), 'list'); prop(list, 'id', 'music-list'); attr(list, 'aria-labelledby', 'music-list-title');
    this.bar.observe(list);
    list.classList.add('is-expanded'); prop(list, 'tabIndex', -1); attr(list, 'data-my-turn', String(Boolean(this.options.getView()?.myTurn)));
    const heading = v.el('heading', 'div', undefined, 'list-heading');
    const title = v.get('title', () => { const node = el('h2', 'Your playlist'); node.id = 'music-list-title'; return node; });
    const count = snapshot?.upcoming.length;
    const countLabel = v.el('count', 'span', count === undefined ? '' : `${count} ${count === 1 ? 'track' : 'tracks'}`, 'list-count');
    prop(countLabel, 'hidden', count === undefined);
    const summary = v.el('summary', 'div', undefined, 'list-summary');
    const attention = Boolean(library.error || library.warning || library.pending || snapshot?.reviewEntryId || snapshot?.upcoming.some(entry => entry.sourceAvailable === false));
    list.classList.toggle('needs-attention', attention);
    attr(list, 'data-save-state', library.loading ? 'loading' : library.saving ? 'saving' : library.pending ? 'pending' : !navigator.onLine ? 'offline' : 'ready');
    const preview = v.el('preview', 'p', attention ? 'Needs attention' : snapshot?.upcoming[0] ? `Your next pick: ${snapshot.upcoming[0].title}` : 'Save songs for your turn', 'list-preview');
    prop(preview, 'hidden', !attention && !snapshot?.upcoming.length);
    const meta = v.el('meta', 'div', undefined, 'list-meta');
    prop(preview, 'title', preview.textContent ?? ''); children(meta, countLabel, preview); children(summary, title, meta); children(heading, summary);
    this.bar.update(count, snapshot?.upcoming[0]?.title, attention);
    const status = v.el('status', 'p', library.loading ? 'Loading your private list…' : library.saving ? 'Saving…' : library.pending ? 'Save not confirmed. Your change is kept.' : !navigator.onLine ? 'Offline · saved list retained' : snapshot ? 'Private · Saved ✓' : 'Selections unavailable', 'list-save-status'); attr(status, 'role', 'status');
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
    if (!snapshot?.upcoming.length && !library.error && !library.loading) bodyNodes.push(v.el('empty', 'p', 'No songs yet. Search to add one.', 'muted list-empty'));
    const ordered = v.el('ordered', 'ol'); attr(ordered, 'class', `saved-tracks${!snapshot?.upcoming.length ? ' is-empty' : ''}`); attr(ordered, 'aria-label', 'Your prepared tracks');
    const drag = this.drag ??= new ListDrag(ordered, body, {
      enabled: () => !this.library.locked && !this.library.loading && !this.moving && (this.library.view?.upcoming.length ?? 0) > 1,
      commit: (id, ids) => { void this.move(id, ids); },
    });
    const upcoming = this.displayed(snapshot?.upcoming ?? []);
    const upcomingRows = upcoming.map(entry => this.savedRow(entry, upcoming.indexOf(entry)));
    // A song being dragged keeps its place only while the rows stay the same.
    drag.retain(upcomingRows);
    ordered.classList.toggle('is-reorderable', upcoming.length > 1 && !library.locked);
    children(ordered, ...upcomingRows); bodyNodes.push(ordered);
    const tools = v.el('tools', 'div', undefined, 'list-tools'); const toolNodes: Node[] = [];
    const history = v.el('history', 'div', undefined, 'list-history'); prop(history, 'id', 'list-history');
    const historyNodes: Node[] = [];
    let remaining = this.historyLimit; const historyIds = new Set<string>();
    for (const kind of ['played', 'removed'] as const) {
      const entries = snapshot?.[kind] ?? []; if (!entries.length) continue;
      historyNodes.push(v.el(`history-title-${kind}`, 'h3', `${kind === 'played' ? 'Previously played' : 'Removed'} · ${entries.length}`));
      const rows = v.el(`history-${kind}`, 'ul', undefined, 'saved-tracks'); const historyEntries: Node[] = [];
      const visible = entries.slice(0, remaining); remaining -= visible.length;
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
      } children(rows, ...historyEntries); historyNodes.push(rows);
    }
    if ((snapshot?.played.length ?? 0) + (snapshot?.removed.length ?? 0) > this.historyLimit) {
      historyNodes.push(this.control('more-history', 'Show more history', () => { this.historyLimit += 50; this.refresh(); }));
    }
    children(history, ...historyNodes);
    for (const id of this.historyRows.keys()) if (!historyIds.has(id)) this.historyRows.delete(id);
    if (snapshot?.played.length || snapshot?.removed.length) toolNodes.push(history);
    // History scrolls with the list inside its own area, so it never grows the card.
    children(tools, ...toolNodes); if (toolNodes.length) bodyNodes.push(tools);
    children(body, ...bodyNodes); listNodes.push(body); children(list, ...listNodes);
    for (const id of this.rows.keys()) if (!snapshot?.upcoming.some(entry => entry.id === id)) this.rows.delete(id);
    return list;
  }

  /** The saved order, or the dropped order while that move is being saved. */
  private displayed(upcoming: PreparedEntryView[]) {
    const order = this.moving;
    if (!order || order.length !== upcoming.length || upcoming.some(entry => !order.includes(entry.id))) return upcoming;
    return [...upcoming].sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  }

  /** Saves a dropped song's new place: before the song that now follows it. */
  private async move(id: string, ids: string[]) {
    this.moving = ids; this.refresh();
    try { await this.library.edit('move', { entryId: id, beforeId: ids[ids.indexOf(id) + 1] ?? null }); }
    finally { this.moving = undefined; this.refresh(); }
  }

  private savedRow(entry: PreparedEntryView, index: number) {
    const library = this.library; const key = JSON.stringify(entry);
    let cached = this.rows.get(entry.id);
    if (!cached || cached.key !== key) {
      const row = this.row(entry); row.dataset.entryId = entry.id; row.prepend(el('span', '', 'saved-number'));
      row.querySelector('.result-identity > div:last-child')!.prepend(el('span', 'Your next pick', 'saved-next-label'));
      // Reordering is by dragging the row itself; the row's only button removes the song.
      const controls = el('div', undefined, 'saved-actions');
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
    return row;
  }

  private row(entry: PreparedEntryView) {
    const row = el('li', undefined, 'saved-track'); const identity = el('div', undefined, 'result-identity'); const copy = el('div');
    copy.append(el('strong', entry.title), el('p', [entry.artist, entry.album, entry.version].filter(Boolean).join(' · '), 'muted'), el('span', entry.source === 'upload' ? 'Uploaded file' : entry.provider, 'saved-source'));
    if (entry.sourceAvailable === false) copy.append(el('span', 'Source unavailable · entry kept', 'saved-unavailable'));
    identity.append(artwork(entry.artwork, 'Saved album artwork', 'result-artwork'), copy); row.append(identity); return row;
  }
}
