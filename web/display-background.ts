import type { BackgroundSettings, BackgroundSnapshot } from '../src/background-settings';
import type { BmfLogo } from './bmf-logo/bmf-logo.js';
import { el } from './dom';

/** Lazy-loaded artwork, retained across room telemetry and metadata updates. */
export class AnimatedBackground {
  readonly element = el('div', undefined, 'bmf-background');
  private logo?: BmfLogo;
  private settings?: BackgroundSettings;
  private key = '';
  private disposed = false;

  constructor() {
    this.element.setAttribute('aria-hidden', 'true');
    void import('./bmf-logo/bmf-logo.js').then(({ BmfLogo }) => {
      if (this.disposed) return;
      this.logo = new BmfLogo();
      if (this.settings) this.apply(this.settings);
    }).catch(() => { /* Decorative artwork must not interrupt the room. */ });
  }
  update(snapshot: BackgroundSnapshot | null | undefined) {
    const key = JSON.stringify(snapshot ?? null);
    if (key === this.key) return;
    this.key = key; this.settings = snapshot?.settings;
    if (this.settings) this.apply(this.settings);
    else this.logo?.remove();
  }
  replay() { if (this.logo?.isConnected && this.settings?.enabled) this.logo.play(); }
  destroy() { this.disposed = true; this.logo?.finish(); this.logo?.remove(); this.element.remove(); }

  private apply(s: BackgroundSettings) {
    if (!this.logo) return;
    if (!s.enabled) { this.logo.remove(); return; }
    this.logo.configure({ order: s.order, origin: s.origin, jitter: s.jitter, sprouts: s.sprouts,
      duration: s.duration, spread: s.spread, 'bloom-duration': s.bloomDuration,
      loop: s.loop, hold: s.hold, fade: s.fade, seed: s.seed,
      continuous: s.continuous, coverage: s.coverage, 'cycle-duration': s.cycleDuration });
    this.logo.style.opacity = String(s.opacity);
    if (this.logo.parentElement !== this.element) this.element.append(this.logo);
  }
}
