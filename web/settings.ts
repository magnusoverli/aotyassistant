import type { IntegrationView } from '../src/integrations';
import { el, link } from './dom';
import { AddressingPanel } from './addressing-panel';
import { requestJson, RequestError } from './request';
import { appPath } from './paths';
import type { SetupView } from '../src/setup';
import { pageFrame, workspaceGrid, slot } from './page-layout';
import { panel as createPanel, fieldControl, pageHeading, sectionHeading, actionGroup, notice as uiNotice } from './ui-components';
import { ViewNodes, children, attr, prop, text, scheduledRender } from './view-nodes';

/** Host-only setup. MA handles login; callback credentials are consumed by the backend. */
export async function mountSettings(container: HTMLElement) {
  const main = pageFrame('workspace', 'settings-page'); container.append(main);
  const nodes = new ViewNodes();
  let settings: IntegrationView | undefined;
  let urlDraft = '';
  let tokenDraft = '';
  let pendingDestination = '';
  let refreshingSpeakers = false;
  let queuedSnapshot: IntegrationView | undefined;
  let live: EventSource | undefined;
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
  let authAttempt = '';
  const authResult = new URL(location.href).searchParams.get('ma_auth');
  if (authResult) {
    const attemptId = new URL(location.href).searchParams.get('ma_attempt');
    history.replaceState(null, '', location.pathname);
    try { localStorage.setItem('aoty.ma-auth-result', JSON.stringify({ result: authResult, attemptId, at: Date.now() })); } catch { /* The integration stream also confirms successful attempts. */ }
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
    if (settings?.instanceId === next.instanceId && settings && (next.revision < settings.revision || next.sequence !== undefined && settings.sequence !== undefined && next.sequence < settings.sequence)) return;
    if (authPending && next.authorization?.attemptId === authAttempt && next.authorization.revision <= next.revision) {
      authPending = false; loginUrl = ''; updateDraft = true; notice = 'Music Assistant connected.';
    }
    if (notice.endsWith(' is now the active speaker.') && (next.output.state !== 'ready' || next.output.name !== settings?.output.name)) notice = '';
    // Runtime relocation should refresh unchanged drafts while preserving an in-progress edit.
    if (settings && next.url !== settings.url && urlDraft === settings.url) {
      urlDraft = next.url ?? ''; if (browserDraft === (settings.browserUrl ?? '')) browserDraft = next.browserUrl ?? '';
    }
    settings = next;
    if (next.addressing) addresses.observe(next.addressing);
    if (!next.tokenConfigured || next.status === 'error') speakerError = '';
    if (updateDraft) { urlDraft = next.url ?? ''; browserDraft = next.browserUrl ?? ''; tokenDraft = ''; }
  }
  async function loadSetup(refresh = false) {
    const next = await requestJson<SetupView>(`/api/host/setup${refresh ? '/refresh' : ''}`, refresh ? {} : undefined, 120_000);
    return applySetup(next);
  }
  function applySetup(next: SetupView) {
    let changed = JSON.stringify(setup) !== JSON.stringify(next); setup = next;
    if (!settings?.tokenConfigured && !urlDraft && setup.servers.length === 1) {
      urlDraft = setup.servers[0]!.url; browserDraft = setup.servers[0]!.browserUrl ?? ''; changed = true;
    }
    return changed;
  }
  function connectButton(text: string) {
    const button = nodes.el(`connect-${text}`, 'button', text, settings?.tokenConfigured ? 'secondary' : ''); prop(button, 'type', 'button'); prop(button, 'disabled', busy || !online || !urlDraft.trim() || authPending || Boolean(settings?.settingsChangesBlocked));
    button.onclick = () => {
      const popup = window.open('about:blank', '_blank'); if (popup) popup.opener = null;
      void run(async () => {
        try {
          const result = await requestJson<{ loginUrl: string; expiresAt: number; attemptId: string }>('/api/host/auth/start', { url: urlDraft.trim(),
            ...(browserDraft.trim() ? { browserUrl: browserDraft.trim() } : {}), revision: settings!.revision }, 30_000);
          loginUrl = result.loginUrl; authPending = true; authExpiresAt = result.expiresAt; authAttempt = result.attemptId;
          if (popup) popup.location.replace(loginUrl);
          notice = popup ? 'Sign in in the opened tab, then return here.' : 'Your browser blocked the sign-in tab. Open the sign-in link below.';
        } catch (error) { popup?.close(); throw error; }
      });
    };
    return button;
  }
  async function discover() {
    if (!settings?.tokenConfigured) return;
    speakerError = ''; refreshingSpeakers = true; render();
    try { apply(await request('/destinations')); }
    catch (cause) { speakerError = cause instanceof Error ? cause.message : 'Speakers could not be loaded.'; }
    finally { refreshingSpeakers = false; render(); }
  }
  async function run(work: () => Promise<void>, scope: 'connection' | 'speaker' = 'connection') {
    if (busy) return;
    const focused = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
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
    } finally {
      busy = false; if (queuedSnapshot) { apply(queuedSnapshot); queuedSnapshot = undefined; } render();
      if (!addresses.view || settings?.revision !== revision || addresses.view.mediaCheck.status === 'unchecked') void addresses.load(!authPending);
      queueMicrotask(() => { if (focused?.isConnected && document.activeElement === document.body) focused.focus({ preventScroll: true }); });
    }
  }
  function action(text: string, work: () => Promise<void>, secondary = false, scope: 'connection' | 'speaker' = 'connection') {
    const key = text === 'Close connection settings' ? 'Change connection' : text;
    const b = nodes.el(`action-${key}`, 'button', text); prop(b, 'type', 'button');
    // Retain feature classes such as the refresh spinner's animation hook.
    b.classList.toggle('secondary', secondary); attr(b, 'data-focus-key', key);
    prop(b, 'disabled', busy || !online); b.onclick = () => { void run(work, scope); }; return b;
  }
  function field(text: string, id: string, type: string, value: string, change: (value: string) => void) {
    const { group, input } = nodes.get(`field-${id}`, () => fieldControl(text, id, type)); prop(input, 'value', value); prop(input, 'disabled', busy);
    input.oninput = () => change(input.value); return { group, input };
  }
  function panel(id: string, title: string, state?: string) {
    const section = nodes.get(`panel-${id}`, () => { const section = createPanel(`settings-card settings-${id}`); section.setAttribute('aria-labelledby', `settings-${id}-title`); section.append(sectionHeading(title, `settings-${id}-title`)); return section; });
    const heading = section.firstElementChild!;
    const badge = nodes.el(`badge-${id}`, 'span', state ?? '', 'badge settings-state'); attr(badge, 'role', 'status');
    children(heading, heading.firstElementChild!, state ? badge : undefined); return section;
  }
  const render = scheduledRender(renderNow);
  function renderNow() {
    const v = nodes;
    const workspace = v.el('workspace', 'div', undefined, 'settings-workspace');
    const workspaceNodes: Node[] = [v.get('heading', () => pageHeading('Settings'))];
    const failure = error;
    if (failure) { const message = v.get('error', () => { const node = uiNotice('', 'error'); node.classList.add('settings-notice'); return node; }); text(message, failure); workspaceNodes.push(message); }
    if (notice) { const message = v.get('notice', () => { const node = uiNotice('', 'success'); node.classList.add('settings-notice'); return node; }); text(message, notice); workspaceNodes.push(message); }
    if (!online && error) { const retry = v.el('retry', 'button', 'Retry connection', 'secondary'); retry.onclick = () => { void run(async () => { apply(await request(''), !settings); await loadSetup(); await discover(); }); }; workspaceNodes.push(retry); }
    const grid = v.get('grid', () => workspaceGrid('sidebar', 'settings-grid'));
    const state = busy && busyScope === 'connection' ? 'Working…' : !settings ? 'Loading…' : !settings.tokenConfigured ? 'Not connected' : settings.status === 'checked' ? 'Connected' : settings.status === 'error' ? 'Needs attention' : 'Not checked';
    const connection = panel('connection', '1. Music connection', state);
    const connectionNodes: Node[] = [connection.firstElementChild!];
    if (settings?.tokenConfigured) {
      connectionNodes.push(v.el('saved-address', 'p', settings.url ?? 'Music Assistant', 'saved-address'));
      if (settings.status === 'error') { const failure = v.el('connection-failure', 'p', settings.message, 'error'); attr(failure, 'role', 'alert'); connectionNodes.push(failure); }
      else if (settings.status !== 'checked') connectionNodes.push(v.el('checking-connection', 'p', 'Connection saved. Checking Music Assistant…', 'muted small'));
      const change = action(editConnection ? 'Close connection settings' : 'Change connection', async () => { editConnection = !editConnection; }, true);
      prop(change, 'disabled', change.disabled || Boolean(settings.settingsChangesBlocked)); connectionNodes.push(change);
      connectionNodes.push(action('Find Music Assistant', async () => { await loadSetup(true); apply(await request('')); }, true));
      const actions = v.get('connection-actions', () => { const node = actionGroup(); node.classList.add('settings-connection-actions'); return node; });
      children(actions, connectButton('Reconnect Music Assistant'), action('Disconnect', async () => {
        if (!confirm('Disconnect Music Assistant and remove the saved token and destination? This does not revoke the token in Music Assistant.')) return;
        apply(await request('/clear', { revision: settings!.revision }), true); editConnection = false; authPending = false; loginUrl = '';
        notice = 'Music Assistant disconnected.';
      }, true));
      if (editConnection || settings.status === 'error') connectionNodes.push(actions);
      for (const control of actions.querySelectorAll('button')) prop(control, 'disabled', control.disabled || Boolean(settings.settingsChangesBlocked));
      if (settings.tokenExpiresAt) connectionNodes.push(v.el('expiry', 'p', `Authorization expires ${new Date(settings.tokenExpiresAt).toLocaleDateString()}.`, 'muted small'));
    }
    if (settings && (!settings.tokenConfigured || editConnection)) {
      const setupFields = v.el('setup-fields', 'div', undefined, 'form-stack connection-fields'); const setupNodes: Node[] = [];
      if (!settings.tokenConfigured) {
        if (!setup?.servers.length) setupNodes.push(v.el('finding-server', 'p', setup?.status === 'waiting' ? 'No server found. Enter its address below.' : 'Looking for Music Assistant…', 'muted small'));
        setupNodes.push(action('Find Music Assistant', async () => { await loadSetup(true); apply(await request('')); }, true));
      }
      if (setup?.servers.length) {
        const label = v.el('detected-label', 'label', 'Detected Music Assistant server'); prop(label, 'htmlFor', 'ma-detected');
        const select = v.el('detected-select', 'select'); prop(select, 'id', 'ma-detected'); prop(select, 'disabled', busy);
        const manual = v.el('manual-server', 'option', 'Enter another address'); prop(manual, 'value', ''); const serverOptions = [manual];
        for (const server of setup.servers) {
          const option = v.el(`server-${server.url}`, 'option', `${server.name} · ${server.version}${server.ready ? '' : ' · sources/players setup pending'}${server.playbackCompatible ? '' : ' · playback schema not supported'}`);
          prop(option, 'value', server.url); serverOptions.push(option);
        }
        children(select, ...serverOptions); v.retain('server-', setup.servers.map(server => `server-${server.url}`)); prop(select, 'value', setup.servers.some(s => s.url === urlDraft) ? urlDraft : '');
        select.onchange = () => { const server = setup?.servers.find(s => s.url === select.value); urlDraft = server?.url ?? ''; browserDraft = server?.browserUrl ?? ''; render(); };
        const detected = v.el('detected-field', 'div', undefined, 'field'); children(detected, label, select); setupNodes.push(detected);
      }
      const form = v.el('connection-form', 'form', undefined, 'form-stack integration-form');
      const url = field('Music Assistant URL', 'ma-url', 'url', urlDraft, value => { urlDraft = value; browserDraft = ''; const b = document.getElementById('ma-connect') as HTMLButtonElement | null; if (b) b.disabled = !value.trim() || busy || !online || authPending || Boolean(settings?.settingsChangesBlocked); });
      prop(url.input, 'required', true); prop(url.input, 'maxLength', 2048); prop(url.input, 'placeholder', 'http://homeassistant.local:8095');
      setupNodes.push(url.group);
      if (!settings.tokenConfigured) { const connect = connectButton('Connect Music Assistant'); prop(connect, 'id', 'ma-connect'); setupNodes.push(connect); }
      children(setupFields, ...setupNodes); connectionNodes.push(setupFields);
      const advanced = v.el('advanced', 'details', undefined, 'settings-advanced'); prop(advanced, 'open', manualExpanded);
      advanced.ontoggle = () => { if (advanced.isConnected) manualExpanded = advanced.open; };
      const login = field('Browser login address', 'ma-browser-url', 'url', browserDraft, value => { browserDraft = value; });
      prop(login.input, 'placeholder', 'Same as Music Assistant URL');
      const token = field('Music Assistant access token', 'ma-token', 'password', tokenDraft, value => { tokenDraft = value; });
      prop(token.input, 'autocomplete', 'off'); prop(token.input, 'maxLength', 8192); prop(token.input, 'placeholder', 'Paste a long-lived access token');
      attr(token.input, 'spellcheck', 'false'); prop(token.input, 'required', true);
      const tokenHelp = v.el('token-help', 'p', 'Create a token in Music Assistant → Settings → Profile.', 'muted field-hint'); prop(tokenHelp, 'id', 'ma-token-help');
      attr(token.input, 'aria-describedby', tokenHelp.id);
      children(token.group, token.group.firstElementChild!, token.input, tokenHelp, location.protocol !== 'https:' && v.el('token-security', 'p', 'HTTP connection — use HTTPS before entering a real token on shared Wi-Fi.', 'settings-security-note'));
      const save = v.el('save', 'button', 'Save connection'); prop(save, 'type', 'submit'); prop(save, 'disabled', busy || !online || Boolean(settings.settingsChangesBlocked)); prop(save, 'id', 'ma-save');
      const controls = v.get('save-actions', () => actionGroup('form')); children(controls, save);
      children(form, token.group, controls);
      form.onsubmit = event => {
        event.preventDefault(); const submittedUrl = urlDraft.trim(); const submittedToken = tokenDraft.trim();
        // Clear the secret immediately after submission; it is never persisted in browser storage.
        tokenDraft = ''; token.input.value = '';
        void run(async () => {
          apply(await request('/save', { url: submittedUrl, accessToken: submittedToken, revision: settings!.revision }), true);
          await discover(); notice = 'Connection saved.';
        });
      }; children(advanced, v.el('advanced-summary', 'summary', 'Advanced: token or separate login address'), login.group, form); connectionNodes.push(advanced);
      const help = v.el('help', 'details', undefined, 'settings-help'); prop(help, 'open', helpExpanded);
      const summary = v.el('help-summary', 'summary', 'Setup help'); prop(summary, 'id', 'settings-help-toggle');
      help.ontoggle = () => { if (help.isConnected) helpExpanded = help.open; };
      children(help, summary, v.el('help-address', 'p', 'Use the direct Music Assistant API address, not a Home Assistant dashboard link.', 'muted small'),
        v.el('help-token', 'p', 'Tokens are stored on the server, not in your browser. Connecting does not start audio.', 'muted small'));
      connectionNodes.push(help);
    }
    if (loginUrl) {
      const pending = v.el('auth-pending', 'p', 'Waiting for sign-in…', 'muted'); attr(pending, 'role', 'status'); connectionNodes.push(pending);
      const login = v.el('auth-link', 'a', 'Open Music Assistant sign-in', 'button secondary'); attr(login, 'href', loginUrl); prop(login, 'target', '_blank'); prop(login, 'rel', 'noopener noreferrer'); connectionNodes.push(login);
      connectionNodes.push(action('Cancel sign-in', async () => { await requestJson('/api/host/auth/cancel', {}); authPending = false; loginUrl = ''; notice = 'Sign-in cancelled. Your saved connection was kept.'; }, true));
    }
    if (settings?.settingsChangesBlocked) connectionNodes.push(v.get('connection-blocked', () => { const node = el('p', undefined, 'muted small'); node.append('Finish the current song before changing setup. ', link('Return to host', '/host', 'inline-link')); return node; }));
    if (settings?.compatibility && !settings.compatibility.supported) connectionNodes.push(v.el('compatibility', 'p', settings.compatibility.message, 'warning small'));
    children(connection, ...connectionNodes);
    const output = v.get('output', () => slot(el('div', undefined, 'settings-output stack'), 'secondary')); const outputNodes: Node[] = [];
    if (setup?.supervisor.enabled && (!setup.supervisor.available || setup.supervisor.guestOrigins.some(origin => origin !== addresses.view?.guestOrigin))) {
      const detected = panel('detected', 'Home Assistant setup', setup.supervisor.available ? 'Detected' : 'Unavailable');
      const detectedNodes: Node[] = [detected.firstElementChild!, v.el('supervisor-message', 'p', setup.supervisor.message, 'muted small')];
      for (const origin of setup.supervisor.guestOrigins) if (origin !== addresses.view?.guestOrigin) detectedNodes.push(action(`Use ${origin} for guests`, async () => {
        if (!confirm(`Change the guest link from ${addresses.view?.guestOrigin}/join to ${origin}/join? Keep private recovery keys before switching browser addresses.`)) return;
        await requestJson('/api/host/addressing/guest', { origin, revision: settings!.revision }); notice = 'Guest address saved.';
      }, true));
      children(detected, ...detectedNodes);
      for (const control of detected.querySelectorAll('button')) prop(control, 'disabled', control.disabled || Boolean(settings?.settingsChangesBlocked));
      outputNodes.push(detected);
    }
    const activeOutput = settings?.output;
    const speakerState = pendingDestination ? 'Selecting…' : busy && busyScope === 'speaker' ? 'Checking…' : !settings ? 'Loading…' : !online ? 'Connection lost'
      : activeOutput?.state === 'ready' ? 'Ready' : activeOutput?.state === 'checking' ? 'Checking…' : activeOutput?.state === 'recovery' ? 'Recovery needed'
      : activeOutput?.state === 'unconfirmed' ? 'Unconfirmed' : activeOutput?.state === 'incompatible' ? 'Playback unsupported' : 'No active speaker';
    const destination = panel('destination', '2. Active speaker', speakerState);
    const destinationNodes: Node[] = [destination.firstElementChild!];
    const report = online && settings?.status === 'checked' ? settings.report : null;
    const availableSpeakers = report?.players.filter(player => player.available) ?? [];
    if (pendingDestination) destinationNodes.push(v.el('speaker-description', 'p', `Selecting ${availableSpeakers.find(player => player.id === pendingDestination)?.name ?? 'speaker'}…`, 'muted small'));
    else if (online && activeOutput?.state === 'ready') destinationNodes.push(v.el('speaker-description', 'p', `Active speaker: ${activeOutput.name}`, 'active-destination'));
    else if (activeOutput?.state === 'incompatible') destinationNodes.push(v.el('speaker-description', 'p', `Selected speaker: ${activeOutput.name}. Playback needs a compatible Music Assistant API.`, 'muted small'));
    else if (activeOutput?.state === 'unavailable' && activeOutput.name) destinationNodes.push(v.el('speaker-description', 'p', `${activeOutput.name} is unavailable. Choose another speaker or wait for it to reconnect.`, 'muted small'));
    else if (activeOutput?.state === 'checking' && activeOutput.name) destinationNodes.push(v.el('speaker-description', 'p', `Checking ${activeOutput.name}…`, 'muted small'));
    const destinationLabel = v.el('speaker-label', 'label', 'Speaker or group'); prop(destinationLabel, 'htmlFor', 'ma-destination');
    const select = v.el('speaker-select', 'select'); prop(select, 'id', 'ma-destination');
    prop(select, 'disabled', busy || !online || !settings?.tokenConfigured || settings.status === 'error' || !availableSpeakers.length || Boolean(settings.settingsChangesBlocked));
    const placeholder = !settings ? 'Loading speakers…' : !settings.tokenConfigured || settings.status === 'error' ? 'Connect Music Assistant first'
      : !report ? busy && busyScope === 'speaker' ? 'Discovering speakers…' : 'Speakers not checked'
      : availableSpeakers.length ? 'Choose a speaker or group' : 'No available speakers or groups';
    const empty = v.el('speaker-placeholder', 'option', placeholder); prop(empty, 'value', ''); prop(empty, 'disabled', true); const speakerOptions = [empty];
    // The saved routing preference is not evidence that a speaker is currently selectable.
    for (const player of availableSpeakers) {
      const option = v.el(`speaker-option-${player.id}`, 'option', player.name); prop(option, 'value', player.id); speakerOptions.push(option);
    }
    const selectedId = pendingDestination || (activeOutput?.state === 'ready' || activeOutput?.state === 'recovery' || activeOutput?.state === 'incompatible' ? settings?.destination?.id : undefined);
    children(select, ...speakerOptions); v.retain('speaker-option-', availableSpeakers.map(player => `speaker-option-${player.id}`)); prop(select, 'value', availableSpeakers.find(player => player.id === selectedId)?.id ?? '');
    select.onchange = () => {
      const id = select.value;
      if (busy || select.disabled || !id || id === settings?.destination?.id && settings.output.state === 'ready') return;
      const restoreFocus = document.activeElement === select;
      pendingDestination = id;
      void run(async () => {
        try {
          apply(await request('/destination', { id, revision: settings!.revision }));
          notice = settings?.output.state === 'ready' ? `${settings.output.name} is now the active speaker.` : 'Speaker selected. Playback is not ready; check its status below.';
        }
        finally { pendingDestination = ''; }
      }, 'speaker').then(() => {
        if (restoreFocus && main.isConnected && document.activeElement === document.body) main.querySelector<HTMLSelectElement>('#ma-destination')?.focus({ preventScroll: true });
      });
    };
    const speakerHelp = v.el('speaker-help', 'p', 'Music plays here when you press Play. Speaker availability updates automatically.', 'muted field-hint'); prop(speakerHelp, 'id', 'ma-destination-help');
    attr(select, 'aria-describedby', speakerHelp.id);
    const group = v.el('speaker-field', 'div', undefined, 'field'); children(group, destinationLabel, select, speakerHelp); destinationNodes.push(group);
    if (report && !availableSpeakers.length) destinationNodes.push(v.el('empty-speakers', 'p', report.players.length
      ? 'No speakers are currently available. Turn one on or check Music Assistant; available speakers will appear here.'
      : 'No speakers found. Add or enable one in Music Assistant; available speakers will appear here.', 'muted small'));
    else if (!report && !settings?.destination) {
      destinationNodes.push(v.el('speaker-loading', 'div', !settings?.tokenConfigured || settings.status === 'error' ? 'Connect Music Assistant to choose a speaker.'
        : busy && busyScope === 'speaker' ? 'Discovering speakers…' : 'Speakers could not be loaded. Try again.', 'empty-state'));
    }
    const speakerFailure = speakerError || (settings?.destinationStatus === 'error' ? settings.destinationMessage : '');
    if (speakerFailure) { const failure = v.el('speaker-error', 'p', speakerFailure, 'error'); attr(failure, 'role', 'alert'); destinationNodes.push(failure); }
    else if (activeOutput?.state === 'unconfirmed') destinationNodes.push(v.el('speaker-unconfirmed', 'p', 'Speaker status will update when Music Assistant reconnects.', 'muted small'));
    if (settings?.tokenConfigured) {
      const refresh = action('Refresh speakers', discover, true, 'speaker');
      if (!refresh.classList.contains('speaker-refresh')) refresh.classList.add('speaker-refresh'); attr(refresh, 'aria-busy', String(refreshingSpeakers));
      destinationNodes.push(refresh);
    }
    if (settings?.settingsChangesBlocked) destinationNodes.push(v.el('speaker-blocked', 'p', 'Finish the current song before changing speakers.', 'muted small'));
    if (settings?.destination) destinationNodes.push(v.el('speaker-safe-note', 'p', 'Pressing Play replaces the selected speaker’s queue and may interrupt other audio.', 'muted settings-safe-note'));
    children(destination, ...destinationNodes); outputNodes.push(destination, addresses.render());
    if (settings?.playbackIssue) {
      const playback = panel('recovery', 'Playback recovery');
      const recovery = action('Recover playback controls', async () => {
        if (!confirm('Recover playback controls? This stops the recording only if the app still owns that exact queue item. Externally replaced audio is left untouched. The turn will not advance.')) return;
        apply(await request('/recover', { revision: settings!.revision })); notice = 'Playback controls recovered. Select a track to start again.';
      }, true, 'speaker');
      const details = v.el('recovery-details', 'details'); children(details, v.el('recovery-summary', 'summary', 'Details'), v.el('recovery-issue', 'p', settings.playbackIssue, 'muted small'));
      children(playback, playback.firstElementChild!, v.el('recovery-note', 'p', 'The speaker may still be playing. Recovery stops only the song this app still controls; other audio is left alone. It does not start music or pass the turn.', 'warning'), recovery, details);
      outputNodes.push(playback);
    }
    children(output, ...outputNodes); children(grid, slot(connection, 'primary'), output); workspaceNodes.push(grid);
    children(workspace, ...workspaceNodes); children(main, workspace);
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
      if (result.attemptId !== authAttempt || typeof result.at !== 'number' || Date.now() - result.at > 60_000) return;
      if (result.result === 'connected') void refreshSnapshot();
      else { authPending = false; loginUrl = ''; notice = result.result === 'cancelled' ? 'Sign-in cancelled. Your saved connection was kept.' : result.result === 'expired' ? 'Sign-in expired. Try connecting again.' : 'Sign-in could not finish. Try connecting again.'; render(); }
    } catch { /* Ignore unrelated/malformed browser storage. */ }
  });
  let refreshing = false;
  async function refreshSnapshot(discoverSpeakers = true) {
    if (busy || refreshing) return;
    refreshing = true; let changed = false; const wasOnline = online;
    try {
      const next = await request(discoverSpeakers && settings?.tokenConfigured ? '/destinations' : '');
      if (busy) { queuedSnapshot = next; return; }
      const before = visibleSnapshot(); apply(next); changed = before !== visibleSnapshot();
    } catch { /* Keep the current form and explicit retry; a read cannot replay a mutation. */ }
    finally { refreshing = false; if (changed || wasOnline !== online) render(); }
  }
  window.addEventListener('focus', () => { void refreshSnapshot(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) void refreshSnapshot(); });
  function visibleSnapshot() {
    return JSON.stringify(settings && { ...settings, sequence: undefined, instanceId: undefined, output: { ...settings.output, checkedAt: undefined },
      report: settings.report && { ...settings.report, checkedAt: undefined } });
  }
  function acceptLive(next: IntegrationView) {
    const wasOnline = online; online = true;
    if (busy) { queuedSnapshot = next; return; }
    const before = visibleSnapshot(); apply(next);
    if (!wasOnline || before !== visibleSnapshot()) render();
  }
  function connectLive() {
    live?.close(); live = new EventSource(appPath('/api/host/integrations/events'));
    live.addEventListener('state', event => {
      if (!main.isConnected) { live?.close(); return; }
      acceptLive(JSON.parse((event as MessageEvent).data) as IntegrationView);
    });
    live.addEventListener('setup', event => { if (applySetup(JSON.parse((event as MessageEvent).data) as SetupView)) render(); });
    live.onerror = () => { online = false; if (!busy) render(); void refreshSnapshot(false); };
  }
  connectLive();
  window.addEventListener('offline', () => { online = false; render(); });
  window.addEventListener('online', () => { void refreshSnapshot(); });
  window.addEventListener('pagehide', () => live?.close());
  window.addEventListener('pageshow', event => { if (event.persisted) { connectLive(); void refreshSnapshot(); } });
}
