import { el } from './dom';

/** Shared by /join and the unjoined participant entry screen; never submits on mount. */
export function joinPanel(options: { nickname: string; busy: boolean; disabled: boolean; notice?: string; error?: string; changed(value: string): void; submit(nickname: string): void }) {
  const panel = el('section', undefined, 'panel join-panel');
  const title = el('h1', 'Join room'); title.id = 'join-room-title'; panel.setAttribute('aria-labelledby', title.id); panel.append(title);
  panel.append(el('p', 'Choose a name, find your songs, and share one when it’s your turn.', 'muted'));
  if (options.notice) { const notice = el('p', options.notice, 'muted join-notice'); notice.setAttribute('role', 'status'); panel.append(notice); }
  const form = el('form');
  const field = el('div', undefined, 'field'); const label = el('label', 'What should we call you?'); label.htmlFor = 'nickname';
  const input = el('input'); input.name = 'nickname'; input.id = 'nickname'; input.required = true; input.maxLength = 40; input.setAttribute('autocomplete', 'nickname');
  const error = el('p', options.error, 'field-error'); error.id = 'nickname-error'; error.hidden = !options.error; error.setAttribute('role', 'alert');
  input.setAttribute('aria-describedby', error.id); input.setAttribute('aria-invalid', String(Boolean(options.error)));
  input.value = options.nickname; input.disabled = options.busy; input.oninput = () => {
    options.changed(input.value); error.hidden = true; error.textContent = ''; input.setAttribute('aria-invalid', 'false');
  };
  field.append(label, input, error);
  const submit = el('button', options.busy ? 'Joining…' : 'Join room'); submit.id = 'join-room-submit'; submit.type = 'submit'; submit.disabled = options.busy || options.disabled;
  form.setAttribute('aria-busy', String(options.busy)); form.append(field, submit);
  form.onsubmit = event => {
    event.preventDefault(); if (submit.disabled) return;
    if (!input.value.trim()) {
      error.textContent = 'Enter a name to join the room.'; error.hidden = false; input.setAttribute('aria-invalid', 'true'); input.focus(); return;
    }
    options.submit(input.value.trim());
  };
  panel.append(form); return panel;
}
