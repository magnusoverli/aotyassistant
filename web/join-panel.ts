import { el } from './dom';

/** Shared by /join and the unjoined participant entry screen; never submits on mount. */
export function joinPanel(options: { nickname: string; busy: boolean; disabled: boolean; notice?: string; changed(value: string): void; submit(nickname: string): void }) {
  const panel = el('section', undefined, 'panel join-panel');
  const title = el('h1', 'Join room'); title.id = 'join-room-title'; panel.setAttribute('aria-labelledby', title.id); panel.append(title);
  if (options.notice) { const notice = el('p', options.notice, 'muted join-notice'); notice.setAttribute('role', 'status'); panel.append(notice); }
  const form = el('form');
  const field = el('div', undefined, 'field'); const label = el('label', 'What should we call you?'); label.htmlFor = 'nickname';
  const input = el('input'); input.name = 'nickname'; input.id = 'nickname'; input.required = true; input.maxLength = 40; input.setAttribute('autocomplete', 'nickname');
  input.value = options.nickname; input.disabled = options.busy; input.oninput = () => options.changed(input.value);
  field.append(label, input);
  const submit = el('button', options.busy ? 'Joining…' : 'Join room'); submit.id = 'join-room-submit'; submit.type = 'submit'; submit.disabled = options.busy || options.disabled;
  form.setAttribute('aria-busy', String(options.busy)); form.append(field, submit);
  form.onsubmit = event => { event.preventDefault(); if (!submit.disabled) options.submit(input.value); };
  panel.append(form); return panel;
}
