import { el } from './dom';
import { hasOnlineSession, isPublic } from './paths';

/** Redeem a fragment before mounting anything that subscribes to private room state. */
export async function enterOnline(root: HTMLElement): Promise<boolean> {
  if (!isPublic()) return true;
  let invitation = new URLSearchParams(location.hash.slice(1)).get('online');
  if (invitation !== null) history.replaceState(null, '', location.pathname + location.search);
  // The page itself says the invitation cookie is valid: no session check needed. A guest who
  // scans the room code again is let straight in; the scan only renews their seven days.
  if (hasOnlineSession()) {
    if (invitation) void fetch('/api/online/redeem', { method: 'POST', credentials: 'same-origin', cache: 'no-store', keepalive: true,
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ invitation }) }).catch(() => {});
    return true;
  }
  const main = el('main', undefined, 'page stack'); main.id = 'main-content';
  const status = el('p', 'Opening your invitation…'); status.setAttribute('role', 'status');
  main.append(el('h1', 'Join Doom Room'), status); root.replaceChildren(main);
  return new Promise(resolve => {
    const retry = el('button', 'Try again'); retry.type = 'button';
    const attempt = async () => {
      retry.disabled = true;
      try {
        const response = await fetch(invitation ? '/api/online/redeem' : '/api/online/session', { credentials: 'same-origin', cache: 'no-store',
          ...(invitation ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ invitation }) } : {}), signal: AbortSignal.timeout(15_000) });
        if (response.ok) { invitation = null; resolve(true); return; }
        status.textContent = response.status === 401 || response.status === 403 ? 'Ask your host for the latest invitation link or scan the room QR code. Your saved playlist is kept.'
          : response.status === 429 ? 'Too many attempts. Wait a minute, then try again.' : 'The room is temporarily unavailable. Ask the host to check its internet connection, then try again.';
      } catch { status.textContent = 'Could not reach the room. Check your internet connection and try again.'; }
      retry.disabled = false; main.append(retry);
    };
    retry.onclick = () => { void attempt(); }; void attempt();
  });
}
