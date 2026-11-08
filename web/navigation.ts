import type { View } from '../src/model';

export const routes = { home: '/', host: '/host', settings: '/host/settings', participant: '/participant', join: '/join', display: '/display' } as const;
export type Page = keyof typeof routes;
export const pageTitles: Record<Page, string> = { home: 'Home', join: 'Join room', participant: 'Your music', display: 'Room display', host: 'Host desk', settings: 'Settings' };
export const pageForPath = (path: string): Page => (Object.keys(routes) as Page[]).find(page => routes[page] === (path.replace(/\/+$/, '') || '/')) ?? 'home';

/** Preserve deep links without replacing the document that owns browser audio. */
export function spaDestination(target: URL, current: URL, base = ''): string | undefined {
  if (target.origin !== current.origin || base && !target.pathname.startsWith(`${base}/`)) return;
  const path = base ? target.pathname.slice(base.length) : target.pathname;
  if (!Object.values(routes).some(route => route === path)) return;
  if (target.pathname === current.pathname && target.search === current.search && target.hash) return;
  return target.pathname + target.search + target.hash;
}

/** Only fields needed by the shell; no track metadata, private lists, or integration secrets. */
export type HeaderView = Pick<View, 'me' | 'mode'>;
export type HeaderState = { view?: HeaderView };
export type NavigationItem = { id: string; text: string; href: string; current: boolean };

export function headerModel(page: Page, state: HeaderState) {
  const view = state.view;
  const primary: NavigationItem[] = (['host', 'settings', 'participant', 'display'] as const)
    .map(id => ({ id, text: pageTitles[id], href: routes[id], current: page === id }));
  const subtitle = page === 'participant' && view?.me ? view.me.nickname : pageTitles[page];
  return { primary, subtitle };
}
