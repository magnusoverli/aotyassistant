import { el, link } from './dom';
import { headerModel, routes, type HeaderState, type NavigationItem, type Page } from './navigation';
import { appPath, navigationHref, inIngress } from './paths';
import { attr, prop, text } from './view-nodes';
import { demoPlaybackNotice, productName } from '../src/product';
import { requestJson } from './request';
import type { UserDirectory } from '../src/model';

/** One persistent, compact header for every route and viewport. */
export class AppHeader {
  readonly element = el('header', undefined, 'app-header');
  private subtitle = el('span', undefined, 'brand-subtitle');
  private meta = el('div', undefined, 'header-meta');
  private navigation = el('nav', undefined, 'primary-navigation');
  private primary = el('ul', undefined, 'primary-links');
  private toggle = el('button', 'Menu', 'secondary header-menu-toggle');
  private fullscreen = el('button', 'Full screen', 'secondary header-fullscreen');
  private logout = el('button', 'Log out', 'header-nav-link header-logout');
  private logoutItem = el('li');
  private logoutError = el('p', undefined, 'error');
  private logoutPending = false;
  private identityRequest?: AbortController;
  private lifetime = new AbortController();
  private links = new Map<string, HTMLAnchorElement>();
  private expanded = false;
  private resize?: ResizeObserver;
  private fullscreenPending = false;
  private lastState: HeaderState = {};

  constructor(private page: Page, private failed: (message: string) => void) {
    const skip = link('Skip to content', '#main-content', 'skip-link');
    skip.onclick = event => {
      const content = document.getElementById('main-content');
      if (!content) return;
      // Focus without changing the current URL or creating a history entry.
      event.preventDefault(); content.focus({ preventScroll: true }); content.scrollIntoView({ block: 'start' });
    };
    const inner = el('div', undefined, 'header-inner');
    const brand = link('', routes.home, 'brand');
    if (page === 'home') brand.setAttribute('aria-current', 'page');
    const mark = el('span', '◉', 'brand-mark'); mark.setAttribute('aria-hidden', 'true');
    const wordmark = el('div'); wordmark.append(el('strong', productName), this.subtitle); brand.append(mark, wordmark);
    this.navigation.id = 'app-navigation'; this.navigation.setAttribute('aria-label', 'Primary navigation');
    this.navigation.append(this.primary);
    this.toggle.type = 'button'; this.toggle.setAttribute('aria-controls', this.navigation.id);
    this.toggle.onclick = () => this.setExpanded(!this.expanded);
    this.fullscreen.type = 'button'; this.fullscreen.onclick = () => { void this.toggleFullscreen(); };
    inner.append(brand, this.meta, this.toggle, this.navigation); this.element.append(skip, inner);
    this.element.dataset.header = 'shared';
    document.addEventListener('keydown', this.keydown);
    document.addEventListener('focusin', this.focusChanged);
    this.navigation.addEventListener('click', event => {
      const target = event.target instanceof Element ? event.target.closest('a') : null;
      if (!target) return;
      // Close the shared menu after a navigation choice.
      this.setExpanded(false);
    });
    document.addEventListener('pointerdown', this.outside);
    document.addEventListener('fullscreenchange', this.fullscreenChanged);
    document.addEventListener('aoty-address-changed', this.addressChanged);
    if (typeof ResizeObserver !== 'undefined') {
      this.resize = new ResizeObserver(() => {
        const style = document.documentElement.style;
        for (const [key, value] of [['--app-header-height', `${this.element.getBoundingClientRect().height}px`], ['--app-bar-height', `${inner.getBoundingClientRect().height}px`]]) {
          if (style.getPropertyValue(key!) !== value) style.setProperty(key!, value!);
        }
      });
      this.resize.observe(this.element);
    }
    this.update({});
    this.logout.type = 'button'; this.logout.onclick = () => { void this.logOut(); };
    this.logoutError.setAttribute('role', 'alert'); this.logoutError.hidden = true;
    this.logoutItem.append(this.logout, this.logoutError); this.logoutItem.hidden = true; this.primary.append(this.logoutItem);
  }
  private async refreshIdentity() {
    if (this.logoutPending) return;
    this.identityRequest?.abort();
    const request = new AbortController(); this.identityRequest = request;
    try {
      const directory = await requestJson<UserDirectory>('/api/participant/identity', undefined, 15_000,
        AbortSignal.any([request.signal, this.lifetime.signal]));
      if (!request.signal.aborted && !this.lifetime.signal.aborted) prop(this.logoutItem, 'hidden', !directory.current);
    } catch { /* A failed read must not discard a previously confirmed sign-in. */ }
  }
  private async logOut() {
    if (this.logoutPending) return;
    this.identityRequest?.abort(); this.logoutPending = true;
    prop(this.logout, 'disabled', true); text(this.logout, 'Logging out…'); prop(this.logoutError, 'hidden', true);
    try {
      await requestJson('/api/participant/logout', {}, 15_000, this.lifetime.signal);
      // A full navigation clears private page state as well as the server-side session.
      location.assign(appPath('/join'));
    } catch (error) {
      if (this.lifetime.signal.aborted) return;
      text(this.logoutError, `Log out was not confirmed. ${error instanceof Error ? error.message : 'Please try again.'}`);
      prop(this.logoutError, 'hidden', false);
    } finally {
      this.logoutPending = false; prop(this.logout, 'disabled', false); text(this.logout, 'Log out');
    }
  }
  update(state: HeaderState) {
    this.lastState = state;
    const model = headerModel(this.page, state);
    const demo = state.view?.mode === 'demo';
    this.subtitle.classList.toggle('demo-playback-notice', demo);
    attr(this.subtitle, 'aria-live', demo ? 'polite' : undefined);
    text(this.subtitle, demo ? demoPlaybackNotice : model.subtitle);
    for (const item of model.primary) {
      let anchor = this.links.get(item.id);
      if (!anchor) { anchor = link('', item.href, 'header-nav-link'); const li = el('li'); li.append(anchor); this.primary.append(li); this.links.set(item.id, anchor); }
      this.updateLink(anchor, item);
    }
    this.updateLayout(); this.updateFullscreen();
  }
  setPage(page: Page) {
    this.page = page;
    attr(this.element.querySelector('.brand')!, 'aria-current', page === 'home' ? 'page' : undefined);
    if (page !== 'display') this.fullscreen.remove();
    this.setExpanded(false);
    this.update(this.lastState);
  }
  private updateLink(anchor: HTMLAnchorElement, item: NavigationItem) {
    if (anchor.textContent !== item.text) anchor.textContent = item.text;
    attr(anchor, 'href', navigationHref(item.href));
    if (inIngress() && ['participant', 'display'].includes(item.id)) { prop(anchor, 'target', '_blank'); prop(anchor, 'rel', 'noopener noreferrer'); }
    attr(anchor, 'aria-current', item.current ? 'page' : undefined);
  }
  private setExpanded(value: boolean, restoreFocus = false) {
    this.expanded = value; this.updateLayout();
    if (value) void this.refreshIdentity();
    if (restoreFocus) this.toggle.focus({ preventScroll: true });
  }
  private updateLayout() {
    attr(this.toggle, 'aria-expanded', String(this.expanded));
    text(this.toggle, this.expanded ? 'Close' : 'Menu');
    prop(this.navigation, 'hidden', !this.expanded);
  }
  private keydown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape') return;
    if (this.expanded) { this.setExpanded(false, true); event.preventDefault(); }
  };
  private outside = (event: PointerEvent) => {
    if (!this.element.contains(event.target as Node)) this.setExpanded(false);
  };
  private focusChanged = (event: FocusEvent) => {
    if (this.expanded && event.target !== this.toggle && !this.navigation.contains(event.target as Node)) this.setExpanded(false);
  };
  private fullscreenChanged = () => this.updateFullscreen();
  private addressChanged = () => this.update(this.lastState);
  private updateFullscreen() {
    if (this.page === 'display') {
      const parent = this.meta;
      if (this.fullscreen.parentElement !== parent) parent.append(this.fullscreen);
    }
    prop(this.fullscreen, 'hidden', !document.fullscreenEnabled || !document.documentElement.requestFullscreen);
    text(this.fullscreen, document.fullscreenElement ? 'Exit full screen' : 'Full screen');
    attr(this.fullscreen, 'aria-pressed', String(Boolean(document.fullscreenElement)));
    prop(this.fullscreen, 'disabled', this.fullscreenPending);
    prop(this.meta, 'hidden', this.page !== 'display' || this.fullscreen.hidden);
  }
  private async toggleFullscreen() {
    if (this.fullscreenPending) return;
    this.fullscreenPending = true; this.updateFullscreen();
    try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); }
    catch { this.failed('Full screen could not be changed. Try your browser’s full-screen control.'); }
    finally { this.fullscreenPending = false; this.updateFullscreen(); }
  }
  destroy() {
    this.lifetime.abort(); this.identityRequest?.abort();
    this.resize?.disconnect();
    document.removeEventListener('keydown', this.keydown); document.removeEventListener('focusin', this.focusChanged);
    document.removeEventListener('pointerdown', this.outside); document.removeEventListener('fullscreenchange', this.fullscreenChanged);
    document.removeEventListener('aoty-address-changed', this.addressChanged);
  }
}
