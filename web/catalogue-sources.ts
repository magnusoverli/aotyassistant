import { ViewNodes, children, attr, prop } from './view-nodes';

export function sourceName(provider: string) {
  const names: Record<string, string> = { spotify: 'Spotify', tidal: 'Tidal', qobuz: 'Qobuz', apple_music: 'Apple Music', youtube_music: 'YouTube Music', filesystem_local: 'Local files', library: 'Music Assistant' };
  return provider.split(/ [·+] /).map(name => names[name] ?? name).join(' · ');
}

/** A display group is never a playback choice. Values are participant-bound opaque references. */
export function catalogueSourceChoice<T extends { id: string; provider: string; sources?: T[]; matchKind?: 'identity' | 'metadata'; version?: string; year?: number | null; available?: boolean }>(
  item: T, caption: string, selected: Map<string, string>, changed: () => void, browse: false | 'artist' | 'album' = false, nodes = new ViewNodes(),
): { item?: T; control?: HTMLElement } {
  if (!item.sources?.length) return { item };
  const picked = item.sources.find(source => source.id === selected.get(item.id));
  const label = nodes.el('source-label', 'label', undefined, 'catalogue-source');
  const union = Boolean(browse && item.matchKind !== 'metadata');
  const notice = item.matchKind === 'metadata' && !picked ? 'These results may be different versions. Choose a source to continue.' : '';
  const select = nodes.el('source-select', 'select'); attr(select, 'data-focus-key', `source-${item.id}`);
  attr(select, 'aria-label', `Source for ${caption}`); attr(select, 'aria-description', notice || undefined);
  const initial = nodes.el('source-placeholder', 'option', union ? 'All listed sources' : 'Choose a source'); prop(initial, 'value', '');
  const options = [initial];
  const totals = new Map<string, number>(); const seen = new Map<string, number>();
  for (const source of item.sources) totals.set(source.provider, (totals.get(source.provider) ?? 0) + 1);
  for (const source of item.sources) {
    const number = (seen.get(source.provider) ?? 0) + 1; seen.set(source.provider, number);
    const details = [sourceName(source.provider), source.version, source.year, source.available === false ? 'Unavailable' : '', totals.get(source.provider)! > 1 ? `Option ${number}` : ''].filter(Boolean).join(' · ');
    const option = nodes.el(`source-option-${source.id}`, 'option', details);
    prop(option, 'value', source.id); options.push(option);
  }
  children(select, ...options); prop(select, 'value', picked?.id ?? '');
  select.onchange = () => { if (select.value) selected.set(item.id, select.value); else selected.delete(item.id); changed(); };
  children(label, nodes.el('source-caption', 'span', `Source for ${caption}`, 'sr-only'), notice ? nodes.el('source-notice', 'span', notice, 'muted small catalogue-match-note') : undefined, select);
  return { item: picked ?? (union ? item : undefined), control: label };
}
