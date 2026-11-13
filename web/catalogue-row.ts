import type { CatalogueAlbum, CatalogueArtist, CatalogueTrack } from '../src/model';
import { ArtworkView } from './media';
import { ViewNodes, children, attr, prop } from './view-nodes';
import type { PreparationPanel } from './preparation-panel';
import { buttonIcon } from './button-icon';

type Item = CatalogueArtist | CatalogueAlbum | CatalogueTrack;
type Options = {
  music: PreparationPanel;
  online: boolean; canPlay: boolean; playbackAvailable: boolean; starting: boolean;
  browse(item: CatalogueArtist | CatalogueAlbum): void; play(track: CatalogueTrack): void;
  /** Start the browse request when the pointer goes down; `unprepare` when no click follows. */
  prepare(item: CatalogueArtist | CatalogueAlbum): void; unprepare(): void;
  /** A song's place in its album (1-based), shown on phones in place of the repeated cover. */
  position?: number;
};

/** A song length as m:ss, or nothing when it is unknown. */
const length = (seconds: number | null) => {
  if (!seconds || !Number.isFinite(seconds)) return '';
  const total = Math.round(seconds); return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};

/** The backend resolves equivalent providers; listeners choose music, not services. */
export class CatalogueRow {
  private nodes = new ViewNodes();
  update(kind: 'artist' | 'album' | 'track', group: Item, options: Options) {
    const v = this.nodes;
    const shown = group;
    const track = shown as CatalogueTrack; const album = shown as CatalogueAlbum;
    const row = v.get('row', () => { const node = document.createElement('div'); node.className = `track-row${kind === 'track' ? '' : ' browse-row'}`; return node; });
    const info = v.el('identity', 'div', undefined, 'result-identity'); const copy = v.el('copy', 'div');
    const content: Node[] = [v.el('name', 'strong', kind === 'track' ? track.title : album.name)];
    if (kind === 'track') content.push(v.el('artist', 'p', track.artist, 'result-artist'));
    if (kind !== 'artist') content.push(v.el('details', 'p', kind === 'album'
      ? [album.artist, album.year, album.version].filter(Boolean).join(' · ')
      : [track.album, track.version].filter(Boolean).join(' · '), kind === 'track' ? 'muted result-details result-full' : 'muted result-full'));
    // Phones browse inside one artist's album, so this line drops what the heading already says:
    // albums show year and edition, songs their version and length (music-collection.css swaps the lines).
    if (kind !== 'artist') content.push(v.el('meta', 'p', kind === 'album'
      ? [album.year, album.version].filter(Boolean).join(' · ')
      : [track.version, length(track.duration)].filter(Boolean).join(' · '), 'muted result-meta'));
    if (kind === 'track' && !track.available) content.push(v.el('unavailable', 'p', 'Currently unavailable', 'muted small'));
    children(copy, ...content);
    const art = v.get('art', () => new ArtworkView(kind === 'artist' ? 'Artist image' : 'Album artwork', kind === 'artist' ? 'result-artwork artist-portrait' : 'result-artwork'));
    const number = v.el('number', 'span', options.position ? String(options.position) : '', 'result-number'); attr(number, 'aria-hidden', 'true');
    children(info, kind === 'track' && number, art.update(shown.artwork), copy);
    if (kind !== 'track') {
      attr(row, 'role', 'button'); prop(row, 'tabIndex', 0);
      attr(row, 'aria-label', kind === 'artist' ? `View albums by ${album.name}` : `View tracks on ${album.name}`);
      attr(row, 'aria-disabled', String(!options.online));
      row.onclick = () => { if (options.online) options.browse(shown as CatalogueAlbum); };
      row.onkeydown = event => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        if (event.key === 'Enter' && !event.repeat) row.click();
      };
      row.onkeyup = event => {
        if (event.key !== ' ') return;
        event.preventDefault(); row.click();
      };
      row.onpointerdown = event => { if (event.button === 0 && options.online) options.prepare(shown as CatalogueAlbum); };
      // A scroll takes over (cancel), or a held mouse button leaves. Touch also
      // fires pointerleave after lifting the finger; that must not cancel.
      row.onpointercancel = () => options.unprepare();
      row.onpointerleave = event => { if (event.buttons) options.unprepare(); };
      children(row, info);
    } else {
      const controls = v.el('controls', 'div', undefined, 'row-actions');
      const add = v.get(`add-${track.id}`, () => options.music.addButton(track));
      attr(add, 'data-source-selectable', 'true');
      options.music.updateAddButton(add);
      row.classList.toggle('is-prepared', add.getAttribute('aria-disabled') === 'true');
      const play = v.el('play', 'button', undefined, 'catalogue-action'); prop(play, 'type', 'button');
      const caption = !track.available ? 'Unavailable' : !options.playbackAvailable ? 'Choose a speaker' : 'Play';
      const reason = !track.available ? 'Unavailable' : !options.playbackAvailable ? 'Choose a speaker'
        : !options.online ? 'Offline' : options.starting ? 'Playback is starting' : undefined;
      attr(play, 'aria-label', reason ? `Play — ${reason}` : 'Play');
      const short = v.el('play-short', 'span', 'Play', 'catalogue-action-short'); attr(short, 'aria-hidden', 'true');
      children(play, v.get('play-icon', () => buttonIcon('play', 'catalogue-action-icon')),
        v.el('play-caption', 'span', caption, 'catalogue-action-full'), short);
      const ready = options.online && options.canPlay && track.available && options.playbackAvailable;
      attr(play, 'data-player-ready', String(ready)); prop(play, 'disabled', !ready || options.starting);
      play.onclick = () => options.play(track);
      // Play exists only during your turn; waiting listeners see just Add to list.
      children(controls, add, options.canPlay && play); children(row, info, controls);
    }
    return row;
  }
}
