import type { View } from '../src/model';

export const routes = { home: '/', host: '/host', settings: '/host/settings', participant: '/participant', join: '/join', display: '/display' } as const;
export type Page = keyof typeof routes;
export const pageForPath = (path: string): Page => (Object.keys(routes) as Page[]).find(page => routes[page] === (path.replace(/\/+$/, '') || '/')) ?? 'home';

/** Only fields needed by the shell; no track metadata, private lists, or integration secrets. */
export type HeaderView = Pick<View, 'mode' | 'me' | 'myTurn' | 'position' | 'current' | 'playbackAvailable'>;
export type HeaderState = { view?: HeaderView; mode?: View['mode']; realtime?: boolean };
export type NavigationItem = { id: string; text: string; href: string; current: boolean };

export function headerModel(page: Page, state: HeaderState) {
  const view = state.view;
  const primary: NavigationItem[] = [
    { id: 'host', text: 'Host desk', href: routes.host, current: page === 'host' },
    { id: 'settings', text: 'Settings', href: routes.settings, current: page === 'settings' },
    { id: 'participant', text: 'My music', href: routes.participant, current: page === 'participant' },
    { id: 'display', text: 'Room display', href: routes.display, current: page === 'display' },
  ];
  const mode = state.mode ?? view?.mode;
  const subtitle = page === 'participant' && view?.me ? view.me.nickname : page === 'display' ? 'Room display'
    : page === 'settings' ? 'Settings' : page === 'host' ? 'Host desk' : page === 'join' ? 'Join room' : page === 'participant' ? 'My music' : 'Home';
  const modeText = view && state.realtime === false ? 'Reconnecting…' : mode === 'demo' ? 'DEMO · NO AUDIO'
    : mode === 'music-assistant' ? view?.playbackAvailable === true ? 'Playback ready' : view?.playbackAvailable === false ? 'Playback unavailable' : 'Music Assistant' : '';
  return { primary, subtitle, modeText };
}
