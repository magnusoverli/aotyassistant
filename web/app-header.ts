import { el, link } from './dom';
import { headerModel, routes, type HeaderState, type NavigationItem, type Page } from './navigation';
import { navigationHref, inIngress } from './paths';

/** One persistent, compact header for every route and viewport. */
export class AppHeader {
  readonly element = el('header', undefined, 'app-header');
  private subtitle = el('span', undefined, 'brand-subtitle');
  private meta = el('div', undefined, 'header-meta');
  private navigation = el('nav', undefined, 'primary-navigation');
  private primary = el('ul', undefined, 'primary-links');
  private toggle = el('button', 'Menu', 'secondary header-menu-toggle');
  private fullscreen = el('button', 'Full screen', 'secondary header-fullscreen');
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
    const wordmark = el('div'); wordmark.append(el('strong', 'Albums of the Year'), this.subtitle); brand.append(mark, wordmark);
    this.navigation.id = 'app-navigation'; this.navigation.setAttribute('aria-label', 'Primary navigation');
    this.navigation.append(this.primary);
    this.toggle.type = 'button'; this.toggle.setAttribute('aria-controls', this.navigation.id);
    this.toggle.onclick = () => this.setExpanded(!this.expanded);
    if (page === 'display') this.meta.append(this.fullscreen);
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
        document.documentElement.style.setProperty('--app-header-height', `${this.element.getBoundingClientRect().height}px`);
        document.documentElement.style.setProperty('--app-bar-height', `${inner.getBoundingClientRect().height}px`);
      });
      this.resize.observe(this.element);
    }
    this.update({});
  }
  update(state: HeaderState) {
    this.lastState = state;
    const model = headerModel(this.page, state);
    if (this.subtitle.textContent !== model.subtitle) this.subtitle.textContent = model.subtitle;
    for (const item of model.primary) {
      let anchor = this.links.get(item.id);
      if (!anchor) { anchor = link('', item.href, 'header-nav-link'); const li = el('li'); li.append(anchor); this.primary.append(li); this.links.set(item.id, anchor); }
      this.updateLink(anchor, item);
    }
    this.updateLayout(); this.updateFullscreen();
  }
  private updateLink(anchor: HTMLAnchorElement, item: NavigationItem) {
    if (anchor.textContent !== item.text) anchor.textContent = item.text;
    anchor.setAttribute('href', navigationHref(item.href));
    if (inIngress() && ['participant', 'display'].includes(item.id)) { anchor.target = '_blank'; anchor.rel = 'noopener noreferrer'; }
    if (item.current) anchor.setAttribute('aria-current', 'page'); else anchor.removeAttribute('aria-current');
  }
  private setExpanded(value: boolean, restoreFocus = false) {
    this.expanded = value; this.updateLayout();
    if (restoreFocus) this.toggle.focus({ preventScroll: true });
  }
  private updateLayout() {
    this.toggle.setAttribute('aria-expanded', String(this.expanded));
    this.toggle.textContent = this.expanded ? 'Close' : 'Menu';
    this.navigation.hidden = !this.expanded;
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
    this.fullscreen.hidden = !document.fullscreenEnabled || !document.documentElement.requestFullscreen;
    this.fullscreen.textContent = document.fullscreenElement ? 'Exit full screen' : 'Full screen';
    this.fullscreen.setAttribute('aria-pressed', String(Boolean(document.fullscreenElement)));
    this.fullscreen.disabled = this.fullscreenPending;
    this.meta.hidden = this.page !== 'display' || this.fullscreen.hidden;
  }
  private async toggleFullscreen() {
    if (this.fullscreenPending) return;
    this.fullscreenPending = true; this.updateFullscreen();
    try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); }
    catch { this.failed('Full screen could not be changed. Try your browser’s full-screen control.'); }
    finally { this.fullscreenPending = false; this.updateFullscreen(); }
  }
  destroy() {
    this.resize?.disconnect();
    document.removeEventListener('keydown', this.keydown); document.removeEventListener('focusin', this.focusChanged);
    document.removeEventListener('pointerdown', this.outside); document.removeEventListener('fullscreenchange', this.fullscreenChanged);
    document.removeEventListener('aoty-address-changed', this.addressChanged);
  }
}
