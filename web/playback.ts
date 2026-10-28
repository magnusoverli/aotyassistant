import type { PlaybackProgress, View, VolumeState } from '../src/model';
import type { PreparedEntryView } from '../src/preparations';
import { el } from './dom';
import { vinyl } from './visuals';
import { ArtworkView, progressBar, updateProgress, volumeControl, updateVolume } from './media';
import { outputLabel, updateOutputLabel } from './output';
import { slot } from './page-layout';
import { panel } from './ui-components';
import { ViewNodes, attr, children, prop, text } from './view-nodes';
import { ParticipantPlayerDetails } from './participant-player-details';

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
  control(action: 'pause' | 'resume' | 'stop'): void;
  reveal(): void;
  finish(): Promise<void> | void;
};
type PlaybackState = {
  view: View; projected: View; online: boolean; busy: boolean; starting: boolean;
  firstSelection?: PreparedEntryView; selectionReady: boolean; error?: string;
};

/** One persistent playback UI. Roles select presentation/actions, never broaden server permissions. */
export class Playback {
  private nodes = new ViewNodes();
  private state?: PlaybackState;
  private volumeState?: VolumeState;
  private audibleVolume = 35;
  private details?: ParticipantPlayerDetails;

  constructor(private options: HostOptions | ParticipantOptions) {}

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
      return node;
    });
  }
  private get output() { return this.nodes.get('output', () => outputLabel(undefined, false)); }

  clear() { this.details?.destroy(); this.details = undefined; this.state = undefined; this.volumeState = undefined; this.audibleVolume = 35; this.nodes.clear(); }

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

  private decorate(button: HTMLButtonElement, caption: string, icon: 'play' | 'pause' | 'stop' | 'volume' | 'muted' | 'reveal' | 'advance', mobileCaption?: string) {
    const paths = { play: 'M8 5l11 7-11 7Z', pause: 'M8 5v14M16 5v14', stop: 'M6 6h12v12H6Z',
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
    if (!this.progress.querySelector('.player-pending')) updateProgress(this.progress, progress);
    this.updateVolume(volume);
  }

  update(state: PlaybackState) {
    this.state = state;
    const { view, projected, online, starting } = state;
    const host = this.options.role === 'host';
    const playback = host ? projected.hostPlayback : view.myTurn ? projected.ownPlayback : undefined;
    const songActive = Boolean(online && playback && (playback.status === 'playing' || playback.status === 'paused'));
    const progress = this.progress;
    const status = progress.querySelector<HTMLElement>('.playback-status')!;
    status.classList.toggle('player-pending', !host && starting);
    updateProgress(progress, host ? songActive ? projected.progress : undefined : playback ? projected.progress : undefined);
    if (!host && starting) text(status, 'Starting track…');
    updateOutputLabel(this.output, view.output, online);
    prop(this.volume.querySelector('input')!, 'disabled', !online || !view.connected || !projected.volume?.available ||
      (!host && (!playback || playback.status === 'stopped' || starting)));
    this.updateVolume(projected.volume);
    if (this.options.role === 'host') this.renderHost(state, this.options, songActive);
    else this.renderParticipant(state, this.options);
    return this.element;
  }

  private button(id: string, caption: string, action: () => void, secondary = false) {
    return this.nodes.get(id, () => {
      const node = el('button', caption, secondary ? 'secondary' : '');
      node.type = 'button'; node.id = id; node.disabled = true; node.onclick = action;
      return node;
    });
  }

  private transport(state: PlaybackState) {
    const host = this.options.role === 'host'; const { view, projected, online, starting } = state;
    const playback = host ? projected.hostPlayback : view.myTurn ? projected.ownPlayback : undefined;
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
      const ui = this.nodes.get('host-ui', () => ({ identity: '', pending: '' })); ui.pending = song.id;
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
    const play = !host && this.options.role === 'participant' ? this.button('player-play-next', 'Play first selection', () => {
      if (this.options.role === 'participant') this.options.playFirst();
    }, true) : undefined;
    if (play) {
      const next = state.firstSelection;
      const ready = Boolean(next && next.sourceAvailable !== false && permitted && view.catalogue?.playbackAvailable && state.selectionReady);
      prop(play, 'hidden', !next); prop(play, 'disabled', !ready || starting); attr(play, 'data-player-ready', String(ready));
      prop(play, 'title', next ? `Play first selection: ${next.title}` : 'Save a track to play it here'); this.decorate(play, 'Play first selection', 'play', 'Play pick');
    }
    const hostPlay = host ? this.button('host-play', 'Play pick', () => {}) : undefined;
    if (hostPlay) {
      this.decorate(hostPlay, 'Play pick', 'play');
      prop(hostPlay, 'disabled', true); prop(hostPlay, 'title', 'The current participant chooses and starts their song.');
    }
    children(controls, play ?? hostPlay, transport, stop);
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
    const ui = v.get('host-ui', () => ({ identity: '', pending: '' }));
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
      const current = this.state?.view;
      if (!current || (current.playbackStatus !== 'idle' && !confirm('Stop the current song and skip to the next person?'))) return;
      return options.advance(current.turnId);
    }); });
    prop(advance, 'disabled', busy || !online || !view.connected || !view.current);
    this.decorate(advance, 'Skip turn', 'advance'); prop(advance, 'title', 'Skip to the next participant');
    const transport = this.transport(state);
    const stop = transport.querySelector<HTMLButtonElement>('#host-stop')!;
    if ((changedPlayback || !songActive) && document.activeElement === stop && !advance.disabled) advance.focus({ preventScroll: true });
    const reveal = this.button('host-reveal-status', 'Hidden', () => {}, true);
    this.decorate(reveal, playback?.revealed ? 'Details revealed' : 'Reveal details', 'reveal', playback?.revealed ? 'Revealed' : 'Reveal');
    prop(reveal, 'disabled', true); prop(reveal, 'title', 'Only the current participant can reveal their song on the room display.');
    children(controls, reveal, advance);
    children(this.element, livePerson, transport, this.progress, this.footer(controls));
  }

  private renderParticipant(state: PlaybackState, options: ParticipantOptions) {
    const v = this.nodes; const { view, projected, online, busy, starting } = state;
    const playback = view.myTurn ? projected.ownPlayback : undefined;
    const next = state.firstSelection; const preview = playback?.track ?? next;
    const card = this.element;
    const details = this.details ??= new ParticipantPlayerDetails();
    details.update({ title: preview?.title, artist: preview?.artist, album: preview?.album,
      next: next?.title, error: state.error || (!online ? 'Connection lost. Your saved songs are kept. Controls return when the room reconnects.'
        : !view.connected ? 'The room cannot confirm playback or save changes. Ask the host to check Settings.' : undefined) });
    const now = v.el('now', 'div', undefined, 'private-now-playing');
    const track = v.el('track', 'div'); const title = v.el('title', 'h2', preview?.title ?? (view.myTurn ? 'Choose a song' : 'Waiting for your turn'));
    prop(title, 'title', title.textContent!);
    const artist = v.el('artist', 'div', undefined, 'artist-credit');
    const credit = v.el('credit', 'p', preview?.artist ?? 'Search or use your list.', 'artist'); prop(credit, 'title', credit.textContent!);
    children(artist, Boolean(preview?.artistArtwork) && v.get('portrait', () => new ArtworkView('Artist image', 'artist-portrait')).update(preview?.artistArtwork), credit);
    children(track, title, artist, this.output, details.button);
    children(now, v.get('cover', () => new ArtworkView('Album artwork', 'mini-record')).update(preview?.artwork), track);
    const progress = this.progress; const status = progress.querySelector<HTMLElement>('.playback-status')!;
    const statusLine = v.el('status-line', 'div', undefined, 'player-status-line');
    const privacy = playback ? playback.revealed ? view.ownPlayback?.revealed ? 'Visible on room display' : 'Revealing…' : 'Hidden on room display' : next ? 'First saved selection' : 'Your player';
    const notice = state.error ? 'Action failed · tap details' : !online ? 'Connection lost' : !view.connected ? 'Player unavailable'
      : !view.myTurn ? 'Waiting for turn' : !playback && !starting ? next ? 'Ready to play' : 'Choose a song' : '';
    const mobileNotice = v.el('mobile-notice', 'span', undefined, 'player-mobile-only player-mobile-notice');
    children(mobileNotice, v.el('mobile-notice-caption', 'span', notice),
      state.error ? v.el('mobile-error-detail', 'span', ` ${state.error}`, 'sr-only') : undefined);
    attr(mobileNotice, 'role', state.error ? 'alert' : 'status');
    card.classList.toggle('has-player-notice', Boolean(notice));
    card.classList.toggle('has-player-error', Boolean(state.error));
    const mobilePrivacy = v.el('mobile-privacy', 'span', playback ? playback.revealed ? view.ownPlayback?.revealed ? 'Revealed' : 'Revealing' : 'Hidden' : '', 'player-mobile-only player-mobile-privacy');
    prop(mobilePrivacy, 'title', playback ? privacy : '');
    children(statusLine, status, mobileNotice, v.el('privacy', 'span', privacy, 'privacy-tag'), mobilePrivacy);
    if (statusLine.parentElement !== progress) progress.prepend(statusLine);
    card.classList.toggle('has-next-pick', Boolean(next));
    card.classList.toggle('has-active-song', Boolean(playback && playback.status !== 'stopped'));
    const reveal = this.button('player-reveal', 'Reveal details', () => options.reveal()); reveal.classList.add('reveal-button');
    this.decorate(reveal, playback?.revealed ? 'Details revealed' : 'Reveal details', 'reveal', playback?.revealed ? 'Revealed' : 'Reveal');
    prop(reveal, 'title', playback?.revealed ? 'Details revealed' : 'Reveal track details on the room display');
    prop(reveal, 'disabled', !online || !view.connected || !view.myTurn || !playback || playback.revealed);
    const finish = this.button('finish-my-turn', 'Pass turn', () => { void options.run(() => options.finish()); }, true);
    this.decorate(finish, playback ? 'Finish turn' : 'Pass turn', 'advance');
    prop(finish, 'title', playback ? 'Finish your turn and pass to the next participant' : 'Pass to the next participant');
    prop(finish, 'disabled', busy || !online || !view.connected || !view.myTurn || starting);
    const ending = v.el('ending', 'div', undefined, 'player-ending'); children(ending, reveal, finish);
    children(card, now, this.transport(state), progress, this.footer(ending), details.dialog);
  }
}
