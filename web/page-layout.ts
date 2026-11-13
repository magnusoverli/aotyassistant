import { el } from './dom';

export type PageLayout = 'workspace' | 'compact' | 'display';

/** Layouts own geometry; callers retain their feature nodes and controllers. */
export function pageFrame(layout: PageLayout, className = '') {
  const main = el('main', undefined, `page ${className}`.trim());
  main.dataset.layout = layout;
  return main;
}

export function workspaceGrid(layout: 'sidebar' | 'music', className = '') {
  const grid = el('div', undefined, `workspace-grid ${className}`.trim());
  grid.dataset.composition = layout;
  return grid;
}

export function slot<T extends HTMLElement>(node: T, name: 'primary' | 'secondary' | 'player' | 'find' | 'list' | 'results') {
  if (node.dataset.slot !== name) node.dataset.slot = name;
  return node;
}

/** The stacked (phone) layout: the same breakpoint that sets --layout-stacked in ui-layouts.css. A cached
 * media query answers without the style recalculation reading that variable would force. */
const stacked = typeof matchMedia === 'function' ? matchMedia('(max-width:1099px)') : undefined;
export function stackedLayout() {
  return stacked ? stacked.matches : getComputedStyle(document.documentElement).getPropertyValue('--layout-stacked').trim() === '1';
}
