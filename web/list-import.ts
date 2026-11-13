import type { ImportView } from '../src/list-import-jobs';
import { el } from './dom';
import { requestJson, RequestError } from './request';

type Options = { search(query: string): void; changed(): void };

const path = '/api/participant/preparations/import';
const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;
const message = (error: unknown, fallback: string) => error instanceof Error && error.message ? error.message : fallback;

/** Imports a list shared from SuShe Online. The server does the work, so a sleeping phone or a reload
 * never interrupts it; this window starts it and follows its progress. */
export class ListImport {
  readonly dialog = el('dialog', undefined, 'list-dialog');
  private job?: ImportView;
  private starting = false;
  private follower?: ReturnType<typeof setTimeout>;
  /** A finished import's summary is shown once, then the form returns. */
  private summarized = false;
  private link = '';
  private lifecycle = new AbortController();

  constructor(private options: Options) {
    this.dialog.id = 'list-import'; this.dialog.setAttribute('aria-labelledby', 'list-import-title');
    // Closing never stops an import: it continues on the server, and Import shows it again.
    this.dialog.addEventListener('click', event => {
      if (event.target !== this.dialog) return;
      const box = this.dialog.getBoundingClientRect();
      if (event.clientY < box.top || event.clientY > box.bottom || event.clientX < box.left || event.clientX > box.right) this.dialog.close();
    });
  }

  get busy() { return this.starting || Boolean(this.job && !this.job.finished); }

  async open() {
    if (this.lifecycle.signal.aborted) this.lifecycle = new AbortController();
    const { signal } = this.lifecycle;
    if (!this.dialog.isConnected) document.body.append(this.dialog);
    this.render();
    if (!this.dialog.open) this.dialog.showModal();
    // An import may be running already, for example after a reload or on another device.
    if (!this.busy) {
      try {
        const { import: job } = await requestJson<{ import: ImportView | null }>(path, undefined, 15_000, signal);
        if (signal.aborted) return;
        if (job && !job.finished) { this.job = job; this.summarized = false; this.render(); this.follow(); }
      } catch { /* The form still works; starting reports any problem. */ }
    }
  }

  /** Stop following this page's import; the server job remains recoverable on the next open. */
  dispose() {
    this.lifecycle.abort(); clearTimeout(this.follower); this.follower = undefined;
    this.starting = false; this.job = undefined;
    this.dialog.close(); this.dialog.remove();
  }

  private render() {
    if (this.starting) this.progress('Importing a list', 'Reading the list…');
    else if (this.job && !this.job.finished) this.showProgress(this.job);
    else if (this.job && !this.summarized) this.showSummary(this.job);
    else this.showPaste();
  }

  private header(title: string, closable = true) {
    const header = el('div', undefined, 'list-dialog-header'); const heading = el('h2', title); heading.id = 'list-import-title';
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
    const alert = el('p', error, 'list-dialog-error'); alert.setAttribute('role', 'alert'); alert.hidden = !error;
    const submit = el('button', 'Import'); submit.type = 'submit';
    const actions = el('div', undefined, 'list-dialog-actions'); actions.append(submit, this.action('Cancel', () => this.dialog.close()));
    form.append(label, field, alert, actions);
    form.onsubmit = event => { event.preventDefault(); if (input.value.trim()) void this.start(input.value.trim()); };
    this.dialog.replaceChildren(this.header('Import a list'),
      el('p', 'In SuShe Online, open a list’s menu and choose Share to Listening Room. Then paste the link here.'),
      form, el('p', 'Songs are added to the end of your playlist, last album first.', 'muted small'));
    input.focus();
  }

  private progress(title: string, status: string, done?: number, total?: number, note = '') {
    const line = el('p', status, 'import-status'); line.setAttribute('role', 'status');
    const bar = el('progress'); bar.setAttribute('aria-label', 'Import progress');
    if (total) { bar.max = total; bar.value = done ?? 0; }
    const actions = el('div', undefined, 'list-dialog-actions'); actions.append(this.action('Stop', () => void this.stop()));
    const nodes: Node[] = [this.header(title), line, bar];
    if (note) nodes.push(el('p', note, 'muted small'));
    this.dialog.replaceChildren(...nodes, actions);
  }
  private showProgress(job: ImportView) {
    this.progress(`Importing ${job.list.name}`, `Finding songs · ${job.checked} of ${job.total} · ${plural(job.added, 'song')} added`, job.checked, job.total,
      'You can close this window; the import continues.');
  }

  private async start(link: string) {
    const { signal } = this.lifecycle;
    if (this.busy || signal.aborted) return;
    this.starting = true; this.render();
    try {
      // Reading the link can take a while: another server answers it.
      const { import: job } = await requestJson<{ import: ImportView }>(path, { link }, 30_000);
      if (signal.aborted) return;
      this.job = job; this.summarized = false;
    } catch (error) {
      if (signal.aborted) return;
      this.starting = false;
      // A running import (from another device) is followed instead of reported as an error.
      if (error instanceof RequestError && error.status === 409) { await this.open(); if (signal.aborted || this.busy) return; }
      this.showPaste(message(error, 'The list could not be read. Try again.')); return;
    }
    this.starting = false; this.render(); this.options.changed(); this.follow();
  }

  /** Checks progress about once a second until the import finishes, also while this window is closed. */
  private follow() {
    clearTimeout(this.follower);
    const { signal } = this.lifecycle;
    if (signal.aborted) return;
    this.follower = setTimeout(async () => {
      try {
        const { import: job } = await requestJson<{ import: ImportView | null }>(path, undefined, 15_000, signal);
        if (signal.aborted) return;
        this.job = job ?? undefined;
      } catch (error) {
        if (signal.aborted) return;
        // Signed out or the list is unavailable: stop following; other errors are retried.
        if (error instanceof RequestError && [401, 403].includes(error.status)) { this.job = undefined; this.render(); this.options.changed(); return; }
      }
      if (this.dialog.open) this.render();
      // Finished while the window was closed: its summary shows the next time it opens.
      if (this.busy) this.follow(); else this.options.changed();
    }, 1000);
  }

  private async stop() {
    const { signal } = this.lifecycle;
    if (signal.aborted) return;
    try { const { import: job } = await requestJson<{ import: ImportView | null }>(`${path}/stop`, {}); if (!signal.aborted && job) this.job = job; }
    catch { /* Following the import shows whether it stopped. */ }
    if (signal.aborted) return;
    if (this.dialog.open) this.render();
  }

  private showSummary(job: ImportView) {
    this.summarized = true;
    const nodes: Node[] = [];
    nodes.push(el('p', job.added ? `Added ${plural(job.added, 'song')} from ${job.list.name}.` : `No songs were added from ${job.list.name}.`, 'import-result'));
    if (job.already) nodes.push(el('p', `${plural(job.already, 'song was', 'songs were')} already in your playlist.`));
    const notImported = job.total - job.added - job.already - job.missing.length;
    if (job.stopped) {
      const stopped = el('p', notImported > 0 ? `${job.stopped} ${plural(notImported, 'song was', 'songs were')} not imported.` : job.stopped, 'list-dialog-error');
      stopped.setAttribute('role', 'alert'); nodes.push(stopped);
    }
    const leftOut = [job.leftOut.noPick && plural(job.leftOut.noPick, 'album') + ' without a track pick',
      job.leftOut.disqualified && plural(job.leftOut.disqualified, 'disqualified album')].filter(Boolean);
    if (leftOut.length) nodes.push(el('p', `Left out in SuShe Online: ${leftOut.join(', ')}.`, 'muted'));
    if (job.unreadable) nodes.push(el('p', `${plural(job.unreadable, 'song in the link', 'songs in the link')} couldn’t be read.`, 'muted'));
    if (job.missing.length) {
      nodes.push(el('h3', `Not found · ${job.missing.length}`));
      nodes.push(el('p', 'Find their artist to choose them yourself, or upload a file.', 'muted small'));
      const list = el('ul', undefined, 'import-missing');
      for (const song of job.missing) {
        const item = el('li'); const copy = el('div');
        copy.append(el('strong', song.title), el('p', [song.artist, song.album].filter(Boolean).join(' · '), 'muted'));
        if (song.failed) copy.append(el('span', 'Couldn’t check · try searching', 'import-failed'));
        // Searches find artists: open this song's artist, then its album and the song.
        const search = this.action('Find artist', () => { this.dialog.close(); this.options.search(song.artist); });
        search.setAttribute('aria-label', `Find ${song.artist} to choose ${song.title}`);
        item.append(copy, search); list.append(item);
      }
      nodes.push(list);
    }
    const actions = el('div', undefined, 'list-dialog-actions'); const done = this.action('Done', () => this.dialog.close(), true);
    actions.append(done);
    this.dialog.replaceChildren(this.header(job.stopped ? 'Import stopped' : 'Import finished', false), ...nodes, actions);
    // Keep the result at the top in view; a long Not found list continues below.
    done.focus({ preventScroll: true }); this.dialog.scrollTop = 0;
  }
}
