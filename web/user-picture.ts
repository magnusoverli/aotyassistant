import type { Person } from '../src/model';
import { maxUserPictureBytes, maxUserPicturePixels, pictureVersion, userPictureSize } from '../src/user-picture-format';
import { el } from './dom';
import { appPath } from './paths';
import { avatar, updateAvatar } from './visuals';
import { requestJson } from './request';
import { centredCrop, movePictureCrop, pictureCrop, type PictureCrop } from './picture-crop';

let sequence = 0;

/** Native camera capture works with LAN HTTP too; no live camera stream or camera permission API. */
export class UserPictureEditor {
  readonly element = el('button', undefined, 'secondary profile-picture-button');
  private icon = avatar(undefined, 'avatar-small');
  private dialog = el('dialog', undefined, 'picture-dialog');
  private current = avatar(undefined, 'avatar-large picture-current');
  private canvas = el('canvas');
  private zoom = el('input');
  private camera = el('input');
  private picker = el('input');
  private status = el('p', '', 'picture-status');
  private save = el('button', 'Save picture');
  private remove = el('button', 'Remove picture', 'secondary');
  private cancel = el('button', 'Cancel', 'secondary');
  private take = el('button', 'Take photo', 'secondary');
  private choose = el('button', 'Choose photo', 'secondary');
  private zoomControl = el('label', 'Zoom', 'picture-zoom');
  private cropHelp = el('p', 'Drag or use arrow keys to position; zoom to crop.', 'muted picture-crop-help');
  private person?: Person;
  private image?: HTMLImageElement;
  private objectUrl?: string;
  private crop: PictureCrop = centredCrop();
  private expected = 'none';
  private busy = false;
  private request?: AbortController;
  private epoch = 0;

  constructor(private host: boolean, private signal: AbortSignal) {
    const id = `picture-editor-${++sequence}`;
    this.element.type = 'button'; this.element.append(this.icon, el('span', 'Profile picture'));
    this.element.onclick = () => this.open();
    const title = el('h2', 'Profile picture'); title.id = id;
    this.dialog.setAttribute('aria-labelledby', id);
    const help = el('p', 'Visible to everyone in the room and user picker.', 'muted');
    const header = el('div', undefined, 'picture-header'); header.append(title, help);
    const preview = el('div', undefined, 'picture-preview');
    this.canvas.width = this.canvas.height = userPictureSize; this.canvas.tabIndex = 0;
    this.canvas.setAttribute('aria-label', 'Picture crop. Drag or use arrow keys to move the picture.');
    preview.append(this.current, this.canvas);
    this.cropHelp.id = `${id}-crop-help`; this.canvas.setAttribute('aria-describedby', this.cropHelp.id);
    const choices = el('div', undefined, 'actions picture-choices'); choices.append(this.take, this.choose);
    this.camera.type = this.picker.type = 'file';
    this.camera.accept = 'image/*'; this.camera.setAttribute('capture', 'user');
    this.picker.accept = 'image/jpeg,image/png,image/webp,image/heic,image/heif';
    this.camera.hidden = this.picker.hidden = true;
    for (const input of [this.camera, this.picker]) input.onchange = () => {
      const file = input.files?.[0]; input.value = ''; if (file) void this.load(file);
    };
    this.take.onclick = () => this.camera.click(); this.choose.onclick = () => this.picker.click();
    this.zoom.type = 'range'; this.zoom.min = '1'; this.zoom.max = '4'; this.zoom.step = '.01'; this.zoom.value = '1';
    this.zoomControl.append(this.zoom);
    this.zoom.oninput = () => { this.crop.zoom = Number(this.zoom.value); this.draw(); };
    const actions = el('div', undefined, 'actions picture-actions'); actions.append(this.save, this.remove, this.cancel);
    for (const button of [this.take, this.choose, this.save, this.remove, this.cancel]) button.type = 'button';
    this.save.onclick = () => { void this.persist(false); }; this.remove.onclick = () => { void this.persist(true); };
    this.cancel.onclick = () => this.dialog.close();
    this.dialog.addEventListener('cancel', event => { if (this.busy) event.preventDefault(); });
    this.dialog.addEventListener('close', () => { this.clearDraft(); this.element.focus({ preventScroll: true }); });
    const controls = el('div', undefined, 'picture-controls');
    controls.append(choices, this.camera, this.picker, this.zoomControl, this.cropHelp, this.status);
    const body = el('div', undefined, 'picture-body'); body.append(preview, controls);
    this.dialog.append(header, body, actions);
    this.canvas.onkeydown = event => {
      if (!this.image || this.busy) return;
      const step = event.shiftKey ? 30 : 8;
      const movement = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[event.key];
      if (!movement) return;
      event.preventDefault(); this.move(movement[0]!, movement[1]!);
    };
    let pointer: { id: number; x: number; y: number } | undefined;
    this.canvas.onpointerdown = event => {
      if (!this.image || this.busy || event.button !== 0) return;
      pointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
      this.canvas.setPointerCapture(event.pointerId); this.canvas.focus({ preventScroll: true });
    };
    this.canvas.onpointermove = event => {
      if (pointer?.id !== event.pointerId || this.busy) return;
      this.move(event.clientX - pointer.x, event.clientY - pointer.y);
      pointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
    };
    this.canvas.onlostpointercapture = () => { pointer = undefined; };
    signal.addEventListener('abort', () => { this.request?.abort(); this.clearDraft(); this.dialog.remove(); }, { once: true });
    this.render();
  }
  update(person: Person | undefined) {
    if (this.person?.id !== person?.id) { this.request?.abort(); this.clearDraft(); this.dialog.close(); }
    this.person = person;
    updateAvatar(this.icon, person); updateAvatar(this.current, person);
    this.element.hidden = !person; this.render();
  }
  private open() {
    if (!this.person || this.signal.aborted) return;
    this.clearDraft(); this.expected = pictureVersion(this.person.avatarUrl); this.message('');
    document.body.append(this.dialog); this.dialog.showModal(); this.choose.focus();
  }
  private clearDraft() {
    this.epoch++;
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.objectUrl = undefined; this.image = undefined; this.crop = centredCrop(); this.zoom.value = '1'; this.busy = false; this.render();
  }
  private message(value: string, failed = false) {
    this.status.textContent = value; this.status.className = failed ? 'field-error picture-status' : 'muted picture-status';
    this.status.setAttribute('role', failed ? 'alert' : 'status');
  }
  private render() {
    for (const button of [this.take, this.choose, this.save, this.remove, this.cancel]) button.disabled = this.busy;
    this.save.disabled ||= !this.image;
    this.save.textContent = this.busy ? 'Please wait…' : 'Save picture';
    this.remove.hidden = !this.person?.avatarUrl; this.zoom.disabled = this.busy;
    this.zoomControl.hidden = this.cropHelp.hidden = !this.image; this.canvas.hidden = !this.image; this.current.hidden = Boolean(this.image);
  }
  private async load(file: File) {
    if (file.size > maxUserPictureBytes) { this.message('Choose a picture smaller than 10 MB.', true); return; }
    if (file.type && !/^image\/(jpeg|png|webp|heic|heif)$/.test(file.type)) { this.message('Choose a still JPEG, PNG or WebP picture.', true); return; }
    const epoch = ++this.epoch; const url = URL.createObjectURL(file); const image = new Image();
    this.busy = true; this.message('Opening photo…'); this.render();
    try {
      await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error('This photo could not be opened. Try taking another photo or choose a JPEG, PNG or WebP picture.')); image.src = url; });
      if (epoch !== this.epoch || this.signal.aborted) { URL.revokeObjectURL(url); return; }
      if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth * image.naturalHeight > maxUserPicturePixels) throw new Error('This picture is too large to edit. Choose a photo under 40 megapixels.');
      if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = url; this.image = image; this.crop = centredCrop(); this.zoom.value = '1'; this.draw(); this.message('Preview ready. Save to apply this picture.');
    } catch (error) {
      URL.revokeObjectURL(url);
      if (epoch === this.epoch) this.message(error instanceof Error ? error.message : 'Could not open this picture.', true);
    } finally { if (epoch === this.epoch) { this.busy = false; this.render(); } }
  }
  private move(dx: number, dy: number) {
    if (!this.image) return;
    this.crop = movePictureCrop(this.image.naturalWidth, this.image.naturalHeight, this.crop, dx, dy, this.canvas.clientWidth); this.draw();
  }
  private draw() {
    if (!this.image) return;
    const context = this.canvas.getContext('2d'); if (!context) return;
    const { left, top, size } = pictureCrop(this.image.naturalWidth, this.image.naturalHeight, this.crop);
    context.clearRect(0, 0, userPictureSize, userPictureSize);
    context.drawImage(this.image, left, top, size, size, 0, 0, userPictureSize, userPictureSize);
  }
  private async persist(remove: boolean) {
    const person = this.person; if (!person || this.busy || !remove && !this.image) return;
    const epoch = this.epoch; this.busy = true; this.message(remove ? 'Removing picture…' : 'Saving picture…'); this.render();
    this.request = new AbortController();
    const signal = AbortSignal.any([this.signal, this.request.signal, AbortSignal.timeout(60_000)]);
    const path = this.host ? `/api/host/users/${person.id}/picture` : '/api/participant/picture';
    try {
      let result: { avatarUrl: string | null };
      if (remove) result = await requestJson(`${path}/remove`, { version: this.expected }, 60_000, signal);
      else {
        const blob = await new Promise<Blob>((resolve, reject) => this.canvas.toBlob(value => value ? resolve(value) : reject(new Error('Could not prepare the picture.')), 'image/webp', .9));
        const response = await fetch(appPath(path), { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-Picture-Version': this.expected }, body: blob, signal });
        const payload = await response.json() as { avatarUrl: string | null; error?: string };
        if (!response.ok || typeof payload.avatarUrl !== 'string') throw new Error(payload.error ?? 'The picture could not be saved.');
        result = payload;
      }
      if (epoch !== this.epoch || this.signal.aborted) return;
      this.update({ ...person, avatarUrl: result.avatarUrl ?? undefined });
      this.expected = pictureVersion(result.avatarUrl ?? undefined); this.clearDraft();
      this.message(remove ? 'Picture removed. Your initial is shown again.' : 'Picture saved. The room now shows your photo.');
    } catch (error) {
      if (epoch === this.epoch && !this.signal.aborted) this.message(error instanceof Error ? error.message : 'The picture change could not be confirmed.', true);
    } finally { if (epoch === this.epoch) { this.busy = false; this.render(); } }
  }
}
