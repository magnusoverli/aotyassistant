import { panel as createPanel, fieldControl } from './ui-components';
import { ViewNodes, children, attr, prop } from './view-nodes';
import type { UserDirectory } from '../src/model';
import { avatar } from './visuals';

/** Shared by /join and the unjoined participant entry screen; never submits on mount. */
export function joinPanel(options: { nickname: string; pin: string; directory?: UserDirectory; selected?: string;
  busy: boolean; disabled: boolean; notice?: string; error?: string; changed(value: string): void; pinChanged(value: string): void;
  select(id?: string): void; submit(nickname: string): void; retry(): void }, v = new ViewNodes()) {
  const panel = v.get('panel', () => createPanel('join-panel'));
  const title = v.el('title', 'h1', 'Join room'); prop(title, 'id', 'join-room-title'); attr(panel, 'aria-labelledby', title.id);
  const content: Node[] = [title, v.el('hint', 'p', 'Choose yourself to continue, or join as someone new.', 'muted')];
  if (options.notice) { const notice = v.el('notice', 'p', options.notice, 'muted join-notice'); attr(notice, 'role', 'status'); content.push(notice); }
  const selected = options.directory?.users.find(user => user.id === options.selected);
  const remembered = selected && selected.id === options.directory?.current?.id;
  const picker = v.el('picker', 'div', undefined, 'user-picker'); attr(picker, 'aria-label', 'Existing users');
  children(picker, ...(options.directory?.users ?? []).map(user => {
    const button = v.el(`user-${user.id}`, 'button', undefined, 'secondary user-choice'); prop(button, 'type', 'button');
    prop(button, 'disabled', options.busy); attr(button, 'aria-pressed', String(user.id === selected?.id));
    children(button, v.get(`avatar-${user.id}`, () => avatar(user)), v.el(`name-${user.id}`, 'span', user.nickname));
    button.onclick = () => options.select(user.id); return button;
  }));
  if (options.directory?.users.length) content.push(picker);
  if (!options.directory) {
    const retry = v.el('reload-users', 'button', 'Refresh users', 'secondary'); prop(retry, 'type', 'button');
    retry.onclick = options.retry; prop(retry, 'disabled', options.busy || options.disabled); content.push(retry);
  }
  if (selected) {
    content.push(v.el('selected-name', 'h2', `Continue as ${selected.nickname}`));
    const other = v.el('new-user', 'button', 'New here? Create a user', 'secondary'); prop(other, 'type', 'button');
    other.onclick = () => options.select(undefined); prop(other, 'disabled', options.busy); content.push(other);
  } else content.push(v.el('new-heading', 'h2', 'New here?'));
  const form = v.el('form', 'form', undefined, 'form-stack');
  const { group: field, input } = v.get('field', () => { const field = fieldControl('Display name', 'nickname'); field.input.name = 'nickname'; field.input.required = true; field.input.maxLength = 40; field.input.setAttribute('autocomplete', 'nickname'); return field; });
  const error = v.el('error', 'p', options.error ?? '', 'field-error'); prop(error, 'id', 'nickname-error'); prop(error, 'hidden', !options.error); attr(error, 'role', 'alert');
  attr(input, 'aria-describedby', error.id); attr(input, 'aria-invalid', String(Boolean(options.error)));
  prop(input, 'value', options.nickname); prop(input, 'disabled', options.busy); input.oninput = () => {
    options.changed(input.value); error.hidden = true; error.textContent = ''; input.setAttribute('aria-invalid', 'false');
  };
  if (error.parentElement !== field) field.append(error);
  const needsPin = !remembered || selected?.pinRequired;
  const pinField = v.get('pin-field', () => { const field = fieldControl('4-digit PIN', 'join-pin'); field.input.type = 'password'; return field; });
  const pin = pinField.input; pin.inputMode = 'numeric'; pin.name = 'pin'; pin.maxLength = 4; pin.pattern = '[0-9]{4}'; pin.required = true;
  pin.autocomplete = !selected || selected.pinRequired ? 'new-password' : 'current-password';
  attr(pin, 'aria-describedby', error.id); attr(pin, 'aria-invalid', String(Boolean(options.error)));
  prop(pin, 'value', options.pin); prop(pin, 'disabled', options.busy); pin.oninput = () => options.pinChanged(pin.value);
  const show = v.el('show-pin', 'button', pin.type === 'password' ? 'Show PIN' : 'Hide PIN', 'secondary'); prop(show, 'type', 'button'); prop(show, 'disabled', options.busy);
  show.onclick = () => { pin.type = pin.type === 'password' ? 'text' : 'password'; show.textContent = pin.type === 'password' ? 'Show PIN' : 'Hide PIN'; };
  const hint = v.el('pin-hint', 'p', !selected || selected.pinRequired ? 'Choose four digits to recognize you on another device. This browser will remember you.' : 'Forgot your PIN? Ask the host to reset it.', 'muted small');
  const submit = v.el('submit', 'button', options.busy ? 'Joining…' : 'Join room'); prop(submit, 'id', 'join-room-submit'); prop(submit, 'type', 'submit'); prop(submit, 'disabled', options.busy || options.disabled || Boolean(selected?.pinRequired && !remembered));
  if (selected?.pinRequired && !remembered) content.push(v.el('unset-pin', 'p', 'Choose your first PIN on your remembered device, or ask the host to set it.', 'muted'));
  attr(form, 'aria-busy', String(options.busy)); children(form, !selected && field, needsPin && pinField.group, needsPin && show, needsPin && hint, selected && error, submit);
  form.onsubmit = event => {
    event.preventDefault(); if (submit.disabled) return;
    if (!selected && !input.value.trim()) {
      error.textContent = 'Enter a name to join the room.'; error.hidden = false; input.setAttribute('aria-invalid', 'true'); input.focus(); return;
    }
    options.submit(input.value.trim());
  };
  children(panel, ...content, form, panel.querySelector('.entry-library-access')); return panel;
}
