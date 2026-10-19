import { panel as createPanel, fieldControl } from './ui-components';
import { ViewNodes, children, attr, prop } from './view-nodes';

/** Shared by /join and the unjoined participant entry screen; never submits on mount. */
export function joinPanel(options: { nickname: string; busy: boolean; disabled: boolean; notice?: string; error?: string; changed(value: string): void; submit(nickname: string): void }, v = new ViewNodes()) {
  const panel = v.get('panel', () => createPanel('join-panel'));
  const title = v.el('title', 'h1', 'Join room'); prop(title, 'id', 'join-room-title'); attr(panel, 'aria-labelledby', title.id);
  const content: Node[] = [title, v.el('hint', 'p', 'Choose a name, find your songs, and share one when it’s your turn.', 'muted')];
  if (options.notice) { const notice = v.el('notice', 'p', options.notice, 'muted join-notice'); attr(notice, 'role', 'status'); content.push(notice); }
  const form = v.el('form', 'form', undefined, 'form-stack');
  const { group: field, input } = v.get('field', () => { const field = fieldControl('What should we call you?', 'nickname'); field.input.name = 'nickname'; field.input.required = true; field.input.maxLength = 40; field.input.setAttribute('autocomplete', 'nickname'); return field; });
  const error = v.el('error', 'p', options.error ?? '', 'field-error'); prop(error, 'id', 'nickname-error'); prop(error, 'hidden', !options.error); attr(error, 'role', 'alert');
  attr(input, 'aria-describedby', error.id); attr(input, 'aria-invalid', String(Boolean(options.error)));
  prop(input, 'value', options.nickname); prop(input, 'disabled', options.busy); input.oninput = () => {
    options.changed(input.value); error.hidden = true; error.textContent = ''; input.setAttribute('aria-invalid', 'false');
  };
  if (error.parentElement !== field) field.append(error);
  const submit = v.el('submit', 'button', options.busy ? 'Joining…' : 'Join room'); prop(submit, 'id', 'join-room-submit'); prop(submit, 'type', 'submit'); prop(submit, 'disabled', options.busy || options.disabled);
  attr(form, 'aria-busy', String(options.busy)); children(form, field, submit);
  form.onsubmit = event => {
    event.preventDefault(); if (submit.disabled) return;
    if (!input.value.trim()) {
      error.textContent = 'Enter a name to join the room.'; error.hidden = false; input.setAttribute('aria-invalid', 'true'); input.focus(); return;
    }
    options.submit(input.value.trim());
  };
  children(panel, ...content, form, panel.querySelector('.entry-library-access')); return panel;
}
