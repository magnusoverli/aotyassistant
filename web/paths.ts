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
  if (inIngress() && ['/participant', '/join', '/display'].includes(path)) return guestLinksReady() ? `${meta('aoty-guest')}${path}` : appPath('/host/settings');
  return appPath(path);
}
export function guestLinksReady(origin = meta('aoty-guest')) {
  if (!inIngress()) return true;
  try { return !/^(localhost|127\.|\[::1\])/.test(new URL(origin).hostname); } catch { return false; }
}
