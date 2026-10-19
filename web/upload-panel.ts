import type { UploadPreview } from '../src/uploads';
import { el } from './dom';
import { fieldControl } from './ui-components';
import { ArtworkView } from './media';
import { ViewNodes, children, prop, text } from './view-nodes';
import { operationId, preparationRequest, type PreparationController } from './preparation-controller';

const prefix = '/api/participant/preparations';
type Text = { title: string; artist: string; album: string };
/** Upload has its own request/progress lane; never queues or retries audio commands. */
export class UploadPanel {
  private element = el('div', undefined, 'upload-panel');
  private input = el('input');
  private preview?: UploadPreview;
  private text: Text = { title: '', artist: '', album: '' };
  private ownerId?: string;
  private uploadId?: string;
  private selection?: { ownerId?: string };
  private get busy() { return Boolean(this.selection); }
  private recovering = false;
  private discarding = false;
  private progress = 0;
  private error = '';
  private notice = '';
  private xhr?: XMLHttpRequest;
  private epoch = 0;
  private nodes = new ViewNodes();
  constructor(private library: PreparationController, private member: () => boolean, private changed: () => void, private added: () => void) {
    this.input.type = 'file'; this.input.id = 'track-upload-file'; this.input.hidden = true;
    this.input.accept = '.mp3,.m4a,.flac,.wav,.aif,.aiff,.ogg,.oga,.opus,audio/mpeg,audio/mp4,audio/flac,audio/wav,audio/aiff,audio/ogg,audio/opus';
    this.input.onchange = () => { const file = this.input.files?.[0]; this.input.value = ''; if (file) void this.choose(file); };
  }
  private key(ownerId: string) { return `aoty.upload-draft.v1.${ownerId}`; }
  private persist() {
    if (!this.ownerId) return;
    try {
      if (this.uploadId) localStorage.setItem(this.key(this.ownerId), JSON.stringify({ id: this.uploadId, text: this.text }));
      else localStorage.removeItem(this.key(this.ownerId));
    } catch { this.error = 'This browser cannot retain the upload draft after a reload. Wait until the track is saved to your list.'; }
  }
  private syncOwner() {
    const ownerId = this.library.view?.ownerId;
    if (ownerId === this.ownerId) return;
    this.epoch++; this.xhr?.abort(); this.xhr = undefined; this.ownerId = ownerId; this.uploadId = undefined; this.preview = undefined;
    // The first owner may be created by this selection. An already-bound selection
    // cannot follow recovery or revocation into a different private list.
    if (this.selection?.ownerId) this.selection = undefined;
    this.recovering = false; this.discarding = false; this.error = ''; this.notice = ''; this.text = { title: '', artist: '', album: '' };
    if (!ownerId) return;
    try {
      const raw = localStorage.getItem(this.key(ownerId));
      if (!raw || raw.length > 16_000) return;
      const draft = JSON.parse(raw);
      if (!/^[a-f0-9-]{36}$/.test(draft.id)) return;
      this.uploadId = draft.id;
      if (draft.text && ['title', 'artist', 'album'].every(key => typeof draft.text[key] === 'string' && draft.text[key].length <= 1000)) this.text = draft.text;
      const epoch = this.epoch;
      queueMicrotask(() => { if (this.epoch === epoch) void this.recover(); });
    } catch { /* The server list remains authoritative. */ }
  }
  private async recover() {
    if (!this.uploadId || this.recovering || this.discarding || this.busy || !navigator.onLine) return;
    const epoch = this.epoch; const id = this.uploadId; this.recovering = true; this.changed();
    try {
      const preview = await preparationRequest<UploadPreview>(`/uploads/${id}`);
      if (epoch !== this.epoch || id !== this.uploadId) return;
      this.preview = preview; if (!this.text.title) this.text = { title: preview.title, artist: preview.artist, album: preview.album };
      this.error = ''; this.persist();
    } catch { if (epoch === this.epoch) this.error = 'The upload is unfinished or unavailable. Check again, or select the file again. Tracks already saved in your list are kept.'; }
    finally { if (epoch === this.epoch) { this.recovering = false; this.changed(); } }
  }
  private async choose(file: File) {
    this.syncOwner();
    if (this.busy || this.recovering || this.discarding || this.library.loading || this.library.saving || this.library.pending || !this.member() || !navigator.onLine) return;
    if (this.uploadId && (this.preview || this.text.title) && !confirm('Replace this uploaded song and its reviewed details? Your saved list will be kept.')) return;
    const selection = { ownerId: this.ownerId }; this.selection = selection; this.epoch++;
    this.progress = 0; this.error = ''; this.notice = ''; this.changed();
    try {
      await this.library.ensureOwner(); this.syncOwner();
      if (this.selection !== selection || !this.ownerId) return;
      selection.ownerId = this.ownerId;
      if (this.uploadId) await this.discard();
      if (this.selection !== selection || this.uploadId || this.ownerId !== this.library.view?.ownerId || this.library.saving || this.library.pending || !this.member() || !navigator.onLine) return;
      const uploadId = operationId();
      this.uploadId = uploadId; this.preview = undefined; this.text = { title: '', artist: '', album: '' }; this.persist(); this.changed();
      const preview = await new Promise<UploadPreview>((resolve, reject) => {
        const xhr = new XMLHttpRequest(); this.xhr = xhr;
        xhr.open('POST', `${prefix}/uploads/${uploadId}`); xhr.responseType = 'json';
        xhr.setRequestHeader('Content-Type', 'application/octet-stream'); xhr.setRequestHeader('X-Upload-Filename', encodeURIComponent(file.name));
        xhr.upload.onprogress = event => {
          if (this.selection !== selection) return;
          const progress = event.lengthComputable ? Math.round(event.loaded / event.total * 100) : 0;
          if (progress !== this.progress) { this.progress = progress; this.changed(); }
        };
        xhr.onload = () => xhr.status === 200 ? resolve(xhr.response) : reject(new Error(xhr.response?.error ?? 'The file upload could not be confirmed.'));
        xhr.onerror = () => reject(new Error('Upload connection lost. Check for a completed upload before selecting the file again.'));
        xhr.onabort = () => reject(new Error('Upload interrupted. Check for a completed upload or select the file again.'));
        xhr.send(file);
      });
      if (this.selection !== selection) return;
      this.preview = preview; this.text = { title: preview.title, artist: preview.artist, album: preview.album }; this.persist();
    } catch (error) { if (this.selection === selection) this.error = error instanceof Error ? error.message : 'The file was not uploaded.'; }
    finally { if (this.selection === selection) { this.xhr = undefined; this.selection = undefined; this.changed(); } }
  }
  private async discard() {
    if (!this.uploadId || this.recovering || this.discarding || this.library.saving || this.library.pending || !navigator.onLine) return;
    const epoch = this.epoch; const id = this.uploadId; this.discarding = true; this.changed();
    try {
      await preparationRequest(`/uploads/${id}/discard`, {});
      if (epoch !== this.epoch || id !== this.uploadId) return;
      this.uploadId = undefined; this.preview = undefined; this.error = ''; this.persist();
    } catch (error) { if (epoch === this.epoch) this.error = error instanceof Error ? error.message : 'The draft could not be discarded.'; }
    finally { if (epoch === this.epoch) { this.discarding = false; this.changed(); } }
  }
  private button(label: string, action: () => void | Promise<void>, disabled = false) {
    const button = el('button', label, 'secondary'); button.type = 'button'; button.disabled = disabled;
    button.onclick = () => { void action(); }; return button;
  }
  stop(cancelled = false) {
    this.epoch++;
    if (this.selection) {
      this.error = cancelled ? '' : 'Upload interrupted. Check for a completed upload or select the file again.';
      if (cancelled) this.notice = 'Upload cancelled.';
    }
    this.selection = undefined; this.xhr?.abort(); this.xhr = undefined;
    this.recovering = false; this.discarding = false; this.changed();
  }
  get pending() { return Boolean(this.uploadId); }
  get hasWork() { return Boolean(this.uploadId || this.selection || this.error); }
  render(allowSelection = true) {
    this.syncOwner();
    if (this.uploadId && this.library.lastSavedUploadId === this.uploadId) {
      this.uploadId = undefined; this.preview = undefined; this.persist(); this.notice = 'Added to your list.';
    }
    const disabled = !this.member() || !navigator.onLine || this.busy || this.recovering || this.discarding || this.library.loading || this.library.saving || Boolean(this.library.pending);
    const v = this.nodes;
    const button = (key: string, caption: string, action: () => void | Promise<void>, disabled = false) => {
      const control = v.get(key, () => this.button(caption, action));
      text(control, caption); prop(control, 'disabled', disabled); control.onclick = () => { void action(); }; return control;
    };
    const nodes: Node[] = [this.input];
    if (this.busy) {
      const message = v.el('progress-message', 'p', this.progress >= 100 ? 'Processing audio and artwork…' : `Uploading… ${this.progress}%`, 'muted small');
      const progress = v.get('progress', () => { const node = el('progress'); node.max = 100; node.setAttribute('aria-label', 'File upload progress'); message.setAttribute('role', 'status'); return node; });
      prop(progress, 'value', this.progress);
      nodes.push(message, progress, button('cancel', 'Cancel upload', () => this.stop(true)));
    } else if (allowSelection) {
      const formats = v.el('formats', 'p', 'Supported formats: MP3, M4A, FLAC, WAV, AIFF, Vorbis and Opus. Standalone AAC files are not supported.', 'muted small');
      nodes.push(v.el('instructions', 'p', 'Choose one audio file, then review it before adding.', 'muted small'), button('choose', this.uploadId ? 'Choose another file' : 'Choose audio file', () => this.input.click(), disabled), formats);
    }
    if (this.recovering) nodes.push(v.el('recovering', 'p', 'Checking the completed upload…', 'muted small'));
    if (this.error) { const error = v.el('error', 'p', this.error, 'error small'); if (!error.hasAttribute('role')) error.setAttribute('role', 'alert'); nodes.push(error); }
    if (this.notice) { const notice = v.el('notice', 'p', this.notice, 'success small'); if (!notice.hasAttribute('role')) notice.setAttribute('role', 'status'); nodes.push(notice); }
    if (this.preview && !this.busy) {
      const preview = this.preview; const form = v.el('preview', 'form', undefined, 'upload-preview');
      const heading = v.el('identity', 'div', undefined, 'result-identity');
      children(heading, v.get('art', () => new ArtworkView('Uploaded album artwork', 'result-artwork')).update(preview.artwork), v.el('filename', 'p', preview.filename, 'muted small'));
      const fields: Node[] = [];
      for (const [key, caption] of [['title', 'Track title'], ['artist', 'Artist'], ['album', 'Album']] as const) {
        const { group, input } = v.get(`field-${key}`, () => {
          const field = fieldControl(caption, `upload-${key}`); field.input.maxLength = 1000; field.input.required = key === 'title';
          field.input.oninput = () => { this.text[key] = field.input.value; this.persist(); }; return field;
        });
        prop(input, 'value', this.text[key]); prop(input, 'disabled', disabled); fields.push(group);
      }
      const add = v.get('add', () => { const node = el('button', 'Add to list'); node.type = 'submit'; return node; });
      prop(add, 'disabled', disabled || Boolean(this.library.view?.reviewEntryId));
      children(form, v.el('preview-title', 'h3', 'Review uploaded song'), heading, ...fields,
        v.el('unsaved', 'p', 'Uploaded, not yet saved. Artist and album are optional.', 'muted small'), add);
      form.onsubmit = event => {
        event.preventDefault();
        void (async () => {
          const epoch = this.epoch;
          await this.library.edit('add-upload', { uploadId: preview.id, text: { ...this.text } }, this.text.title);
          if (epoch === this.epoch && !this.library.pending && !this.library.error) {
            this.preview = undefined; this.uploadId = undefined; this.persist(); this.notice = 'Added to your list.'; this.added(); this.changed();
          }
        })();
      }; nodes.push(form);
    }
    if (this.uploadId && !this.busy) {
      const actions = v.el('actions', 'div', undefined, 'actions');
      children(actions, !this.preview && button('recover', 'Check completed upload', () => this.recover(), !navigator.onLine || this.recovering || this.discarding),
        button('discard', 'Discard upload draft', () => this.discard(), !navigator.onLine || this.recovering || this.discarding || this.library.saving || Boolean(this.library.pending))); nodes.push(actions);
    }
    children(this.element, ...nodes); return this.element;
  }
}
