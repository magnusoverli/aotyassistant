import type { IntegrationView } from '../src/integrations';
import { el } from './dom';
import { AddressingPanel } from './addressing-panel';
import { requestJson, RequestError } from './request';

/** Host-only setup surface. No tokens in URLs, localStorage, returned responses, or SSE. */
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
    if (updateDraft) { urlDraft = next.url ?? ''; tokenDraft = ''; destinationDraft = next.destination?.id ?? ''; }
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
    } finally { busy = false; await addresses.load(); render(); }
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
    const reload = action('Reload saved settings', async () => { apply(await request(''), true); await discover(); }, true, true);
    heading.append(title, reload); workspace.append(heading);
    const failure = error || (settings?.status === 'error' ? settings.message : '');
    if (failure) { const message = el('div', failure, 'error settings-notice'); message.setAttribute('role', 'alert'); workspace.append(message); }
    if (notice) { const message = el('p', notice, 'success settings-notice'); message.setAttribute('role', 'status'); workspace.append(message); }
    const grid = el('div', undefined, 'settings-grid');
    const state = busy ? 'Working…' : !settings ? 'Loading…' : settings.tokenConfigured ? 'Configured' : 'Not configured';
    const connection = panel('connection', 'Music Assistant', state);
    if (settings?.tokenConfigured) {
      connection.append(el('p', 'Music Assistant is configured.', 'configured-connection'));
      connection.append(action('Disconnect', async () => {
        if (!confirm('Disconnect Music Assistant and remove the saved token and destination? This does not revoke the token in Music Assistant.')) return;
        apply(await request('/clear', { revision: settings!.revision }), true);
        notice = 'Music Assistant disconnected. You can set up a new connection.';
      }, true));
    } else if (settings) {
      const form = el('form', undefined, 'integration-form');
      const url = field('Music Assistant URL', 'ma-url', 'url', urlDraft, value => { urlDraft = value; });
      url.input.required = true; url.input.maxLength = 2048; url.input.placeholder = 'http://homeassistant.local:8095';
      const token = field('Music Assistant access token', 'ma-token', 'password', tokenDraft, value => { tokenDraft = value; });
      token.input.autocomplete = 'off'; token.input.maxLength = 8192; token.input.placeholder = 'Paste a long-lived access token';
      token.input.setAttribute('spellcheck', 'false'); token.input.required = true;
      const tokenHelp = el('p', 'Create a token in Music Assistant → Settings → Profile.', 'muted field-hint'); tokenHelp.id = 'ma-token-help';
      token.input.setAttribute('aria-describedby', tokenHelp.id); token.group.append(tokenHelp);
      if (location.protocol !== 'https:') token.group.append(el('p', 'HTTP connection — use HTTPS before entering a real token on shared Wi-Fi.', 'settings-security-note'));
      const save = el('button', 'Save connection'); save.type = 'submit'; save.disabled = busy || addresses.busy || !online; save.id = 'ma-save';
      const controls = el('div', undefined, 'actions settings-form-actions'); controls.append(save);
      form.append(url.group, token.group, controls);
      form.onsubmit = event => {
        event.preventDefault(); const submittedUrl = urlDraft.trim(); const submittedToken = tokenDraft.trim();
        // Clear the secret immediately after submission; it is never persisted in browser storage.
        tokenDraft = '';
        void run(async () => {
          apply(await request('/save', { url: submittedUrl, accessToken: submittedToken, revision: settings!.revision }), true);
          await discover(); notice = 'Connection saved. Speakers are discovered automatically.';
        });
      }; connection.append(form);
      connection.append(el('p', 'Saving a connection does not start audio.', 'muted settings-safe-note'));
      const help = el('details', undefined, 'settings-help'); help.open = helpExpanded;
      const summary = el('summary', 'Setup help'); summary.id = 'settings-help-toggle'; help.append(summary);
      help.addEventListener('toggle', () => { if (help.isConnected) helpExpanded = help.open; });
      help.append(el('p', 'Use the direct Music Assistant API address, not a Home Assistant dashboard link.', 'muted small'));
      help.append(el('p', 'Tokens stay on the server and cannot be displayed again. Home Assistant can host the app as an add-on; no separate Home Assistant account connection is needed.', 'muted small'));
      connection.append(help);
    }
    grid.append(connection);
    const output = el('div', undefined, 'settings-output');
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
  try { apply(await request(''), true); if (settings!.tokenConfigured) { render(); await run(discover); } else await addresses.load(); }
  catch (cause) { error = cause instanceof Error ? cause.message : 'Cannot load integration settings.'; }
  render();
}
