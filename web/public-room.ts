import type { View } from '../src/model';
import { el, label } from './dom';
import { avatar, rotation, vinyl, updateVinylLabel } from './visuals';
import { artwork, progressBar, updateProgress } from './media';
import { publicRecordLabels } from './record-labels';

export function publicPlaybackState(view: View, online: boolean) {
  if (!online || !view.connected) return 'unavailable';
  return view.progress?.status === 'playing' || view.progress?.status === 'paused' ? view.progress.status : 'idle';
}

/** Keep motion on persistent nodes: revealing metadata must never restart or change its rhythm. */
export class PublicRoom {
  readonly element = el('main', undefined, 'display-page');
  private people = el('div', undefined, 'room-topline');
  private circle = el('div');
  private invitation = el('aside', undefined, 'qr-card');
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
  private peopleKey = '';
  private invitationKey = '';
  private trackKey = '';

  constructor() {
    const grid = el('div', undefined, 'room-stage');
    this.rest.setAttribute('role', 'status');
    const mark = el('span', undefined, 'room-rest-mark'); mark.setAttribute('aria-hidden', 'true');
    this.rest.append(mark, this.restTitle, this.restHint);
    this.stage.setAttribute('aria-label', 'Public now playing');
    const visual = el('div', undefined, 'room-visual');
    const glow = el('div', undefined, 'room-glow'); glow.setAttribute('aria-hidden', 'true');
    this.record.classList.add('room-record'); this.cover.append(this.record);
    visual.append(glow, this.cover);
    const info = el('div', undefined, 'track-info');
    info.append(el('span', 'NOW LISTENING', 'reveal-label'), this.title, this.credit, this.album);
    const activity = el('div', undefined, 'room-activity');
    const meter = el('span', undefined, 'room-meter'); meter.setAttribute('aria-hidden', 'true');
    for (let i = 0; i < 5; i++) meter.append(el('i'));
    activity.append(meter, this.progress); info.append(activity);
    this.stage.append(visual, info);
    grid.append(this.rest, this.stage, this.invitation); this.element.append(this.people, grid, this.circle);
  }

  update(view: View, online: boolean, qrImage: string) {
    const state = publicPlaybackState(view, online);
    const active = state === 'playing' || state === 'paused';
    this.element.dataset.playback = state;
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
      this.album.textContent = active ? revealed?.album ?? 'Track details stay private until the reveal.' : '';
      if (active) {
        const sticker = revealed ? undefined : publicRecordLabels.label(JSON.stringify([view.roomId, view.turnId, view.progress!.id, view.current?.id]), view.current?.nickname);
        updateVinylLabel(this.record, sticker);
        if (revealed?.artwork) this.cover.append(artwork(revealed.artwork, 'Current album artwork', 'room-artwork', true));
        if (revealed?.artistArtwork) this.credit.append(artwork(revealed.artistArtwork, 'Current artist image', 'artist-portrait', true));
        if (revealed?.artist) this.credit.append(el('p', revealed.artist, 'artist'));
      }
    }
    updateProgress(this.progress, active ? view.progress : undefined);

    const peopleKey = JSON.stringify([view.current, view.next, view.rotation]);
    if (this.peopleKey !== peopleKey) {
      this.peopleKey = peopleKey;
      const current = el('div', undefined, 'room-speaker'); const speaker = el('div');
      speaker.append(label('CURRENT PARTICIPANT'), el('h2', view.current?.nickname ?? 'None selected'));
      current.append(avatar(view.current, 'avatar-large'), speaker);
      const next = el('div', undefined, 'room-next'); next.append(label('UP NEXT'), el('strong', view.next?.nickname ?? '—'));
      this.people.replaceChildren(current, next); this.circle.replaceChildren(rotation(view, true));
    }
    const invitationKey = JSON.stringify([view.joinUrl, qrImage]);
    if (this.invitationKey !== invitationKey) {
      this.invitationKey = invitationKey;
      this.invitation.replaceChildren(el('h3', 'Join room'));
      if (view.joinUrl) {
        if (qrImage) { const image = el('img'); image.src = qrImage; image.alt = 'Scan to join the listening room'; this.invitation.append(image); }
        this.invitation.append(el('p', 'Scan the QR code to join.', 'muted'));
      }
    }
  }
}
