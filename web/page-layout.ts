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

/** CSS is the source of truth for the responsive mode, including before mount. */
export function stackedLayout() {
  return getComputedStyle(document.documentElement).getPropertyValue('--layout-stacked').trim() === '1';
}
