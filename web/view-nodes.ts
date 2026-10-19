import { el, syncChildren } from './dom';

export function text(node: Node, value: string) { if (node.textContent !== value) node.textContent = value; }
export function attr(node: Element, name: string, value: string | undefined) {
  if (value === undefined) { if (node.hasAttribute(name)) node.removeAttribute(name); }
  else if (node.getAttribute(name) !== value) node.setAttribute(name, value);
}
export function prop<T, K extends keyof T>(node: T, key: K, value: T[K]) { if (node[key] !== value) node[key] = value; }
export function children(parent: Element, ...nodes: (Node | undefined | false | null)[]) {
  syncChildren(parent, nodes.filter((node): node is Node => Boolean(node)));
}

/** A component's named, persistent nodes. Builders and handlers always receive the live
 * nodes, never detached templates. Reconciliation only inserts/removes changed children. */
export class ViewNodes {
  private nodes = new Map<string, unknown>();
  get<T>(key: string, create: () => T): T {
    if (!this.nodes.has(key)) this.nodes.set(key, create());
    return this.nodes.get(key) as T;
  }
  el<K extends keyof HTMLElementTagNameMap>(key: string, tag: K, value?: string, className?: string): HTMLElementTagNameMap[K] {
    const node = this.get(key, () => el(tag));
    if (value !== undefined) text(node, value);
    if (className !== undefined) prop(node, 'className', className);
    return node;
  }
  retain(prefix: string, keys: Iterable<string>) {
    const keep = new Set(keys);
    for (const key of this.nodes.keys()) if (key.startsWith(prefix) && !keep.has(key)) this.nodes.delete(key);
  }
  clear() { this.nodes.clear(); }
}

/** Batch event notifications within a task, without delaying commands or authoritative state. */
export function scheduledRender(update: () => void) {
  let pending = false;
  return () => {
    if (pending) return;
    pending = true;
    queueMicrotask(() => { pending = false; update(); });
  };
}
