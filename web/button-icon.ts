import { attr } from './view-nodes';

const paths = {
  play: 'M8 5l11 7-11 7Z', pause: 'M8 5v14M16 5v14', stop: 'M6 6h12v12H6Z', next: 'M5 5l10 7-10 7ZM19 5v14',
  volume: 'M11 5 6 9H3v6h3l5 4ZM15 8a6 6 0 0 1 0 8M18 5a10 10 0 0 1 0 14',
  muted: 'M11 5 6 9H3v6h3l5 4ZM16 9l6 6M22 9l-6 6',
  reveal: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12ZM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
  advance: 'M4 12h16M14 6l6 6-6 6',
  add: 'M12 5v14M5 12h14', check: 'M5 12l4 4L19 6', progress: 'M12 3a9 9 0 1 1-9 9',
};
export type ButtonIcon = keyof typeof paths;

/** The player's stroke icons, shared by compact actions. Captions supply the accessible name. */
export function buttonIcon(icon: ButtonIcon, className: string) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('focusable', 'false');
  svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor'); svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('stroke-linejoin', 'round'); svg.setAttribute('class', className);
  svg.append(document.createElementNS('http://www.w3.org/2000/svg', 'path')); updateButtonIcon(svg, icon);
  return svg;
}

export function updateButtonIcon(svg: SVGSVGElement, icon: ButtonIcon) { attr(svg.firstElementChild!, 'd', paths[icon]); }
