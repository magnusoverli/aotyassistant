import type { View } from '../src/model';

export const routes = { home: '/', host: '/host', settings: '/host/settings', participant: '/participant', join: '/join', display: '/display' } as const;
export type Page = keyof typeof routes;
export const pageForPath = (path: string): Page => (Object.keys(routes) as Page[]).find(page => routes[page] === (path.replace(/\/+$/, '') || '/')) ?? 'home';

/** Only fields needed by the shell; no track metadata, private lists, or integration secrets. */
export type HeaderView = Pick<View, 'mode' | 'me' | 'myTurn' | 'position' | 'current'>;
export type HeaderState = { view?: HeaderView; mode?: View['mode'] };
export type NavigationItem = { id: string; text: string; href: string; current: boolean };

export function headerModel(page: Page, state: HeaderState) {
  const view = state.view;
  const primary: NavigationItem[] = [
    { id: 'host', text: 'Host desk', href: routes.host, current: page === 'host' },
    { id: 'settings', text: 'Connections & settings', href: routes.settings, current: page === 'settings' },
    { id: 'participant', text: 'My seat', href: routes.participant, current: page === 'participant' },
    { id: 'display', text: 'Listening room', href: routes.display, current: page === 'display' },
  ];
  const mode = state.mode ?? view?.mode;
  const turn = page === 'participant' && view?.me ? {
    text: view.myTurn ? 'YOUR TURN' : view.position?.turnsUntil === 1 ? 'UP NEXT' : 'LISTENING',
    mine: Boolean(view.myTurn), title: view.current ? `${view.current.nickname} is currently sharing` : 'Waiting for participants',
  } : undefined;
  const subtitle = page === 'participant' && view?.me ? view.me.nickname : page === 'display' ? 'Listening room'
    : page === 'settings' ? 'Connections & settings' : page === 'host' ? 'Host desk' : page === 'join' ? 'Join room' : page === 'participant' ? 'My seat' : 'Home';
  return { primary, turn, subtitle, modeText: mode === 'music-assistant' ? 'LIVE · SONOS' : mode === 'demo' ? 'DEMO · NO AUDIO' : '' };
}
