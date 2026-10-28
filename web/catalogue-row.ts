import type { CatalogueAlbum, CatalogueArtist, CatalogueTrack } from '../src/model';
import { ArtworkView } from './media';
import { ViewNodes, children, attr, prop, text } from './view-nodes';
import type { PreparationPanel } from './preparation-panel';

type Item = CatalogueArtist | CatalogueAlbum | CatalogueTrack;
type Options = {
  music: PreparationPanel;
  online: boolean; canPlay: boolean; playbackAvailable: boolean; starting: boolean;
  browse(item: CatalogueArtist | CatalogueAlbum): void; play(track: CatalogueTrack): void;
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
    content.push(v.el('details', 'p', kind === 'artist' ? (group as CatalogueArtist).description ?? '' : kind === 'album'
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
      children(controls, add, play); children(row, info, controls);
    }
    return row;
  }
}
