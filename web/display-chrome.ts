/** The room display's menu and full-screen button are for whoever set the screen up, not
 * for the room. They rest out of sight until someone moves a pointer or presses a key, and
 * stay while they are in use. They remain focusable and clickable while at rest. */
export class DisplayChrome {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running = false;
  private pointer = '';
  constructor(private inUse: () => boolean, private restAfter = 4000) {}

  start() {
    if (this.running) return;
    this.running = true;
    for (const type of ['pointermove', 'pointerdown', 'keydown', 'wheel', 'focusin'] as const) {
      document.addEventListener(type, this.activity, { capture: true, passive: true });
    }
    this.show();
  }
  stop() {
    if (!this.running) return;
    this.running = false; clearTimeout(this.timer);
    for (const type of ['pointermove', 'pointerdown', 'keydown', 'wheel', 'focusin'] as const) {
      document.removeEventListener(type, this.activity, { capture: true });
    }
    delete document.documentElement.dataset.displayChrome;
  }
  private activity = (event: Event) => {
    if (event.type === 'pointermove') {
      // Browsers repeat a pointer's position when the page under it changes; only real movement counts.
      const { screenX, screenY } = event as PointerEvent; const position = `${screenX},${screenY}`;
      if (position === this.pointer) return;
      this.pointer = position;
    }
    this.show();
  };
  private show() {
    document.documentElement.dataset.displayChrome = 'shown';
    clearTimeout(this.timer); this.timer = setTimeout(this.rest, this.restAfter);
  }
  private rest = () => {
    if (this.inUse()) { this.timer = setTimeout(this.rest, this.restAfter); return; }
    document.documentElement.dataset.displayChrome = 'resting';
  };
}
