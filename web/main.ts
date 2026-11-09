import { AppHeader } from './app-header';
import { ListeningOrder } from './listening-order';
import { mountPage } from './page-runtime';
import { pageForPath, spaDestination } from './navigation';
import { pagePath, ingressBase, inIngress } from './paths';
import './style.css';
import { enterOnline } from './online-entry';
import { whenIdle } from './idle';

// The shell survives route changes. Page lifetimes own their requests, listeners,
// subscriptions and controls; late responses cannot update a replacement page.
const root = document.querySelector<HTMLDivElement>('#app')!;
void enterOnline(root).then(ready => { if (ready) mountApplication(); });
function mountApplication() {
// Ingress is control-only. Direct LAN and invited browsers can become speakers;
// load their SDK and codec checks after the first screen.
const loadAudio = () => { void import('./browser-speaker').then(audio => { audio.initializeBrowserSpeaker(); })
  .catch(() => { window.addEventListener('online', loadAudio, { once: true }); }); };
if (!inIngress()) whenIdle(loadAudio);
const header = new AppHeader(pageForPath(pagePath(location.pathname)), message => {
  const notice = document.createElement('p'); notice.setAttribute('role', 'alert'); notice.textContent = message;
  content.prepend(notice);
});
const order = new ListeningOrder();
header.element.append(order.element);
const content = document.createElement('div');
root.replaceChildren(header.element, content);
let currentPath = location.pathname;
let currentSearch = location.search;
let dispose = () => {};
function mount() {
  dispose();
  currentPath = location.pathname;
  currentSearch = location.search;
  header.setPage(pageForPath(pagePath(currentPath)));
  dispose = mountPage(content, header, order, navigate);
}
function navigate(path: string, replace = false) {
  if (path === location.pathname + location.search + location.hash) return;
  if (replace) history.replaceState(null, '', path);
  else history.pushState(null, '', path);
  mount();
  window.scrollTo({ top: 0, behavior: 'instant' });
  document.getElementById('main-content')?.focus({ preventScroll: true });
}
// Register before route-local browse history, so Back disposes that listener
// before it can treat navigation to another page as a catalogue history entry.
window.addEventListener('popstate', () => {
  if (location.pathname !== currentPath || location.search !== currentSearch) mount();
});
root.addEventListener('click', event => {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const anchor = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null;
  if (!anchor || anchor.target && anchor.target !== '_self' || anchor.hasAttribute('download')) return;
  const url = new URL(anchor.href);
  const destination = spaDestination(url, new URL(location.href), ingressBase());
  if (destination === undefined) return;
  event.preventDefault();
  navigate(destination);
});
mount();
}
