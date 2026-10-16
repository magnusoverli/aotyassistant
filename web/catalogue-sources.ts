import { el } from './dom';

/** A display group is never a playback choice. Values are participant-bound opaque references. */
export function catalogueSourceChoice<T extends { id: string; provider: string; sources?: T[] }>(
  item: T, caption: string, selected: Map<string, string>, changed: () => void, browse = false,
): { item?: T; control?: HTMLElement } {
  if (!item.sources?.length) return { item };
  const picked = item.sources.find(source => source.id === selected.get(item.id));
  const label = el('label', undefined, 'catalogue-source'); label.append(el('span', `Source for ${caption}`, 'sr-only'));
  const select = el('select'); select.dataset.focusKey = `source-${item.id}`;
  const initial = el('option', browse ? 'All listed sources' : 'Choose exact source'); initial.value = ''; select.append(initial);
  const totals = new Map<string, number>(); const seen = new Map<string, number>();
  for (const source of item.sources) totals.set(source.provider, (totals.get(source.provider) ?? 0) + 1);
  for (const source of item.sources) {
    const number = (seen.get(source.provider) ?? 0) + 1; seen.set(source.provider, number);
    const option = el('option', `${source.provider}${totals.get(source.provider)! > 1 ? ` · option ${number}` : ''}`);
    option.value = source.id; select.append(option);
  }
  select.value = picked?.id ?? '';
  select.onchange = () => { if (select.value) selected.set(item.id, select.value); else selected.delete(item.id); changed(); };
  label.append(select); return { item: picked ?? (browse ? item : undefined), control: label };
}
