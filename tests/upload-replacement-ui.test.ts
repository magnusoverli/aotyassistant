import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ReplaceTrack } from '../web/replace-track.js';
import { UploadPanel } from '../web/upload-panel.js';
import type { PreparationController } from '../web/preparation-controller.js';
import type { PreparationView, PreparedEntryView } from '../src/preparations.js';

// Controlled DOM and transfer completion, not a browser test.
class Element extends EventTarget {
  childNodes: Element[] = []; parent?: Element; className = ''; textContent = ''; id = ''; type = ''; value = '';
  hidden = false; disabled = false; open = false; files?: { name: string }[];
  onclick?: () => void; onchange?: () => void; onsubmit?: (event: { preventDefault(): void }) => void;
  attributes = new Map<string, string>();
  classList = { toggle() {} };
  constructor(readonly tag: string) { super(); }
  get isConnected(): boolean { return this.tag === 'body' || Boolean(this.parent?.isConnected); }
  get firstChild(): Element | null { return this.childNodes[0] ?? null; }
  get nextSibling(): Element | null { return this.parent?.childNodes[this.parent.childNodes.indexOf(this) + 1] ?? null; }
  append(...children: (Element | string)[]) {
    for (const child of children) {
      const node = typeof child === 'string' ? Object.assign(new Element('text'), { textContent: child }) : child;
      node.remove(); this.childNodes.push(node); node.parent = this;
    }
  }
  insertBefore(node: Element, before: Element | null) {
    node.remove(); const index = before ? this.childNodes.indexOf(before) : this.childNodes.length;
    this.childNodes.splice(index, 0, node); node.parent = this;
  }
  replaceChildren(...children: Element[]) { for (const child of [...this.childNodes]) child.remove(); this.append(...children); }
  remove() { if (this.parent) this.parent.childNodes.splice(this.parent.childNodes.indexOf(this), 1); this.parent = undefined; }
  setAttribute(key: string, value: string) { this.attributes.set(key, value); }
  getAttribute(key: string) { return this.attributes.get(key) ?? null; }
  hasAttribute(key: string) { return this.attributes.has(key); }
  removeAttribute(key: string) { this.attributes.delete(key); }
  querySelector(selector: string): Element | null {
    const [head, ...rest] = selector.split(' ');
    for (const child of this.childNodes) {
      const matches = head!.startsWith('.') ? child.className.split(' ').includes(head!.slice(1)) : head!.startsWith('#') ? child.id === head!.slice(1) : child.tag === head;
      if (matches) { const found = rest.length ? child.querySelector(rest.join(' ')) : child; if (found) return found; }
      const found = child.querySelector(selector); if (found) return found;
    }
    return null;
  }
  showModal() { this.open = true; }
  close() { if (this.open) { this.open = false; queueMicrotask(() => this.dispatchEvent(new Event('close'))); } }
  click() { this.onclick?.(); }
}
class Transfer {
  static all: Transfer[] = [];
  upload = {}; status = 200; response: unknown; aborted = false;
  private id = '';
  onload?: () => void; onabort?: () => void;
  constructor() { Transfer.all.push(this); }
  open(_method: string, path: string) { this.id = path.split('/').at(-1)!; } setRequestHeader() {} send() {}
  abort() { this.aborted = true; this.onabort?.(); }
  finish() { this.response = { id: this.id, filename: 'new.mp3', title: 'New song', artist: 'New artist', album: '', duration: 30 }; this.onload?.(); }
}
const tick = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
function fixture(t: TestContext) {
  const body = new Element('body'); const storage = new Map<string, string>(); const requests: string[] = []; Transfer.all = [];
  const globals = { document: { body, createElement: (tag: string) => new Element(tag), querySelector: () => null }, navigator: { onLine: true },
    XMLHttpRequest: Transfer, localStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) },
    fetch: async (path: string) => { requests.push(path); return new Response(JSON.stringify({ discarded: true, saved: false }), { status: 200 }); } };
  for (const [key, value] of Object.entries(globals)) {
    const original = Object.getOwnPropertyDescriptor(globalThis, key); Object.defineProperty(globalThis, key, { configurable: true, value });
    t.after(() => { if (original) Object.defineProperty(globalThis, key, original); else Reflect.deleteProperty(globalThis, key); });
  }
  const entry: PreparedEntryView = { id: randomUUID(), source: 'upload', title: 'Original', artist: '', album: '', version: '', provider: 'Uploaded file', duration: 30, addedAt: 0, playCount: 0, sourceAvailable: false };
  const view: PreparationView = { ownerId: randomUUID(), revision: 1, capacity: { upcoming: 200, entries: 1000 }, upcoming: [entry], played: [], removed: [] };
  const edits: { path: string; payload: { entryId?: string; uploadId?: string } }[] = [];
  const library = { view, loading: false, saving: false, pending: undefined, error: '', locked: false, lastSavedUploadId: undefined as string | undefined,
    async ensureOwner() {}, async edit(path: string, payload: { entryId?: string; uploadId?: string }) { edits.push({ path, payload }); } };
  let member = true;
  const replaced: string[][] = [];
  const dialog = new ReplaceTrack(library as unknown as PreparationController, (from, to) => replaced.push([from, to]), () => member);
  const root = dialog.dialog as unknown as Element;
  async function upload() {
    const input = root.querySelector('input')!; input.files = [{ name: 'new.mp3' }]; input.onchange!(); await tick();
    Transfer.all.at(-1)!.finish(); await tick();
    return root.querySelector('form')!;
  }
  return { entry, view, library, dialog, root, storage, requests, edits, replaced, upload, revoke() { member = false; } };
}

test('uploaded Replace opens file review, not album browsing, including an unavailable source; save targets the original entry', async t => {
  const f = fixture(t); f.dialog.open(f.entry);
  assert.equal(f.root.open, true); assert.ok(f.root.querySelector('input')); assert.equal(f.requests.length, 0);
  const form = await f.upload(); assert.equal(form.querySelector('button')!.textContent, 'Replace song');
  form.onsubmit!({ preventDefault() {} }); await tick();
  assert.equal(f.edits[0]!.path, 'replace-upload'); assert.equal(f.edits[0]!.payload.entryId, f.entry.id);
  assert.deepEqual(f.replaced, [['Original', 'New song']]); assert.equal(f.root.open, false);
  form.onsubmit!({ preventDefault() {} }); await tick(); assert.equal(f.edits.length, 1, 'A detached review cannot submit the upload twice.');
  assert.equal(f.requests.some(path => path.endsWith('/album')), false);
});

test('closing uploaded Replace cancels and cleans only the new draft without editing the playlist', async t => {
  const f = fixture(t); f.dialog.open(f.entry); await f.upload();
  assert.ok([...f.storage.keys()].some(key => key.endsWith(`.replace.${f.entry.id}`)));
  f.root.close(); await tick();
  assert.deepEqual(f.edits, []); assert.equal(f.view.upcoming[0]!.id, f.entry.id);
  assert.equal(f.requests.filter(path => path.endsWith('/discard')).length, 1); assert.equal(f.storage.size, 0);
});

test('uncertain replacement saves retain their upload draft; regular upload storage and field IDs stay separate', async t => {
  const f = fixture(t); f.dialog.open(f.entry); const form = await f.upload();
  const normal = new UploadPanel(f.library as unknown as PreparationController, () => true, () => {}, () => {});
  const normalInput = (normal.render() as unknown as Element).querySelector('input')!;
  assert.notEqual(normalInput.id, f.root.querySelector('input')!.id);
  f.library.edit = async (path, payload) => { f.edits.push({ path, payload }); f.library.pending = {} as never; f.library.error = 'Unconfirmed save'; };
  form.onsubmit!({ preventDefault() {} }); await tick();
  assert.equal(f.root.open, true); f.root.close(); await tick();
  assert.equal(f.requests.length, 0, 'No draft is discarded while a save needs reconciliation.');
  assert.equal(f.storage.size, 1); assert.equal(f.view.upcoming[0]!.id, f.entry.id);
});

test('authorization teardown aborts a replacement transfer and never edits or deletes another owner’s files', async t => {
  const f = fixture(t); f.dialog.open(f.entry);
  const input = f.root.querySelector('input')!; input.files = [{ name: 'new.mp3' }]; input.onchange!(); await tick();
  f.library.view = { ...f.view, ownerId: randomUUID() }; f.revoke(); f.dialog.refresh(); await tick();
  assert.equal(Transfer.all[0]!.aborted, true); assert.equal(f.root.open, false); assert.equal(f.root.isConnected, false);
  assert.deepEqual(f.edits, []); assert.deepEqual(f.requests, []);
});

test('album loading can be retried without reopening the replacement dialog', async t => {
  const f = fixture(t); let attempts = 0;
  globalThis.fetch = async () => {
    attempts++;
    return attempts === 1
      ? new Response(JSON.stringify({ error: 'Album temporarily unavailable' }), { status: 502 })
      : new Response(JSON.stringify({ album: { name: 'Album', artist: 'Artist' }, tracks: [], current: -1 }), { status: 200 });
  };
  f.dialog.open({ ...f.entry, source: 'music-assistant' }); await tick();
  const retry = f.root.querySelector('.list-dialog-actions button')!;
  assert.equal(retry.textContent, 'Try again'); retry.click(); await tick();
  assert.equal(attempts, 2); assert.equal(f.root.open, true);
  assert.equal(f.root.querySelector('h3')!.textContent, 'Album · Artist');
});
