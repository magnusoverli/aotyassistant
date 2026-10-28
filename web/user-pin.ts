import { fieldControl, panel, sectionHeading } from './ui-components';
import { ViewNodes, children, prop, attr } from './view-nodes';
import { requestJson } from './request';
import type { UserDirectory } from '../src/model';
import { avatar } from './visuals';
import { link } from './dom';

export function pinInput(v: ViewNodes, id: string, label: string) {
  return v.get(id, () => {
    const field = fieldControl(label, id); const input = field.input;
    input.type = 'password'; input.inputMode = 'numeric'; input.pattern = '[0-9]{4}'; input.maxLength = 4; input.required = true;
    input.autocomplete = 'new-password'; return field;
  });
}

export class UserSettingsPanel {
  readonly element = panel('settings-card settings-users');
  private nodes = new ViewNodes();
  private directory?: UserDirectory;
  private selected = '';
  private editingPin = false;
  private busy = false;
  private loading = false;
  private loadSequence = 0;
  private message = '';
  private failed = false;
  constructor(private signal: AbortSignal) {
    this.element.setAttribute('aria-labelledby', 'settings-users-title');
    this.render();
    window.addEventListener('focus', () => { if (!this.busy) void this.load(); }, { signal });
    window.addEventListener('online', () => { if (!this.busy) void this.load(); }, { signal });
    window.addEventListener('offline', () => this.render(), { signal });
  }
  async load() {
    if (this.loading || this.signal.aborted) return;
    const sequence = ++this.loadSequence;
    this.loading = true; this.render();
    try {
      const directory = await requestJson<UserDirectory>('/api/host/users', undefined, 15_000, this.signal);
      if (sequence !== this.loadSequence || this.signal.aborted) return;
      this.directory = directory;
      if (this.selected && !this.directory.users.some(user => user.id === this.selected)) { this.selected = ''; this.editingPin = false; }
    } catch (error) { if (sequence === this.loadSequence) { this.failed = true; this.message = error instanceof Error ? error.message : 'Could not load users.'; } }
    finally { this.loading = false; if (!this.signal.aborted) this.render(); }
  }
  private render() {
    if (this.signal.aborted) return;
    const v = this.nodes;
    const heading = v.get('heading', () => sectionHeading('Saved users', 'settings-users-title', 'h3'));
    const count = this.directory?.users.length;
    children(heading, heading.firstElementChild!, v.el('count', 'span', count === undefined ? 'Loading…' : `${count} ${count === 1 ? 'user' : 'users'}`, 'badge'));
    const hint = v.el('hint', 'p', 'Each person has one playlist across devices. Manage their PIN or permanently delete their account, music and place in the listening order.', 'muted');
    const disabled = this.busy || !navigator.onLine;
    const pin = pinInput(v, 'reset-user-pin', 'New 4-digit PIN'); prop(pin.input, 'disabled', disabled);
    const list = v.el('list', 'ul', undefined, 'settings-user-list'); attr(list, 'aria-label', 'Saved users');
    children(list, ...(this.directory?.users ?? []).map(user => {
      const row = v.el(`row-${user.id}`, 'li', undefined, 'settings-user-row');
      const header = v.el(`header-${user.id}`, 'div', undefined, 'settings-user-header');
      const name = v.el(`name-${user.id}`, 'strong', user.nickname);
      const state = v.el(`state-${user.id}`, 'span', user.deletionPending ? 'Deletion needs retry' : user.pinRequired ? 'First PIN not set' : 'PIN set', 'muted');
      const identity = v.el(`identity-${user.id}`, 'div', undefined, 'settings-user-identity'); children(identity, name, state);
      const expanded = user.id === this.selected;
      const manage = v.el(`manage-${user.id}`, 'button', expanded ? 'Close' : 'Manage', 'secondary'); prop(manage, 'type', 'button'); prop(manage, 'disabled', this.busy);
      attr(manage, 'aria-label', `${expanded ? 'Close' : 'Manage'} ${user.nickname}`); attr(manage, 'aria-expanded', String(expanded)); attr(manage, 'aria-controls', `user-actions-${user.id}`);
      manage.onclick = () => { this.selected = expanded ? '' : user.id; this.editingPin = false; pin.input.value = ''; this.message = ''; this.failed = false; this.render(); };
      children(header, v.get(`avatar-${user.id}`, () => avatar(user)), identity, manage);
      const details = v.el(`details-${user.id}`, 'div', undefined, 'settings-user-details'); details.id = `user-actions-${user.id}`; prop(details, 'hidden', !expanded);
      if (expanded) {
        const reset = v.el('reset', 'button', user.pinRequired ? 'Set first PIN' : 'Reset PIN', 'secondary'); prop(reset, 'type', 'button'); prop(reset, 'disabled', disabled);
        reset.onclick = () => { this.editingPin = true; this.render(); pin.input.focus(); };
        const form = v.el('pin-form', 'form', undefined, 'form-stack settings-pin-form');
        const help = v.el('pin-help', 'p', 'Use four digits, including leading zeroes. Remembered devices will need the new PIN; saved music and playback stay unchanged.', 'muted');
        const save = v.el('save', 'button', this.busy ? 'Saving…' : 'Save PIN'); prop(save, 'type', 'submit'); prop(save, 'disabled', disabled);
        const cancel = v.el('cancel', 'button', 'Cancel', 'secondary'); prop(cancel, 'type', 'button'); prop(cancel, 'disabled', this.busy);
        cancel.onclick = () => { this.editingPin = false; pin.input.value = ''; this.render(); reset.focus(); };
        const actions = v.el('pin-actions', 'div', undefined, 'actions'); children(actions, save, cancel); children(form, pin.group, help, actions);
        form.onsubmit = event => {
          event.preventDefault(); if (disabled || !form.reportValidity()) return;
          const value = pin.input.value; this.busy = true; this.loadSequence++; this.message = ''; this.failed = false; this.render();
          void requestJson<UserDirectory>('/api/host/users/pin', { userId: user.id, pin: value }).then(directory => {
            this.directory = directory; pin.input.value = ''; this.editingPin = false; this.message = `PIN updated for ${user.nickname}. Their music was kept.`;
          }).catch(error => { this.failed = true; this.message = error instanceof Error ? error.message : 'PIN save could not be confirmed.'; })
            .finally(() => { this.busy = false; this.render(); });
        };
        const danger = v.el('danger', 'div', undefined, 'settings-danger-zone');
        const removal = v.el('delete-help', 'p', user.deletionPending ? 'This user is signed out. Retry to finish deleting their account and music.' : 'Permanently delete this user, their playlist, history and uploads.', 'muted');
        const remove = v.el('delete', 'button', user.deletionPending ? 'Retry Delete user' : 'Delete user', 'danger'); prop(remove, 'type', 'button'); prop(remove, 'disabled', disabled);
        remove.onclick = () => {
          if (disabled || !confirm(`Permanently delete ${user.nickname}?\n\nTheir playlist, history and uploaded files will be deleted, and all their devices signed out. They will also be removed from the listening order; if it is their turn, playback will stop. This cannot be undone.`)) return;
          this.busy = true; this.loadSequence++; this.message = ''; this.failed = false; this.render();
          void requestJson<UserDirectory>('/api/host/users/delete', { userId: user.id, confirm: true }).then(directory => {
            this.directory = directory; this.selected = ''; this.editingPin = false; pin.input.value = ''; this.message = `${user.nickname} and their music were deleted.`;
          }).catch(async error => {
            this.failed = true; this.message = `Deletion was not confirmed. ${error instanceof Error ? error.message : 'Refresh users and retry Delete user.'}`; await this.load();
          }).finally(() => { this.busy = false; this.render(); });
        };
        children(danger, removal, remove); children(details, !user.deletionPending && (this.editingPin ? form : reset), danger);
      }
      children(row, header, details); return row;
    }));
    const refresh = v.el('refresh', 'button', this.loading ? 'Refreshing…' : 'Refresh users', 'secondary'); prop(refresh, 'type', 'button'); prop(refresh, 'disabled', disabled || this.loading);
    refresh.onclick = () => { this.message = ''; this.failed = false; void this.load(); };
    const message = v.el('message', 'p', this.message, this.failed ? 'error' : 'success'); attr(message, 'role', this.failed ? 'alert' : 'status'); prop(message, 'hidden', !this.message);
    const empty = v.el('empty', 'div', undefined, 'settings-empty');
    children(empty, v.el('empty-title', 'h3', 'No users yet'), v.el('empty-hint', 'p', 'People create their own user with a name and PIN when they join.', 'muted'), v.get('join', () => link('Open Join room', '/join')));
    children(this.element, heading, hint, message, count === 0 ? empty : list, refresh);
  }
}
