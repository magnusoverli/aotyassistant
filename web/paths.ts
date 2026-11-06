/** Context is injected by the backend only on the trusted Ingress listener. */
const meta = (name: string) => typeof document === 'undefined' ? '' : document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`)?.content ?? '';
export const ingressBase = () => meta('aoty-base');
export const inIngress = () => Boolean(ingressBase());
export function setGuestOrigin(origin: string) {
  const tag = document.querySelector<HTMLMetaElement>('meta[name="aoty-guest"]');
  if (tag && tag.content !== origin) { tag.content = origin; document.dispatchEvent(new Event('aoty-address-changed')); }
}
export function appPath(path: string) {
  return path.startsWith('/') && !path.startsWith('//') ? `${ingressBase()}${path}` : path;
}
export function pagePath(path: string) {
  const base = ingressBase(); return base && path.startsWith(`${base}/`) ? path.slice(base.length) : path;
}
export function navigationHref(path: string) {
  return appPath(path);
}
/** Preserve existing direct-access drafts; isolate installations sharing an HA origin. */
export const storageKey = (key: string) => ingressBase() ? `${ingressBase()}:${key}` : key;
