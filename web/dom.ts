export function el<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, className?: string): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
}
export function label(text: string) { return el('p', text, 'eyebrow'); }
/** Retain nodes already in the right position instead of detaching/reinserting an entire list. */
export function syncChildren(parent: Element, next: Node[]) {
  const keep = new Set(next);
  for (const child of [...parent.childNodes]) if (!keep.has(child)) child.remove();
  let cursor = parent.firstChild;
  for (const child of next) {
    if (child === cursor) cursor = cursor.nextSibling;
    else parent.insertBefore(child, cursor);
  }
}
export function link(text: string, href: string, className = 'button secondary') {
  const a = el('a', text, className); a.href = navigationHref(href); return a;
}
import { navigationHref } from './paths';
