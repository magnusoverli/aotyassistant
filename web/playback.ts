import type { PlaybackProgress, View, VolumeState } from '../src/model';
import type { PreparedEntryView } from '../src/preparations';
import { el } from './dom';
import { vinyl } from './visuals';
import { ArtworkView, progressBar, updateProgress, volumeControl, updateVolume } from './media';
import { outputCaption, outputLabel, updateOutputLabel } from './output';
import { slot } from './page-layout';
import { panel } from './ui-components';
import { ViewNodes, attr, children, prop, text } from './view-nodes';
import { ParticipantPlayerDetails } from './participant-player-details';
import { SeekBar } from './seek-bar';

type CommonOptions = {
  volume(level: number, commit: boolean): void;
  run(action: () => Promise<void> | void): Promise<void>;
};
type HostOptions = CommonOptions & {
  role: 'host';
  control(action: 'pause' | 'resume'): void;
  advance(turnId: string | null): Promise<void>;
  stop(turnId: string | null, playbackId: string): Promise<void>;
};
type ParticipantOptions = CommonOptions & {
  role: 'participant';
  playFirst(): void;
  /** Plays the next saved song at once, keeping the turn: the "continue this playlist" song-end mode. */
  next(): void;
  /** Moves the participant's playing song; settles once the speaker's answer is in. */
  seek(position: number): Promise<void>;
  control(action: 'pause' | 'resume' | 'stop'): void;
  reveal(): void;
  finish(): Promise<void> | void;
};
type PlaybackState = {
  view: View; projected: View; online: boolean; busy: boolean; starting: boolean;
  firstSelection?: PreparedEntryView; selectionReady: boolean; error?: string;
};
/** Room-level status copy shared by the page notice and the player details. */
export const roomMessages = {
  connectionLost: 'Connection lost. Your saved songs are kept. Controls return when the room reconnects.',
  unavailable: 'The room cannot confirm playback or save changes. Ask the host to check Settings.',
};

/** One persistent playback UI. Roles select presentation/actions, never broaden server permissions. */
export class Playback {
  private nodes = new ViewNodes();
  private state?: PlaybackState;
  private volumeState?: VolumeState;
  private audibleVolume = 35;
  private details?: ParticipantPlayerDetails;
  private cover?: ArtworkView;
  private portrait?: ArtworkView;
  private seekBar?: SeekBar;
  /** Host-only: the playback the card last showed, and a stop the host is waiting on. */
  private hostUi = { identity: '', pending: '' };

  constructor(private options: HostOptions | ParticipantOptions) {}

  /** The song this role may see: the host's status-only view, or the participant's own while it is their turn. */
  private playbackOf({ view, projected }: PlaybackState) {
    return this.options.role === 'host' ? projected.hostPlayback : view.myTurn ? projected.ownPlayback : undefined;
  }

  get element() {
    return this.nodes.get('card', () => {
      const node = slot(panel('playback-card', { tone: 'highlight', density: 'compact' }), 'player');
      node.dataset.playbackRole = this.options.role;
      if (this.options.role === 'participant') {
        node.id = 'participant-player'; node.setAttribute('aria-label', 'Your player'); node.tabIndex = -1;
      } else {
        node.classList.add('host-live');
        node.id = 'host-player'; node.setAttribute('aria-label', 'Host player'); node.tabIndex = -1;
      }
      return node;
    });
  }

  private get volume() { return this.nodes.get('volume', () => volumeControl(undefined, (level, commit) => this.options.volume(level, commit), true)); }
  private get progress() {
    return this.nodes.get('progress', () => {
      const node = progressBar(undefined, false);
      if (this.options.role === 'host') node.classList.add('host-progress');
      else {
        const options = this.options;
        this.seekBar = new SeekBar(node, seconds => options.seek(seconds), () => { if (this.state) this.update(this.state); });
      }
      return node;
    });
  }
  private get output() { return this.nodes.get('output', () => outputLabel(undefined, false)); }

  clear() {
    this.details?.destroy(); this.details = undefined; this.cover?.clear(); this.portrait?.clear(); this.cover = this.portrait = undefined;
    this.state = undefined; this.volumeState = undefined; this.audibleVolume = 35; this.nodes.clear(); this.hostUi = { identity: '', pending: '' };
    this.seekBar = undefined;
  }

  updateVolume(volume?: VolumeState) {
    if (!this.state) return;
    if (volume?.revision !== this.volumeState?.revision) this.audibleVolume = 35;
    if (volume?.available && volume.level && volume.level > 0) this.audibleVolume = volume.level;
    this.volumeState = volume;
    updateVolume(this.volume, volume);
    attr(this.volume.querySelector('output')!, 'data-unavailable', volume?.level == null ? '' : undefined);
    const mute = this.muteButton;
    const muted = volume?.level === 0;
    this.decorate(mute, muted ? 'Unmute' : 'Mute', muted ? 'muted' : 'volume');
    prop(mute, 'title', muted ? 'Unmute — restore previous volume' : 'Mute speaker');
    attr(mute, 'aria-pressed', String(muted));
    prop(mute, 'disabled', this.volume.querySelector('input')!.disabled || !volume?.available || volume.level === null);
  }

  private get muteButton() {
    return this.button('player-mute', 'Mute', () => {
      if (this.volume.querySelector('input')!.disabled || !this.volumeState?.available || this.volumeState.level === null) return;
      this.options.volume(this.volumeState.level === 0 ? this.audibleVolume : 0, true);
    }, true);
  }

  private decorate(button: HTMLButtonElement, caption: string, icon: 'play' | 'pause' | 'stop' | 'volume' | 'muted' | 'reveal' | 'advance' | 'next', mobileCaption?: string) {
    const paths = { play: 'M8 5l11 7-11 7Z', pause: 'M8 5v14M16 5v14', stop: 'M6 6h12v12H6Z', next: 'M5 5l10 7-10 7ZM19 5v14',
      volume: 'M11 5 6 9H3v6h3l5 4ZM15 8a6 6 0 0 1 0 8M18 5a10 10 0 0 1 0 14',
      muted: 'M11 5 6 9H3v6h3l5 4ZM16 9l6 6M22 9l-6 6',
      reveal: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12ZM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
      advance: 'M4 12h16M14 6l6 6-6 6' };
    const image = this.nodes.get(`${button.id}-icon`, () => {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('focusable', 'false');
      svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor'); svg.setAttribute('stroke-width', '2');
      svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('stroke-linejoin', 'round'); svg.classList.add('playback-icon');
      svg.append(document.createElementNS('http://www.w3.org/2000/svg', 'path')); return svg;
    });
    attr(image.firstElementChild!, 'd', paths[icon]);
    // Keep descriptive names where the short visible label is already contained
    // in it (e.g. Reveal details); Play pick uses its own visible mobile name.
    attr(button, 'aria-label', mobileCaption && mobileCaption !== 'Play pick' ? caption : undefined);
    children(button, image, this.nodes.el(`${button.id}-caption`, 'span', caption, mobileCaption ? 'player-desktop-only' : ''),
      mobileCaption ? this.nodes.el(`${button.id}-mobile-caption`, 'span', mobileCaption, 'player-mobile-only') : undefined);
  }

  /** Telemetry never remounts buttons, artwork, disclosures or a slider being dragged. */
  updateTelemetry(progress?: PlaybackProgress, volume?: VolumeState) {
    if (!this.state) return;
    if (!this.progress.querySelector('.player-pending') && !this.seekBar?.active) updateProgress(this.progress, progress);
    this.updateVolume(volume);
  }

  update(state: PlaybackState) {
    this.state = state;
    const { view, projected, online, starting } = state;
    const host = this.options.role === 'host';
    const playback = this.playbackOf(state);
    const songActive = Boolean(online && playback && (playback.status === 'playing' || playback.status === 'paused'));
    const progress = this.progress;
    const status = progress.querySelector<HTMLElement>('.playback-status')!;
    const moving = this.seekBar?.pendingText;
    status.classList.toggle('player-pending', !host && (starting || Boolean(moving)));
    updateProgress(progress, host ? songActive ? projected.progress : undefined : playback ? projected.progress : undefined);
    if (!host && starting) text(status, 'Starting track…'); else if (!host && moving) text(status, moving);
    if (!host) this.updateSeek(state);
    updateOutputLabel(this.output, view.output, online);
    prop(this.volume.querySelector('input')!, 'disabled', !online || !view.connected || !projected.volume?.available ||
      (!host && (!playback || playback.status === 'stopped' || starting)));
    this.updateVolume(projected.volume);
    if (this.options.role === 'host') this.renderHost(state, this.options, songActive);
    else this.renderParticipant(state, this.options);
    return this.element;
  }

  /** Only the participant whose song is playing can move within it. MA's seek would also start a
   * paused song, so pausing hides the handle. */
  private updateSeek(state: PlaybackState) {
    const bar = this.seekBar; if (!bar) return;
    const { view, projected, online, busy, starting } = state;
    const playback = view.myTurn ? projected.ownPlayback : undefined;
    const progress = projected.progress;
    const enabled = Boolean(online && view.connected && view.myTurn && !busy && !starting && playback?.status === 'playing' &&
      !playback.id.startsWith('pending-') && progress?.id === playback.id && progress.elapsed !== undefined);
    bar.update({ enabled, duration: progress?.duration ?? 0, revealAt: progress?.autoRevealAt,
      hidden: view.secretPlayback !== false && !playback?.revealed });
  }

  /** In the "continue this playlist" song-end mode, Play pick becomes Next track during a song. */
  private nextTrackMode(state: PlaybackState | undefined) {
    const playback = state?.view.myTurn ? state.projected.ownPlayback : undefined;
    return Boolean(state?.view.songEnd === 'same-participant' && playback && (playback.status === 'playing' || playback.status === 'paused'));
  }

  private button(id: string, caption: string, action: () => void, secondary = false) {
    return this.nodes.get(id, () => {
      const node = el('button', caption, secondary ? 'secondary' : '');
      node.type = 'button'; node.id = id; node.disabled = true; node.onclick = action;
      return node;
    });
  }

  private transport(state: PlaybackState) {
    const host = this.options.role === 'host'; const { view, online, starting } = state;
    const playback = this.playbackOf(state);
    const permitted = online && view.connected && (host || view.myTurn);
    const transport = this.button(host ? 'host-transport' : 'player-transport', 'Pause', () => {
      const current = this.state; if (!current) return;
      const song = this.options.role === 'host' ? current.projected.hostPlayback : current.projected.ownPlayback;
      this.options.control(song?.status === 'paused' ? 'resume' : 'pause');
    });
    this.decorate(transport, playback?.status === 'paused' ? 'Resume' : 'Pause', playback?.status === 'paused' ? 'play' : 'pause');
    prop(transport, 'disabled', !permitted || !playback || playback.status === 'stopped' || (host && state.busy));
    const stop = this.button(host ? 'host-stop' : 'player-stop', host ? 'Stop song — keep turn' : 'Stop song', () => {
      if (this.options.role === 'participant') { this.options.control('stop'); return; }
      const options = this.options; const current = this.state; const target = current?.view; const song = target?.hostPlayback;
      if (!current || current.busy || !current.online || !target?.connected || !song || song.status === 'stopped') return;
      if (!confirm(`Stop ${target.current?.nickname ?? 'the participant'}’s song and keep their turn?`)) return;
      const ui = this.hostUi; ui.pending = song.id;
      void options.run(async () => { try { await options.stop(target.turnId, song.id); } finally { ui.pending = ''; } }).then(() => {
        const next = this.element.querySelector<HTMLButtonElement>('#host-skip-turn');
        if ((document.activeElement === stop || document.activeElement === document.body) && next && !next.disabled) next.focus({ preventScroll: true });
      });
    }, true);
    this.decorate(stop, 'Stop song', 'stop', 'Stop');
    if (host) attr(stop, 'aria-label', 'Stop song — keep turn');
    prop(stop, 'title', 'Stop the song without advancing the turn');
    prop(stop, 'disabled', !permitted || !playback || playback.status === 'stopped' || (host && state.busy));
    const controls = this.nodes.el('transport', 'div', undefined, 'playback-transport');
    attr(controls, 'role', 'group'); attr(controls, 'aria-label', 'Playback controls');
    const play = this.options.role === 'participant' ? this.button('player-play-next', 'Play first selection', () => {
      if (this.options.role !== 'participant') return;
      if (this.nextTrackMode(this.state)) this.options.next(); else this.options.playFirst();
    }, true) : undefined;
    if (play) {
      const next = state.firstSelection; const skip = this.nextTrackMode(state);
      const ready = Boolean(next && next.sourceAvailable !== false && permitted && view.catalogue?.playbackAvailable && state.selectionReady);
      prop(play, 'hidden', !next); prop(play, 'disabled', !ready || starting); attr(play, 'data-player-ready', String(ready));
      if (skip) {
        prop(play, 'title', next ? `Next track: ${next.title}` : 'Your list is empty'); this.decorate(play, 'Next track', 'next', 'Next');
      } else {
        prop(play, 'title', next ? `Play first selection: ${next.title}` : 'Save a track to play it here'); this.decorate(play, 'Play first selection', 'play', 'Play pick');
      }
      play.classList.toggle('is-next-track', skip);
    }
    // The host never starts a song, so its player has no Play button at all.
    children(controls, play, transport, stop);
    return controls;
  }

  private footer(actions: HTMLElement) {
    const volume = this.nodes.el('volume-row', 'div', undefined, 'playback-volume');
    children(volume, this.muteButton, this.volume);
    const footer = this.nodes.el('footer', 'div', undefined, 'playback-footer');
    children(footer, volume, actions); return footer;
  }

  private renderHost(state: PlaybackState, options: HostOptions, songActive: boolean) {
    const v = this.nodes; const { view, online, busy } = state;
    const livePerson = v.el('person', 'div', undefined, 'private-now-playing');
    const ui = this.hostUi;
    const playback = state.projected.hostPlayback;
    const identity = JSON.stringify([view.roomId, view.turnId, playback?.id]);
    const changedPlayback = ui.identity !== identity;
    if (changedPlayback) ui.identity = identity;
    const stopping = Boolean(ui.pending && ui.pending === playback?.id);
    const personInfo = v.el('person-info', 'div');
    const status = !online || view.playbackStatus === 'unavailable' ? 'Unavailable' : stopping ? 'Stopping…'
      : playback?.status === 'stopped' ? `Stopped · ${view.current?.nickname ?? 'The participant'} keeps the turn`
      : playback?.status === 'playing' ? 'Playing' : playback?.status === 'paused' ? 'Paused' : 'Choosing a song';
    // Never read ownPlayback, nowPlaying or any recording metadata in this variant.
    children(personInfo, v.el('current-name', 'h2', view.current?.nickname ?? 'Waiting for participants'), view.output && this.output);
    const record = v.get('record', () => { const node = vinyl(); node.classList.add('room-record'); return node; });
    const cover = v.el('cover', 'div', undefined, 'mini-record host-record'); children(cover, record);
    children(livePerson, cover, personInfo);
    const card = this.element;
    attr(card, 'data-playback', online && view.connected ? playback?.status ?? 'idle' : 'unavailable');
    card.classList.toggle('has-active-song', songActive);
    const notice = state.error ? 'Action failed · check status' : !online ? 'Connection lost' : !view.connected ? 'Player unavailable' : stopping ? 'Stopping…' : !songActive ? status : '';
    card.classList.toggle('has-player-notice', Boolean(notice));
    card.classList.toggle('has-player-error', Boolean(state.error));
    const privacy = songActive ? playback?.revealed ? 'Visible on room display' : 'Hidden on room display' : 'Host player';
    const statusLine = v.el('status-line', 'div', undefined, 'player-status-line');
    const mobileNotice = v.el('mobile-notice', 'span', notice, 'player-mobile-only player-mobile-notice');
    attr(mobileNotice, 'role', state.error ? 'alert' : 'status');
    const statusText = this.progress.querySelector<HTMLElement>('.playback-status')!;
    statusText.classList.add('host-playback-status'); text(statusText, status);
    children(statusLine, statusText, mobileNotice,
      v.el('privacy', 'span', privacy, 'privacy-tag host-reveal-status'),
      v.el('mobile-privacy', 'span', songActive ? playback?.revealed ? 'Revealed' : 'Hidden' : '', 'player-mobile-only player-mobile-privacy'));
    if (statusLine.parentElement !== this.progress) this.progress.prepend(statusLine);
    const controls = v.el('controls', 'div', undefined, 'player-ending');
    const advance = this.button('host-skip-turn', 'Skip turn', () => { void options.run(() => {
      const current = this.state?.view; if (!current) return;
      const name = current.current?.nickname ?? 'the participant';
      if (!confirm(current.playbackStatus === 'idle' ? `Skip ${name}’s turn? They have not played a song yet.`
        : 'Stop the current song and skip to the next person?')) return;
      return options.advance(current.turnId);
    }); }, true);
    prop(advance, 'disabled', busy || !online || !view.connected || !view.current);
    this.decorate(advance, 'Skip turn', 'advance'); prop(advance, 'title', 'Skip to the next participant');
    const transport = this.transport(state);
    const stop = transport.querySelector<HTMLButtonElement>('#host-stop')!;
    if ((changedPlayback || !songActive) && document.activeElement === stop && !advance.disabled) advance.focus({ preventScroll: true });
    children(controls, advance);
    children(this.element, livePerson, transport, this.progress, this.footer(controls));
  }

  private renderParticipant(state: PlaybackState, options: ParticipantOptions) {
    const v = this.nodes; const { view, projected, online, busy, starting } = state;
    const playback = view.myTurn ? projected.ownPlayback : undefined;
    const next = state.firstSelection; const preview = playback?.track ?? next;
    const card = this.element;
    const details = this.details ??= new ParticipantPlayerDetails();
    details.update({ title: preview?.title, artist: preview?.artist, album: preview?.album, output: outputCaption(view.output, online),
      next: next?.title, error: state.error || (!online ? roomMessages.connectionLost : !view.connected ? roomMessages.unavailable : undefined) });
    const now = v.el('now', 'div', undefined, 'private-now-playing');
    const track = v.el('track', 'div'); const title = v.el('title', 'h2', preview?.title ?? (view.myTurn ? 'Choose a song' : 'Waiting for your turn'));
    prop(title, 'title', title.textContent!);
    const artist = v.el('artist', 'div', undefined, 'artist-credit');
    const credit = v.el('credit', 'p', preview?.artist ?? 'Search or use your list.', 'artist'); prop(credit, 'title', credit.textContent!);
    const portrait = this.portrait ??= new ArtworkView('Artist image', 'artist-portrait');
    portrait.update(preview?.artistArtwork, playback?.track.artistArtworkIdentity);
    children(artist, Boolean(preview?.artistArtwork) && portrait.element, credit);
    children(track, title, artist, this.output, details.button);
    const cover = this.cover ??= new ArtworkView('Album artwork', 'mini-record');
    children(now, cover.update(preview?.artwork, playback?.track.artworkIdentity), track);
    const progress = this.progress; const status = progress.querySelector<HTMLElement>('.playback-status')!;
    const statusLine = v.el('status-line', 'div', undefined, 'player-status-line');
    // Without secret playback, every song shows on the room display from the start: nothing to reveal.
    const secret = view.secretPlayback !== false;
    const privacy = playback ? !secret || playback.revealed && view.ownPlayback?.revealed ? 'Visible on room display' : playback.revealed ? 'Revealing…' : 'Hidden on room display' : next ? 'First saved selection' : 'Your player';
    const turnReady = Boolean(view.myTurn && !playback && !starting && online && view.connected && !state.error);
    const notice = state.error ? 'Action failed · tap details' : !online ? 'Connection lost' : !view.connected ? 'Player unavailable'
      : !view.myTurn ? 'Waiting for turn' : turnReady ? next ? 'Your turn · play your pick' : 'Your turn · choose a song' : '';
    card.classList.toggle('is-turn-ready', turnReady);
    card.classList.toggle('is-waiting', !view.myTurn);
    const mobileNotice = v.el('mobile-notice', 'span', undefined, 'player-mobile-only player-mobile-notice');
    children(mobileNotice, v.el('mobile-notice-caption', 'span', notice),
      state.error ? v.el('mobile-error-detail', 'span', ` ${state.error}`, 'sr-only') : undefined);
    attr(mobileNotice, 'role', state.error ? 'alert' : 'status');
    card.classList.toggle('has-player-notice', Boolean(notice));
    card.classList.toggle('has-player-error', Boolean(state.error));
    const mobilePrivacy = v.el('mobile-privacy', 'span', playback ? !secret || playback.revealed && view.ownPlayback?.revealed ? 'Revealed' : playback.revealed ? 'Revealing' : 'Hidden' : '', 'player-mobile-only player-mobile-privacy');
    prop(mobilePrivacy, 'title', playback ? privacy : '');
    children(statusLine, status, mobileNotice, v.el('privacy', 'span', privacy, 'privacy-tag'), mobilePrivacy);
    if (statusLine.parentElement !== progress) progress.prepend(statusLine);
    card.classList.toggle('has-next-pick', Boolean(next));
    card.classList.toggle('has-active-song', Boolean(playback && playback.status !== 'stopped'));
    card.classList.toggle('without-reveal', !secret);
    const reveal = this.button('player-reveal', 'Reveal details', () => options.reveal()); reveal.classList.add('reveal-button');
    const revealing = Boolean(playback?.revealed && !view.ownPlayback?.revealed);
    this.decorate(reveal, revealing ? 'Revealing…' : playback?.revealed ? 'Details revealed' : 'Reveal details', 'reveal', revealing ? 'Revealing…' : playback?.revealed ? 'Revealed' : 'Reveal');
    prop(reveal, 'title', !online ? 'Waiting for the room connection' : !view.connected ? 'Playback is unavailable'
      : !view.myTurn ? 'Only the current participant can reveal their track' : !playback ? 'Play a track before revealing'
      : revealing ? 'Waiting for reveal confirmation' : playback.revealed ? 'Details are already visible on the room display' : 'Reveal track details on the room display');
    prop(reveal, 'disabled', !online || !view.connected || !view.myTurn || !playback || playback.revealed);
    const finish = this.button('finish-my-turn', 'Pass turn', () => {
      // Ending a turn cannot be undone, so it is always confirmed.
      const current = this.state; if (!current?.view.myTurn) return;
      const song = current.projected.ownPlayback; const following = current.view.next;
      const after = following && following.id !== current.view.me?.id ? ` ${following.nickname} is up next.` : '';
      if (!confirm(!song ? `Pass your turn without playing a song?${after}`
        : song.status === 'stopped' ? `Finish your turn?${after}` : `Finish your turn? Your song stops now.${after}`)) return;
      void options.run(() => options.finish());
    }, true);
    this.decorate(finish, playback ? 'Finish turn' : 'Pass turn', 'advance');
    prop(finish, 'title', playback ? 'Finish your turn and pass to the next participant' : 'Pass to the next participant');
    prop(finish, 'disabled', busy || !online || !view.connected || !view.myTurn || starting);
    const ending = v.el('ending', 'div', undefined, 'player-ending'); children(ending, secret && reveal, finish);
    children(card, this.waitingSummary(state), now, this.transport(state), progress, this.footer(ending), details.dialog);
  }

  /** Phones, while someone else has the turn: the room's state and your place instead of disabled controls. */
  private waitingSummary(state: PlaybackState) {
    const v = this.nodes; const { view, online, error } = state;
    const summary = v.el('waiting', 'div', undefined, 'player-waiting player-mobile-only');
    const room = !online ? 'Connection lost' : !view.connected || view.playbackStatus === 'unavailable' ? 'Player unavailable'
      : view.playbackStatus === 'playing' ? 'Playing' : view.playbackStatus === 'paused' ? 'Paused' : 'Choosing a song';
    const head = v.el('waiting-head', 'div', undefined, 'player-waiting-head');
    const whose = v.el('waiting-turn', 'p', view.current ? `${view.current.nickname}’s turn` : 'Waiting for people to join', 'player-waiting-turn');
    prop(whose, 'title', whose.textContent!);
    const status = v.el('waiting-status', 'span', view.current || !online ? room : '', 'player-waiting-status');
    attr(status, 'data-state', !online || !view.connected ? 'problem' : view.playbackStatus ?? 'idle');
    children(head, whose, status);
    const until = view.position?.turnsUntil;
    const distance = v.el('waiting-distance', 'p', until === 1 ? 'You’re next' : until ? `You’re up in ${until} turns` : '', 'player-waiting-distance');
    const pick = state.firstSelection;
    const next = v.el('waiting-pick', 'p', undefined, 'player-waiting-pick');
    children(next, pick && v.el('waiting-pick-label', 'span', 'Next pick', 'player-waiting-label'),
      v.el('waiting-pick-title', 'span', pick ? [pick.title, pick.artist].filter(Boolean).join(' · ') : 'No songs yet. Search below to add one.'));
    prop(next, 'title', next.textContent ?? '');
    const output = v.get('waiting-output', () => { const node = outputLabel(undefined, false); node.className = 'player-waiting-output'; return node; });
    updateOutputLabel(output, view.output, online);
    const failure = v.el('waiting-error', 'p', error ?? '', 'player-waiting-error'); prop(failure, 'hidden', !error);
    attr(failure, 'role', error ? 'alert' : undefined);
    children(summary, head, Boolean(distance.textContent) && distance, next, output, failure);
    return summary;
  }
}
