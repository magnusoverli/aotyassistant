import type { FoundSong } from '../src/model';
import type { SharedSong } from '../src/shared-list';
import { el } from './dom';
import { requestJson } from './request';
import type { PreparationController } from './preparation-controller';

type SharedRead = { list: { name: string; year: number | null }; leftOut: { noPick: number; disqualified: number }; unreadable: number; songs: SharedSong[] };
type Missing = { song: SharedSong; failed: boolean };
type Summary = { read: SharedRead; added: number; already: number; missing: Missing[]; notImported: number; stopped?: string };
type Options = { search(query: string): void };

/** Songs are matched a few at a time: small requests, and progress the person can follow. */
const batchSize = 4;
const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;
const message = (error: unknown, fallback: string) => error instanceof Error && error.message ? error.message : fallback;

/** Imports a list shared from SuShe Online: paste its link, and its songs are added to
 * the end of the playlist, last album first. */
export class ListImport {
  readonly dialog = el('dialog', undefined, 'import-dialog');
  private running?: AbortController;
  private link = '';

  constructor(private library: PreparationController, private options: Options) {
    this.dialog.id = 'list-import'; this.dialog.setAttribute('aria-labelledby', 'list-import-title');
    // While importing, Escape stops the import instead of hiding its progress.
    this.dialog.addEventListener('cancel', event => { if (this.running) { event.preventDefault(); this.running.abort(); } });
    this.dialog.addEventListener('click', event => {
      if (event.target !== this.dialog || this.running) return;
      const box = this.dialog.getBoundingClientRect();
      if (event.clientY < box.top || event.clientY > box.bottom || event.clientX < box.left || event.clientX > box.right) this.dialog.close();
    });
  }

  get busy() { return Boolean(this.running); }

  open() {
    if (!this.dialog.isConnected) document.body.append(this.dialog);
    if (!this.running) this.showPaste();
    if (!this.dialog.open) this.dialog.showModal();
  }

  private header(title: string, closable = true) {
    const header = el('div', undefined, 'import-header'); const heading = el('h2', title); heading.id = 'list-import-title';
    header.append(heading);
    if (closable) header.append(this.action('Close', () => this.dialog.close()));
    return header;
  }
  private action(caption: string, work: () => void, primary = false) {
    const button = el('button', caption, primary ? '' : 'secondary'); button.type = 'button'; button.onclick = work; return button;
  }

  private showPaste(error = '') {
    const form = el('form', undefined, 'import-form');
    const label = el('label', 'Link from SuShe Online'); label.htmlFor = 'list-import-link';
    // Plain text, not type=url: a pasted chat message that contains the link must be accepted too.
    const input = el('input'); input.id = 'list-import-link'; input.type = 'text'; input.inputMode = 'url'; input.autocomplete = 'off';
    input.spellcheck = false; input.required = true; input.maxLength = 2000; input.placeholder = 'https://…/lr/…'; input.value = this.link; input.autofocus = true;
    input.oninput = () => { this.link = input.value; };
    const field = el('div', undefined, 'import-field'); field.append(input);
    // Reading the clipboard needs a secure page; elsewhere people paste with the keyboard or a long press.
    if (window.isSecureContext && navigator.clipboard?.readText) field.append(this.action('Paste', () => {
      void navigator.clipboard.readText().then(text => { input.value = this.link = text.trim(); input.focus(); }, () => {
        this.showPaste('Your browser didn’t allow pasting here. Long-press the field, or use the keyboard, to paste.');
      });
    }));
    const alert = el('p', error, 'import-error'); alert.setAttribute('role', 'alert'); alert.hidden = !error;
    const submit = el('button', 'Import'); submit.type = 'submit';
    const actions = el('div', undefined, 'import-actions'); actions.append(submit, this.action('Cancel', () => this.dialog.close()));
    form.append(label, field, alert, actions);
    form.onsubmit = event => { event.preventDefault(); if (input.value.trim()) void this.run(input.value.trim()); };
    this.dialog.replaceChildren(this.header('Import a list'),
      el('p', 'In SuShe Online, open a list’s menu and choose Share to Listening Room. Then paste the link here.'),
      form, el('p', 'Songs are added to the end of your playlist, last album first.', 'muted small'));
    input.focus();
  }

  private progress(title: string, status: string, done?: number, total?: number) {
    const line = el('p', status, 'import-status'); line.setAttribute('role', 'status');
    const bar = el('progress'); bar.setAttribute('aria-label', 'Import progress');
    if (total) { bar.max = total; bar.value = done ?? 0; }
    const stop = this.action('Stop', () => this.running?.abort());
    const actions = el('div', undefined, 'import-actions'); actions.append(stop);
    this.dialog.replaceChildren(this.header(title, false), line, bar, actions);
  }

  private async run(link: string) {
    if (this.running) return;
    if (this.library.locked || !this.library.view) { this.showPaste('Wait until your playlist shows Saved, then import again.'); return; }
    const running = new AbortController(); this.running = running;
    this.progress('Importing a list', 'Reading the list…');
    let read: SharedRead;
    try { read = await requestJson<SharedRead>('/api/participant/import/read', { link }, 20_000, running.signal); }
    catch (error) {
      this.running = undefined;
      this.showPaste(running.signal.aborted ? '' : message(error, 'The list could not be read. Try again.')); return;
    }
    const summary: Summary = { read, added: 0, already: 0, missing: [], notImported: read.songs.length };
    const title = `Importing ${read.list.name}`;
    const report = () => this.progress(title, `Finding and adding songs · ${read.songs.length - summary.notImported} of ${read.songs.length}`, read.songs.length - summary.notImported, read.songs.length);
    report();
    try {
      for (let start = 0; start < read.songs.length && !summary.stopped; start += batchSize) {
        const batch = read.songs.slice(start, start + batchSize);
        const { results } = await requestJson<{ results: FoundSong[] }>('/api/participant/import/match', { songs: batch }, 40_000, running.signal);
        for (const [index, song] of batch.entries()) {
          if (running.signal.aborted) throw new DOMException('Stopped', 'AbortError');
          const track = results[index]?.track;
          if (!track) { summary.missing.push({ song, failed: Boolean(results[index]?.failed) }); summary.notImported--; report(); continue; }
          const view = this.library.view;
          if (!view || this.library.locked) { summary.stopped = 'Your playlist was busy saving another change. Import the list again to add the rest.'; break; }
          if (view.upcoming.length >= view.capacity.upcoming) { summary.stopped = `Your playlist is full (${view.capacity.upcoming} songs).`; break; }
          const before = view.upcoming.length;
          await this.library.add(track);
          if (this.library.pending || this.library.error) { summary.stopped = this.library.error || 'A song could not be saved.'; break; }
          // Adding a song that is already upcoming keeps the existing entry.
          if ((this.library.view?.upcoming.length ?? before) > before) summary.added++; else summary.already++;
          summary.notImported--; report();
        }
      }
    } catch (error) {
      summary.stopped = running.signal.aborted ? 'You stopped the import.' : message(error, 'The import stopped unexpectedly.');
    } finally { this.running = undefined; }
    this.showSummary(summary);
  }

  private showSummary(summary: Summary) {
    const { read } = summary; const nodes: Node[] = [];
    nodes.push(el('p', summary.added ? `Added ${plural(summary.added, 'song')} from ${read.list.name}.` : `No songs were added from ${read.list.name}.`, 'import-result'));
    if (summary.already) nodes.push(el('p', `${plural(summary.already, 'song was', 'songs were')} already in your playlist.`));
    if (summary.stopped) {
      const stopped = el('p', summary.notImported ? `${summary.stopped} ${plural(summary.notImported, 'song was', 'songs were')} not imported.` : summary.stopped, 'import-error');
      stopped.setAttribute('role', 'alert'); nodes.push(stopped);
    }
    const leftOut = [read.leftOut.noPick && plural(read.leftOut.noPick, 'album') + ' without a track pick',
      read.leftOut.disqualified && plural(read.leftOut.disqualified, 'disqualified album')].filter(Boolean);
    if (leftOut.length) nodes.push(el('p', `Left out in SuShe Online: ${leftOut.join(', ')}.`, 'muted'));
    if (read.unreadable) nodes.push(el('p', `${plural(read.unreadable, 'song in the link', 'songs in the link')} couldn’t be read.`, 'muted'));
    if (summary.missing.length) {
      nodes.push(el('h3', `Not found · ${summary.missing.length}`));
      nodes.push(el('p', 'Search for these yourself, or upload a file.', 'muted small'));
      const list = el('ul', undefined, 'import-missing');
      for (const { song, failed } of summary.missing) {
        const item = el('li'); const copy = el('div');
        copy.append(el('strong', song.title), el('p', [song.artist, song.album].filter(Boolean).join(' · '), 'muted'));
        if (failed) copy.append(el('span', 'Couldn’t check · try searching', 'import-failed'));
        const search = this.action('Search', () => { this.dialog.close(); this.options.search(`${song.artist} ${song.title}`); });
        search.setAttribute('aria-label', `Search for ${song.title}`);
        item.append(copy, search); list.append(item);
      }
      nodes.push(list);
    }
    const actions = el('div', undefined, 'import-actions'); const done = this.action('Done', () => this.dialog.close(), true);
    actions.append(done);
    this.dialog.replaceChildren(this.header(summary.stopped ? 'Import stopped' : 'Import finished', false), ...nodes, actions);
    done.focus();
  }
}
