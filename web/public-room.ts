import type { View } from '../src/model';
import { el } from './dom';
import { vinyl, updateVinylLabel } from './visuals';
import { artwork, progressBar, updateProgress } from './media';
import { publicRecordLabels } from './record-labels';
import { PublicTurnOrder } from './public-turn-order';

export function publicPlaybackState(view: View, online: boolean) {
  if (!online || !view.connected) return 'unavailable';
  return view.progress?.status === 'playing' || view.progress?.status === 'paused' ? view.progress.status : 'idle';
}

/** Keep motion on persistent nodes: revealing metadata must never restart or change its rhythm. */
export class PublicRoom {
  readonly element = el('main', undefined, 'display-page');
  private turn = el('p', undefined, 'room-turn');
  private order = new PublicTurnOrder();
  private invitation = el('aside', undefined, 'room-invitation');
  private rest = el('section', undefined, 'room-rest');
  private restTitle = el('h1');
  private restHint = el('p', undefined, 'muted');
  private stage = el('section', undefined, 'now-playing');
  private cover = el('div', undefined, 'cover room-cover');
  private record = vinyl();
  private title = el('h1');
  private credit = el('div', undefined, 'artist-credit');
  private album = el('p', undefined, 'room-album');
  private progress = progressBar(undefined, true);
  private invitationKey = '';
  private trackKey = '';

  constructor() {
    const grid = el('div', undefined, 'room-stage');
    const listening = el('section', undefined, 'room-listening'); listening.setAttribute('aria-label', 'Listening stage');
    this.rest.setAttribute('role', 'status');
    this.rest.append(this.restTitle, this.restHint);
    this.stage.setAttribute('aria-label', 'Public now playing');
    const visual = el('div', undefined, 'room-visual');
    const glow = el('div', undefined, 'room-glow'); glow.setAttribute('aria-hidden', 'true');
    this.record.classList.add('room-record'); this.cover.append(this.record);
    visual.append(glow, this.cover);
    const info = el('div', undefined, 'track-info');
    info.append(this.title, this.credit, this.album);
    const activity = el('div', undefined, 'room-activity');
    activity.append(this.progress); info.append(activity);
    this.stage.append(visual, info);
    listening.append(this.turn, this.rest, this.stage);
    this.invitation.setAttribute('aria-label', 'Join room');
    grid.append(listening, this.invitation); this.element.append(grid, this.order.element);
  }

  update(view: View, online: boolean, qrImage: string) {
    const state = publicPlaybackState(view, online);
    const active = state === 'playing' || state === 'paused';
    this.element.dataset.playback = state;
    this.turn.textContent = view.current ? `${view.current.nickname}’s turn` : '';
    this.turn.hidden = !view.current;
    this.rest.hidden = active; this.stage.hidden = !active;
    this.restTitle.textContent = state === 'unavailable' ? 'Playback unavailable.' : 'Nothing playing.';
    this.restHint.textContent = state === 'unavailable' ? (online ? 'Waiting for a reliable playback update.' : 'Reconnecting to the room…')
      : view.current ? 'Waiting for the next selection.' : 'Scan the QR code to join the listening circle.';

    const revealed = active && view.nowPlaying?.revealed === true ? view.nowPlaying.track : undefined;
    const trackKey = active ? JSON.stringify([view.progress!.id, revealed ?? null, revealed ? null : view.current]) : '';
    if (this.trackKey !== trackKey) {
      this.trackKey = trackKey;
      this.cover.querySelector('.room-artwork')?.remove(); this.credit.replaceChildren();
      updateVinylLabel(this.record);
      this.title.textContent = active ? revealed?.title ?? 'Keep them guessing.' : '';
      this.title.classList.toggle('is-long', Boolean(revealed && revealed.title.length > 55));
      this.album.textContent = active ? revealed?.album ?? '' : '';
      this.album.hidden = !this.album.textContent;
      this.credit.hidden = !revealed?.artist;
      if (active) {
        const sticker = revealed ? undefined : publicRecordLabels.label(JSON.stringify([view.roomId, view.turnId, view.progress!.id, view.current?.id]), view.current?.nickname);
        updateVinylLabel(this.record, sticker);
        if (revealed?.artwork) this.cover.append(artwork(revealed.artwork, 'Current album artwork', 'room-artwork', true));
        if (revealed?.artistArtwork) this.credit.append(artwork(revealed.artistArtwork, 'Current artist image', 'artist-portrait', true));
        if (revealed?.artist) this.credit.append(el('p', revealed.artist, 'artist'));
      }
    }
    updateProgress(this.progress, active ? view.progress : undefined);

    this.order.update(view, state);
    const invitationKey = JSON.stringify([view.joinUrl, qrImage]);
    if (this.invitationKey !== invitationKey) {
      this.invitationKey = invitationKey;
      this.invitation.replaceChildren(el('h3', 'Join room'));
      if (view.joinUrl) {
        if (qrImage) { const image = el('img'); image.src = qrImage; image.alt = 'Scan to join the listening room'; this.invitation.append(image); }
      }
    }
  }

  destroy() { this.order.destroy(); }
}
