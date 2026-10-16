import type { IntegrationView } from '../src/integrations';
import { el } from './dom';
import { AddressingPanel } from './addressing-panel';
import { requestJson, RequestError } from './request';
import type { SetupView } from '../src/setup';

/** Host-only setup. MA handles login; callback credentials are consumed by the backend. */
export async function mountSettings(container: HTMLElement, modeChanged: (mode: 'demo' | 'music-assistant') => void) {
  const main = el('main', undefined, 'host-page settings-page'); container.append(main);
  let settings: IntegrationView | undefined;
  let urlDraft = '';
  let tokenDraft = '';
  let destinationDraft = '';
  let busy = false;
  let online = false;
  let error = '';
  let notice = '';
  let helpExpanded = false;
  let manualExpanded = false;
  let editConnection = false;
  let browserDraft = '';
  let setup: SetupView | undefined;
  let loginUrl = '';
  let authPending = false;
  const authResult = new URL(location.href).searchParams.get('ma_auth');
  if (authResult) {
    history.replaceState(null, '', location.pathname);
    if (authResult === 'connected') notice = 'Music Assistant connected. You can close this tab after choosing a speaker.';
    else if (authResult === 'cancelled') error = 'Music Assistant sign-in was cancelled. Your saved connection was kept.';
    else error = 'Music Assistant sign-in could not finish. It may have expired, settings changed, or this browser blocked the return. Try Connect again or use advanced token setup.';
  }
  const addresses = new AddressingPanel(() => render(), revision => {
    if (settings && settings.tokenConfigured === addresses.view?.configured) settings = { ...settings, revision };
  }, () => busy);

  async function request(path: string, data?: unknown): Promise<IntegrationView> {
    try {
      const result = await requestJson<IntegrationView>(`/api/host/integrations${path}`, data, 60_000);
      online = true; return result;
    } catch (error) {
      if (error instanceof RequestError) { online = true; throw error; }
      online = false; throw new Error('Cannot reach the application. Reload settings when the connection returns.');
    }
  }
  function apply(next: IntegrationView, updateDraft = false) {
    settings = next;
    modeChanged(next.tokenConfigured ? 'music-assistant' : 'demo');
    if (updateDraft) { urlDraft = next.url ?? ''; browserDraft = next.browserUrl ?? ''; tokenDraft = ''; destinationDraft = next.destination?.id ?? ''; }
  }
  async function loadSetup(refresh = false) {
    setup = await requestJson<SetupView>(`/api/host/setup${refresh ? '/refresh' : ''}`, refresh ? {} : undefined, 120_000);
    if (!settings?.tokenConfigured && !urlDraft && setup.servers.length === 1) {
      urlDraft = setup.servers[0]!.url; browserDraft = setup.servers[0]!.browserUrl ?? '';
    }
  }
  function connectButton(text: string) {
    const button = el('button', text); button.type = 'button'; button.disabled = busy || addresses.busy || !online || !urlDraft.trim();
    button.onclick = () => {
      const popup = window.open('about:blank', '_blank'); if (popup) popup.opener = null;
      void run(async () => {
        try {
          const result = await requestJson<{ loginUrl: string }>('/api/host/auth/start', { url: urlDraft.trim(),
            ...(browserDraft.trim() ? { browserUrl: browserDraft.trim() } : {}), revision: settings!.revision }, 30_000);
          loginUrl = result.loginUrl; authPending = true;
          if (popup) popup.location.replace(loginUrl);
          notice = popup ? 'Complete Music Assistant sign-in in the opened tab. Return here to refresh your connection.' : 'Your browser blocked the sign-in tab. Open the sign-in link below.';
        } catch (error) { popup?.close(); throw error; }
      });
    };
    return button;
  }
  async function discover() {
    if (!settings?.tokenConfigured) return;
    apply(await request('/destinations'));
    if (settings!.status === 'error') error = settings!.message;
  }
  async function run(work: () => Promise<void>) {
    if (busy || addresses.busy) return;
    busy = true; error = ''; notice = ''; render();
    try { await work(); }
    catch (cause) {
      error = cause instanceof Error ? cause.message : 'The settings request failed.';
      // Read back only. Never automatically retry a settings mutation.
      try { apply(await request('')); } catch { online = false; }
    } finally { busy = false; await addresses.load(!authPending); render(); }
  }
  function action(text: string, work: () => Promise<void>, secondary = false, allowOffline = false) {
    const b = el('button', text, secondary ? 'secondary' : ''); b.type = 'button';
    b.dataset.focusKey = text;
    b.disabled = busy || addresses.busy || (!allowOffline && !online); b.onclick = () => { void run(work); }; return b;
  }
  function field(text: string, id: string, type: string, value: string, change: (value: string) => void) {
    const group = el('div', undefined, 'field'); const label = el('label', text); label.htmlFor = id;
    const input = el('input'); input.id = id; input.type = type; input.value = value; input.disabled = busy;
    input.disabled ||= addresses.busy;
    input.oninput = () => change(input.value); group.append(label, input); return { group, input };
  }
  function panel(id: string, title: string, state?: string) {
    const section = el('section', undefined, `panel settings-card settings-${id}`); section.setAttribute('aria-labelledby', `settings-${id}-title`);
    const heading = el('div', undefined, 'section-heading'); const text = el('div');
    const h2 = el('h2', title); h2.id = `settings-${id}-title`; text.append(h2); heading.append(text);
    if (state) { const badge = el('span', state, 'badge settings-state'); badge.setAttribute('role', 'status'); heading.append(badge); }
    section.append(heading); return section;
  }
  function render() {
    const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusId = focused?.id;
    const selection = focused instanceof HTMLInputElement && ['text', 'password', 'search'].includes(focused.type) ? [focused.selectionStart, focused.selectionEnd] as const : null;
    const scrollY = window.scrollY;
    const workspace = el('div', undefined, 'host-workspace settings-workspace');
    const heading = el('div', undefined, 'workspace-heading'); const title = el('div');
    title.append(el('h1', 'Connections & settings.'));
    const reload = action('Reload saved settings', async () => { authPending = false; loginUrl = ''; apply(await request(''), true); await loadSetup(); await discover(); }, true, true);
    heading.append(title, reload); workspace.append(heading);
    const failure = error || (settings?.status === 'error' ? settings.message : '');
    if (failure) { const message = el('div', failure, 'error settings-notice'); message.setAttribute('role', 'alert'); workspace.append(message); }
    if (notice) { const message = el('p', notice, 'success settings-notice'); message.setAttribute('role', 'status'); workspace.append(message); }
    const grid = el('div', undefined, 'settings-grid');
    const state = busy ? 'Working…' : !settings ? 'Loading…' : settings.tokenConfigured ? 'Configured' : 'Not configured';
    const connection = panel('connection', 'Music Assistant', state);
    if (settings?.tokenConfigured) {
      connection.append(el('p', 'Music Assistant is configured.', 'configured-connection'));
      connection.append(connectButton('Reconnect Music Assistant'));
      if (settings.tokenExpiresAt) connection.append(el('p', `Authorization expires ${new Date(settings.tokenExpiresAt).toLocaleDateString()}. Reconnect to renew it.`, 'muted small'));
      connection.append(action(editConnection ? 'Hide advanced connection' : 'Advanced connection', async () => { editConnection = !editConnection; manualExpanded = editConnection; }, true));
      connection.append(action('Disconnect', async () => {
        if (!confirm('Disconnect Music Assistant and remove the saved token and destination? This does not revoke the token in Music Assistant.')) return;
        apply(await request('/clear', { revision: settings!.revision }), true); editConnection = false; authPending = false; loginUrl = '';
        notice = 'Music Assistant disconnected. You can set up a new connection.';
      }, true));
    }
    if (settings && (!settings.tokenConfigured || editConnection)) {
      if (!settings.tokenConfigured) {
        connection.append(el('p', setup?.message ?? 'Looking for Music Assistant…', 'muted small'));
        connection.append(action('Find Music Assistant', async () => { await loadSetup(true); apply(await request('')); }, true));
        if (setup?.servers.length) {
          const label = el('label', 'Detected Music Assistant server'); label.htmlFor = 'ma-detected';
          const select = el('select'); select.id = 'ma-detected'; select.disabled = busy || addresses.busy;
          const manual = el('option', 'Enter another address'); manual.value = ''; select.append(manual);
          for (const server of setup.servers) {
            const option = el('option', `${server.name} · ${server.version}${server.ready ? '' : ' · finish MA setup'}${server.playbackCompatible ? '' : ' · playback schema not supported'}`);
            option.value = server.url; select.append(option);
          }
          select.value = setup.servers.some(s => s.url === urlDraft) ? urlDraft : '';
          select.onchange = () => { const server = setup?.servers.find(s => s.url === select.value); urlDraft = server?.url ?? ''; browserDraft = server?.browserUrl ?? ''; render(); };
          connection.append(label, select);
        }
      }
      const form = el('form', undefined, 'integration-form');
      const url = field('Music Assistant URL', 'ma-url', 'url', urlDraft, value => { urlDraft = value; browserDraft = ''; const b = document.getElementById('ma-connect') as HTMLButtonElement | null; if (b) b.disabled = !value.trim() || busy || addresses.busy || !online; });
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
      const save = el('button', 'Save connection'); save.type = 'submit'; save.disabled = busy || addresses.busy || !online; save.id = 'ma-save';
      const controls = el('div', undefined, 'actions settings-form-actions'); controls.append(save);
      form.append(token.group, controls);
      form.onsubmit = event => {
        event.preventDefault(); const submittedUrl = urlDraft.trim(); const submittedToken = tokenDraft.trim();
        // Clear the secret immediately after submission; it is never persisted in browser storage.
        tokenDraft = '';
        void run(async () => {
          apply(await request('/save', { url: submittedUrl, accessToken: submittedToken, revision: settings!.revision }), true);
          await discover(); notice = 'Connection saved. Speakers are discovered automatically.';
        });
      }; advanced.append(form); connection.append(advanced);
      connection.append(el('p', 'Saving a connection does not start audio.', 'muted settings-safe-note'));
      const help = el('details', undefined, 'settings-help'); help.open = helpExpanded;
      const summary = el('summary', 'Setup help'); summary.id = 'settings-help-toggle'; help.append(summary);
      help.addEventListener('toggle', () => { if (help.isConnected) helpExpanded = help.open; });
      help.append(el('p', 'Use the direct Music Assistant API address, not a Home Assistant dashboard link.', 'muted small'));
      help.append(el('p', 'Tokens stay on the server and cannot be displayed again. Home Assistant can host the app as an add-on; no separate Home Assistant account connection is needed.', 'muted small'));
      connection.append(help);
    }
    if (loginUrl) {
      const login = el('a', 'Open Music Assistant sign-in', 'button secondary'); login.href = loginUrl; login.target = '_blank'; login.rel = 'noopener noreferrer'; connection.append(login);
    }
    grid.append(connection);
    const output = el('div', undefined, 'settings-output');
    if (setup?.supervisor.enabled) {
      const detected = panel('detected', 'Home Assistant setup', setup.supervisor.available ? 'Detected' : 'Unavailable');
      detected.append(el('p', setup.supervisor.message, 'muted small'));
      if (setup.supervisor.versions.core) detected.append(el('p', `Core ${setup.supervisor.versions.core} · Supervisor ${setup.supervisor.versions.supervisor ?? 'unknown'}`, 'muted small'));
      for (const origin of setup.supervisor.guestOrigins) if (origin !== addresses.view?.guestOrigin) detected.append(action(`Use ${origin} for guests`, async () => {
        await requestJson('/api/host/addressing/guest', { origin, revision: settings!.revision }); notice = 'Guest address saved.';
      }, true));
      output.append(detected);
    }
    const destination = panel('destination', 'Speaker or group');
    if (settings?.destination) destination.append(el('p', `Saved destination: ${settings.destination.name}`, 'saved-destination'));
    if (settings?.report) {
      const report = settings.report;
      const destinationLabel = el('label', 'Playback destination'); destinationLabel.htmlFor = 'ma-destination';
      const select = el('select'); select.id = 'ma-destination'; select.disabled = busy || addresses.busy || !online;
      const empty = el('option', 'Choose a speaker or group'); empty.value = ''; select.append(empty);
      for (const player of report.players) {
        const option = el('option', `${player.name}${player.available ? '' : ' (unavailable)'}`);
        option.value = player.id; option.disabled = !player.available; select.append(option);
      }
      select.value = destinationDraft || settings.destination?.id || '';
      const choose = action('Save destination', async () => {
        if (!destinationDraft) throw new Error('Choose an available speaker or group first.');
        apply(await request('/destination', { id: destinationDraft, revision: settings!.revision })); notice = 'Destination saved without starting audio. Private preparations stay intact.';
      });
      choose.disabled ||= !select.value;
      select.onchange = () => { destinationDraft = select.value; choose.disabled = busy || addresses.busy || !online || !select.value; };
      const group = el('div', undefined, 'field'); group.append(destinationLabel, select, choose); destination.append(group);
      if (!report.players.length) destination.append(el('p', 'No destinations found. Configure Sonos in Music Assistant, then reload saved settings.', 'muted small'));
    } else {
      destination.append(el('div', settings?.tokenConfigured ? busy ? 'Discovering speakers…' : 'Speakers could not be loaded. Reload saved settings to retry.' : 'Save a connection to discover your speakers automatically.', 'empty-state'));
    }
    if (settings?.destination) destination.append(el('p', 'Music starts only when the current participant presses Play. Play replaces this destination’s queue and can interrupt existing audio.', 'muted settings-safe-note'));
    output.append(destination);
    output.append(addresses.render());
    if (settings?.playbackIssue) {
      const playback = panel('recovery', 'Playback recovery');
      playback.append(el('p', settings.playbackIssue, 'warning'), action('Recover playback controls', async () => {
        if (!confirm('Recover playback controls? This stops the recording only if the app still owns that exact queue item. Externally replaced audio is left untouched. The turn will not advance.')) return;
        apply(await request('/recover', { revision: settings!.revision })); notice = 'Playback controls recovered. Select a track to start again.';
      }, true));
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
  try { apply(await request(''), true); await loadSetup(); if (settings!.tokenConfigured) { render(); await run(discover); } else await addresses.load(); }
  catch (cause) { error = cause instanceof Error ? cause.message : 'Cannot load integration settings.'; }
  render();
  let polls = 0;
  const poll = setInterval(() => {
    if (!main.isConnected || ++polls > 60 || setup?.status !== 'checking' && setup?.status !== 'idle') { clearInterval(poll); return; }
    if (!busy && !addresses.busy) void loadSetup().then(() => render()).catch(() => {});
  }, 2000);
  window.addEventListener('pagehide', () => clearInterval(poll), { once: true });
  window.addEventListener('focus', () => {
    if (authPending && !busy && !addresses.busy) void run(async () => {
      const next = await request('');
      if (next.revision !== settings?.revision) { authPending = false; loginUrl = ''; apply(next, true); await discover(); notice = 'Saved connection refreshed.'; }
    });
  });
}
