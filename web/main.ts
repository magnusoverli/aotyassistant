import QRCode from 'qrcode';
import type { CatalogueTrack, CatalogueArtist, CatalogueAlbum, View } from '../src/model';
import { catalogueSearchNotice } from '../src/catalogue-messages';
import { mountSettings } from './settings';
import { el, link } from './dom';
import { vinyl } from './visuals';
import { ListeningOrder } from './listening-order';
import { AppHeader } from './app-header';
import { pageForPath } from './navigation';
import { progressConnected, displayedProgress } from './media';
import { PlayerController } from './player-controller';
import { Playback } from './playback';
import { PlayerReturn } from './player-return';
import { ViewNodes, children, prop, text, attr } from './view-nodes';
import { CatalogueRow } from './catalogue-row';
import { PublicRoom } from './public-room';
import { PreparationController } from './preparation-controller';
import { PreparationPanel } from './preparation-panel';
import type { PreparationView } from '../src/preparations';
import { requestJson } from './request';
import { CatalogueController, catalogueIdentity } from './catalogue-controller';
import { sourceName } from './catalogue-sources';
import { participantEvents } from './participant-events';
import { BrowseHistory } from './browse-history';
import { copyButton } from './copy-text';
import './style.css';
import { appPath, pagePath, guestLinksReady, setGuestOrigin } from './paths';
import { joinPanel } from './join-panel';
import { ParticipantAccess } from './participant-access';
import { pageFrame, workspaceGrid, slot, stackedLayout } from './page-layout';
import { panel, pageHeading, sectionHeading, notice } from './ui-components';
import { productName, productTagline } from '../src/product';

const page = pageForPath(pagePath(location.pathname));
document.title = `${({ home: 'Home', join: 'Join room', participant: 'Your music', display: 'Room display', host: 'Host desk', settings: 'Settings' })[page]} · ${productName}`;
const root = document.querySelector<HTMLDivElement>('#app')!;
const turnAnnouncement = el('div', undefined, 'sr-only');
turnAnnouncement.setAttribute('role', 'status'); turnAnnouncement.setAttribute('aria-live', 'polite'); turnAnnouncement.setAttribute('aria-atomic', 'true');
const searchAnnouncement = el('div', undefined, 'sr-only');
searchAnnouncement.setAttribute('role', 'status'); searchAnnouncement.setAttribute('aria-live', 'polite'); searchAnnouncement.setAttribute('aria-atomic', 'true');
if (page === 'participant') document.body.append(turnAnnouncement, searchAnnouncement);
let view: View | undefined;
const catalogue = new CatalogueController(() => view);
let realtime = false;
let busy = false;
let error = '';
let results: CatalogueTrack[] = [];
let searchText = '';
let searchDone = false;
let searching = false;
let catalogueBusy = false;
let catalogueError = '';
type CatalogueAction = () => Promise<boolean | void> | boolean | void;
let catalogueRetry: CatalogueAction | undefined;
let catalogueSequence = 0;
let searchMode: 'tracks' | 'artists' = 'artists';
let artists: CatalogueArtist[] = [];
let albums: CatalogueAlbum[] = [];
let chosenArtist: CatalogueArtist | undefined;
let chosenAlbum: CatalogueAlbum | undefined;
const sourceChoices = new Map<string, string>();
let artistNotices: string[] = [];
let albumNotices: string[] = [];
let trackNotices: string[] = [];
let catalogueDetails = false;
const browseSnapshot = () => ({ results, searchText, searchDone, searchMode, artists, albums, chosenArtist, chosenAlbum,
  artistNotices, albumNotices, trackNotices, choices: [...sourceChoices], scroll: scrollY, catalogueDetails });
const browseHistory = page === 'participant' ? new BrowseHistory(browseSnapshot, snapshot => {
  catalogue.cancel(); resetCatalogueTask();
  results = snapshot?.results ?? []; searchText = snapshot?.searchText ?? ''; searchDone = snapshot?.searchDone ?? false;
  searchMode = snapshot?.searchMode ?? (view?.catalogue?.source === 'music-assistant' ? 'artists' : 'tracks');
  artists = snapshot?.artists ?? []; albums = snapshot?.albums ?? []; chosenArtist = snapshot?.chosenArtist; chosenAlbum = snapshot?.chosenAlbum;
  artistNotices = snapshot?.artistNotices ?? []; albumNotices = snapshot?.albumNotices ?? []; trackNotices = snapshot?.trackNotices ?? [];
  sourceChoices.clear(); for (const [key, value] of snapshot?.choices ?? []) sourceChoices.set(key, value);
  catalogueDetails = snapshot?.catalogueDetails ?? false; render(); window.scrollTo({ top: snapshot?.scroll ?? 0, behavior: 'instant' });
}) : undefined;
let stream: { close(): void } | undefined;
let qrUrl = '';
let qrImage = '';
let nicknameDraft = '';
let joinError = '';
let accessEnded = false;
let publicRoom: PublicRoom | undefined;
let settingsMounted = false;
const participantNodes = new ViewNodes();
const hostNodes = new ViewNodes();
const pageNodes = new ViewNodes();
const entryNodes = new ViewNodes();
const catalogueRows = new Map<string, CatalogueRow>();
document.body.dataset.view = page;
const player = new PlayerController({
  role: page === 'host' ? 'host' : 'participant', getView: () => view,
  position: displayedProgress,
  canSend: () => (page === 'host' || page === 'participant') && realtime && Boolean(view?.connected),
  request: async (path, data) => {
    if (path === '/api/participant/preparations/play') {
      const ownerId = library.view?.ownerId;
      const result = await api<{ view: View; preparation?: PreparationView; warning?: string }>(path, data);
      if (ownerId === library.view?.ownerId) { if (result.preparation) library.accept(result.preparation); if (result.warning) library.warning = result.warning; } return result.view;
    }
    return api<View>(path, data);
  }, accept,
  resync: async () => { try { accept(await api<View>(`/api/${page}/state`)); } catch { realtime = false; render(); } },
  changed: kind => {
    if (kind === 'volume' && view) playback?.updateVolume(player.project(view).volume);
    else renderParticipantPlayer();
  },
  failed: message => { error = message; render(); },
});
const library = new PreparationController(() => {
  if (page === 'participant' && view?.me && root.querySelector('.preparation-list')) { music.refresh(); renderParticipantPlayer(); } else render();
}, () => Boolean(view?.me));
const music = new PreparationPanel(library, { getView: () => view, starting: () => player.starting, changed: render });
const playbackOptions = { run, volume: (level: number, commit: boolean) => player.volume(level, commit) };
const playback = page === 'host' ? new Playback({ ...playbackOptions, role: 'host',
  control: action => { error = ''; player.control(action); },
  advance: turnId => { player.cancel(); return mutate('/api/host/advance', { turnId }); },
  stop: (turnId, playbackId) => { player.cancel(); return mutate('/api/host/stop', { turnId, playbackId }); },
}) : page === 'participant' ? new Playback({ ...playbackOptions, role: 'participant',
  playFirst: playFirstSelection,
  control: action => { error = ''; player.control(action); },
  reveal: () => { error = ''; player.reveal(); },
  finish: () => { player.cancel(); return mutate('/api/participant/finish', { turnId: view?.turnId }); },
}) : undefined;
const appHeader = new AppHeader(page, message => { error = message; render(); });
const listeningOrder = new ListeningOrder(page === 'host' ? {
  disabled: () => busy || !realtime || !view?.connected,
  reorder: ({ id, ids, revision }) => run(async () => {
    if (!view) return;
    const name = view.rotation?.find(person => person.id === id)?.nickname ?? 'Participant';
    try {
      await mutate('/api/host/reorder', { ids, revision }); listeningOrder.announce(`Moved ${name} to position ${ids.indexOf(id) + 1}.`);
    } catch (cause) { listeningOrder.announce('Order could not be confirmed. Review the current order and try again.'); throw cause; }
  }),
  remove: id => { void run(async () => {
    const person = view?.rotation?.find(person => person.id === id); if (!view || !person) return;
    if (id === view.current?.id && !confirm(`Remove ${person.nickname} from the room? This ends their turn and stops any app-owned song.`)) return;
    await mutate('/api/host/remove', { id, revision: view.revision }); listeningOrder.announce(`Removed ${person.nickname}. Their saved music is kept.`);
  }); },
} : undefined);
appHeader.element.append(listeningOrder.element);
const pageContent = el('div', undefined, 'app-content'); pageContent.id = 'main-content'; pageContent.tabIndex = -1;
root.replaceChildren(appHeader.element, pageContent);
const playerReturn = page === 'participant' ? new PlayerReturn() : undefined;
if (playerReturn) root.append(playerReturn.element);
const updatePlayerReturn = () => playerReturn?.update(view, player.starting, realtime && Boolean(view?.connected), error);
const updateHeader = () => {
  progressConnected(realtime && Boolean(view?.connected));
  appHeader.update({ view });
  listeningOrder.update(view, realtime && navigator.onLine);
};
const participantAccess = new ParticipantAccess(
  () => api<View>('/api/participant/state'), () => navigator.onLine,
  next => {
    if (page === 'join') { view = next; location.replace(appPath('/participant')); return; }
    const changed = view?.roomId !== next.roomId || view.me?.id !== next.me?.id;
    accept(next); if (!stream || changed) subscribe('participant');
  },
  () => {
    view = undefined; realtime = false; stream?.close(); stream = undefined; player.cancel(); catalogue.cancel();
    participantNodes.clear(); playback?.clear(); catalogueRows.clear();
    resetCatalogueTask();
    results = []; searchDone = false; searching = false; artists = []; albums = []; chosenArtist = undefined; chosenAlbum = undefined;
    sourceChoices.clear(); artistNotices = []; albumNotices = []; trackNotices = [];
    browseHistory?.reset();
    searchAnnouncement.textContent = '';
  }, render,
);
let restoringFocus = false;
function keepMusicFocusVisible() {
  if (restoringFocus || page !== 'participant') return;
  const focused = document.activeElement;
  if (!(focused instanceof HTMLElement) || !focused.closest('.music-workspace')) return;
  const headerBottom = Math.max(0, appHeader.element.getBoundingClientRect().bottom) + 12;
  const list = root.querySelector<HTMLElement>('.preparation-list');
  const obstruction = stackedLayout() && focused.closest('.catalogue-panel') && list && getComputedStyle(list).position === 'sticky' ? Math.max(headerBottom, list.getBoundingClientRect().bottom + 12) : headerBottom;
  const rect = focused.getBoundingClientRect();
  if (rect.top < obstruction) window.scrollBy({ top: rect.top - obstruction, behavior: 'instant' });
}
root.addEventListener('focusin', () => {
  const focused = document.activeElement;
  if (!restoringFocus) requestAnimationFrame(() => { if (document.activeElement === focused) keepMusicFocusVisible(); });
});
function updateMusicViewport() {
  const height = Math.min(innerHeight, window.visualViewport?.height ?? innerHeight);
  document.documentElement.style.setProperty('--music-viewport-height', `${height}px`);
  document.body.dataset.shortViewport = String(height < 600);
  requestAnimationFrame(keepMusicFocusVisible);
}
if (page === 'participant') {
  updateMusicViewport(); window.addEventListener('resize', updateMusicViewport); window.visualViewport?.addEventListener('resize', updateMusicViewport);
}

async function api<T>(path: string, data?: unknown): Promise<T> {
  // Playback may include upstream resolution and bounded transport verification.
  return requestJson<T>(path, data, data === undefined ? 15_000 : 120_000);
}
async function run(action: () => Promise<void> | void) {
  if (busy) return;
  const focusId = document.activeElement instanceof HTMLElement ? document.activeElement.id : '';
  busy = true; error = ''; render();
  try { await action(); }
  catch (cause) {
    error = cause instanceof Error ? cause.message : 'Connection failed. Try again.';
    // Do not retry mutations automatically: the server may already have committed.
    if (view && (page === 'host' || page === 'participant')) {
      try { accept(await api<View>(`/api/${page}/state`)); } catch { realtime = false; }
    }
  } finally {
    busy = false; render();
    if (focusId && document.activeElement === document.body) document.getElementById(focusId)?.focus({ preventScroll: true });
  }
}
function resetCatalogueTask() {
  catalogueSequence++; catalogueBusy = false; searching = false; catalogueError = ''; catalogueRetry = undefined;
}
function showCatalogueStart() {
  const results = root.querySelector<HTMLElement>('.catalogue-results');
  if (!results) return;
  const header = appHeader.element;
  let top = getComputedStyle(header).position === 'sticky' ? header.getBoundingClientRect().bottom + 12 : 12;
  const list = root.querySelector<HTMLElement>('.preparation-list');
  if (stackedLayout() && list && getComputedStyle(list).position === 'sticky') {
    // Use the companion's eventual sticky position, not its position before scrolling.
    top = Math.max(top, parseFloat(getComputedStyle(list).top) + list.getBoundingClientRect().height + 12);
  }
  const heading = results.querySelector('h2')!.getBoundingClientRect();
  const first = (results.querySelector('.track-row') ?? results).getBoundingClientRect();
  const height = Math.min(innerHeight, window.visualViewport?.height ?? innerHeight);
  if (heading.top < top || first.bottom > height) {
    const search = root.querySelector('.catalogue-panel')!.getBoundingClientRect();
    const target = first.bottom - search.top <= height - top ? search.top : results.getBoundingClientRect().top;
    window.scrollTo({ top: Math.max(0, scrollY + target - top), behavior: 'instant' });
  }
}
async function runCatalogue(action: CatalogueAction) {
  catalogue.cancel();
  const sequence = ++catalogueSequence;
  const focusId = document.activeElement instanceof HTMLElement ? document.activeElement.id : '';
  let newList = false;
  catalogueBusy = true; catalogueError = ''; catalogueRetry = undefined; render();
  try { newList = await action() === true; }
  catch (cause) {
    if (sequence !== catalogueSequence) return;
    catalogueError = cause instanceof Error ? cause.message : 'Music could not be loaded. Try again.';
    catalogueRetry = action;
  } finally {
    if (sequence === catalogueSequence) {
      catalogueBusy = false; searching = false; render();
      if (focusId && document.activeElement === document.body) {
        restoringFocus = true;
        document.getElementById(focusId)?.focus({ preventScroll: true });
        restoringFocus = false;
      }
      // Ordinary renders keep the viewport; a successful search/browse starts a new list.
      if (newList) { showCatalogueStart(); browseHistory?.push(); }
    }
  }
}
function catalogueButton(text: string, action: CatalogueAction, secondary = true) {
  const control = el('button', text, secondary ? 'secondary' : ''); control.type = 'button';
  control.disabled = !realtime || !view?.connected;
  control.onclick = () => { void runCatalogue(action); }; return control;
}
function participantLayoutKey(current: View) {
  return JSON.stringify({ ...current, revision: undefined, output: undefined, ownPlayback: undefined, progress: undefined, playbackStatus: undefined, nowPlaying: undefined,
    volume: [current.volume?.available, current.volume?.revision] });
}
function accept(next: View) {
  accessEnded = false;
  if (view?.roomId === next.roomId && view.revision > next.revision) return;
  if (view?.volume?.revision === next.volume?.revision && (view?.volume?.generation ?? 0) > (next.volume?.generation ?? 0)) next = { ...next, volume: view!.volume };
  if (catalogueIdentity(view) !== catalogueIdentity(next)) {
    catalogueRows.clear();
    catalogue.cancel();
    resetCatalogueTask();
    results = []; searchText = ''; searchDone = false;
    artists = []; albums = []; chosenArtist = undefined; chosenAlbum = undefined;
    sourceChoices.clear(); artistNotices = []; albumNotices = []; trackNotices = [];
    searchMode = next.catalogue?.source === 'music-assistant' ? 'artists' : 'tracks';
    browseHistory?.reset();
    if (page === 'participant') void library.refresh();
  }
  // Position/volume snapshots do not rebuild browsing forms or reload all artwork.
  const telemetryOnly = view && JSON.stringify({ ...view, progress: undefined, volume: [view.volume?.available, view.volume?.revision] }) === JSON.stringify({ ...next, progress: undefined, volume: [next.volume?.available, next.volume?.revision] });
  const playerOnly = page === 'participant' && view?.me && participantLayoutKey(view) === participantLayoutKey(next);
  view = next;
  updateHeader();
  if (next.joinUrl) setGuestOrigin(new URL(next.joinUrl).origin);
  player.observe(next);
  if (page !== 'display' && telemetryOnly && root.querySelector('main')) {
    const shown = player.project(next);
    playback?.updateTelemetry(shown.progress, shown.volume); return;
  }
  if (playerOnly) { renderParticipantPlayer(); return; }
  if (page === 'participant' && next.me) {
    const position = next.position;
    const turnMessage = next.myTurn ? 'It’s your turn to share.'
      : next.current ? `${next.current.nickname}’s turn. ${position?.turnsUntil === 1 ? 'You are up next.' : position?.turnsUntil != null ? `Your turn is ${position.turnsUntil} turns away.` : ''}`
      : 'The listening room is ready.';
    const announcement = turnMessage;
    if (turnAnnouncement.textContent !== announcement) turnAnnouncement.textContent = announcement;
  }
  if (next.joinUrl && next.joinUrl !== qrUrl) {
    qrUrl = next.joinUrl; qrImage = '';
    const url = qrUrl;
    void QRCode.toDataURL(url, { width: 360, margin: 3 }).then(image => {
      if (qrUrl === url) { qrImage = image; render(); }
    }).catch(() => {});
  }
  render();
}
function subscribe(role: 'host' | 'participant' | 'display') {
  stream?.close();
  const state = (event: MessageEvent) => {
    if (stream !== connection || !navigator.onLine) return;
    const reconnecting = !realtime; realtime = true;
    accept(JSON.parse((event as MessageEvent).data) as View);
    if (reconnecting) render();
  };
  const revoked = () => {
    if (stream !== connection) return;
    accessEnded = true;
    turnAnnouncement.textContent = 'You have been removed from the listening room.';
    error = '';
    participantAccess.revoke(); music.uploads.stop();
  };
  const failed = () => { if (stream === connection) { realtime = false; player.cancel(); render(); } };
  const connection = role === 'participant'
    ? { close: participantEvents.subscribe('room', { state, revoked, error: failed }) }
    : new EventSource(appPath(`/api/${role}/events`));
  stream = connection;
  if (connection instanceof EventSource) {
    connection.addEventListener('state', event => state(event as MessageEvent));
    connection.addEventListener('revoked', revoked); connection.onerror = failed;
  }
}
async function mutate(path: string, data: unknown) { accept(await api<View>(path, data)); }

function qrCard() {
  const card = panel('qr-card');
  card.append(el('h2', 'Invite people'));
  if (!guestLinksReady(view?.joinUrl)) { card.append(el('p', 'Choose a guest address in Settings before sharing the room.'), link('Configure guest access', '/host/settings')); return card; }
  if (view?.joinUrl) {
    const qr = el('div', undefined, 'invitation-qr');
    if (qrImage) { const img = el('img'); img.src = qrImage; img.alt = 'Scan to join the listening room'; qr.append(img); }
    qr.append(el('p', 'Scan the QR code to join.', 'muted')); card.append(qr);
    const address = el('input'); address.value = view.joinUrl; address.readOnly = true; address.setAttribute('aria-label', 'Join link'); address.className = 'join-link-field';
    const sharing = el('div', undefined, 'invitation-sharing'); sharing.append(address, copyButton('Copy join link', address)); card.append(sharing);
    const invitation = link('Open guest invitation ↗', view.joinUrl); invitation.target = '_blank'; invitation.rel = 'noopener noreferrer'; card.append(invitation);
  }
  if (view?.displayUrl) {
    const display = link('Open room display ↗', view.displayUrl); display.target = '_blank'; display.rel = 'noopener noreferrer'; card.append(display);
  }
  return card;
}
function renderDisplay() {
  if (!view) {
    publicRoom = undefined;
    const message = notice(error, 'error'); message.hidden = !error;
    pageContent.replaceChildren(message, closedRoom()); return;
  }
  if (!publicRoom?.element.isConnected) {
    publicRoom = new PublicRoom();
    const message = notice('', 'error'); message.id = 'display-notice';
    pageContent.replaceChildren(message, publicRoom.element);
  }
  const message = document.getElementById('display-notice')!; text(message, error); prop(message, 'hidden', !error);
  publicRoom.update(view, realtime, qrImage);
}
function closedRoom() {
  const main = pageFrame('display', 'room-closed');
  const record = el('div', undefined, 'welcome-record'); record.append(vinyl());
  main.append(record, el('h1', 'Listening room'), el('p', 'Connecting to the room…', 'muted'));
  return main;
}
function host() {
  const v = hostNodes;
  const main = v.get('main', () => { const node = pageFrame('workspace', 'host-page'); node.setAttribute('aria-label', 'Host desk'); return node; });
  const heading = v.get('heading', () => pageHeading('Host desk'));
  const grid = v.get('grid', () => workspaceGrid('sidebar'));
  const workspace = v.get('workspace', () => { const node = slot(el('div', undefined, 'host-workspace stack'), 'primary'); node.id = 'overview'; return node; });
  const aside = v.get('invitations', () => { const node = slot(el('aside', undefined, 'host-invitations'), 'secondary'); node.id = 'room-invitation'; node.setAttribute('aria-label', 'Room invitation'); return node; });
  const invitation = v.get('invitation-state', () => ({ key: '' }));
  const invitationKey = JSON.stringify([view?.joinUrl, view?.displayUrl, qrImage, guestLinksReady(view?.joinUrl)]);
  if (invitation.key !== invitationKey) { invitation.key = invitationKey; children(aside, qrCard()); }
  children(grid, workspace, aside); children(main, heading, grid);
  if (!view) return main;
  const active = view.active ?? [];
  main.classList.toggle('is-empty', !active.length);
  if (!active.length) {
    children(workspace, v.el('empty', 'p', 'Share the room. The first person to join gets the first turn.', 'muted'),
      (!view.playbackAvailable || view.mode === 'demo') && v.get('setup', () => link('Set up music and speaker', '/host/settings')));
    return main;
  }
  children(workspace, renderPlayback(view));
  return main;
}
function renderParticipantPlayer() {
  const card = root.querySelector('.playback-card');
  if (page !== 'participant' || !view?.me || !card || root.querySelector('.app-content > .error')) { render(); return; }
  renderPlayback(view);
  updatePlayerReturn();
  // Starting a track changes availability, not the search/list layout or their DOM state.
  for (const control of root.querySelectorAll<HTMLButtonElement>('[data-player-ready]')) prop(control, 'disabled', control.dataset.playerReady !== 'true' || player.starting);
}
function renderPlayback(current: View) {
  return playback!.update({ view: current, projected: player.project(current), online: realtime, busy, starting: player.starting,
    firstSelection: page === 'participant' ? library.view?.upcoming[0] : undefined,
    selectionReady: !library.loading && !library.saving && !library.pending && !library.view?.reviewEntryId });
}
function playFirstSelection() {
  error = '';
  const entry = library.view?.upcoming[0];
  if (!entry || !library.view) return;
  const track: CatalogueTrack = { id: `prepared:${entry.id}`, title: entry.title, artist: entry.artist, album: entry.album, version: entry.version,
    provider: entry.provider, duration: entry.duration, available: entry.sourceAvailable !== false, artwork: entry.artwork, artistArtwork: entry.artistArtwork };
  playTrack(track, { entryId: entry.id, revision: library.view.revision });
}
function participant() {
  if (!view?.me) return participantEntry();
  const v = participantNodes;
  const main = v.get('main', () => pageFrame('workspace', 'participant-page'));
  const position = view.position;
  const state = view.myTurn ? 'mine' : position?.turnsUntil === 1 ? 'next' : 'listening';
  attr(main, 'data-turn-state', state);
  const hero = v.el('hero', 'section', undefined, `participant-hero is-${state}`); attr(hero, 'aria-label', 'Your turn status');
  const title = v.el('title', 'h1', view.myTurn ? 'Your turn.' : view.current ? `${view.current.nickname}’s turn.` : 'Listening room'); prop(title, 'title', title.textContent!);
  const distance = v.el('distance', 'p', !view.myTurn && position ? position.turnsUntil === 1 ? 'You’re next' : `${position.turnsUntil} turns away` : '', 'turn-distance');
  const shortcuts = v.el('shortcuts', 'nav', undefined, 'music-shortcuts'); attr(shortcuts, 'aria-label', 'Your music shortcuts');
  const find = v.get('find', () => link('Find music', '#music-find', 'secondary button'));
  find.onclick = event => { event.preventDefault(); document.getElementById('catalogue-search')?.focus({ preventScroll: true }); document.getElementById('music-find')?.scrollIntoView({ block: 'start', behavior: 'instant' }); };
  const list = v.el('list-shortcut', 'button', 'Your selections', 'secondary'); prop(list, 'type', 'button'); list.onclick = () => music.openList();
  children(shortcuts, find, list); children(hero, title, distance, shortcuts);
  const search = v.get('search', () => { const node = el('section', undefined, 'catalogue-panel'); node.setAttribute('aria-labelledby', 'music-find-title'); return node; });
  const searchHeading = v.get('search-heading', () => el('div', undefined, 'catalogue-toolbar'));
  const searchTitle = v.get('search-title', () => { const node = el('div', undefined, 'catalogue-title'); const heading = el('h2', 'Find music'); heading.id = 'music-find-title'; node.append(heading, el('span', 'Your search', 'privacy-tag')); return node; });
  const modes = v.el('modes', 'div', undefined, 'search-tabs'); attr(modes, 'role', 'group'); attr(modes, 'aria-label', 'Search by');
  const searchNodes: Node[] = [searchHeading];
  const realCatalogue = view.catalogue?.source === 'music-assistant';
  if (realCatalogue && !view.catalogue?.playbackAvailable) {
    const hint = v.el('speaker-hint', 'p', undefined, 'muted small');
    const prefix = v.get('speaker-prefix', () => document.createTextNode('')); text(prefix, view.output?.name ? 'Check the speaker in ' : 'Choose a speaker in ');
    children(hint, prefix, v.get('speaker-settings', () => link('host settings', '/host/settings', 'inline-link')), v.get('speaker-suffix', () => document.createTextNode(' before playing. You can still prepare tracks.'))); searchNodes.push(hint);
  }
  if (realCatalogue) {
    const tabs: Node[] = [];
    for (const mode of ['artists', 'tracks'] as const) {
      const tab = v.get(`mode-${mode}`, () => catalogueButton(mode === 'tracks' ? 'Songs' : 'Artists', () => {
        browseHistory?.remember();
        searchMode = mode; searchDone = false; results = []; artists = []; albums = []; chosenArtist = undefined; chosenAlbum = undefined;
        sourceChoices.clear(); artistNotices = []; albumNotices = []; trackNotices = [];
        browseHistory?.push();
      })); prop(tab, 'className', searchMode !== mode ? 'secondary' : ''); prop(tab, 'disabled', !realtime || !view.connected);
      prop(tab, 'id', `catalogue-mode-${mode}`); attr(tab, 'aria-pressed', String(searchMode === mode)); tabs.push(tab);
    }
    children(modes, ...tabs);
  }
  children(searchHeading, searchTitle, realCatalogue && modes);
  const form = v.el('form', 'form', undefined, 'search-form');
  const input = v.get('input', () => { const node = el('input'); node.type = 'search'; node.enterKeyHint = 'search'; node.required = true; node.maxLength = 200; node.id = 'catalogue-search'; node.setAttribute('aria-label', 'Search catalogue'); node.oninput = () => { searchText = node.value; }; return node; });
  prop(input, 'placeholder', realCatalogue ? (searchMode === 'artists' ? 'Artist name' : 'Song, artist, or album') : 'Try Northern or Night'); prop(input, 'value', searchText);
  const submit = v.get('submit', () => { const node = el('button'); node.id = 'catalogue-search-submit'; node.type = 'submit'; return node; }); text(submit, searching ? 'Searching…' : 'Search'); prop(submit, 'disabled', !realtime || !view.connected);
  children(form, input, submit);
  form.onsubmit = event => {
    event.preventDefault(); if (submit.disabled) return;
    const query = input.value.trim();
    if (!query) { catalogueError = 'Enter a track title, artist, or album to search.'; catalogueRetry = undefined; render(); return; }
    browseHistory?.remember();
    searching = true; searchDone = false; results = []; artists = []; albums = []; chosenArtist = undefined; chosenAlbum = undefined;
    sourceChoices.clear(); artistNotices = []; albumNotices = []; trackNotices = [];
    void runCatalogue(async () => {
      if (realCatalogue && searchMode === 'artists') {
        const response = await catalogue.browse('artists', query);
        if (response) { artists = response.artists ?? []; artistNotices = response.notices ?? []; searchDone = true; return true; }
      } else {
        const response = await catalogue.search(query);
        if (response && view?.catalogue?.source === response.source) {
          results = response.tracks; trackNotices = response.notices ?? []; searchDone = true; return true;
        }
      }
    });
  }; searchNodes.push(form);
  const found = v.get('found', () => { const node = el('section', undefined, 'catalogue-results'); node.setAttribute('aria-labelledby', 'music-results-title'); return node; });
  attr(found, 'aria-busy', String(catalogueBusy));
  const resultsHeading = v.get('results-heading', () => sectionHeading('Results', 'music-results-title')); text(resultsHeading.querySelector('h2')!, chosenArtist ? 'Browse music' : 'Results');
  const foundNodes: Node[] = [resultsHeading];
  const resultKind = searchMode === 'artists' && !chosenAlbum ? chosenArtist ? 'album' : 'artist' : 'track';
  const resultCount = resultKind === 'album' ? albums.length : resultKind === 'artist' ? artists.length : results.length;
  const resultSummary = `${resultCount} ${resultKind}${resultCount === 1 ? '' : 's'}`;
  children(resultsHeading, resultsHeading.querySelector('h2')!, searchDone && !searching && v.el('count', 'span', resultSummary, 'count-tag'));
  const allNotices = resultKind === 'artist' ? artistNotices : resultKind === 'album' ? albumNotices : trackNotices;
  // Keep API coverage caveats available without repeating a warning banner on every successful search.
  const notices = allNotices.filter(notice => notice !== catalogueSearchNotice);
  const coverageUnconfirmed = notices.length > 0 || allNotices.length > notices.length;
  const announcement = searching ? 'Searching…' : searchDone ? `${resultSummary} ${realCatalogue ? 'returned' : 'found'}.${coverageUnconfirmed ? ' Source coverage unconfirmed.' : ''}` : '';
  if (searchAnnouncement.textContent !== announcement) searchAnnouncement.textContent = announcement;
  if (catalogueError) {
    const notice = v.el('error', 'div', undefined, 'list-notice'); const message = v.el('error-text', 'p', catalogueError); attr(message, 'role', 'alert');
    const retry = v.get('retry', () => { const node = catalogueButton('Try again', () => catalogueRetry?.()); node.id = 'catalogue-retry'; return node; });
    prop(retry, 'disabled', !realtime || !view.connected);
    // runCatalogue clears the retry slot before executing; capture the current request.
    const retryAction = catalogueRetry; retry.onclick = () => { if (retryAction) void runCatalogue(retryAction); };
    children(notice, message, Boolean(catalogueRetry) && retry); foundNodes.push(notice);
  }
  if (!searchDone && !searching && !catalogueError) foundNodes.push(v.el('instructions', 'p', 'Search for music to add to your private list.', 'muted small'));
  if (searching || catalogueBusy) { const status = v.el('status', 'p', searching ? 'Searching…' : 'Loading music…', 'muted'); attr(status, 'role', 'status'); foundNodes.push(status); }
  if (coverageUnconfirmed) {
    const details = v.el('help', 'details', undefined, 'catalogue-help'); prop(details, 'open', catalogueDetails);
    children(details, v.el('help-summary', 'summary', 'Some sources may be missing · Details'), ...allNotices.map((notice, index) => v.el(`help-${index}`, 'p', notice, 'muted small')));
    details.ontoggle = () => { if (details.isConnected) catalogueDetails = details.open; }; foundNodes.push(details);
  }
  if (chosenArtist) {
    const crumbs = v.el('crumbs', 'div', undefined, 'actions browse-crumbs');
    const back = v.get('back', () => catalogueButton('', () => browseHistory?.back())); text(back, chosenAlbum ? '← Albums' : '← Artists'); prop(back, 'disabled', !realtime || !view.connected); prop(back, 'id', chosenAlbum ? 'browse-albums' : 'browse-artists'); children(crumbs, back);
    foundNodes.push(crumbs, v.el('browse-title', 'h3', chosenAlbum ? `${chosenArtist.name} · ${chosenAlbum.name}` : `${chosenArtist.name} — albums`),
      v.el('browse-provider', 'p', sourceName(chosenAlbum?.provider ?? chosenArtist.provider), 'muted small'));
  }
  const rowIds = new Set<string>(); const occurrences = new Map<string, number>();
  const row = (kind: 'artist' | 'album' | 'track', item: CatalogueArtist | CatalogueAlbum | CatalogueTrack) => {
    // Repeated references remain separate presentation rows; the opaque playback/browse
    // reference is never rewritten to manufacture a unique source identity.
    const identity = `${kind}:${item.id}`; const occurrence = occurrences.get(identity) ?? 0; occurrences.set(identity, occurrence + 1);
    const key = JSON.stringify([kind, item.id, occurrence]); rowIds.add(key);
    let renderer = catalogueRows.get(key); if (!renderer) { renderer = new CatalogueRow(); catalogueRows.set(key, renderer); }
    return renderer.update(kind, item, { choices: sourceChoices, changed: render, music, online: realtime && view!.connected,
      canPlay: Boolean(view!.myTurn), playbackAvailable: Boolean(view!.catalogue?.playbackAvailable), starting: player.starting,
      play: track => { error = ''; playTrack(track); }, browse: selected => { void runCatalogue(async () => {
        browseHistory?.remember();
        const response = await catalogue.browse(kind === 'artist' ? 'albums' : 'tracks', selected.id);
        if (!response) return;
        if (kind === 'artist') { chosenArtist = selected; chosenAlbum = undefined; albums = response.albums ?? []; albumNotices = response.notices ?? []; results = []; }
        else { chosenAlbum = selected as CatalogueAlbum; results = response.tracks ?? []; trackNotices = response.notices ?? []; }
        return true;
      }); },
    });
  };
  for (const artist of !chosenArtist ? artists : []) {
    foundNodes.push(row('artist', artist));
  }
  for (const album of chosenArtist && !chosenAlbum ? albums : []) {
    foundNodes.push(row('album', album));
  }
  const emptyBrowse = searchDone && searchMode === 'artists' && ((!chosenArtist && !artists.length) || (chosenArtist && !chosenAlbum && !albums.length) || (chosenAlbum && !results.length));
  if (emptyBrowse) foundNodes.push(v.el('empty-browse', 'p', coverageUnconfirmed ? 'No results returned. Try another source or check Details.' : chosenArtist && !chosenAlbum
    ? 'No albums returned for this artist. This provider may not support artist albums; try another provider result or search tracks.'
    : chosenAlbum ? 'No tracks returned for this album.' : 'No artists found. Try another artist name; Music Assistant may omit unavailable sources.', 'muted'));
  if (searchDone && searchMode === 'tracks' && !results.length) {
    const empty = v.el('empty-tracks', 'p', realCatalogue
      ? coverageUnconfirmed ? 'No results returned. Try another source or check Details.' : 'No songs found. Try another title or artist.'
      : 'No tracks found in the demo catalogue. Try “Northern”, “Summer”, or “Night”.', 'muted');
    attr(empty, 'role', 'status'); foundNodes.push(empty);
  }
  for (const group of results) {
    foundNodes.push(row('track', group));
  }
  for (const id of catalogueRows.keys()) if (!rowIds.has(id)) catalogueRows.delete(id);
  children(found, ...foundNodes);
  children(search, ...searchNodes, search.querySelector('.music-upload'), Boolean(searchDone || catalogueBusy || catalogueError) && found);
  const musicPanel = music.render(search, renderPlayback(view));
  children(main, hero, musicPanel);
  return main;
}
function playTrack(track: CatalogueTrack, prepared?: { entryId: string; revision: number }) {
  if (view?.ownPlayback && view.ownPlayback.status !== 'stopped' && !confirm('Replace the current song? Playing this song will stop the current one.')) return;
  player.play(track, prepared);
}
function joinForm() {
  return joinPanel({ nickname: nicknameDraft, busy, disabled: !navigator.onLine, error: joinError,
    notice: participantAccess.removed ? 'You’re no longer in the listening order. Join again when you’re ready. Your saved music is kept.' : undefined,
    changed: value => { nicknameDraft = value; joinError = ''; },
    submit: nickname => { void run(async () => {
      joinError = '';
      try {
        const next = await api<View>('/api/participant/join', { nickname });
        if (page === 'join') location.replace(appPath('/participant')); else participantAccess.enter(next);
      } catch (cause) { joinError = cause instanceof Error ? cause.message : 'Could not join the room. Try again.'; }
    }); },
  }, entryNodes.get('join-form', () => new ViewNodes()));
}

function participantEntry() {
  const v = entryNodes;
  const main = v.get('main', () => pageFrame('compact', page === 'join' ? 'room-join-page' : 'participant-entry'));
  const layout = v.el('layout', 'div', undefined, 'entry-layout stack');
  const state = participantAccess.state;
  let content: HTMLElement;
  if (state === 'unjoined') content = joinForm();
  else {
    const status = v.get('status', () => panel('entry-status'));
    const title = v.el('title', 'h1', state === 'checking' ? 'Checking your place in the room…' : state === 'offline' ? 'You’re offline.' : 'Can’t reach the room.');
    const message = v.el('message', 'p', state === 'checking' ? 'Your saved music is kept separately.' : state === 'offline' ? 'Reconnect to check your place or join the room.' : participantAccess.message, 'muted');
    attr(message, 'role', state === 'error' ? 'alert' : 'status');
    const retry = v.el('retry', 'button', 'Retry', 'secondary'); prop(retry, 'type', 'button'); prop(retry, 'id', 'retry-room'); prop(retry, 'disabled', !navigator.onLine);
    retry.onclick = () => { void participantAccess.check(); };
    children(status, title, message, state !== 'checking' && retry, status.querySelector('.entry-library-access')); content = status;
  }
  const access = music.renderEntry(); if (access.parentElement !== content) content.append(access);
  children(layout, content); children(main, layout); return main;
}
function render() {
  updateHeader();
  if (page === 'settings') return;
  if (page === 'display') { renderDisplay(); return; }
  const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const selection = focused instanceof HTMLInputElement && ['text', 'search', 'password'].includes(focused.type) ? [focused.selectionStart, focused.selectionEnd] as const : null;
  const scrollRegions = [...root.querySelectorAll<HTMLElement>('[data-scroll-key]')].map(node => [node.dataset.scrollKey, node.scrollTop] as const);
  const scrollY = window.scrollY;
  const content: Node[] = [];
  if (error) { const message = pageNodes.get('error', () => notice('', 'error')); text(message, error); content.push(message); }
  if (view && !realtime) content.push(pageNodes.get('connection', () => notice('Connection lost. Your saved songs are kept. Controls return when the room reconnects.', 'connection')));
  else if (view?.playbackIssue) {
    content.push(pageNodes.get('recovery', () => { const message = notice('', 'warning'); message.append('Playback controls lost; the speaker may still be playing. ', page === 'host' ? link('Recover controls in Settings', '/host/settings', 'inline-link') : 'Ask the host to recover controls.'); return message; }));
  } else if (view && !view.connected) content.push(pageNodes.get('unavailable', () => notice('The room cannot confirm playback or save changes. Ask the host to check Settings.', 'error')));
  if (page === 'host') content.push(host());
  else if (page === 'join' && !view) content.push(participantEntry());
  else if (page === 'participant' || page === 'join') content.push(participant());
  else {
    const main = pageFrame('compact', 'home-page');
    const actions = el('div', undefined, 'actions'); actions.append(link('Join room', '/join', 'button'), link('Your music', '/participant'), link('Room display', '/display'));
    main.append(el('h1', productName, 'heading-brand'), el('p', productTagline, 'muted'),
      el('p', 'Join from your phone, prepare private selections, and take turns playing through Music Assistant. Reveal track details on the shared display when you’re ready.', 'muted'),
      actions, link('Host desk', '/host', 'home-host')); content.push(main);
  }
  children(pageContent, ...content);
  updatePlayerReturn();
  for (const [key, top] of scrollRegions) { const region = [...root.querySelectorAll<HTMLElement>('[data-scroll-key]')].find(node => node.dataset.scrollKey === key); if (region) prop(region, 'scrollTop', top); }
  const replacement = focused?.id ? document.getElementById(focused.id)
    : focused?.dataset.focusKey ? [...root.querySelectorAll<HTMLElement>('[data-focus-key]')].find(node => node.dataset.focusKey === focused.dataset.focusKey) : null;
  if (replacement instanceof HTMLElement && replacement !== document.activeElement) {
    restoringFocus = true;
    replacement.focus({ preventScroll: true });
    if (selection && replacement instanceof HTMLInputElement) replacement.setSelectionRange(selection[0], selection[1]);
    restoringFocus = false;
  }
  if (window.scrollY !== scrollY) window.scrollTo({ top: scrollY, behavior: 'instant' });
}
async function init() {
  render();
  if (page === 'settings') {
    if (!settingsMounted) { settingsMounted = true; await mountSettings(pageContent); }
    return;
  }
  if (page === 'home') return;
  if (page === 'display') {
    history.replaceState(null, '', '/display');
    try {
      accept(await api<View>('/api/display/state')); subscribe('display');
    } catch (cause) { error = (cause as Error).message; render(); }
  } else if (page === 'host') {
    try { accept(await api<View>('/api/host/state')); subscribe('host'); }
    catch { error = 'Cannot connect to the app. Check the connection and reload.'; render(); }
  } else {
    if (page === 'join') history.replaceState(null, '', '/join');
    void library.start();
    await participantAccess.check();
  }
}
void init();
window.addEventListener('hashchange', () => {
  if ((page === 'display' && location.hash.startsWith('#access=')) || (page === 'join' && location.hash.startsWith('#invite='))) history.replaceState(null, '', location.pathname);
});
window.addEventListener('pagehide', () => { realtime = false; player.cancel(); catalogue.cancel(); stream?.close(); listeningOrder.stop(); library.stop(); music.uploads.stop(); });
window.addEventListener('pageshow', event => { if (event.persisted) void init(); });
window.addEventListener('offline', () => {
  listeningOrder.stop(); listeningOrder.update(view, false);
  if (page === 'settings' || page === 'home') return;
  realtime = false; player.cancel(); catalogue.cancel(); stream?.close(); stream = undefined; render();
  if (page === 'participant' || page === 'join') participantAccess.offline();
  library.stop();
  music.uploads.stop();
});
window.addEventListener('online', () => {
  updateHeader();
  if (page === 'participant' && accessEnded) void library.start();
  if (page !== 'settings' && page !== 'home' && !accessEnded) void init();
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden || !navigator.onLine || !['participant', 'host', 'display'].includes(page)) return;
  if (page === 'participant') { void participantAccess.check(); void library.start(); }
  else void api<View>(`/api/${page}/state`).then(accept).catch(() => { realtime = false; render(); });
});
