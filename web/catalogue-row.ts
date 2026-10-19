import type { CatalogueAlbum, CatalogueArtist, CatalogueTrack } from '../src/model';
import { catalogueSourceChoice, sourceName } from './catalogue-sources';
import { ArtworkView } from './media';
import { ViewNodes, children, attr, prop, text } from './view-nodes';
import type { PreparationPanel } from './preparation-panel';

type Item = CatalogueArtist | CatalogueAlbum | CatalogueTrack;
type Options = {
  choices: Map<string, string>; changed(): void; music: PreparationPanel;
  online: boolean; canPlay: boolean; playbackAvailable: boolean; starting: boolean;
  browse(item: CatalogueArtist | CatalogueAlbum): void; play(track: CatalogueTrack): void;
};

/** One identity-stable result row, including its native source picker. */
export class CatalogueRow {
  private nodes = new ViewNodes();
  update(kind: 'artist' | 'album' | 'track', group: Item, options: Options) {
    const v = this.nodes;
    // Each kind has recursively homogeneous source choices.
    const source = kind === 'track'
      ? catalogueSourceChoice(group as CatalogueTrack, (group as CatalogueTrack).title, options.choices, options.changed, false, v)
      : catalogueSourceChoice(group as CatalogueAlbum, (group as CatalogueAlbum).name, options.choices, options.changed, kind, v);
    const shown = source.item ?? group;
    const track = shown as CatalogueTrack; const album = shown as CatalogueAlbum;
    const unchosen = group.matchKind === 'metadata' && !source.item;
    const row = v.get('row', () => { const node = document.createElement('div'); node.className = `track-row${kind === 'track' ? '' : ' browse-row'}`; return node; });
    const info = v.el('identity', 'div', undefined, 'result-identity'); const copy = v.el('copy', 'div');
    const content: Node[] = [v.el('name', 'strong', kind === 'track' ? track.title : album.name)];
    if (kind === 'track') content.push(v.el('artist', 'p', track.artist, 'result-artist'));
    content.push(v.el('details', 'p', kind === 'artist' ? sourceName(group.provider) : kind === 'album'
      ? [unchosen ? null : album.year, album.version, sourceName(group.provider)].filter(Boolean).join(' · ')
      : [track.album, track.version, sourceName(track.provider)].filter(Boolean).join(' · '), kind === 'track' ? 'muted result-details' : 'muted'));
    if (source.control) content.push(source.control);
    if (kind === 'track' && source.item && !track.available) content.push(v.el('unavailable', 'p', 'Unavailable through this source', 'muted small'));
    children(copy, ...content);
    const art = v.get('art', () => new ArtworkView(kind === 'artist' ? 'Artist image' : 'Album artwork', kind === 'artist' ? 'result-artwork artist-portrait' : 'result-artwork'));
    children(info, art.update(unchosen ? undefined : shown.artwork), copy);
    if (kind !== 'track') {
      const browse = v.el('browse', 'button', kind === 'artist' ? 'View albums' : 'View tracks', 'secondary'); prop(browse, 'type', 'button');
      prop(browse, 'disabled', !options.online || !source.item);
      browse.onclick = () => { if (source.item) options.browse(source.item as CatalogueAlbum); };
      children(row, info, browse);
    } else {
      const controls = v.el('controls', 'div', undefined, 'row-actions');
      const add = v.get(`add-${track.id}`, () => options.music.addButton(track));
      attr(add, 'data-source-selectable', String(Boolean(source.item)));
      options.music.updateAddButton(add);
      row.classList.toggle('is-prepared', add.getAttribute('aria-disabled') === 'true');
      const play = v.el('play', 'button'); prop(play, 'type', 'button');
      text(play, !source.item ? 'Choose a source' : !track.available ? 'Unavailable' : !options.playbackAvailable ? 'Choose a speaker' : 'Play');
      const ready = options.online && options.canPlay && Boolean(source.item) && track.available && options.playbackAvailable;
      attr(play, 'data-player-ready', String(ready)); prop(play, 'disabled', !ready || options.starting);
      play.onclick = () => options.play(track);
      children(controls, add, play); children(row, info, controls);
    }
    return row;
  }
}
