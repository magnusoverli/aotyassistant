import type { IntegrationView } from '../src/integrations';
import { el, link } from './dom';
import { AddressingPanel } from './addressing-panel';
import { requestJson, RequestError } from './request';
import { appPath } from './paths';
import type { SetupView } from '../src/setup';
import { pageFrame } from './page-layout';
import { panel as createPanel, fieldControl, pageHeading, sectionHeading, actionGroup, notice as uiNotice } from './ui-components';
import { ViewNodes, children, attr, prop, text, scheduledRender } from './view-nodes';
import { SpeakerFreshness } from './speaker-freshness';
import { PlaybackSettingsPanel } from './playback-settings';
import { UserSettingsPanel } from './user-pin';
import { SettingsSections, type SettingsSection } from './settings-sections';

/** Host-only setup. MA handles login; callback credentials are consumed by the backend. */
export async function mountSettings(container: HTMLElement, signal: AbortSignal) {
  const main = pageFrame('workspace', 'settings-page'); container.append(main);
  const nodes = new ViewNodes();
  const sections = new SettingsSections(signal);
  const playbackSettings = new PlaybackSettingsPanel(signal);
  void playbackSettings.load();
  const userPins = new UserSettingsPanel(signal); void userPins.load();
  let settings: IntegrationView | undefined;
  let urlDraft = '';
  let tokenDraft = '';
  let pendingDestination = '';
  let refreshingSpeakers = false;
  let refreshing = false;
  const speakerFreshness = new SpeakerFreshness();
  let freshnessTimer: ReturnType<typeof setTimeout> | undefined;
  let queuedSnapshot: IntegrationView | undefined;
  let live: EventSource | undefined;
  signal.addEventListener('abort', () => { live?.close(); clearTimeout(freshnessTimer); }, { once: true });
  let busy = false;
  let busyScope: 'connection' | 'speaker' | 'access' = 'connection';
  let feedbackSection: SettingsSection = 'music-assistant';
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
    history.replaceState(null, '', location.pathname + location.hash);
    try { localStorage.setItem('aoty.ma-auth-result', JSON.stringify({ result: authResult, attemptId, at: Date.now() })); } catch { /* The integration stream also confirms successful attempts. */ }
    if (authResult === 'connected') notice = 'Music Assistant connected. Open Playback to choose a speaker.';
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
      speakerFreshness.receive(result);
      online = true; return result;
    } catch (error) {
      if (error instanceof RequestError) { online = true; throw error; }
      online = false; throw new Error('Cannot reach the application. Check your connection and try again.');
    }
  }
  function apply(next: IntegrationView, updateDraft = false) {
    if (signal.aborted) return;
    if (settings?.instanceId === next.instanceId && settings && (next.revision < settings.revision || next.sequence !== undefined && settings.sequence !== undefined && next.sequence < settings.sequence)) return;
    if (authPending && next.authorization?.attemptId === authAttempt && next.authorization.revision <= next.revision) {
      authPending = false; loginUrl = ''; updateDraft = true; feedbackSection = 'music-assistant'; notice = 'Music Assistant connected.';
    }
    if (notice.endsWith(' is now the active speaker.') && (next.output.state !== 'ready' || next.output.name !== settings?.output.name)) notice = '';
    // Runtime relocation should refresh unchanged drafts while preserving an in-progress edit.
    if (settings && next.url !== settings.url && urlDraft === settings.url) {
      urlDraft = next.url ?? ''; if (browserDraft === (settings.browserUrl ?? '')) browserDraft = next.browserUrl ?? '';
    }
    settings = next;
    sections.initialize(next.tokenConfigured, Boolean(authResult));
    speakerFreshness.accept(next); scheduleSpeakerExpiry();
    if (next.addressing) addresses.observe(next.addressing);
    if (!next.tokenConfigured || next.status === 'error') speakerError = '';
    if (updateDraft) { urlDraft = next.url ?? ''; browserDraft = next.browserUrl ?? ''; tokenDraft = ''; }
  }
  function queueSnapshot(next: IntegrationView) {
    if (queuedSnapshot?.instanceId === next.instanceId && queuedSnapshot && (next.revision < queuedSnapshot.revision ||
      next.sequence !== undefined && queuedSnapshot.sequence !== undefined && next.sequence < queuedSnapshot.sequence)) return;
    queuedSnapshot = next;
  }
  function scheduleSpeakerExpiry() {
    clearTimeout(freshnessTimer);
    if (signal.aborted) return;
    const remaining = speakerFreshness.remaining(settings?.output.state === 'ready' && speakerFreshness.ready);
    if (remaining === undefined) return;
    freshnessTimer = setTimeout(() => { render(); scheduleSpeakerExpiry(); void refreshSnapshot(); }, Math.ceil(remaining) + 1);
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
  async function run(work: () => Promise<void>, scope: 'connection' | 'speaker' | 'access' = 'connection') {
    if (busy) return;
    const focused = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    const revision = settings?.revision;
    busy = true; busyScope = scope; feedbackSection = scope === 'speaker' ? 'playback' : scope === 'access' ? 'access' : 'music-assistant';
    error = ''; notice = ''; if (scope === 'speaker') speakerError = ''; render();
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
  function action(text: string, work: () => Promise<void>, secondary = false, scope: 'connection' | 'speaker' | 'access' = 'connection') {
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
    const section = nodes.get(`panel-${id}`, () => { const section = createPanel(`settings-card settings-${id}`); section.setAttribute('aria-labelledby', `settings-${id}-title`); section.append(sectionHeading(title, `settings-${id}-title`, 'h3')); return section; });
    const heading = section.firstElementChild!;
    const badge = nodes.el(`badge-${id}`, 'span', state ?? '', 'badge settings-state'); attr(badge, 'role', 'status');
    children(heading, heading.firstElementChild!, state ? badge : undefined); return section;
  }
  const render = scheduledRender(renderNow);
  function renderNow() {
    if (signal.aborted) return;
    const v = nodes;
    const workspace = v.el('workspace', 'div', undefined, 'settings-workspace');
    const workspaceNodes: Node[] = [v.get('heading', () => pageHeading('Settings', link('Back to host desk', '/host', 'button secondary')))];
    const feedback: Node[] = [];
    const failure = error;
    if (failure) { const message = v.get('error', () => { const node = uiNotice('', 'error'); node.classList.add('settings-notice'); return node; }); text(message, failure); (online && settings ? feedback : workspaceNodes).push(message); }
    if (notice) { const message = v.get('notice', () => { const node = uiNotice('', 'success'); node.classList.add('settings-notice'); return node; }); text(message, notice); feedback.push(message); }
    if ((!online || !settings) && error) { const retry = v.el('retry', 'button', 'Retry connection', 'secondary'); retry.onclick = () => { void run(async () => { apply(await request(''), !settings); await loadSetup(); await discover(); }); }; workspaceNodes.push(retry); }
    const state = busy && busyScope === 'connection' ? 'Working…' : !settings ? 'Loading…' : !settings.tokenConfigured ? 'Not connected' : settings.status === 'checked' ? 'Connected' : settings.status === 'error' ? 'Needs attention' : 'Not checked';
    const connection = panel('connection', 'Music connection', state);
    const connectionNodes: Node[] = [connection.firstElementChild!];
    if (settings?.tokenConfigured) {
      connectionNodes.push(v.el('saved-address', 'p', settings.url ?? 'Music Assistant', 'saved-address'));
      if (settings.status === 'error') { const failure = v.el('connection-failure', 'p', settings.message, 'error'); attr(failure, 'role', 'alert'); connectionNodes.push(failure); }
      else if (settings.status !== 'checked') connectionNodes.push(v.el('checking-connection', 'p', 'Connection saved. Checking Music Assistant…', 'muted small'));
      const change = action(editConnection ? 'Close connection settings' : 'Change connection', async () => { editConnection = !editConnection; }, true);
      prop(change, 'disabled', change.disabled || Boolean(settings.settingsChangesBlocked)); connectionNodes.push(change);
      if (editConnection) connectionNodes.push(action('Find Music Assistant', async () => { await loadSetup(true); apply(await request('')); }, true));
      const actions = v.get('connection-actions', () => { const node = actionGroup(); node.classList.add('settings-connection-actions'); return node; });
      children(actions, connectButton('Reconnect Music Assistant'), action('Disconnect', async () => {
        if (!confirm('Disconnect Music Assistant and remove the saved token and destination? This does not revoke the token in Music Assistant.')) return;
        apply(await request('/clear', { revision: settings!.revision }), true); editConnection = false; authPending = false; loginUrl = '';
        notice = 'Music Assistant disconnected.';
      }, true));
      actions.querySelectorAll('button').forEach(button => { if (button.textContent === 'Disconnect') button.classList.add('danger'); });
      if (editConnection || settings.status === 'error') connectionNodes.push(actions);
      for (const control of actions.querySelectorAll('button')) prop(control, 'disabled', control.disabled || Boolean(settings.settingsChangesBlocked));
      if (settings.tokenExpiresAt) connectionNodes.push(v.el('expiry', 'p', `Authorization expires ${new Date(settings.tokenExpiresAt).toLocaleDateString()}.`, 'muted small'));
      if (!settings.destination && settings.status === 'checked') {
        const next = v.el('choose-speaker', 'button', 'Choose a speaker'); prop(next, 'type', 'button'); next.onclick = () => sections.show('playback'); connectionNodes.push(next);
      }
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
      children(token.group, token.group.firstElementChild!, token.input, tokenHelp, location.protocol !== 'https:' && v.el('token-security', 'p', 'This connection uses HTTP. Use HTTPS to protect the access token on shared Wi-Fi.', 'settings-security-note'));
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
    const accessNodes: Node[] = [];
    if (setup?.supervisor.enabled && (!setup.supervisor.available || setup.supervisor.guestOrigins.some(origin => origin !== addresses.view?.guestOrigin))) {
      const detected = panel('detected', 'Home Assistant setup', setup.supervisor.available ? 'Detected' : 'Unavailable');
      const detectedNodes: Node[] = [detected.firstElementChild!, v.el('supervisor-message', 'p', setup.supervisor.message, 'muted small')];
      for (const origin of setup.supervisor.guestOrigins) if (origin !== addresses.view?.guestOrigin) detectedNodes.push(action(`Use ${origin} for guests`, async () => {
        if (!confirm(`Change the guest link from ${addresses.view?.guestOrigin}/join to ${origin}/join? People will need to select their name and enter their PIN at the new address. Their playlists are kept.`)) return;
        await requestJson('/api/host/addressing/guest', { origin, revision: settings!.revision }); notice = 'Guest address saved.';
      }, true, 'access'));
      children(detected, ...detectedNodes);
      for (const control of detected.querySelectorAll('button')) prop(control, 'disabled', control.disabled || Boolean(settings?.settingsChangesBlocked));
      accessNodes.push(detected);
    }
    const inventory = settings?.speakerInventory;
    const inventoryState = speakerFreshness.state;
    const updatingSpeakers = refreshingSpeakers || refreshing || inventoryState === 'loading' || inventoryState === 'refreshing';
    const activeOutput = settings?.output.state === 'ready' && !speakerFreshness.ready ? { ...settings.output, state: 'checking' as const } : settings?.output;
    const speakerState = pendingDestination ? 'Selecting…' : busy && busyScope === 'speaker' ? 'Checking…' : !settings ? 'Loading…' : !online ? 'Connection lost'
      : inventoryState === 'loading' && activeOutput?.state !== 'recovery' ? 'Loading…'
      : activeOutput?.state === 'ready' ? updatingSpeakers ? 'Updating…' : 'Ready' : activeOutput?.state === 'checking' ? 'Checking…' : activeOutput?.state === 'recovery' ? 'Recovery needed'
      : activeOutput?.state === 'unconfirmed' ? 'Unconfirmed' : activeOutput?.state === 'incompatible' ? 'Playback unsupported' : 'No active speaker';
    const destination = panel('destination', 'Active speaker', speakerState);
    attr(destination, 'data-inventory-state', inventoryState);
    const destinationNodes: Node[] = [destination.firstElementChild!];
    const report = online && settings?.status === 'checked' ? settings.report : null;
    const availableSpeakers = (online ? inventory?.players ?? report?.players : undefined)?.filter(player => player.available) ?? [];
    if (pendingDestination) destinationNodes.push(v.el('speaker-description', 'p', `Selecting ${availableSpeakers.find(player => player.id === pendingDestination)?.name ?? 'speaker'}…`, 'muted small'));
    else if (online && activeOutput?.state === 'ready') destinationNodes.push(v.el('speaker-description', 'p', `Active speaker: ${activeOutput.name}`, 'active-destination'));
    else if (activeOutput?.state === 'incompatible') destinationNodes.push(v.el('speaker-description', 'p', `Selected speaker: ${activeOutput.name}. Playback needs a compatible Music Assistant API.`, 'muted small'));
    else if (activeOutput?.state === 'unavailable' && activeOutput.name) destinationNodes.push(v.el('speaker-description', 'p', `${activeOutput.name} is unavailable. Choose another speaker or wait for it to reconnect.`, 'muted small'));
    else if (activeOutput?.state === 'checking' && activeOutput.name) destinationNodes.push(v.el('speaker-description', 'p', `Checking ${activeOutput.name}…`, 'muted small'));
    const destinationLabel = v.el('speaker-label', 'label', 'Speaker or group'); prop(destinationLabel, 'htmlFor', 'ma-destination');
    const select = v.el('speaker-select', 'select'); prop(select, 'id', 'ma-destination');
    prop(select, 'disabled', busy || !online || !settings?.tokenConfigured || settings.status === 'error' || !availableSpeakers.length || Boolean(settings.settingsChangesBlocked));
    const placeholder = !settings ? 'Loading speakers…' : !settings.tokenConfigured || settings.status === 'error' ? 'Connect Music Assistant first'
      : !report && inventory?.checkedAt == null ? updatingSpeakers ? 'Discovering speakers…' : 'Speakers not checked'
      : availableSpeakers.length ? 'Choose a speaker or group' : 'No available speakers or groups';
    const empty = v.el('speaker-placeholder', 'option', placeholder); prop(empty, 'value', ''); prop(empty, 'disabled', true); const speakerOptions = [empty];
    // Retain last-known options, never synthesize one from a saved routing preference.
    for (const player of availableSpeakers) {
      const option = v.el(`speaker-option-${player.id}`, 'option', player.name); prop(option, 'value', player.id); speakerOptions.push(option);
    }
    const selectedId = pendingDestination || (inventory || activeOutput?.state === 'ready' || activeOutput?.state === 'recovery' || activeOutput?.state === 'incompatible' ? settings?.destination?.id : undefined);
    children(select, ...speakerOptions); v.retain('speaker-option-', availableSpeakers.map(player => `speaker-option-${player.id}`)); prop(select, 'value', availableSpeakers.find(player => player.id === selectedId)?.id ?? '');
    select.onchange = () => {
      const id = select.value;
      if (busy || select.disabled || !id || id === settings?.destination?.id && settings.output.state === 'ready' && speakerFreshness.ready) return;
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
    const checked = inventory?.checkedAt === null || inventory?.checkedAt === undefined ? '' : ` Last checked ${new Date(inventory.checkedAt).toLocaleTimeString()}.`;
    const speakerExplanation = !inventory ? 'Music plays here when you press Play. Speaker availability updates automatically.'
      : inventoryState === 'loading' ? 'Checking speakers in Music Assistant…'
      : updatingSpeakers ? `Updating speakers… Showing the last ${speakerFreshness.fresh ? 'verified' : 'known, unverified'} list.${checked}`
      : inventoryState === 'failed' ? `Speaker refresh failed. Showing last-known speakers; availability is not verified.${checked}`
      : inventoryState === 'stale' ? `Speaker information has expired. Showing last-known speakers; each selection is checked again.${checked}`
      : inventoryState === 'not-configured' ? 'Connect Music Assistant to discover speakers.'
      : `Available in Music Assistant. The selected speaker’s queue is checked separately.${checked}`;
    const speakerHelp = v.el('speaker-help', 'p', speakerExplanation, 'muted field-hint'); prop(speakerHelp, 'id', 'ma-destination-help');
    attr(select, 'aria-describedby', speakerHelp.id);
    const group = v.el('speaker-field', 'div', undefined, 'field'); children(group, destinationLabel, select, speakerHelp); destinationNodes.push(group);
    if (report && speakerFreshness.fresh && !availableSpeakers.length) destinationNodes.push(v.el('empty-speakers', 'p', report.players.length
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
    if (settings && !settings.tokenConfigured) {
      const connect = v.el('speaker-connect', 'button', 'Set up Music Assistant', 'secondary'); prop(connect, 'type', 'button'); connect.onclick = () => sections.show('music-assistant'); destinationNodes.push(connect);
    }
    children(destination, ...destinationNodes);
    const playbackNodes: Node[] = [];
    if (settings?.playbackIssue) {
      const requiresRecovery = settings.playbackProblem?.recoveryRequired ?? true;
      const playback = panel('recovery', requiresRecovery ? 'Playback recovery' : 'Playback status');
      const recovery = action('Recover playback controls', async () => {
        if (!confirm('Recover playback controls? This stops the recording only if the app still owns that exact queue item. Externally replaced audio is left untouched. The turn will not advance.')) return;
        apply(await request('/recover', { revision: settings!.revision })); notice = 'Playback controls recovered. Select a track to start again.';
      }, true, 'speaker');
      const details = v.el('recovery-details', 'details'); children(details, v.el('recovery-summary', 'summary', 'Details'),
        v.el('recovery-issue', 'p', settings.playbackProblem ? `Diagnostic code: ${settings.playbackProblem.code}` : settings.playbackIssue, 'muted small'));
      const explanation = settings.playbackProblem?.message ?? 'The speaker may still be playing. Recovery stops only the song this app still controls; other audio is left alone. It does not start music or pass the turn.';
      children(playback, playback.firstElementChild!, v.el('recovery-note', 'p', explanation, 'warning'), requiresRecovery && recovery, requiresRecovery && details);
      playbackNodes.push(playback);
    }
    playbackNodes.push(destination, playbackSettings.element); accessNodes.push(addresses.render());
    sections.update('music-assistant', ...(feedbackSection === 'music-assistant' ? feedback : []), connection);
    sections.update('playback', ...(feedbackSection === 'playback' ? feedback : []), ...playbackNodes);
    sections.update('access', ...(feedbackSection === 'access' ? feedback : []), ...accessNodes);
    sections.update('users', userPins.element);
    workspaceNodes.push(sections.element);
    children(workspace, ...workspaceNodes); children(main, workspace);
  }
  render();
  try {
    apply(await request(''), true); render();
    if (signal.aborted) return;
    await Promise.all([loadSetup().then(render), settings!.tokenConfigured ? run(discover, 'speaker') : addresses.load()]);
  }
  catch (cause) { error = cause instanceof Error ? cause.message : 'Cannot load integration settings.'; }
  render();
  if (signal.aborted) return;
  let polls = 0;
  const poll = setInterval(() => {
    if (!main.isConnected || ++polls > 60 || setup?.status !== 'checking' && setup?.status !== 'idle') { clearInterval(poll); return; }
    if (!busy && !addresses.busy) void loadSetup().then(changed => { if (changed) render(); }).catch(() => {});
  }, 2000);
  window.addEventListener('pagehide', () => clearInterval(poll), { once: true, signal });
  const authTimer = setInterval(() => {
    if (authPending && Date.now() >= authExpiresAt) { authPending = false; loginUrl = ''; feedbackSection = 'music-assistant'; notice = 'Sign-in expired. Try connecting again.'; render(); }
  }, 1000);
  window.addEventListener('pagehide', () => clearInterval(authTimer), { once: true, signal });
  window.addEventListener('storage', event => {
    if (event.key !== 'aoty.ma-auth-result' || !authPending || !event.newValue) return;
    try {
      const result = JSON.parse(event.newValue);
      if (result.attemptId !== authAttempt || typeof result.at !== 'number' || Date.now() - result.at > 60_000) return;
      if (result.result === 'connected') void refreshSnapshot();
      else { authPending = false; loginUrl = ''; feedbackSection = 'music-assistant'; notice = result.result === 'cancelled' ? 'Sign-in cancelled. Your saved connection was kept.' : result.result === 'expired' ? 'Sign-in expired. Try connecting again.' : 'Sign-in could not finish. Try connecting again.'; render(); }
    } catch { /* Ignore unrelated/malformed browser storage. */ }
  }, { signal });
  async function refreshSnapshot(discoverSpeakers = true) {
    if (signal.aborted || busy || refreshing) return;
    refreshing = true; render();
    try {
      const next = await request(discoverSpeakers && settings?.tokenConfigured ? '/destinations' : '');
      if (busy) { queueSnapshot(next); return; }
      apply(next);
    } catch { /* Keep the current form and explicit retry; a read cannot replay a mutation. */ }
    finally { refreshing = false; render(); }
  }
  window.addEventListener('focus', () => { void refreshSnapshot(); }, { signal });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) void refreshSnapshot(); }, { signal });
  function visibleSnapshot() {
    return JSON.stringify(settings && { ...settings, sequence: undefined, instanceId: undefined, output: { ...settings.output, checkedAt: undefined },
      report: settings.report && { ...settings.report, checkedAt: undefined },
      speakerInventory: settings.speakerInventory && { ...settings.speakerInventory, asOf: undefined },
      inventoryFresh: speakerFreshness.fresh, readyFresh: speakerFreshness.ready });
  }
  function acceptLive(next: IntegrationView) {
    speakerFreshness.receive(next);
    const wasOnline = online; online = true;
    if (busy) { queueSnapshot(next); return; }
    const before = visibleSnapshot(); apply(next);
    if (!wasOnline || before !== visibleSnapshot()) render();
  }
  function connectLive() {
    if (signal.aborted) return;
    live?.close(); live = new EventSource(appPath('/api/host/integrations/events'));
    live.addEventListener('state', event => {
      if (!main.isConnected) { live?.close(); return; }
      acceptLive(JSON.parse((event as MessageEvent).data) as IntegrationView);
    });
    live.addEventListener('setup', event => { if (applySetup(JSON.parse((event as MessageEvent).data) as SetupView)) render(); });
    live.onerror = () => { online = false; if (!busy) render(); void refreshSnapshot(false); };
  }
  connectLive();
  window.addEventListener('offline', () => { online = false; render(); }, { signal });
  window.addEventListener('online', () => { void refreshSnapshot(); }, { signal });
  window.addEventListener('pagehide', () => { live?.close(); clearTimeout(freshnessTimer); }, { signal });
  window.addEventListener('pageshow', event => { if (event.persisted) { render(); scheduleSpeakerExpiry(); connectLive(); void refreshSnapshot(); } }, { signal });
  signal.addEventListener('abort', () => { live?.close(); clearTimeout(freshnessTimer); clearInterval(poll); clearInterval(authTimer); }, { once: true });
}
