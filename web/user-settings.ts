import type { UserDirectory } from '../src/model';
import type { AppHeader } from './app-header';
import type { ListeningOrder } from './listening-order';
import { el, link } from './dom';
import { pageFrame } from './page-layout';
import { pageHeading, panel } from './ui-components';
import { loadRoomLogo } from './room-logo';
import { requestJson } from './request';
import { watchUserDirectory } from './user-directory';
import { UserPictureEditor } from './user-picture';

/** Account settings use the signed-in user, independently of their place in the room. */
export function mountUserSettings(root: HTMLElement, header: AppHeader, order: ListeningOrder) {
  const lifecycle = new AbortController(); const signal = lifecycle.signal;
  const picture = new UserPictureEditor(false, signal);
  let directory: UserDirectory | undefined;
  let loading = true; let error = ''; let sequence = 0;
  let request: AbortController | undefined;
  let closeDirectory: (() => void) | undefined;
  const content = el('div', undefined, 'app-content'); content.id = 'main-content'; content.tabIndex = -1;
  const main = pageFrame('compact', 'user-settings-page');
  const profile = panel('user-settings-profile');
  const name = el('h2', 'Your profile');
  const description = el('p', 'Take, choose or remove your profile picture.', 'muted');
  const status = el('p'); status.setAttribute('role', 'status');
  const actions = el('div', undefined, 'actions');
  const signIn = link('Sign in / join room', '/join');
  const retry = el('button', 'Retry', 'secondary'); retry.type = 'button';
  retry.onclick = () => { start(); };
  actions.append(picture.element, signIn, retry);
  profile.append(name, description, status, actions);
  main.append(pageHeading('User settings'), profile); content.append(main); root.replaceChildren(content);
  document.body.dataset.view = 'user-settings';
  header.update({}); order.setDisplay(false); order.setManagement(undefined); order.setDisplayInvitation();
  void loadRoomLogo(signal);

  function render() {
    if (signal.aborted) return;
    const current = directory?.current ?? undefined;
    name.textContent = current?.nickname ?? 'Your profile';
    description.hidden = !current;
    picture.update(current);
    picture.element.disabled = loading || !navigator.onLine || Boolean(error);
    status.textContent = !navigator.onLine ? 'You’re offline. Reconnect to change your picture.' : error
      || (loading ? 'Loading your user…' : current ? '' : 'Sign in to manage your profile picture.');
    status.hidden = !status.textContent;
    status.className = error ? 'field-error' : 'muted'; status.setAttribute('role', error ? 'alert' : 'status');
    signIn.hidden = loading || !directory || Boolean(current);
    retry.hidden = !error; retry.disabled = loading || !navigator.onLine;
  }
  async function refresh() {
    if (signal.aborted || !navigator.onLine) { render(); return; }
    request?.abort(); request = new AbortController();
    const current = ++sequence; loading = true; error = ''; render();
    try {
      const next = await requestJson<UserDirectory>('/api/participant/identity', undefined, 15_000, AbortSignal.any([signal, request.signal]));
      if (signal.aborted || current !== sequence) return;
      directory = next;
    } catch (cause) {
      if (signal.aborted || current !== sequence) return;
      error = cause instanceof Error ? cause.message : 'Could not load your user. Try again.';
    } finally { if (current === sequence) { loading = false; render(); } }
  }
  function stop() {
    sequence++; request?.abort(); closeDirectory?.(); closeDirectory = undefined; order.stop();
  }
  function start() {
    if (signal.aborted) return;
    order.update(undefined, navigator.onLine);
    if (!navigator.onLine) { loading = false; render(); return; }
    closeDirectory ??= watchUserDirectory(false, signal, next => {
      sequence++; directory = next; loading = false; error = ''; render();
    });
    void refresh();
  }
  window.addEventListener('pagehide', stop, { signal });
  window.addEventListener('pageshow', event => { if (event.persisted) start(); }, { signal });
  window.addEventListener('online', start, { signal });
  window.addEventListener('offline', () => { stop(); loading = false; order.update(undefined, false); render(); }, { signal });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) void refresh(); }, { signal });
  start();
  return () => { stop(); lifecycle.abort(); root.replaceChildren(); };
}
