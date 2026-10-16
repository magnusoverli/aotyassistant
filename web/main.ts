import QRCode from 'qrcode';
import type { CatalogueTrack, CatalogueArtist, CatalogueAlbum, View } from '../src/model';
import { catalogueSearchNotice } from '../src/catalogue-messages';
import { mountSettings } from './settings';
import { el, label, link } from './dom';
import { avatar, vinyl, rotation } from './visuals';
import { AppHeader } from './app-header';
import { pageForPath } from './navigation';
import { artwork, progressBar, updateProgress, volumeControl, updateVolume } from './media';
import { PlayerController } from './player-controller';
import { PublicRoom } from './public-room';
import { PreparationController } from './preparation-controller';
import { PreparationPanel } from './preparation-panel';
import type { PreparedEntryView, PreparationView } from '../src/preparations';
import { requestJson } from './request';
import { CatalogueController, catalogueIdentity } from './catalogue-controller';
import { catalogueSourceChoice } from './catalogue-sources';
import './style.css';
import { appPath, pagePath, guestLinksReady, setGuestOrigin } from './paths';
import { joinPanel } from './join-panel';
import { ParticipantAccess } from './participant-access';

const page = pageForPath(pagePath(location.pathname));
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
let searchMode: 'tracks' | 'artists' = 'artists';
let artists: CatalogueArtist[] = [];
let albums: CatalogueAlbum[] = [];
let chosenArtist: CatalogueArtist | undefined;
let chosenAlbum: CatalogueAlbum | undefined;
const sourceChoices = new Map<string, string>();
let artistNotices: string[] = [];
let albumNotices: string[] = [];
let trackNotices: string[] = [];
let stream: EventSource | undefined;
let qrUrl = '';
let qrImage = '';
let nicknameDraft = '';
let accessEnded = false;
let circleExpanded = false;
let publicRoom: PublicRoom | undefined;
let settingsMode: View['mode'] | undefined;
let settingsMounted = false;
document.body.dataset.view = page;
const player = new PlayerController({
  role: page === 'host' ? 'host' : 'participant', getView: () => view,
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
    else render();
  },
  failed: message => { error = message; render(); },
});
const library = new PreparationController(() => render(), () => Boolean(view?.me));
const music = new PreparationPanel(library, { getView: () => view, starting: () => player.starting,
  canPlay: () => realtime && Boolean(view?.connected && view.myTurn && view.catalogue?.playbackAvailable), changed: render,
  play: (entry: PreparedEntryView) => {
    if (!library.view) return;
    if (view?.ownPlayback && view.ownPlayback.status !== 'stopped' && !confirm('Replace the current track with your next prepared choice?')) return;
    const track: CatalogueTrack = { id: `prepared:${entry.id}`, title: entry.title, artist: entry.artist, album: entry.album, version: entry.version,
      provider: entry.provider, duration: entry.duration, available: entry.sourceAvailable !== false, artwork: entry.artwork, artistArtwork: entry.artistArtwork };
    player.play(track, { entryId: entry.id, revision: library.view.revision });
  },
});
const appHeader = new AppHeader(page, message => { error = message; render(); });
const pageContent = el('div', undefined, 'app-content'); pageContent.id = 'main-content'; pageContent.tabIndex = -1;
root.replaceChildren(appHeader.element, pageContent);
const updateHeader = () => appHeader.update({ view, mode: page === 'settings' ? settingsMode : undefined });
const participantAccess = new ParticipantAccess(
  () => api<View>('/api/participant/state'), () => navigator.onLine,
  next => {
    if (page === 'join') { view = next; location.replace(appPath('/participant')); return; }
    accept(next); subscribe('participant');
  },
  () => {
    view = undefined; realtime = false; stream?.close(); stream = undefined; player.cancel(); catalogue.cancel();
    results = []; searchDone = false; searching = false; artists = []; albums = []; chosenArtist = undefined; chosenAlbum = undefined;
    sourceChoices.clear(); artistNotices = []; albumNotices = []; trackNotices = [];
    searchAnnouncement.textContent = '';
  }, render,
);
let restoringFocus = false;
function keepMusicFocusVisible() {
  if (restoringFocus || page !== 'participant') return;
  const focused = document.activeElement;
  if (!(focused instanceof HTMLElement) || !focused.closest('.music-workspace')) return;
  const headerBottom = appHeader.element.getBoundingClientRect().bottom + 12;
  const list = root.querySelector<HTMLElement>('.preparation-list');
  const obstruction = innerWidth < 1000 && focused.closest('.catalogue-results') && list ? Math.max(headerBottom, list.getBoundingClientRect().bottom + 12) : headerBottom;
  const rect = focused.getBoundingClientRect();
  if (rect.top < obstruction) window.scrollBy({ top: rect.top - obstruction, behavior: 'instant' });
}
root.addEventListener('focusin', () => { if (!restoringFocus) requestAnimationFrame(keepMusicFocusVisible); });
function updateMusicViewport() {
  const height = Math.min(innerHeight, window.visualViewport?.height ?? innerHeight);
  document.documentElement.style.setProperty('--music-viewport-height', `${height}px`);
  document.body.dataset.shortViewport = String(innerWidth < 1000 && height < 600);
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
function accept(next: View) {
  accessEnded = false;
  if (view?.roomId === next.roomId && view.revision > next.revision) return;
  if (view?.volume?.revision === next.volume?.revision && (view?.volume?.generation ?? 0) > (next.volume?.generation ?? 0)) next = { ...next, volume: view!.volume };
  if (catalogueIdentity(view) !== catalogueIdentity(next)) {
    catalogue.cancel();
    results = []; searchText = ''; searchDone = false;
    artists = []; albums = []; chosenArtist = undefined; chosenAlbum = undefined;
    sourceChoices.clear(); artistNotices = []; albumNotices = []; trackNotices = [];
    searchMode = next.catalogue?.source === 'music-assistant' ? 'artists' : 'tracks';
    if (page === 'participant') void library.refresh();
  }
  // Position/volume snapshots do not rebuild browsing forms or reload all artwork.
  const telemetryOnly = view && JSON.stringify({ ...view, progress: undefined, volume: [view.volume?.available, view.volume?.revision] }) === JSON.stringify({ ...next, progress: undefined, volume: [next.volume?.available, next.volume?.revision] });
  view = next;
  if (next.joinUrl) setGuestOrigin(new URL(next.joinUrl).origin);
  player.observe(next);
  if (page !== 'display' && telemetryOnly && root.querySelector('main')) {
    const shown = player.project(next);
    for (const frame of root.querySelectorAll<HTMLElement>('.playback-progress')) updateProgress(frame, shown.progress);
    updateVolume(root, shown.volume); return;
  }
  if (page === 'participant' && next.me) {
    const position = next.position;
    const turnMessage = next.myTurn ? 'It’s your turn to share.'
      : next.current ? `${next.current.nickname} is sharing. ${position?.turnsUntil === 1 ? 'You are up next.' : position?.turnsUntil != null ? `Your turn is ${position.turnsUntil} turns away.` : ''}`
      : 'The listening circle is ready.';
    const announcement = `${position?.seat ? `Seat ${position.seat} of ${position.total}. ` : ''}${turnMessage}`;
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
  stream?.close(); const connection = new EventSource(appPath(`/api/${role}/events`)); stream = connection;
  connection.onopen = () => { /* Wait for the authenticated state snapshot before enabling controls. */ };
  connection.addEventListener('state', event => {
    if (stream !== connection || !navigator.onLine) return;
    const reconnecting = !realtime; realtime = true;
    accept(JSON.parse((event as MessageEvent).data) as View);
    if (reconnecting) render();
  });
  connection.addEventListener('revoked', () => {
    if (stream !== connection) return;
    accessEnded = true;
    turnAnnouncement.textContent = 'You have been removed from the listening room.';
    error = '';
    participantAccess.revoke(); music.uploads.stop();
  });
  connection.onerror = () => { if (stream === connection) { realtime = false; player.cancel(); render(); } };
}
async function mutate(path: string, data: unknown) { accept(await api<View>(path, data)); }

function qrCard() {
  const card = el('section', undefined, 'qr-card');
  card.append(el('h3', 'Join room'));
  if (!guestLinksReady(view?.joinUrl)) { card.append(el('p', 'Detect or configure a guest address in Connections & settings before sharing the room.'), link('Configure guest access', '/host/settings')); return card; }
  if (view?.joinUrl) {
    if (qrImage) { const img = el('img'); img.src = qrImage; img.alt = 'Scan to join the listening room'; card.append(img); }
    card.append(el('p', 'Scan the QR code to join.', 'muted'));
    const invitation = link('Open guest invitation ↗', view.joinUrl); invitation.target = '_blank'; invitation.rel = 'noopener noreferrer'; card.append(invitation);
  }
  if (view?.displayUrl) {
    const display = link('Open public display ↗', view.displayUrl); display.target = '_blank'; display.rel = 'noopener noreferrer'; card.append(display);
  }
  return card;
}
function renderDisplay() {
  if (!view) {
    publicRoom?.destroy();
    publicRoom = undefined;
    const notice = el('div', error, 'error'); notice.hidden = !error; notice.setAttribute('role', 'alert');
    pageContent.replaceChildren(notice, closedRoom()); return;
  }
  if (!publicRoom?.element.isConnected) {
    publicRoom = new PublicRoom();
    const notice = el('div', undefined, 'error'); notice.id = 'display-notice'; notice.setAttribute('role', 'alert');
    pageContent.replaceChildren(notice, publicRoom.element);
  }
  const notice = document.getElementById('display-notice')!; notice.textContent = error; notice.hidden = !error;
  publicRoom.update(view, realtime, qrImage);
}
function closedRoom() {
  const main = el('main', undefined, 'room-closed');
  const record = el('div', undefined, 'welcome-record'); record.append(vinyl());
  main.append(record, el('h1', 'Listening room'), el('p', 'Connecting to the room…', 'muted'));
  return main;
}
function host() {
  const main = el('main', undefined, 'host-page');
  main.setAttribute('aria-label', 'Host desk');
  const workspace = el('div', undefined, 'host-workspace'); workspace.id = 'overview';
  main.append(workspace);
  const audio = el('section', undefined, 'panel host-audio'); const audioTitle = el('div'); audioTitle.append(el('h2', 'Speaker volume'));
  if (!view?.volume?.available) {
    const hint = el('p', undefined, 'muted small');
    hint.append('Volume is unavailable. ', link('Check speaker settings', '/host/settings', 'volume-settings-link'));
    audioTitle.append(hint);
  }
  audio.append(audioTitle, volumeControl(view ? player.project(view).volume : undefined, (level, commit) => player.volume(level, commit), !realtime || !view?.connected));
  workspace.append(audio);
  if (!view) return main;
  const active = view.active ?? [];
  const stats = el('div', undefined, 'host-stats');
  for (const [value, caption] of [[String(active.length).padStart(2, '0'), 'PARTICIPANTS'], [view.next?.nickname ?? '—', 'UP NEXT']]) {
    const stat = el('div', undefined, 'host-stat'); stat.append(label(caption!), el('strong', value)); stats.append(stat);
  }
  const live = el('section', undefined, 'host-live panel'); const livePerson = el('div', undefined, 'host-live-person');
  const personInfo = el('div'); personInfo.append(label('CURRENT PARTICIPANT'), el('h2', view.current?.nickname ?? 'Waiting for participants'));
  livePerson.append(avatar(view.current, 'avatar-large'), personInfo); live.append(livePerson);
  const controls = el('div', undefined, 'host-live-actions');
  const advance = button('Advance / skip current turn', () => mutate('/api/host/advance', { turnId: view!.turnId })); advance.disabled ||= !view.current; controls.append(advance);
  live.append(controls); workspace.prepend(live); workspace.append(stats);
  const people = el('section', undefined, 'panel host-people'); people.id = 'rotation'; people.tabIndex = -1;
  const orderHeading = el('div', undefined, 'section-heading'); const orderTitle = el('div'); orderTitle.append(el('h2', 'Listening order'));
  orderHeading.append(orderTitle, el('span', `${active.length} listeners`, 'count-tag')); people.append(orderHeading);
  if (!active.length) people.append(el('p', 'No participants yet. Share the invitation; the first person to join gets the first turn.', 'muted'));
  active.forEach((person, index) => {
    const row = el('div', undefined, `person-row${person.id === view?.current?.id ? ' is-current' : ''}`);
    row.dataset.personId = person.id;
    const identity = el('div', undefined, 'person-identity'); const name = el('div'); name.append(el('strong', person.nickname),
      el('span', person.id === view?.current?.id ? 'Current turn' : person.id === view?.next?.id ? 'Up next' : `Seat ${index + 1}`, 'muted small'));
    identity.append(el('span', String(index + 1).padStart(2, '0'), 'number'), avatar(person), name); row.append(identity);
    const controls = el('div', undefined, 'row-actions');
    for (const [shift, text] of [[-1, '↑'], [1, '↓']] as const) {
      if (index + shift < 0 || index + shift >= active.length) continue;
      const b = button(text, async () => {
        const ids = (view!.active ?? []).map(p => p.id);
        [ids[index], ids[index + shift]] = [ids[index + shift]!, ids[index]!];
        await mutate('/api/host/reorder', { ids, revision: view!.revision });
      }, true);
      b.dataset.focusKey = `move-${person.id}-${shift}`;
      b.setAttribute('aria-label', `Move ${person.nickname} ${shift === -1 ? 'up' : 'down'}`); controls.append(b);
    }
    controls.append(button('Remove', () => mutate('/api/host/remove', { id: person.id, revision: view!.revision }), true));
    row.append(controls); people.append(row);
  });
  workspace.append(people);
  const aside = el('aside', undefined, 'host-invitations'); aside.append(qrCard());
  aside.setAttribute('aria-label', 'Room invitation');
  main.append(aside); return main;
}
function participant() {
  if (!view?.me) return participantEntry();
  const main = el('main', undefined, 'participant-page');
  const position = view.position;
  const state = view.myTurn ? 'mine' : position?.turnsUntil === 1 ? 'next' : 'listening';
  main.dataset.turnState = state;
  const hero = el('section', undefined, `participant-hero is-${state}`); hero.setAttribute('aria-label', 'Your turn status');
  hero.append(el('h1', view.myTurn ? 'Your turn.' : view.current ? `${view.current.nickname} is sharing.` : 'Listening circle'));
  const circle = rotation(view, false, circleExpanded);
  circle.addEventListener('toggle', () => { if (circle.isConnected && circle instanceof HTMLDetailsElement) circleExpanded = circle.open; });
  main.append(hero, circle);
  const shown = player.project(view); const playback = shown.ownPlayback;
  const turnId = view.turnId;
  const finish = view.myTurn ? button('Finish my turn', () => { player.cancel(); return mutate('/api/participant/finish', { turnId }); }, true) : undefined;
  if (finish) { finish.id = 'finish-my-turn'; finish.disabled ||= player.starting; }
  if (view.myTurn && playback) {
    const card = el('section', undefined, 'panel playback-card');
    const cardHeading = el('div', undefined, 'section-heading'); cardHeading.append(label('YOUR TRACK'), el('span', playback.revealed ? view.ownPlayback?.revealed ? 'Revealed' : 'Revealing…' : 'Hidden from the room', 'privacy-tag'));
    card.append(cardHeading);
    if (player.updating) { const pending = el('p', player.starting ? 'Starting track…' : 'Updating player…', 'player-pending'); pending.setAttribute('role', 'status'); card.append(pending); }
    const now = el('div', undefined, 'private-now-playing');
    const track = el('div'); track.append(el('h2', playback.track.title));
    const artist = el('div', undefined, 'artist-credit'); if (playback.track.artistArtwork) artist.append(artwork(playback.track.artistArtwork, 'Artist image', 'artist-portrait'));
    artist.append(el('p', playback.track.artist, 'artist')); track.append(artist);
    now.append(artwork(playback.track.artwork, 'Album artwork', 'mini-record'), track); card.append(now, progressBar(shown.progress));
    const controls = el('div', undefined, 'actions');
    if (playback.status !== 'stopped') {
      const action = playback.status === 'playing' ? 'pause' : 'resume';
      controls.append(playerButton(action === 'pause' ? 'Pause' : 'Resume', () => player.control(action), true));
    }
    if (finish) controls.append(finish);
    card.append(controls);
    card.append(volumeControl(shown.volume, (level, commit) => player.volume(level, commit), !realtime || !view.connected || playback.status === 'stopped' || player.starting));
    if (!playback.revealed) {
      const reveal = playerButton('Reveal on the display', () => player.reveal());
      reveal.classList.add('reveal-button'); card.append(reveal);
    }
    main.append(card);
  }
  const search = el('section', undefined, 'catalogue-panel');
  search.setAttribute('aria-labelledby', 'music-find-title');
  const searchHeading = el('div', undefined, 'section-heading'); const searchTitle = el('h2', 'Find music'); searchTitle.id = 'music-find-title'; searchHeading.append(searchTitle, el('span', 'Private search', 'privacy-tag')); search.append(searchHeading);
  const realCatalogue = view.catalogue?.source === 'music-assistant';
  if (realCatalogue && !view.catalogue?.playbackAvailable) {
    const hint = el('p', undefined, 'muted small');
    hint.append('Choose a speaker in ', link('host settings', '/host/settings', 'inline-link'), ' before playing. You can still prepare tracks.'); search.append(hint);
  }
  if (realCatalogue) {
    const modes = el('div', undefined, 'actions search-tabs');
    for (const mode of ['artists', 'tracks'] as const) {
      const tab = button(mode === 'tracks' ? 'Search tracks' : 'Search artists', () => {
        searchMode = mode; searchDone = false; results = []; artists = []; albums = []; chosenArtist = undefined; chosenAlbum = undefined;
        sourceChoices.clear(); artistNotices = []; albumNotices = []; trackNotices = [];
      }, searchMode !== mode); tab.id = `catalogue-mode-${mode}`; tab.setAttribute('aria-pressed', String(searchMode === mode)); modes.append(tab);
    }
    search.append(modes);
    const sources = el('details', undefined, 'catalogue-help'); sources.append(el('summary', 'Sources and matching'),
      el('p', 'Verified identities can browse all listed sources. Same-name or metadata matches only share a display row: choose a source to browse them. They may be different artists, releases or recordings. Track choices always keep their exact source. Music Assistant may omit failed sources, including in empty searches.', 'muted small')); search.append(sources);
  }
  const form = el('form', undefined, 'search-form');
  const input = el('input'); input.type = 'search'; input.placeholder = realCatalogue ? (searchMode === 'artists' ? 'Artist name' : 'Track, artist, or album') : 'Try Northern or Night'; input.required = true; input.maxLength = 200;
  input.id = 'catalogue-search';
  input.setAttribute('aria-label', 'Search catalogue'); input.value = searchText; input.oninput = () => { searchText = input.value; };
  const submit = el('button', searching ? 'Searching…' : 'Search'); submit.id = 'catalogue-search-submit'; submit.type = 'submit'; submit.disabled = busy || !realtime || !view.connected;
  form.append(input, submit);
  form.onsubmit = event => {
    event.preventDefault(); if (busy) return;
    const query = input.value.trim();
    if (!query) { error = 'Enter a track title, artist, or album to search.'; render(); return; }
    searching = true; searchDone = false; results = []; artists = []; albums = []; chosenArtist = undefined; chosenAlbum = undefined;
    sourceChoices.clear(); artistNotices = []; albumNotices = []; trackNotices = [];
    void run(async () => {
      try {
        if (realCatalogue && searchMode === 'artists') {
          const response = await catalogue.browse('artists', query);
          if (response) { artists = response.artists ?? []; artistNotices = response.notices ?? []; searchDone = true; }
        } else {
          const response = await catalogue.search(query);
          if (response && view?.catalogue?.source === response.source) {
            results = response.tracks; trackNotices = response.notices ?? []; searchDone = true;
          }
        }
      } finally { searching = false; }
    });
  }; search.append(form);
  const found = el('section', undefined, 'panel catalogue-results'); found.setAttribute('aria-labelledby', 'music-results-title');
  found.setAttribute('aria-busy', String(busy || searching));
  const resultsHeading = el('div', undefined, 'section-heading'); const resultsTitle = el('h2', chosenArtist ? 'Browse music' : 'Results'); resultsTitle.id = 'music-results-title'; resultsHeading.append(resultsTitle); found.append(resultsHeading);
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
  if (!searchDone && !searching) found.append(el('p', 'Search for music to add to your private list.', 'muted small'));
  if (searching) { const status = el('p', 'Searching…', 'muted'); status.setAttribute('role', 'status'); found.append(status); }
  for (const notice of notices) { const status = el('p', notice, 'catalogue-notice'); status.setAttribute('role', 'status'); found.append(status); }
  if (chosenArtist) {
    const crumbs = el('div', undefined, 'actions browse-crumbs');
    const backToArtists = button('← Artists', () => { chosenArtist = undefined; chosenAlbum = undefined; albums = []; results = []; }, true); backToArtists.id = 'browse-artists'; crumbs.append(backToArtists);
    if (chosenAlbum) { const backToAlbums = button('← Albums', () => { chosenAlbum = undefined; results = []; }, true); backToAlbums.id = 'browse-albums'; crumbs.append(backToAlbums); }
    found.append(crumbs, el('h3', chosenAlbum ? `${chosenArtist.name} · ${chosenAlbum.name}` : `${chosenArtist.name} — albums`),
      el('p', chosenAlbum?.provider ?? chosenArtist.provider, 'muted small'));
  }
  for (const artist of !chosenArtist ? artists : []) {
    const source = catalogueSourceChoice(artist, artist.name, sourceChoices, render, 'artist');
    const shown = source.item ?? artist;
    const row = el('div', undefined, 'track-row'); const info = el('div', undefined, 'result-identity'); const copy = el('div'); copy.append(el('strong', shown.name), el('p', artist.provider, 'muted')); info.append(artwork(artist.matchKind === 'metadata' && !source.item ? undefined : shown.artwork, 'Artist image', 'result-artwork artist-portrait'), copy);
    if (source.control) copy.append(source.control);
    const browse = button('View albums', async () => {
      if (!source.item) return;
      const response = await catalogue.browse('albums', source.item!.id);
      if (response) { chosenArtist = source.item; chosenAlbum = undefined; albums = response.albums ?? []; albumNotices = response.notices ?? []; results = []; }
    }, true); browse.disabled ||= !source.item; row.append(info, browse); found.append(row);
  }
  for (const album of chosenArtist && !chosenAlbum ? albums : []) {
    const source = catalogueSourceChoice(album, album.name, sourceChoices, render, 'album');
    const shown = source.item ?? album; const unchosen = album.matchKind === 'metadata' && !source.item;
    const row = el('div', undefined, 'track-row'); const info = el('div', undefined, 'result-identity'); const copy = el('div'); copy.append(el('strong', shown.name),
      el('p', [unchosen ? null : shown.year, shown.version, album.provider].filter(Boolean).join(' · '), 'muted'));
    info.append(artwork(unchosen ? undefined : shown.artwork, 'Album artwork', 'result-artwork'), copy);
    if (source.control) copy.append(source.control);
    const browse = button('View tracks', async () => {
      if (!source.item) return;
      const response = await catalogue.browse('tracks', source.item!.id);
      if (response) { chosenAlbum = source.item; results = response.tracks ?? []; trackNotices = response.notices ?? []; }
    }, true); browse.disabled ||= !source.item; row.append(info, browse); found.append(row);
  }
  const emptyBrowse = searchDone && searchMode === 'artists' && ((!chosenArtist && !artists.length) || (chosenArtist && !chosenAlbum && !albums.length) || (chosenAlbum && !results.length));
  if (emptyBrowse) found.append(el('p', coverageUnconfirmed ? 'No results returned. Source coverage is unconfirmed; check Sources and matching or try a source separately.' : chosenArtist && !chosenAlbum
    ? 'No albums returned for this artist. This provider may not support artist albums; try another provider result or search tracks.'
    : chosenAlbum ? 'No tracks returned for this album.' : 'No artists found. Try another artist name; Music Assistant may omit unavailable sources.', 'muted'));
  if (searchDone && searchMode === 'tracks' && !results.length) {
    const empty = el('p', realCatalogue
      ? 'No tracks found. Try a different title or artist, or check that a music source is enabled in Music Assistant. Unavailable sources may be omitted.'
      : 'No tracks found in the demo catalogue. Try “Northern”, “Summer”, or “Night”.', 'muted');
    empty.setAttribute('role', 'status'); found.append(empty);
  }
  for (const group of results) {
    const source = catalogueSourceChoice(group, group.title, sourceChoices, render);
    const track = source.item ?? group;
    const row = el('div', undefined, `track-row${library.added.has(track.id) ? ' is-prepared' : ''}`); const info = el('div', undefined, 'result-identity'); const copy = el('div');
    copy.append(el('strong', track.title), el('p', [track.artist, track.album, track.version, track.provider].filter(Boolean).join(' · '), 'muted'));
    info.append(artwork(group.matchKind === 'metadata' && !source.item ? undefined : track.artwork, 'Album artwork', 'result-artwork'), copy);
    if (source.control) copy.append(source.control);
    if (source.item && !track.available) info.append(el('p', 'Unavailable through this source', 'muted small'));
    const controls = el('div', undefined, 'row-actions');
    const add = music.addButton(track); add.disabled ||= !source.item; controls.append(add);
    if (view.myTurn) {
      const play = playerButton(!source.item ? 'Choose a source' : !track.available ? 'Unavailable' : !view.catalogue?.playbackAvailable ? 'Choose a speaker' : 'Play', () => playTrack(track));
      play.disabled ||= !source.item || !track.available || !view.catalogue?.playbackAvailable || player.starting; controls.append(play);
    }
    row.append(info, controls);
    found.append(row);
  }
  const musicPanel = music.render(search, found);
  main.append(musicPanel);
  if (finish && !playback) {
    const idleFinish = el('section', undefined, 'finish-turn'); idleFinish.append(finish); main.append(idleFinish);
  }
  return main;
}
function playTrack(track: CatalogueTrack) { player.play(track); }
function joinForm() {
  return joinPanel({ nickname: nicknameDraft, busy, disabled: !navigator.onLine,
    notice: participantAccess.removed ? 'You’re no longer in the listening order. Join again when you’re ready. Your saved music is kept.' : undefined,
    changed: value => { nicknameDraft = value; },
    submit: nickname => { void run(async () => {
      const next = await api<View>('/api/participant/join', { nickname });
      if (page === 'join') location.replace(appPath('/participant')); else participantAccess.enter(next);
    }); },
  });
}

function participantEntry() {
  const main = el('main', undefined, page === 'join' ? 'join-page room-join-page' : 'participant-page participant-entry');
  const layout = el('div', undefined, 'entry-layout');
  const state = participantAccess.state;
  if (state === 'unjoined') layout.append(joinForm());
  else {
    const status = el('section', undefined, 'panel entry-status');
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
  if (page === 'participant') {
    layout.firstElementChild!.append(music.renderEntry());
  }
  main.append(layout); return main;
}
function render() {
  updateHeader();
  if (page === 'settings') return;
  if (page === 'display') { renderDisplay(); return; }
  const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const selection = focused instanceof HTMLInputElement && ['text', 'search', 'password'].includes(focused.type) ? [focused.selectionStart, focused.selectionEnd] as const : null;
  const ringScroll = root.querySelector('.rotation-list')?.scrollLeft ?? 0;
  const scrollRegions = [...root.querySelectorAll<HTMLElement>('[data-scroll-key]')].map(node => [node.dataset.scrollKey, node.scrollTop] as const);
  const scrollY = window.scrollY;
  const content = document.createDocumentFragment();
  if (error) { const notice = el('div', error, 'error'); notice.setAttribute('role', 'alert'); content.append(notice); }
  if (view && !realtime) { const n = el('div', 'Reconnecting… controls are disabled until the live connection returns.', 'connection'); n.setAttribute('role', 'status'); content.append(n); }
  if (view && !view.connected) content.append(el('div', 'Playback or storage state is uncertain. Controls are disabled.', 'error'));
  if (view?.playbackIssue) content.append(el('div', view.playbackIssue, 'warning'));
  if (page === 'host') content.append(host());
  else if (page === 'join' && !view) content.append(participantEntry());
  else if (page === 'participant' || page === 'join') content.append(participant());
  else {
    const main = el('main', undefined, 'join-page'); main.append(el('h1', 'Albums of the Year'),
      el('p', 'Open the listening room, join the circle, or return to My seat.', 'muted small'), link('Open listening room', '/display'), link('Join room', '/join')); content.append(main);
  }
  pageContent.replaceChildren(content);
  const ring = root.querySelector('.rotation-list'); if (ring) ring.scrollLeft = ringScroll;
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
    // Settings owns its forms and reports only mode to the shared, route-independent header.
    if (!settingsMounted) { settingsMounted = true; await mountSettings(pageContent, mode => { settingsMode = mode; updateHeader(); }); }
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
    if (page === 'participant') void library.start();
    await participantAccess.check();
  }
}
void init();
window.addEventListener('hashchange', () => {
  if ((page === 'display' && location.hash.startsWith('#access=')) || (page === 'join' && location.hash.startsWith('#invite='))) history.replaceState(null, '', location.pathname);
});
window.addEventListener('pagehide', () => { realtime = false; player.cancel(); catalogue.cancel(); stream?.close(); library.stop(); music.uploads.stop(); });
window.addEventListener('pageshow', event => { if (event.persisted) void init(); });
window.addEventListener('offline', () => {
  if (page === 'settings' || page === 'home') return;
  realtime = false; player.cancel(); catalogue.cancel(); stream?.close(); stream = undefined; render();
  if (page === 'participant' || page === 'join') participantAccess.offline();
  library.stop();
  music.uploads.stop();
});
window.addEventListener('online', () => {
  if (page === 'participant' && accessEnded) void library.start();
  if (page !== 'settings' && page !== 'home' && !accessEnded) void init();
});
