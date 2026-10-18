import type { IntegrationView } from '../src/integrations';
import { el, link } from './dom';
import { AddressingPanel } from './addressing-panel';
import { requestJson, RequestError } from './request';
import type { SetupView } from '../src/setup';
import { pageFrame, workspaceGrid, slot } from './page-layout';
import { panel as createPanel, fieldControl, pageHeading, sectionHeading, actionGroup, notice as uiNotice } from './ui-components';

/** Host-only setup. MA handles login; callback credentials are consumed by the backend. */
export async function mountSettings(container: HTMLElement) {
  const main = pageFrame('workspace', 'settings-page'); container.append(main);
  let settings: IntegrationView | undefined;
  let urlDraft = '';
  let tokenDraft = '';
  let pendingDestination = '';
  let busy = false;
  let busyScope: 'connection' | 'speaker' = 'connection';
  let online = false;
  let error = '';
  let notice = '';
  let helpExpanded = false;
  let manualExpanded = false;
  let editConnection = false;
  let speakerError = '';
  let authExpiresAt = 0;
  let browserDraft = '';
  let setup: SetupView | undefined;
  let loginUrl = '';
  let authPending = false;
  const authResult = new URL(location.href).searchParams.get('ma_auth');
  if (authResult) {
    history.replaceState(null, '', location.pathname);
    try { localStorage.setItem('aoty.ma-auth-result', JSON.stringify({ result: authResult, at: Date.now() })); } catch { /* Returning to the original tab also refreshes its saved connection. */ }
    if (authResult === 'connected') notice = 'Music Assistant connected. Choose a speaker below.';
    else if (authResult === 'cancelled') notice = 'Sign-in cancelled. Your saved connection was kept.';
    else if (authResult === 'expired') notice = 'Sign-in expired. Try connecting again.';
    else error = 'Music Assistant sign-in could not finish. It may have expired, settings changed, or this browser blocked the return. Try Connect again or use advanced token setup.';
  }
  const addresses = new AddressingPanel(() => render(), revision => {
    if (settings && revision >= settings.revision && settings.tokenConfigured === addresses.view?.configured) settings = { ...settings, revision };
  }, () => busy, () => Boolean(settings?.settingsChangesBlocked));

  async function request(path: string, data?: unknown): Promise<IntegrationView> {
    try {
      const result = await requestJson<IntegrationView>(`/api/host/integrations${path}`, data, 60_000);
      online = true; return result;
    } catch (error) {
      if (error instanceof RequestError) { online = true; throw error; }
      online = false; throw new Error('Cannot reach the application. Check your connection and try again.');
    }
  }
  function apply(next: IntegrationView, updateDraft = false) {
    settings = next;
    if (!next.tokenConfigured || next.status === 'error') speakerError = '';
    if (updateDraft) { urlDraft = next.url ?? ''; browserDraft = next.browserUrl ?? ''; tokenDraft = ''; }
  }
  async function loadSetup(refresh = false) {
    const next = await requestJson<SetupView>(`/api/host/setup${refresh ? '/refresh' : ''}`, refresh ? {} : undefined, 120_000);
    let changed = JSON.stringify(setup) !== JSON.stringify(next); setup = next;
    if (!settings?.tokenConfigured && !urlDraft && setup.servers.length === 1) {
      urlDraft = setup.servers[0]!.url; browserDraft = setup.servers[0]!.browserUrl ?? ''; changed = true;
    }
    return changed;
  }
  function connectButton(text: string) {
    const button = el('button', text, settings?.tokenConfigured ? 'secondary' : ''); button.type = 'button'; button.disabled = busy || !online || !urlDraft.trim() || authPending || Boolean(settings?.settingsChangesBlocked);
    button.onclick = () => {
      const popup = window.open('about:blank', '_blank'); if (popup) popup.opener = null;
      void run(async () => {
        try {
          const result = await requestJson<{ loginUrl: string; expiresAt: number }>('/api/host/auth/start', { url: urlDraft.trim(),
            ...(browserDraft.trim() ? { browserUrl: browserDraft.trim() } : {}), revision: settings!.revision }, 30_000);
          loginUrl = result.loginUrl; authPending = true; authExpiresAt = result.expiresAt;
          if (popup) popup.location.replace(loginUrl);
          notice = popup ? 'Sign in in the opened tab, then return here.' : 'Your browser blocked the sign-in tab. Open the sign-in link below.';
        } catch (error) { popup?.close(); throw error; }
      });
    };
    return button;
  }
  async function discover() {
    if (!settings?.tokenConfigured) return;
    speakerError = '';
    try { apply(await request('/destinations')); }
    catch (cause) { speakerError = cause instanceof Error ? cause.message : 'Speakers could not be loaded.'; }
  }
  async function run(work: () => Promise<void>, scope: 'connection' | 'speaker' = 'connection') {
    if (busy) return;
    const revision = settings?.revision;
    busy = true; busyScope = scope; error = ''; notice = ''; if (scope === 'speaker') speakerError = ''; render();
    try { await work(); }
    catch (cause) {
      const message = cause instanceof Error ? cause.message : 'The settings request failed.';
      // Read back only. Never automatically retry a settings mutation.
      try { apply(await request('')); } catch { online = false; }
      if (!online) error = 'Cannot reach the application. Check your connection and try again.';
      else if (scope === 'speaker') { if (settings?.status !== 'error') speakerError = message; }
      else error = message;
    } finally { busy = false; render(); if (!addresses.view || settings?.revision !== revision) void addresses.load(!authPending); }
  }
  function action(text: string, work: () => Promise<void>, secondary = false, scope: 'connection' | 'speaker' = 'connection') {
    const b = el('button', text, secondary ? 'secondary' : ''); b.type = 'button';
    b.dataset.focusKey = text;
    b.disabled = busy || !online; b.onclick = () => { void run(work, scope); }; return b;
  }
  function field(text: string, id: string, type: string, value: string, change: (value: string) => void) {
    const { group, input } = fieldControl(text, id, type); input.value = value; input.disabled = busy;
    input.oninput = () => change(input.value); return { group, input };
  }
  function panel(id: string, title: string, state?: string) {
    const section = createPanel(`settings-card settings-${id}`); section.setAttribute('aria-labelledby', `settings-${id}-title`);
    const heading = sectionHeading(title, `settings-${id}-title`);
    if (state) { const badge = el('span', state, 'badge settings-state'); badge.setAttribute('role', 'status'); heading.append(badge); }
    section.append(heading); return section;
  }
  function render() {
    const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusId = focused?.id;
    const selection = focused instanceof HTMLInputElement && ['text', 'password', 'search'].includes(focused.type) ? [focused.selectionStart, focused.selectionEnd] as const : null;
    const scrollY = window.scrollY;
    const workspace = el('div', undefined, 'settings-workspace');
    workspace.append(pageHeading('Settings'));
    const failure = error;
    if (failure) { const message = uiNotice(failure, 'error'); message.classList.add('settings-notice'); workspace.append(message); }
    if (notice) { const message = uiNotice(notice, 'success'); message.classList.add('settings-notice'); workspace.append(message); }
    if (!online && error) { const retry = el('button', 'Retry connection', 'secondary'); retry.onclick = () => { void run(async () => { apply(await request(''), !settings); await loadSetup(); await discover(); }); }; workspace.append(retry); }
    const grid = workspaceGrid('sidebar', 'settings-grid');
    const state = busy && busyScope === 'connection' ? 'Working…' : !settings ? 'Loading…' : !settings.tokenConfigured ? 'Not connected' : settings.status === 'checked' ? 'Connected' : settings.status === 'error' ? 'Needs attention' : 'Not checked';
    const connection = panel('connection', '1. Music connection', state);
    if (settings?.tokenConfigured) {
      connection.append(el('p', settings.url ?? 'Music Assistant', 'saved-address'));
      if (settings.status === 'error') { const failure = el('p', settings.message, 'error'); failure.setAttribute('role', 'alert'); connection.append(failure); }
      else if (settings.status !== 'checked') connection.append(el('p', 'Connection saved. Checking Music Assistant…', 'muted small'));
      const change = action(editConnection ? 'Close connection settings' : 'Change connection', async () => { editConnection = !editConnection; }, true);
      change.disabled ||= Boolean(settings.settingsChangesBlocked); connection.append(change);
      const actions = actionGroup(); actions.classList.add('settings-connection-actions');
      actions.append(connectButton('Reconnect Music Assistant'));
      actions.append(action('Disconnect', async () => {
        if (!confirm('Disconnect Music Assistant and remove the saved token and destination? This does not revoke the token in Music Assistant.')) return;
        apply(await request('/clear', { revision: settings!.revision }), true); editConnection = false; authPending = false; loginUrl = '';
        notice = 'Music Assistant disconnected.';
      }, true));
      if (editConnection || settings.status === 'error') connection.append(actions);
      for (const control of actions.querySelectorAll('button')) control.disabled ||= Boolean(settings.settingsChangesBlocked);
      if (settings.tokenExpiresAt) connection.append(el('p', `Authorization expires ${new Date(settings.tokenExpiresAt).toLocaleDateString()}.`, 'muted small'));
    }
    if (settings && (!settings.tokenConfigured || editConnection)) {
      if (!settings.tokenConfigured) {
        if (!setup?.servers.length) connection.append(el('p', setup?.status === 'waiting' ? 'No server found. Enter its address below.' : 'Looking for Music Assistant…', 'muted small'));
        connection.append(action('Find Music Assistant', async () => { await loadSetup(true); apply(await request('')); }, true));
        if (setup?.servers.length) {
          const label = el('label', 'Detected Music Assistant server'); label.htmlFor = 'ma-detected';
          const select = el('select'); select.id = 'ma-detected'; select.disabled = busy;
          const manual = el('option', 'Enter another address'); manual.value = ''; select.append(manual);
          for (const server of setup.servers) {
            const option = el('option', `${server.name} · ${server.version}${server.ready ? '' : ' · sources/players setup pending'}${server.playbackCompatible ? '' : ' · playback schema not supported'}`);
            option.value = server.url; select.append(option);
          }
          select.value = setup.servers.some(s => s.url === urlDraft) ? urlDraft : '';
          select.onchange = () => { const server = setup?.servers.find(s => s.url === select.value); urlDraft = server?.url ?? ''; browserDraft = server?.browserUrl ?? ''; render(); };
          connection.append(label, select);
        }
      }
      const form = el('form', undefined, 'form-stack integration-form');
      const url = field('Music Assistant URL', 'ma-url', 'url', urlDraft, value => { urlDraft = value; browserDraft = ''; const b = document.getElementById('ma-connect') as HTMLButtonElement | null; if (b) b.disabled = !value.trim() || busy || !online || authPending || Boolean(settings?.settingsChangesBlocked); });
      url.input.required = true; url.input.maxLength = 2048; url.input.placeholder = 'http://homeassistant.local:8095';
      connection.append(url.group);
      if (!settings.tokenConfigured) { const connect = connectButton('Connect Music Assistant'); connect.id = 'ma-connect'; connection.append(connect); }
      const advanced = el('details', undefined, 'settings-advanced'); advanced.open = manualExpanded;
      advanced.append(el('summary', 'Advanced: token or separate login address'));
      advanced.ontoggle = () => { if (advanced.isConnected) manualExpanded = advanced.open; };
      const login = field('Browser login address', 'ma-browser-url', 'url', browserDraft, value => { browserDraft = value; });
      login.input.placeholder = 'Same as Music Assistant URL'; advanced.append(login.group);
      const token = field('Music Assistant access token', 'ma-token', 'password', tokenDraft, value => { tokenDraft = value; });
      token.input.autocomplete = 'off'; token.input.maxLength = 8192; token.input.placeholder = 'Paste a long-lived access token';
      token.input.setAttribute('spellcheck', 'false'); token.input.required = true;
      const tokenHelp = el('p', 'Create a token in Music Assistant → Settings → Profile.', 'muted field-hint'); tokenHelp.id = 'ma-token-help';
      token.input.setAttribute('aria-describedby', tokenHelp.id); token.group.append(tokenHelp);
      if (location.protocol !== 'https:') token.group.append(el('p', 'HTTP connection — use HTTPS before entering a real token on shared Wi-Fi.', 'settings-security-note'));
      const save = el('button', 'Save connection'); save.type = 'submit'; save.disabled = busy || !online || Boolean(settings.settingsChangesBlocked); save.id = 'ma-save';
      const controls = actionGroup('form'); controls.append(save);
      form.append(token.group, controls);
      form.onsubmit = event => {
        event.preventDefault(); const submittedUrl = urlDraft.trim(); const submittedToken = tokenDraft.trim();
        // Clear the secret immediately after submission; it is never persisted in browser storage.
        tokenDraft = '';
        void run(async () => {
          apply(await request('/save', { url: submittedUrl, accessToken: submittedToken, revision: settings!.revision }), true);
          await discover(); notice = 'Connection saved.';
        });
      }; advanced.append(form); connection.append(advanced);
      const help = el('details', undefined, 'settings-help'); help.open = helpExpanded;
      const summary = el('summary', 'Setup help'); summary.id = 'settings-help-toggle'; help.append(summary);
      help.addEventListener('toggle', () => { if (help.isConnected) helpExpanded = help.open; });
      help.append(el('p', 'Use the direct Music Assistant API address, not a Home Assistant dashboard link.', 'muted small'));
      help.append(el('p', 'Tokens are stored on the server, not in your browser. Connecting does not start audio.', 'muted small'));
      connection.append(help);
    }
    if (loginUrl) {
      const pending = el('p', 'Waiting for sign-in…', 'muted'); pending.setAttribute('role', 'status'); connection.append(pending);
      const login = el('a', 'Open Music Assistant sign-in', 'button secondary'); login.href = loginUrl; login.target = '_blank'; login.rel = 'noopener noreferrer'; connection.append(login);
      connection.append(action('Cancel sign-in', async () => { await requestJson('/api/host/auth/cancel', {}); authPending = false; loginUrl = ''; notice = 'Sign-in cancelled. Your saved connection was kept.'; }, true));
    }
    if (settings?.settingsChangesBlocked) { const blocked = el('p', undefined, 'muted small'); blocked.append('Finish the current song before changing setup. ', link('Return to host', '/host', 'inline-link')); connection.append(blocked); }
    grid.append(slot(connection, 'primary'));
    const output = slot(el('div', undefined, 'settings-output stack'), 'secondary');
    if (setup?.supervisor.enabled && (!setup.supervisor.available || setup.supervisor.guestOrigins.some(origin => origin !== addresses.view?.guestOrigin))) {
      const detected = panel('detected', 'Home Assistant setup', setup.supervisor.available ? 'Detected' : 'Unavailable');
      detected.append(el('p', setup.supervisor.message, 'muted small'));
      for (const origin of setup.supervisor.guestOrigins) if (origin !== addresses.view?.guestOrigin) detected.append(action(`Use ${origin} for guests`, async () => {
        if (!confirm(`Change the guest link from ${addresses.view?.guestOrigin}/join to ${origin}/join? Keep private recovery keys before switching browser addresses.`)) return;
        await requestJson('/api/host/addressing/guest', { origin, revision: settings!.revision }); notice = 'Guest address saved.';
      }, true));
      for (const control of detected.querySelectorAll('button')) control.disabled ||= Boolean(settings?.settingsChangesBlocked);
      output.append(detected);
    }
    const speakerState = busy && busyScope === 'speaker' ? 'Checking…' : !settings ? 'Loading…' : !settings.destination ? 'Not selected'
      : settings.destinationStatus === 'checked' ? 'Available' : settings.destinationStatus === 'error' ? 'Needs attention' : 'Not checked';
    const destination = panel('destination', '2. Speaker', speakerState);
    const savedSpeaker = settings?.destination; const report = settings?.report;
    if (savedSpeaker) destination.append(el('p', `Speaker: ${savedSpeaker.name}`, 'saved-destination'));
    const destinationLabel = el('label', 'Speaker or group'); destinationLabel.htmlFor = 'ma-destination';
    const select = el('select'); select.id = 'ma-destination';
    select.disabled = busy || !online || !settings?.tokenConfigured || settings.status === 'error' || !report?.players.some(player => player.available) || Boolean(settings.settingsChangesBlocked);
    const empty = el('option', 'Choose a speaker or group'); empty.value = ''; empty.disabled = true; select.append(empty);
    if (savedSpeaker && !report?.players.some(player => player.id === savedSpeaker.id)) {
      const saved = el('option', `${savedSpeaker.name} (${report ? 'unavailable' : 'not checked'})`);
      saved.value = savedSpeaker.id; saved.disabled = true; select.append(saved);
    }
    for (const player of report?.players ?? []) {
      const option = el('option', `${player.name}${player.available ? '' : ' (unavailable)'}`);
      option.value = player.id; option.disabled = !player.available; select.append(option);
    }
    select.value = pendingDestination || savedSpeaker?.id || '';
    select.onchange = () => {
      const id = select.value;
      if (busy || select.disabled || !id || id === settings?.destination?.id) return;
      const restoreFocus = document.activeElement === select;
      pendingDestination = id;
      void run(async () => {
        try { apply(await request('/destination', { id, revision: settings!.revision })); notice = 'Speaker selected.'; }
        finally { pendingDestination = ''; }
      }, 'speaker').then(() => {
        if (restoreFocus && main.isConnected && document.activeElement === document.body) main.querySelector<HTMLSelectElement>('#ma-destination')?.focus({ preventScroll: true });
      });
    };
    const speakerHelp = el('p', 'Selections apply automatically. Music starts only when Play is pressed.', 'muted field-hint'); speakerHelp.id = 'ma-destination-help';
    select.setAttribute('aria-describedby', speakerHelp.id);
    const group = el('div', undefined, 'field'); group.append(destinationLabel, select, speakerHelp); destination.append(group);
    if (report && !report.players.length) destination.append(el('p', 'No speakers found. Add one in Music Assistant, then try again.', 'muted small'));
    else if (!report && !savedSpeaker) {
      destination.append(el('div', !settings?.tokenConfigured || settings.status === 'error' ? 'Connect Music Assistant to choose a speaker.'
        : busy && busyScope === 'speaker' ? 'Discovering speakers…' : 'Speakers could not be loaded. Try again.', 'empty-state'));
    }
    const speakerFailure = speakerError || (settings?.destinationStatus === 'error' ? settings.destinationMessage : '');
    if (speakerFailure) { const failure = el('p', speakerFailure, 'error'); failure.setAttribute('role', 'alert'); destination.append(failure); }
    else if (settings?.destination && settings.destinationStatus === 'not-checked') destination.append(el('p', settings.destinationMessage, 'muted small'));
    if (settings?.tokenConfigured) destination.append(action('Find speakers again', discover, true, 'speaker'));
    if (settings?.settingsChangesBlocked) destination.append(el('p', 'Finish the current song before changing speakers.', 'muted small'));
    if (settings?.destination) destination.append(el('p', 'Pressing Play replaces the selected speaker’s queue and may interrupt other audio.', 'muted settings-safe-note'));
    output.append(destination);
    output.append(addresses.render());
    if (settings?.playbackIssue) {
      const playback = panel('recovery', 'Playback recovery');
      playback.append(el('p', 'The speaker may still be playing. Recovery stops only the song this app still controls; other audio is left alone. It does not start music or pass the turn.', 'warning'), action('Recover playback controls', async () => {
        if (!confirm('Recover playback controls? This stops the recording only if the app still owns that exact queue item. Externally replaced audio is left untouched. The turn will not advance.')) return;
        apply(await request('/recover', { revision: settings!.revision })); notice = 'Playback controls recovered. Select a track to start again.';
      }, true, 'speaker'));
      const details = el('details'); details.append(el('summary', 'Details'), el('p', settings.playbackIssue, 'muted small')); playback.append(details);
      output.append(playback);
    }
    grid.append(output); workspace.append(grid);
    main.replaceChildren(workspace);
    if (focused && !busy) {
      const replacement = focusId ? document.getElementById(focusId) : [...main.querySelectorAll<HTMLElement>('[data-focus-key]')].find(node => node.dataset.focusKey === focused.dataset.focusKey);
      if (replacement instanceof HTMLElement) {
        replacement.focus({ preventScroll: true }); if (selection && replacement instanceof HTMLInputElement) replacement.setSelectionRange(selection[0], selection[1]);
      }
    }
    window.scrollTo(0, scrollY);
  }
  render();
  try {
    apply(await request(''), true); render();
    await Promise.all([loadSetup().then(render), settings!.tokenConfigured ? run(discover, 'speaker') : addresses.load()]);
  }
  catch (cause) { error = cause instanceof Error ? cause.message : 'Cannot load integration settings.'; }
  render();
  let polls = 0;
  const poll = setInterval(() => {
    if (!main.isConnected || ++polls > 60 || setup?.status !== 'checking' && setup?.status !== 'idle') { clearInterval(poll); return; }
    if (!busy && !addresses.busy) void loadSetup().then(changed => { if (changed) render(); }).catch(() => {});
  }, 2000);
  window.addEventListener('pagehide', () => clearInterval(poll), { once: true });
  const authTimer = setInterval(() => {
    if (authPending && Date.now() >= authExpiresAt) { authPending = false; loginUrl = ''; notice = 'Sign-in expired. Try connecting again.'; render(); }
  }, 1000);
  window.addEventListener('pagehide', () => clearInterval(authTimer), { once: true });
  window.addEventListener('storage', event => {
    if (event.key !== 'aoty.ma-auth-result' || !authPending || !event.newValue) return;
    try {
      const result = JSON.parse(event.newValue);
      if (typeof result.at !== 'number' || Date.now() - result.at > 60_000) return;
      if (result.result === 'connected') void refreshSnapshot();
      else { authPending = false; loginUrl = ''; notice = result.result === 'cancelled' ? 'Sign-in cancelled. Your saved connection was kept.' : result.result === 'expired' ? 'Sign-in expired. Try connecting again.' : 'Sign-in could not finish. Try connecting again.'; render(); }
    } catch { /* Ignore unrelated/malformed browser storage. */ }
  });
  let refreshing = false;
  async function refreshSnapshot() {
    if (busy || refreshing || !navigator.onLine) return;
    refreshing = true; let changed = false; const wasOnline = online;
    try {
      const next = await request('');
      if (authPending && next.revision !== settings?.revision) { authPending = false; loginUrl = ''; apply(next, true); await discover(); notice = 'Music Assistant connected.'; changed = true; }
      else if (JSON.stringify(next) !== JSON.stringify(settings)) { apply(next); changed = true; }
    } catch { /* Keep the current form and explicit retry; a read cannot replay a mutation. */ }
    finally { refreshing = false; if (changed || wasOnline !== online) render(); }
  }
  window.addEventListener('focus', () => { void refreshSnapshot(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) void refreshSnapshot(); });
}
