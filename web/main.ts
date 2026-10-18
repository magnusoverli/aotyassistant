import QRCode from 'qrcode';
import type { CatalogueTrack, CatalogueArtist, CatalogueAlbum, View } from '../src/model';
import { catalogueSearchNotice } from '../src/catalogue-messages';
import { mountSettings } from './settings';
import { el, label, link } from './dom';
import { avatar, vinyl } from './visuals';
import { ListeningOrder } from './listening-order';
import { AppHeader } from './app-header';
import { pageForPath } from './navigation';
import { artwork, progressBar, updateProgress, volumeControl, updateVolume, progressConnected, displayedProgress } from './media';
import { PlayerController } from './player-controller';
import { PublicRoom } from './public-room';
import { PreparationController } from './preparation-controller';
import { PreparationPanel } from './preparation-panel';
import type { PreparedEntryView, PreparationView } from '../src/preparations';
import { requestJson } from './request';
import { CatalogueController, catalogueIdentity } from './catalogue-controller';
import { catalogueSourceChoice, sourceName } from './catalogue-sources';
import { participantEvents } from './participant-events';
import { BrowseHistory } from './browse-history';
import { copyButton } from './copy-text';
import './style.css';
import { appPath, pagePath, guestLinksReady, setGuestOrigin } from './paths';
import { joinPanel } from './join-panel';
import { ParticipantAccess } from './participant-access';
import { pageFrame, workspaceGrid, slot, stackedLayout } from './page-layout';
import { panel, pageHeading, sectionHeading, notice } from './ui-components';

const page = pageForPath(pagePath(location.pathname));
document.title = `${({ home: 'Home', join: 'Join room', participant: 'My music', display: 'Room display', host: 'Host desk', settings: 'Settings' })[page]} · Albums of the Year`;
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
    if (kind === 'volume' && view) updateVolume(root, player.project(view).volume);
    else renderParticipantPlayer();
  },
  failed: message => { error = message; render(); },
});
const library = new PreparationController(() => {
  if (page === 'participant' && view?.me && root.querySelector('.preparation-list')) music.refresh(); else render();
}, () => Boolean(view?.me));
const music = new PreparationPanel(library, { getView: () => view, starting: () => player.starting,
  canPlay: () => realtime && Boolean(view?.connected && view.myTurn && view.catalogue?.playbackAvailable), changed: render,
  play: (entry: PreparedEntryView) => {
    if (!library.view) return;
    const track: CatalogueTrack = { id: `prepared:${entry.id}`, title: entry.title, artist: entry.artist, album: entry.album, version: entry.version,
      provider: entry.provider, duration: entry.duration, available: entry.sourceAvailable !== false, artwork: entry.artwork, artistArtwork: entry.artistArtwork };
    playTrack(track, { entryId: entry.id, revision: library.view.revision });
  },
});
const appHeader = new AppHeader(page, message => { error = message; render(); });
const listeningOrder = new ListeningOrder(page === 'host' ? {
  disabled: () => busy || !realtime || !view?.connected,
  move: (id, shift) => { void run(async () => {
    if (!view) return;
    const ids = (view.rotation ?? []).map(person => person.id); const index = ids.indexOf(id);
    if (index < 0 || index + shift < 0 || index + shift >= ids.length) return;
    const name = view.rotation![index]!.nickname; const revision = view.revision;
    [ids[index], ids[index + shift]] = [ids[index + shift]!, ids[index]!];
    await mutate('/api/host/reorder', { ids, revision }); listeningOrder.message(`Moved ${name} ${shift < 0 ? 'up' : 'down'}.`);
  }); },
  remove: id => { void run(async () => {
    const person = view?.rotation?.find(person => person.id === id); if (!view || !person) return;
    if (id === view.current?.id && !confirm(`Remove ${person.nickname} from the room? This ends their turn and stops any app-owned song.`)) return;
    await mutate('/api/host/remove', { id, revision: view.revision }); listeningOrder.message(`Removed ${person.nickname}. Their saved music is kept.`);
  }); },
} : undefined);
appHeader.element.append(listeningOrder.element);
const pageContent = el('div', undefined, 'app-content'); pageContent.id = 'main-content'; pageContent.tabIndex = -1;
root.replaceChildren(appHeader.element, pageContent);
const updateHeader = () => {
  progressConnected(realtime && Boolean(view?.connected));
  appHeader.update({ view });
  listeningOrder.update(view, realtime && navigator.onLine);
};
const participantAccess = new ParticipantAccess(
  () => api<View>('/api/participant/state'), () => navigator.onLine,
  next => {
    if (page === 'join') { view = next; location.replace(appPath('/participant')); return; }
    accept(next); subscribe('participant');
  },
  () => {
    view = undefined; realtime = false; stream?.close(); stream = undefined; player.cancel(); catalogue.cancel();
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
  const obstruction = stackedLayout() && focused.closest('.catalogue-results') && list && getComputedStyle(list).position === 'sticky' ? Math.max(headerBottom, list.getBoundingClientRect().bottom + 12) : headerBottom;
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

function playerButton(text: string, action: () => void, secondary = false) {
  const b = el('button', text, secondary ? 'secondary' : ''); b.type = 'button';
  b.disabled = !realtime || !view?.connected || !view.myTurn;
  b.onclick = () => { error = ''; action(); }; return b;
}

function button(text: string, action: () => Promise<void> | void, secondary = false, alwaysEnabled = false) {
  const b = el('button', text, secondary ? 'secondary' : '');
  b.type = 'button'; b.disabled = busy || (!alwaysEnabled && (!realtime || !view?.connected));
  b.addEventListener('click', () => { void run(action); }); return b;
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
    window.scrollTo({ top: Math.max(0, scrollY + results.getBoundingClientRect().top - top), behavior: 'instant' });
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
  return JSON.stringify({ ...current, revision: undefined, ownPlayback: undefined, progress: undefined, playbackStatus: undefined, nowPlaying: undefined,
    volume: [current.volume?.available, current.volume?.revision] });
}
function accept(next: View) {
  accessEnded = false;
  if (view?.roomId === next.roomId && view.revision > next.revision) return;
  if (view?.volume?.revision === next.volume?.revision && (view?.volume?.generation ?? 0) > (next.volume?.generation ?? 0)) next = { ...next, volume: view!.volume };
  if (catalogueIdentity(view) !== catalogueIdentity(next)) {
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
    for (const frame of root.querySelectorAll<HTMLElement>('.playback-progress')) if (!frame.querySelector('.player-pending')) updateProgress(frame, shown.progress);
    updateVolume(root, shown.volume); return;
  }
  if (playerOnly) { renderParticipantPlayer(); return; }
  if (page === 'participant' && next.me) {
    const position = next.position;
    const turnMessage = next.myTurn ? 'It’s your turn to share.'
      : next.current ? `${next.current.nickname}’s turn. ${position?.turnsUntil === 1 ? 'You are up next.' : position?.turnsUntil != null ? `Your turn is ${position.turnsUntil} turns away.` : ''}`
      : 'The listening circle is ready.';
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
    if (qrImage) { const img = el('img'); img.src = qrImage; img.alt = 'Scan to join the listening room'; card.append(img); }
    card.append(el('p', 'Scan the QR code to join.', 'muted'));
    const address = el('input'); address.value = view.joinUrl; address.readOnly = true; address.setAttribute('aria-label', 'Join link'); address.className = 'join-link-field';
    card.append(address, copyButton('Copy join link', address));
    const invitation = link('Open guest invitation ↗', view.joinUrl); invitation.target = '_blank'; invitation.rel = 'noopener noreferrer'; card.append(invitation);
  }
  if (view?.displayUrl) {
    const display = link('Open public display ↗', view.displayUrl); display.target = '_blank'; display.rel = 'noopener noreferrer'; card.append(display);
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
  const message = document.getElementById('display-notice')!; message.textContent = error; message.hidden = !error;
  publicRoom.update(view, realtime, qrImage);
}
function closedRoom() {
  const main = pageFrame('display', 'room-closed');
  const record = el('div', undefined, 'welcome-record'); record.append(vinyl());
  main.append(record, el('h1', 'Listening room'), el('p', 'Connecting to the room…', 'muted'));
  return main;
}
function host() {
  const main = pageFrame('workspace', 'host-page');
  main.setAttribute('aria-label', 'Host desk');
  main.append(pageHeading('Host desk'));
  const grid = workspaceGrid('sidebar');
  const workspace = slot(el('div', undefined, 'host-workspace stack'), 'primary'); workspace.id = 'overview';
  const aside = slot(el('aside', undefined, 'host-invitations'), 'secondary'); aside.id = 'room-invitation'; aside.append(qrCard());
  aside.setAttribute('aria-label', 'Room invitation'); grid.append(workspace, aside); main.append(grid);
  if (!view) return main;
  const active = view.active ?? []; const turnId = view.turnId;
  if (!active.length) {
    main.classList.add('is-empty'); workspace.append(el('p', 'Share the room. The first person to join gets the first turn.', 'muted'));
    if (!view.playbackAvailable || view.mode === 'demo') workspace.append(link('Set up music and speaker', '/host/settings'));
    return main;
  }
  const audio = panel('host-audio'); const audioTitle = el('div'); audioTitle.append(el('h2', 'Speaker volume'));
  if (!view?.volume?.available) {
    const hint = el('p', undefined, 'muted small');
    hint.append('Volume is unavailable. ', link('Check speaker settings', '/host/settings', 'volume-settings-link'));
    audioTitle.append(hint);
  }
  audio.append(audioTitle, volumeControl(view ? player.project(view).volume : undefined, (level, commit) => player.volume(level, commit), !realtime || !view?.connected));
  workspace.append(audio);
  const live = panel('host-live', { tone: 'highlight' }); const livePerson = el('div', undefined, 'host-live-person');
  const personInfo = el('div'); personInfo.append(label('CURRENT PARTICIPANT'), el('h2', view.current?.nickname ?? 'Waiting for participants'));
  const status = view.playbackStatus === 'playing' ? 'Playing' : view.playbackStatus === 'paused' ? 'Paused' : view.playbackStatus === 'unavailable' ? 'Unavailable' : 'Choosing a song';
  personInfo.append(el('p', `${status}${active.length > 1 && view.next ? ` · Next: ${view.next.nickname}` : ''}`, 'muted host-playback-status'));
  livePerson.append(avatar(view.current, 'avatar-large'), personInfo); live.append(livePerson);
  const controls = el('div', undefined, 'host-live-actions');
  const advance = button('Skip turn', () => {
    if (view?.playbackStatus !== 'idle' && !confirm('Stop the current song and skip to the next person?')) return;
    return mutate('/api/host/advance', { turnId });
  }); advance.disabled ||= !view.current; controls.append(advance);
  live.append(controls); workspace.prepend(live);
  return main;
}
function renderParticipantPlayer() {
  const card = root.querySelector('.playback-card');
  if (page !== 'participant' || !view?.me || !card || root.querySelector('.app-content > .error')) { render(); return; }
  const focused = document.activeElement instanceof HTMLElement && card.contains(document.activeElement) ? document.activeElement.id : '';
  const top = scrollY;
  card.replaceWith(participantPlayer(view));
  // Starting a track changes availability, not the search/list layout or their DOM state.
  for (const control of root.querySelectorAll<HTMLButtonElement>('[data-player-ready]')) control.disabled = control.dataset.playerReady !== 'true' || player.starting;
  if (focused) document.getElementById(focused)?.focus({ preventScroll: true });
  window.scrollTo({ top, behavior: 'instant' });
}
function participantPlayer(current: View) {
  const shown = player.project(current); const playback = current.myTurn ? shown.ownPlayback : undefined;
  const card = slot(panel('playback-card', { tone: 'highlight', density: 'compact' }), 'player'); card.id = 'participant-player'; card.setAttribute('aria-label', 'Your player');
  const now = el('div', undefined, 'private-now-playing');
  const track = el('div'); const title = el('h2', playback?.track.title ?? (current.myTurn ? 'Choose a song' : 'Waiting for your turn'));
  title.title = title.textContent!; track.append(title);
  const artist = el('div', undefined, 'artist-credit');
  if (playback?.track.artistArtwork) artist.append(artwork(playback.track.artistArtwork, 'Artist image', 'artist-portrait'));
  const credit = el('p', playback?.track.artist ?? 'Search or use your list.', 'artist'); credit.title = credit.textContent!;
  artist.append(credit); track.append(artist);
  now.append(artwork(playback?.track.artwork, 'Album artwork', 'mini-record'), track);
  const progress = progressBar(playback ? shown.progress : undefined);
  if (player.starting) {
    const status = progress.querySelector<HTMLElement>('.playback-status')!;
    status.textContent = 'Starting track…'; status.classList.add('player-pending');
  }
  const statusLine = el('div', undefined, 'player-status-line');
  statusLine.append(progress.querySelector('.playback-status')!, el('span', playback ? playback.revealed ? current.ownPlayback?.revealed ? 'Visible on room display' : 'Revealing…' : 'Hidden on room display' : 'Your player', 'privacy-tag'));
  progress.prepend(statusLine);
  const controls = el('div', undefined, 'actions');
  const action = playback?.status === 'paused' ? 'resume' : 'pause';
  const transport = playerButton(action === 'pause' ? 'Pause' : 'Resume', () => player.control(action), true);
  transport.id = 'player-transport'; transport.disabled ||= !playback || playback.status === 'stopped';
  const reveal = playerButton(playback?.revealed ? 'Revealed' : 'Reveal song', () => player.reveal());
  reveal.id = 'player-reveal'; reveal.classList.add('reveal-button'); reveal.disabled ||= !playback || playback.revealed;
  controls.append(transport, reveal);
  const finish = button(playback ? 'Finish turn' : 'Pass turn', () => { player.cancel(); return mutate('/api/participant/finish', { turnId: current.turnId }); }, true);
  finish.id = 'finish-my-turn'; finish.disabled ||= !current.myTurn || player.starting;
  const ending = el('div', undefined, 'player-ending'); ending.append(finish);
  card.append(now, progress, controls,
    volumeControl(shown.volume, (level, commit) => player.volume(level, commit), !realtime || !current.connected || !playback || playback.status === 'stopped' || player.starting), ending);
  return card;
}
function participant() {
  if (!view?.me) return participantEntry();
  const main = pageFrame('workspace', 'participant-page');
  const position = view.position;
  const state = view.myTurn ? 'mine' : position?.turnsUntil === 1 ? 'next' : 'listening';
  main.dataset.turnState = state;
  const hero = el('section', undefined, `participant-hero is-${state}`); hero.setAttribute('aria-label', 'Your turn status');
  const title = el('h1', view.myTurn ? 'Your turn.' : view.current ? `${view.current.nickname}’s turn.` : 'Listening circle'); title.title = title.textContent!;
  hero.append(title, el('p', !view.myTurn && position ? position.turnsUntil === 1 ? 'You’re next' : `${position.turnsUntil} turns away` : '', 'turn-distance'));
  main.append(hero);
  const search = el('section', undefined, 'catalogue-panel');
  search.setAttribute('aria-labelledby', 'music-find-title');
  const searchHeading = sectionHeading('Find music', 'music-find-title'); searchHeading.append(el('span', 'Private search', 'privacy-tag')); search.append(searchHeading);
  const realCatalogue = view.catalogue?.source === 'music-assistant';
  if (realCatalogue && !view.catalogue?.playbackAvailable) {
    const hint = el('p', undefined, 'muted small');
    hint.append('Choose a speaker in ', link('host settings', '/host/settings', 'inline-link'), ' before playing. You can still prepare tracks.'); search.append(hint);
  }
  if (realCatalogue) {
    const modes = el('div', undefined, 'actions search-tabs');
    for (const mode of ['artists', 'tracks'] as const) {
      const tab = catalogueButton(mode === 'tracks' ? 'Songs' : 'Artists', () => {
        browseHistory?.remember();
        searchMode = mode; searchDone = false; results = []; artists = []; albums = []; chosenArtist = undefined; chosenAlbum = undefined;
        sourceChoices.clear(); artistNotices = []; albumNotices = []; trackNotices = [];
        browseHistory?.push();
      }, searchMode !== mode); tab.id = `catalogue-mode-${mode}`; tab.setAttribute('aria-pressed', String(searchMode === mode)); modes.append(tab);
    }
    search.append(modes);
  }
  const form = el('form', undefined, 'search-form');
  const input = el('input'); input.type = 'search'; input.enterKeyHint = 'search'; input.placeholder = realCatalogue ? (searchMode === 'artists' ? 'Artist name' : 'Song, artist, or album') : 'Try Northern or Night'; input.required = true; input.maxLength = 200;
  input.id = 'catalogue-search';
  input.setAttribute('aria-label', 'Search catalogue'); input.value = searchText; input.oninput = () => { searchText = input.value; };
  const submit = el('button', searching ? 'Searching…' : 'Search'); submit.id = 'catalogue-search-submit'; submit.type = 'submit'; submit.disabled = !realtime || !view.connected;
  form.append(input, submit);
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
  }; search.append(form);
  const found = panel('catalogue-results'); found.setAttribute('aria-labelledby', 'music-results-title');
  found.setAttribute('aria-busy', String(catalogueBusy));
  const resultsHeading = sectionHeading(chosenArtist ? 'Browse music' : 'Results', 'music-results-title'); found.append(resultsHeading);
  const resultKind = searchMode === 'artists' && !chosenAlbum ? chosenArtist ? 'album' : 'artist' : 'track';
  const resultCount = resultKind === 'album' ? albums.length : resultKind === 'artist' ? artists.length : results.length;
  const resultSummary = `${resultCount} ${resultKind}${resultCount === 1 ? '' : 's'}`;
  if (searchDone && !searching) resultsHeading.append(el('span', resultSummary, 'count-tag'));
  const allNotices = resultKind === 'artist' ? artistNotices : resultKind === 'album' ? albumNotices : trackNotices;
  // Keep API coverage caveats available without repeating a warning banner on every successful search.
  const notices = allNotices.filter(notice => notice !== catalogueSearchNotice);
  const coverageUnconfirmed = notices.length > 0 || allNotices.length > notices.length;
  const announcement = searching ? 'Searching…' : searchDone ? `${resultSummary} ${realCatalogue ? 'returned' : 'found'}.${coverageUnconfirmed ? ' Source coverage unconfirmed.' : ''}` : '';
  if (searchAnnouncement.textContent !== announcement) searchAnnouncement.textContent = announcement;
  if (catalogueError) {
    const notice = el('div', undefined, 'list-notice'); const message = el('p', catalogueError); message.setAttribute('role', 'alert'); notice.append(message);
    if (catalogueRetry) { const retry = catalogueRetry; const control = catalogueButton('Try again', retry); control.id = 'catalogue-retry'; notice.append(control); }
    found.append(notice);
  }
  if (!searchDone && !searching && !catalogueError) found.append(el('p', 'Search for music to add to your private list.', 'muted small'));
  if (searching) { const status = el('p', 'Searching…', 'muted'); status.setAttribute('role', 'status'); found.append(status); }
  else if (catalogueBusy) { const status = el('p', 'Loading music…', 'muted'); status.setAttribute('role', 'status'); found.append(status); }
  if (coverageUnconfirmed) {
    const details = el('details', undefined, 'catalogue-help'); details.open = catalogueDetails;
    details.append(el('summary', 'Some sources may be missing · Details'));
    for (const notice of allNotices) details.append(el('p', notice, 'muted small'));
    details.ontoggle = () => { if (details.isConnected) catalogueDetails = details.open; }; found.append(details);
  }
  if (chosenArtist) {
    const crumbs = el('div', undefined, 'actions browse-crumbs');
    const back = catalogueButton(chosenAlbum ? '← Albums' : '← Artists', () => browseHistory?.back()); back.id = chosenAlbum ? 'browse-albums' : 'browse-artists'; crumbs.append(back);
    found.append(crumbs, el('h3', chosenAlbum ? `${chosenArtist.name} · ${chosenAlbum.name}` : `${chosenArtist.name} — albums`),
      el('p', sourceName(chosenAlbum?.provider ?? chosenArtist.provider), 'muted small'));
  }
  for (const artist of !chosenArtist ? artists : []) {
    const source = catalogueSourceChoice(artist, artist.name, sourceChoices, render, 'artist');
    const shown = source.item ?? artist;
    const row = el('div', undefined, 'track-row browse-row'); const info = el('div', undefined, 'result-identity'); const copy = el('div'); copy.append(el('strong', shown.name), el('p', sourceName(artist.provider), 'muted')); info.append(artwork(artist.matchKind === 'metadata' && !source.item ? undefined : shown.artwork, 'Artist image', 'result-artwork artist-portrait'), copy);
    if (source.control) copy.append(source.control);
    const browse = catalogueButton('View albums', async () => {
      if (!source.item) return;
      browseHistory?.remember();
      const response = await catalogue.browse('albums', source.item!.id);
      if (response) { chosenArtist = source.item; chosenAlbum = undefined; albums = response.albums ?? []; albumNotices = response.notices ?? []; results = []; return true; }
    }, true); browse.disabled ||= !source.item; row.append(info, browse); found.append(row);
  }
  for (const album of chosenArtist && !chosenAlbum ? albums : []) {
    const source = catalogueSourceChoice(album, album.name, sourceChoices, render, 'album');
    const shown = source.item ?? album; const unchosen = album.matchKind === 'metadata' && !source.item;
    const row = el('div', undefined, 'track-row browse-row'); const info = el('div', undefined, 'result-identity'); const copy = el('div'); copy.append(el('strong', shown.name),
      el('p', [unchosen ? null : shown.year, shown.version, sourceName(album.provider)].filter(Boolean).join(' · '), 'muted'));
    info.append(artwork(unchosen ? undefined : shown.artwork, 'Album artwork', 'result-artwork'), copy);
    if (source.control) copy.append(source.control);
    const browse = catalogueButton('View tracks', async () => {
      if (!source.item) return;
      browseHistory?.remember();
      const response = await catalogue.browse('tracks', source.item!.id);
      if (response) { chosenAlbum = source.item; results = response.tracks ?? []; trackNotices = response.notices ?? []; return true; }
    }, true); browse.disabled ||= !source.item; row.append(info, browse); found.append(row);
  }
  const emptyBrowse = searchDone && searchMode === 'artists' && ((!chosenArtist && !artists.length) || (chosenArtist && !chosenAlbum && !albums.length) || (chosenAlbum && !results.length));
  if (emptyBrowse) found.append(el('p', coverageUnconfirmed ? 'No results returned. Try another source or check Details.' : chosenArtist && !chosenAlbum
    ? 'No albums returned for this artist. This provider may not support artist albums; try another provider result or search tracks.'
    : chosenAlbum ? 'No tracks returned for this album.' : 'No artists found. Try another artist name; Music Assistant may omit unavailable sources.', 'muted'));
  if (searchDone && searchMode === 'tracks' && !results.length) {
    const empty = el('p', realCatalogue
      ? coverageUnconfirmed ? 'No results returned. Try another source or check Details.' : 'No songs found. Try another title or artist.'
      : 'No tracks found in the demo catalogue. Try “Northern”, “Summer”, or “Night”.', 'muted');
    empty.setAttribute('role', 'status'); found.append(empty);
  }
  for (const group of results) {
    const source = catalogueSourceChoice(group, group.title, sourceChoices, render);
    const track = source.item ?? group;
    const row = el('div', undefined, `track-row${library.added.has(track.id) ? ' is-prepared' : ''}`); const info = el('div', undefined, 'result-identity'); const copy = el('div');
    copy.append(el('strong', track.title), el('p', track.artist, 'result-artist'), el('p', [track.album, track.version, sourceName(track.provider)].filter(Boolean).join(' · '), 'muted result-details'));
    info.append(artwork(group.matchKind === 'metadata' && !source.item ? undefined : track.artwork, 'Album artwork', 'result-artwork'), copy);
    if (source.control) copy.append(source.control);
    if (source.item && !track.available) copy.append(el('p', 'Unavailable through this source', 'muted small'));
    const controls = el('div', undefined, 'row-actions');
    const add = music.addButton(track); add.dataset.sourceSelectable = String(Boolean(source.item)); add.disabled ||= !source.item; controls.append(add);
    const play = playerButton(!source.item ? 'Choose a source' : !track.available ? 'Unavailable' : !view.catalogue?.playbackAvailable ? 'Choose a speaker' : 'Play', () => playTrack(track));
    play.disabled ||= !source.item || !track.available || !view.catalogue?.playbackAvailable;
    play.dataset.playerReady = String(!play.disabled); play.disabled ||= player.starting; controls.append(play);
    row.append(info, controls);
    found.append(row);
  }
  const musicPanel = music.render(search, searchDone || catalogueBusy || catalogueError ? found : undefined);
  musicPanel.prepend(participantPlayer(view));
  main.append(musicPanel);
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
  });
}

function participantEntry() {
  const main = pageFrame('compact', page === 'join' ? 'room-join-page' : 'participant-entry');
  const layout = el('div', undefined, 'entry-layout stack');
  const state = participantAccess.state;
  if (state === 'unjoined') layout.append(joinForm());
  else {
    const status = panel('entry-status');
    const title = el('h1', state === 'checking' ? 'Checking your place in the room…' : state === 'offline' ? 'You’re offline.' : 'Can’t reach the room.');
    status.append(title);
    const message = el('p', state === 'checking' ? 'Your saved music is kept separately.' : state === 'offline' ? 'Reconnect to check your place or join the room.' : participantAccess.message, 'muted');
    message.setAttribute('role', state === 'error' ? 'alert' : 'status'); status.append(message);
    if (state !== 'checking') {
      const retry = el('button', 'Retry', 'secondary'); retry.type = 'button'; retry.id = 'retry-room'; retry.disabled = !navigator.onLine;
      retry.onclick = () => { void participantAccess.check(); }; status.append(retry);
    }
    layout.append(status);
  }
  layout.firstElementChild!.append(music.renderEntry());
  main.append(layout); return main;
}
function render() {
  updateHeader();
  if (page === 'settings') return;
  if (page === 'display') { renderDisplay(); return; }
  const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const selection = focused instanceof HTMLInputElement && ['text', 'search', 'password'].includes(focused.type) ? [focused.selectionStart, focused.selectionEnd] as const : null;
  const scrollRegions = [...root.querySelectorAll<HTMLElement>('[data-scroll-key]')].map(node => [node.dataset.scrollKey, node.scrollTop] as const);
  const scrollY = window.scrollY;
  const content = document.createDocumentFragment();
  if (error) content.append(notice(error, 'error'));
  if (view && !realtime) content.append(notice('Connection lost. Your saved songs are kept. Controls return when the room reconnects.', 'connection'));
  else if (view?.playbackIssue) {
    const message = notice('', 'warning'); message.append('Playback controls lost; the speaker may still be playing. ', page === 'host' ? link('Recover controls in Settings', '/host/settings', 'inline-link') : 'Ask the host to recover controls.'); content.append(message);
  } else if (view && !view.connected) content.append(notice('The room cannot confirm playback or save changes. Ask the host to check Settings.', 'error'));
  if (page === 'host') content.append(host());
  else if (page === 'join' && !view) content.append(participantEntry());
  else if (page === 'participant' || page === 'join') content.append(participant());
  else {
    const main = pageFrame('compact', 'home-page');
    const actions = el('div', undefined, 'actions'); actions.append(link('Join room', '/join', 'button'), link('My music', '/participant'), link('Room display', '/display'));
    main.append(el('h1', 'Albums of the Year', 'heading-brand'), el('p', 'Take turns sharing the music you love.', 'muted'), actions, link('Host desk', '/host', 'home-host')); content.append(main);
  }
  pageContent.replaceChildren(content);
  for (const [key, top] of scrollRegions) { const region = [...root.querySelectorAll<HTMLElement>('[data-scroll-key]')].find(node => node.dataset.scrollKey === key); if (region) region.scrollTop = top; }
  const replacement = focused?.id ? document.getElementById(focused.id)
    : focused?.dataset.focusKey ? [...root.querySelectorAll<HTMLElement>('[data-focus-key]')].find(node => node.dataset.focusKey === focused.dataset.focusKey) : null;
  if (replacement instanceof HTMLElement) {
    restoringFocus = true;
    replacement.focus({ preventScroll: true });
    if (selection && replacement instanceof HTMLInputElement) replacement.setSelectionRange(selection[0], selection[1]);
    restoringFocus = false;
  }
  window.scrollTo({ top: scrollY, behavior: 'instant' });
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
    catch { error = 'Cannot reach the backend. Reload when it is available.'; render(); }
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
