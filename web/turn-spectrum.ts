import { RoomSpectrum } from './room-spectrum';

const namespace = 'http://www.w3.org/2000/svg';
function svg<K extends keyof SVGElementTagNameMap>(tag: K, attributes: Record<string, string> = {}) {
  const node = document.createElementNS(namespace, tag);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
  return node;
}

/** A narrow ribbon of frequency needles, mostly inside the actual rounded card edge. */
export class TurnSpectrum {
  readonly element = svg('svg', { class: 'order-trace', 'aria-hidden': 'true', focusable: 'false' });
  private outline = svg('rect', { class: 'order-spectrum-outline', fill: 'none' });
  private bars: SVGLineElement[] = [];
  private feed = new RoomSpectrum();
  private reduced = matchMedia('(prefers-reduced-motion: reduce)');
  private observer: ResizeObserver;
  private roomId: string | null = null;
  private participantId: string | null = null;
  private playing = false;
  private frame = 0;
  private last = 0;

  constructor() {
    this.element.append(this.outline);
    this.observer = new ResizeObserver(() => this.layout()); this.observer.observe(this.element);
    this.reduced.addEventListener('change', this.motion);
    document.addEventListener('visibilitychange', this.motion);
    window.addEventListener('pagehide', () => { this.feed.stop(); cancelAnimationFrame(this.frame); this.frame = 0; });
    window.addEventListener('pageshow', this.motion);
  }
  update(roomId: string | null, participantId: string | null, playing: boolean) {
    this.roomId = roomId; this.participantId = participantId; this.playing = playing; this.motion();
  }
  private layout() {
    const card = this.element.parentElement;
    if (!card || !this.element.isConnected) return;
    const width = this.element.clientWidth; const height = this.element.clientHeight;
    if (!width || !height) return;
    const radius = Math.max(2, parseFloat(getComputedStyle(card).borderTopLeftRadius) - .5);
    this.element.setAttribute('viewBox', `0 0 ${width} ${height}`);
    for (const [key, value] of Object.entries({ x: .5, y: .5, width: width - 1, height: height - 1, rx: radius })) this.outline.setAttribute(key, String(value));
    this.bars = []; this.element.replaceChildren(this.outline);
    const points: { x: number; y: number; angle: number }[] = [];
    const horizontal = width - 1 - 2 * radius; const vertical = height - 1 - 2 * radius;
    const straight = (length: number, x: number, y: number, dx: number, dy: number, angle: number) => {
      const count = Math.max(1, Math.round(length / 3.5));
      for (let i = 0; i < count; i++) points.push({ x: x + dx * length * i / count, y: y + dy * length * i / count, angle });
    };
    const corner = (cx: number, cy: number, from: number) => {
      const count = Math.max(2, Math.round(radius * Math.PI / 7));
      for (let i = 0; i < count; i++) {
        const angle = from + i / count * 90; const radians = angle * Math.PI / 180;
        points.push({ x: cx + radius * Math.cos(radians), y: cy + radius * Math.sin(radians), angle: angle + 90 });
      }
    };
    straight(horizontal, radius + .5, .5, 1, 0, 0); corner(width - radius - .5, radius + .5, -90);
    straight(vertical, width - .5, radius + .5, 0, 1, 90); corner(width - radius - .5, height - radius - .5, 0);
    straight(horizontal, width - radius - .5, height - .5, -1, 0, 180); corner(radius + .5, height - radius - .5, 90);
    straight(vertical, .5, height - radius - .5, 0, -1, 270); corner(radius + .5, radius + .5, 180);
    for (let i = 0; i < points.length; i++) {
      const point = points[i]!;
      const group = svg('g', { transform: `translate(${point.x} ${point.y}) rotate(${point.angle})` });
      const bar = svg('line', { class: 'order-spectrum-bar', x1: '0', x2: '0', y1: '-1', y2: height < 50 ? '3.5' : '6.5' });
      bar.style.stroke = `hsl(${(150 + i / points.length * 300) % 360} 65% 72%)`;
      bar.style.animationDelay = `${-i * .137}s`; bar.style.animationDuration = `${3.2 + .7 * Math.sin(i * 1.7)}s`;
      group.append(bar); this.element.append(group); this.bars.push(bar);
    }
  }
  private motion = () => {
    const running = this.playing && this.participantId && !this.reduced.matches && !document.hidden;
    if (running) { this.feed.start(); if (!this.frame) this.frame = requestAnimationFrame(this.draw); }
    else {
      this.feed.stop(); cancelAnimationFrame(this.frame); this.frame = 0; this.element.dataset.reactive = 'false';
      for (const bar of this.bars) bar.style.removeProperty('transform');
    }
  };
  private draw = (now: number) => {
    this.frame = requestAnimationFrame(this.draw);
    if (now - this.last < 32) return; this.last = now;
    const bins = this.feed.clock.sample(now, this.roomId, this.participantId);
    this.element.dataset.reactive = String(Boolean(bins));
    if (!bins) return;
    for (let i = 0; i < this.bars.length; i++) {
      // Mirror low-to-high frequencies around the perimeter, keeping both halves coherent.
      const position = Math.abs(2 * i / this.bars.length - 1) * (bins.length - 1);
      const lo = Math.floor(position); const mix = position - lo;
      const level = bins[lo]! * (1 - mix) + (bins[Math.min(bins.length - 1, lo + 1)] ?? 0) * mix;
      this.bars[i]!.style.transform = `scaleY(${.12 + .88 * level ** 1.5})`;
    }
  };
}
