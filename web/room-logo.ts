import type { RoomLogoView } from '../src/model';
import { el } from './dom';
import { appPath, isPublic } from './paths';
import { requestJson } from './request';

/** The page knows the logo before its first paint; an online shell learns it after its invitation is redeemed. */
function fromPage(): RoomLogoView | null | undefined {
  if (typeof document === 'undefined') return null;
  const meta = document.querySelector<HTMLMetaElement>('meta[name="doom-room-logo"]');
  if (meta?.content) return { url: meta.content, width: Number(meta.dataset.width) || 1, height: Number(meta.dataset.height) || 1 };
  return isPublic() ? undefined : null;
}

let current = fromPage();
const listeners = new Set<() => void>();
if (current) apply();

export const roomLogo = () => current ?? null;

/** `undefined` keeps the current logo; `null` removes it. */
export function setRoomLogo(logo: RoomLogoView | null | undefined) {
  if (logo === undefined || JSON.stringify(logo) === JSON.stringify(current)) return;
  current = logo; apply();
  for (const listener of listeners) listener();
}

export function onRoomLogo(listener: () => void, signal: AbortSignal) {
  listeners.add(listener);
  signal.addEventListener('abort', () => listeners.delete(listener), { once: true });
}

/** Online guests open the room without a logo in the page; one request fills it in. */
export async function loadRoomLogo(signal: AbortSignal) {
  if (current !== undefined) return;
  try { setRoomLogo((await requestJson<{ logo: RoomLogoView | null }>('/api/logo', undefined, 15_000, signal)).logo); }
  catch { /* The page looks as it would without a logo; the next room update retries. */ }
}

/** A place for the logo. CSS draws it in the room's colours and hides it while there is none. */
export function roomLogoMark(className: string) {
  const mark = el('div', undefined, `room-logo ${className}`);
  mark.setAttribute('role', 'img'); mark.setAttribute('aria-label', 'Room logo');
  return mark;
}

function apply() {
  const root = document.documentElement;
  if (current) {
    root.style.setProperty('--room-logo', `url("${new URL(appPath(current.url), location.href).href}")`);
    root.style.setProperty('--room-logo-ratio', `${current.width} / ${current.height}`);
    root.dataset.roomLogo = 'shown';
  } else {
    root.style.removeProperty('--room-logo'); root.style.removeProperty('--room-logo-ratio');
    delete root.dataset.roomLogo;
  }
}
