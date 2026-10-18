import { el } from './dom';

export function sourceName(provider: string) {
  const names: Record<string, string> = { spotify: 'Spotify', tidal: 'Tidal', qobuz: 'Qobuz', apple_music: 'Apple Music', youtube_music: 'YouTube Music', filesystem_local: 'Local files', library: 'Music Assistant' };
  return provider.split(/ [·+] /).map(name => names[name] ?? name).join(' · ');
}

/** A display group is never a playback choice. Values are participant-bound opaque references. */
export function catalogueSourceChoice<T extends { id: string; provider: string; sources?: T[]; matchKind?: 'identity' | 'metadata'; version?: string; year?: number | null; available?: boolean }>(
  item: T, caption: string, selected: Map<string, string>, changed: () => void, browse: false | 'artist' | 'album' = false,
): { item?: T; control?: HTMLElement } {
  if (!item.sources?.length) return { item };
  const picked = item.sources.find(source => source.id === selected.get(item.id));
  const label = el('label', undefined, 'catalogue-source'); label.append(el('span', `Source for ${caption}`, 'sr-only'));
  const union = Boolean(browse && item.matchKind !== 'metadata');
  const notice = item.matchKind === 'metadata' && !picked ? 'These results may be different versions. Choose a source to continue.' : '';
  if (notice) label.append(el('span', notice, 'muted small catalogue-match-note'));
  const select = el('select'); select.dataset.focusKey = `source-${item.id}`;
  select.setAttribute('aria-label', `Source for ${caption}`);
  if (notice) select.setAttribute('aria-description', notice);
  const initial = el('option', union ? 'All listed sources' : 'Choose a source'); initial.value = ''; select.append(initial);
  const totals = new Map<string, number>(); const seen = new Map<string, number>();
  for (const source of item.sources) totals.set(source.provider, (totals.get(source.provider) ?? 0) + 1);
  for (const source of item.sources) {
    const number = (seen.get(source.provider) ?? 0) + 1; seen.set(source.provider, number);
    const details = [sourceName(source.provider), source.version, source.year, source.available === false ? 'Unavailable' : '', totals.get(source.provider)! > 1 ? `Option ${number}` : ''].filter(Boolean).join(' · ');
    const option = el('option', details);
    option.value = source.id; select.append(option);
  }
  select.value = picked?.id ?? '';
  select.onchange = () => { if (select.value) selected.set(item.id, select.value); else selected.delete(item.id); changed(); };
  label.append(select); return { item: picked ?? (union ? item : undefined), control: label };
}
