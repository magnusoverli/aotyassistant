import type { CatalogueAlbum, CatalogueArtist, CatalogueTrack } from '../src/model';
import { ArtworkView } from './media';
import { ViewNodes, children, attr, prop, text } from './view-nodes';
import type { PreparationPanel } from './preparation-panel';

type Item = CatalogueArtist | CatalogueAlbum | CatalogueTrack;
type Options = {
  music: PreparationPanel;
  online: boolean; canPlay: boolean; playbackAvailable: boolean; starting: boolean;
  browse(item: CatalogueArtist | CatalogueAlbum): void; play(track: CatalogueTrack): void;
  /** Start the browse request when the pointer goes down; `unprepare` when no click follows. */
  prepare(item: CatalogueArtist | CatalogueAlbum): void; unprepare(): void;
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
      : [track.album, track.version].filter(Boolean).join(' · '), kind === 'track' ? 'muted result-details' : 'muted'));
    if (kind === 'track' && !track.available) content.push(v.el('unavailable', 'p', 'Currently unavailable', 'muted small'));
    children(copy, ...content);
    const art = v.get('art', () => new ArtworkView(kind === 'artist' ? 'Artist image' : 'Album artwork', kind === 'artist' ? 'result-artwork artist-portrait' : 'result-artwork'));
    children(info, art.update(shown.artwork), copy);
    if (kind !== 'track') {
      const browse = v.el('browse', 'button', kind === 'artist' ? 'View albums' : 'View tracks', 'secondary'); prop(browse, 'type', 'button');
      prop(browse, 'disabled', !options.online);
      browse.onclick = () => options.browse(shown as CatalogueAlbum);
      browse.onpointerdown = event => { if (event.button === 0 && !browse.disabled) options.prepare(shown as CatalogueAlbum); };
      // A scroll takes over (cancel), or a held mouse button leaves. Touch also
      // fires pointerleave after lifting the finger; that must not cancel.
      browse.onpointercancel = () => options.unprepare();
      browse.onpointerleave = event => { if (event.buttons) options.unprepare(); };
      // The whole row opens the artist or album; the button stays for keyboards and screen readers.
      const outside = (event: Event) => !(event.target instanceof Element && event.target.closest('button'));
      row.onclick = event => { if (outside(event) && !browse.disabled) options.browse(shown as CatalogueAlbum); };
      row.onpointerdown = event => { if (outside(event) && event.button === 0 && !browse.disabled) options.prepare(shown as CatalogueAlbum); };
      row.onpointercancel = event => { if (outside(event)) options.unprepare(); };
      row.onpointerleave = event => { if (event.buttons) options.unprepare(); };
      children(row, info, browse);
    } else {
      const controls = v.el('controls', 'div', undefined, 'row-actions');
      const add = v.get(`add-${track.id}`, () => options.music.addButton(track));
      attr(add, 'data-source-selectable', 'true');
      options.music.updateAddButton(add);
      row.classList.toggle('is-prepared', add.getAttribute('aria-disabled') === 'true');
      const play = v.el('play', 'button'); prop(play, 'type', 'button');
      text(play, !track.available ? 'Unavailable' : !options.playbackAvailable ? 'Choose a speaker' : 'Play');
      const ready = options.online && options.canPlay && track.available && options.playbackAvailable;
      attr(play, 'data-player-ready', String(ready)); prop(play, 'disabled', !ready || options.starting);
      play.onclick = () => options.play(track);
      // Play exists only during your turn; waiting listeners see just Add to list.
      children(controls, add, options.canPlay && play); children(row, info, controls);
    }
    return row;
  }
}
