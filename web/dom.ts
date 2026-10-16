export function el<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, className?: string): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
}
export function label(text: string) { return el('p', text, 'eyebrow'); }
export function link(text: string, href: string, className = 'button secondary') {
  const a = el('a', text, className); a.href = navigationHref(href); return a;
}
import { navigationHref } from './paths';
