import type { Track, View } from '../src/model';
import { el, link } from './dom';
import { vinyl, updateVinylLabel } from './visuals';
import { artwork, progressBar, updateProgress } from './media';
import { publicRecordLabels } from './record-labels';
import { pageFrame } from './page-layout';
import { attr, prop, text } from './view-nodes';
import { DisplayArtworkLoader, fetchDisplayArtwork, unlockDisplayArtwork } from './display-artwork';
import { artworkKinds, type DisplayImages, type ArtworkKind } from '../src/display-artwork-format';
import { roomLogoMark } from './room-logo';
import { productName } from '../src/product';
import { AnimatedBackground } from './display-background';

export function publicPlaybackState(view: View, online: boolean) {
  if (!online || !view.connected) return 'unavailable';
  return view.progress?.status === 'playing' || view.progress?.status === 'paused' ? view.progress.status : 'idle';
}

/** The stage's title and hint line. Every state writes into the same places on the screen:
 * the title where a song's title goes, the hint where its artist goes. */
export function publicStageText(view: View | undefined, online: boolean): { title: string; hint: string } {
  if (!view) return { title: productName, hint: 'Connecting to the room…' };
  const state = publicPlaybackState(view, online);
  if (state === 'playing' || state === 'paused') {
    const track = view.nowPlaying?.revealed ? view.nowPlaying.track : undefined;
    return { title: track?.title ?? 'Track details hidden.', hint: '' };
  }
  if (state === 'unavailable') return { title: 'Playback unavailable.', hint: online ? 'Waiting for a reliable playback update.' : 'Reconnecting to the room…' };
  return { title: 'Nothing playing.', hint: view.current ? 'Waiting for the next selection.' : 'Scan the QR code to join the Doom Room.' };
}

export function publicStreamDetails(view: View, online: boolean) {
  const state = publicPlaybackState(view, online);
  if (state !== 'playing' && state !== 'paused') return '';
  const info = view.streamInfo;
  return [info?.format, info?.bitRate ? `${info.bitRate} kbps` : undefined,
    info?.sampleRate ? `${info.sampleRate / 1000} kHz` : undefined].filter(Boolean).join(' · ');
}

/** Keep motion on persistent nodes: revealing metadata must never restart or change its rhythm.
 * One stage serves every state, laid out like a revealed song: the logo, record, turn line, title,
 * artist and album lines, progress and join code keep their places; only their contents change. */
export class PublicRoom {
  readonly element = pageFrame('display', 'display-page');
  private background = new AnimatedBackground();
  private turn = el('p', undefined, 'room-turn');
  private invitation = el('aside', undefined, 'room-invitation');
  private logo = roomLogoMark('room-logo-display');
  private stage = el('section', undefined, 'now-playing');
  private cover = el('div', undefined, 'cover room-cover');
  private record = vinyl();
  private title = el('h1');
  private hint = el('p', undefined, 'room-hint');
  private credit = el('div', undefined, 'artist-credit');
  private album = el('p', undefined, 'room-album');
  private progress = progressBar(undefined, true);
  private technical = el('p', undefined, 'room-stream-details');
  private invitationKey = '';
  private trackKey = '';
  private revealed?: Track;
  private artworkEpoch = 0;
  private objectUrls: string[] = [];
  private prepared = new DisplayArtworkLoader({ load: fetchDisplayArtwork, unlock: unlockDisplayArtwork,
    ready: images => { void this.showPrepared(images); }, failed: () => this.showArtworkNormally() });

  private clearImages() {
    this.artworkEpoch++;
    for (const url of this.objectUrls) URL.revokeObjectURL(url);
    this.objectUrls = [];
  }
  destroy() { this.prepared.clear(); this.clearImages(); this.revealed = undefined; this.background.destroy(); }
  private showArtworkNormally(kind?: ArtworkKind) {
    const track = this.revealed; if (!track) return;
    if ((!kind || kind === 'artwork') && track.artwork && !this.cover.querySelector('.room-artwork')) this.cover.append(artwork(track.artwork, 'Current album artwork', 'room-artwork', true));
    if ((!kind || kind === 'artistArtwork') && track.artistArtwork && !this.credit.querySelector('.artist-portrait')) this.credit.prepend(artwork(track.artistArtwork, 'Current artist image', 'artist-portrait', true));
  }
  private async showPrepared(images: DisplayImages) {
    if (!this.revealed) return;
    const epoch = this.artworkEpoch;
    await Promise.all(artworkKinds.map(async kind => {
      const asset = images[kind];
      if (!asset) { this.showArtworkNormally(kind); return; }
      const url = URL.createObjectURL(new Blob([new Uint8Array(asset.body)], { type: asset.contentType })); this.objectUrls.push(url);
      const image = el('img'); image.alt = kind === 'artwork' ? 'Current album artwork' : 'Current artist image'; image.decoding = 'async';
      try {
        const loaded = new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(Error('Artwork unavailable.')); });
        image.src = url; await loaded; if (image.decode) await image.decode();
        if (epoch !== this.artworkEpoch || !this.revealed) return;
        const frame = el('div', undefined, `media-artwork ${kind === 'artwork' ? 'room-artwork' : 'artist-portrait'}`); frame.append(image);
        if (kind === 'artwork') this.cover.append(frame); else this.credit.prepend(frame);
      } catch { if (epoch === this.artworkEpoch) this.showArtworkNormally(kind); }
      finally { image.onload = image.onerror = null; }
    }));
  }

  constructor() {
    const grid = el('div', undefined, 'room-stage');
    const listening = el('section', undefined, 'room-listening'); listening.setAttribute('aria-label', 'Listening stage');
    this.stage.setAttribute('aria-label', 'Room playback');
    this.hint.setAttribute('role', 'status');
    const visual = el('div', undefined, 'room-visual');
    const glow = el('div', undefined, 'room-glow'); glow.setAttribute('aria-hidden', 'true');
    this.record.classList.add('room-record'); this.cover.append(this.record);
    visual.append(glow, this.cover);
    // One title line tall, anchored at its bottom: a longer title grows upward and nothing below it moves.
    const titleSlot = el('div', undefined, 'room-title-slot'); titleSlot.append(this.title);
    const info = el('div', undefined, 'track-info');
    info.append(titleSlot, this.hint, this.credit, this.album);
    const activity = el('div', undefined, 'room-activity');
    this.technical.title = 'Source audio reported by Music Assistant'; this.technical.hidden = true;
    activity.append(this.progress); info.append(activity, this.technical);
    this.stage.append(visual, info);
    listening.append(this.turn, this.stage);
    this.invitation.setAttribute('aria-label', 'Join room');
    grid.append(this.logo, listening, this.invitation); this.element.append(this.background.element, grid);
    this.connecting();
  }

  /** Before the first room update: the same stage, resting, with the app's name in the title. */
  connecting() {
    attr(this.element, 'data-playback', 'connecting'); attr(this.element, 'data-stage', 'resting');
    prop(this.turn, 'hidden', true);
    const words = publicStageText(undefined, navigator.onLine);
    text(this.title, words.title); this.title.classList.remove('is-long'); text(this.hint, words.hint);
    this.revealed = undefined; this.trackKey = ''; this.clearImages(); this.prepared.clear();
    this.cover.querySelector('.room-artwork')?.remove(); this.credit.replaceChildren(); this.credit.hidden = true;
    text(this.album, ''); this.album.hidden = true; updateVinylLabel(this.record);
    updateProgress(this.progress, undefined); text(this.technical, ''); this.technical.hidden = true;
  }

  update(view: View, online: boolean, qrImage: string) {
    this.background.update(view.background);
    const state = publicPlaybackState(view, online);
    const active = state === 'playing' || state === 'paused';
    attr(this.element, 'data-playback', state);
    attr(this.element, 'data-stage', active ? 'playing' : 'resting');
    text(this.turn, view.current ? `Currently playing: ${view.current.nickname}` : '');
    prop(this.turn, 'hidden', state !== 'playing' || !view.current);

    const revealed = active && view.nowPlaying?.revealed === true ? view.nowPlaying.track : undefined;
    this.revealed = revealed;
    const words = publicStageText(view, online);
    text(this.title, words.title); text(this.hint, words.hint);
    this.title.classList.toggle('is-long', Boolean(revealed && revealed.title.length > 55));
    const trackKey = active ? JSON.stringify([view.progress!.id, view.preparedArtwork?.id, revealed ?? null, revealed ? null : view.current]) : '';
    if (this.trackKey !== trackKey) {
      this.trackKey = trackKey;
      this.clearImages();
      this.cover.querySelector('.room-artwork')?.remove(); this.credit.replaceChildren();
      updateVinylLabel(this.record);
      this.album.textContent = active ? revealed?.album ?? '' : '';
      this.album.hidden = !this.album.textContent;
      this.credit.hidden = !revealed?.artist;
      if (active) {
        const sticker = revealed ? { owner: revealed.title, caption: revealed.artist }
          : publicRecordLabels.label(JSON.stringify([view.roomId, view.turnId, view.progress!.id, view.current?.id]), view.current?.nickname);
        updateVinylLabel(this.record, sticker);
        if (!view.preparedArtwork) this.showArtworkNormally();
        if (revealed?.artist) this.credit.append(el('p', revealed.artist, 'artist'));
      }
    }
    this.prepared.update(active ? view.preparedArtwork : undefined,
      active ? JSON.stringify([view.roomId, view.turnId, view.progress!.id]) : '', Boolean(revealed));
    updateProgress(this.progress, active ? view.progress : undefined);
    const technical = publicStreamDetails(view, online);
    text(this.technical, technical); prop(this.technical, 'hidden', !technical);

    const invitationKey = JSON.stringify([view.joinUrl, qrImage, view.guestAccess]);
    if (this.invitationKey !== invitationKey) {
      this.invitationKey = invitationKey;
      this.invitation.replaceChildren(el('h3', 'Join room'));
      if (!view.joinUrl) {
        if (view.guestAccess) this.invitation.append(el('p', view.guestAccess.message, 'muted small'));
        this.invitation.append(link('Guest access settings', '/host/settings#access'));
      }
      if (view.joinUrl) {
        const join = link('', view.joinUrl, 'room-qr-link'); join.setAttribute('aria-label', 'Join room');
        if (qrImage) { const image = el('img'); image.src = qrImage; image.alt = 'Scan to join the room'; join.append(image); this.invitation.append(join); }
      }
    }
  }

}
