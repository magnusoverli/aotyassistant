import { RoomSpectrum } from './room-spectrum';
import { spectrumBandHue, spectrumBandPosition, spectrumCornerLength, spectrumNeedleLevel } from './spectrum-presentation';

const namespace = 'http://www.w3.org/2000/svg';
const needleSpacing = 3;
function svg<K extends keyof SVGElementTagNameMap>(tag: K, attributes: Record<string, string> = {}) {
  const node = document.createElementNS(namespace, tag);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
  return node;
}

/** Frequency needles extending inward from the actual rounded card edge. */
export class TurnSpectrum {
  readonly element = svg('svg', { class: 'order-trace', 'aria-hidden': 'true', focusable: 'false' });
  private outline = svg('rect', { class: 'order-spectrum-outline', fill: 'none' });
  private bars: SVGLineElement[] = [];
  private positions: number[] = [];
  private limits: number[] = [];
  private feed = new RoomSpectrum();
  private reduced = matchMedia('(prefers-reduced-motion: reduce)');
  private observer: ResizeObserver;
  private roomId: string | null = null;
  private participantId: string | null = null;
  private playing = false;
  private frame = 0;

  constructor() {
    this.element.append(this.outline);
    this.observer = new ResizeObserver(() => this.layout()); this.observer.observe(this.element);
    this.reduced.addEventListener('change', this.motion);
    document.addEventListener('visibilitychange', this.motion);
    window.addEventListener('pagehide', () => { this.feed.stop(); cancelAnimationFrame(this.frame); this.frame = 0; });
    window.addEventListener('pageshow', this.motion);
  }
  update(roomId: string | null, participantId: string | null, playing: boolean) {
    if (this.roomId !== roomId || this.participantId !== participantId) this.resetBars();
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
    this.bars = []; this.positions = []; this.limits = []; this.element.replaceChildren(this.outline);
    const needleLength = height < 50 ? 10.5 : 19.5;
    const points: { x: number; y: number; angle: number; distance: number; limit?: number }[] = [];
    let distance = 0;
    const horizontal = width - 1 - 2 * radius; const vertical = height - 1 - 2 * radius;
    const straight = (length: number, x: number, y: number, dx: number, dy: number, angle: number) => {
      const count = Math.max(1, Math.round(length / needleSpacing));
      for (let i = 0; i < count; i++) points.push({ x: x + dx * length * i / count, y: y + dy * length * i / count, angle, distance: distance + length * i / count });
      distance += length;
    };
    const corner = (cx: number, cy: number, from: number) => {
      // Include each corner midpoint so the bass and treble endpoints have their own needle.
      const count = Math.max(2, 2 * Math.round(radius * Math.PI / (4 * needleSpacing)));
      const length = radius * Math.PI / 2;
      const limit = Math.min(1, spectrumCornerLength(radius, count) / needleLength);
      for (let i = 0; i < count; i++) {
        const angle = from + i / count * 90; const radians = angle * Math.PI / 180;
        points.push({ x: cx + radius * Math.cos(radians), y: cy + radius * Math.sin(radians), angle: angle + 90, distance: distance + length * i / count, limit });
      }
      distance += length;
    };
    straight(horizontal, radius + .5, .5, 1, 0, 0); corner(width - radius - .5, radius + .5, -90);
    straight(vertical, width - .5, radius + .5, 0, 1, 90); corner(width - radius - .5, height - radius - .5, 0);
    straight(horizontal, width - radius - .5, height - .5, -1, 0, 180); corner(radius + .5, height - radius - .5, 90);
    straight(vertical, .5, height - radius - .5, 0, -1, 270); corner(radius + .5, radius + .5, 180);
    for (let i = 0; i < points.length; i++) {
      const point = points[i]!;
      const position = spectrumBandPosition(point.distance, distance, horizontal + radius * Math.PI / 4);
      const group = svg('g', { transform: `translate(${point.x} ${point.y}) rotate(${point.angle})` });
      const bar = svg('line', { class: 'order-spectrum-bar', x1: '0', x2: '0', y1: '0', y2: String(needleLength) });
      bar.style.stroke = `hsl(${spectrumBandHue(position)} 65% 72%)`;
      if (point.limit !== undefined) bar.style.setProperty('--order-needle-limit', String(point.limit));
      group.append(bar); this.element.append(group); this.bars.push(bar); this.positions.push(position); this.limits.push(point.limit ?? 1);
    }
  }
  private motion = () => {
    this.element.dataset.playing = String(this.playing && Boolean(this.participantId));
    const running = this.playing && this.participantId && !this.reduced.matches && !document.hidden;
    if (running) { this.feed.start(); if (!this.frame) this.frame = requestAnimationFrame(this.draw); }
    else {
      this.feed.stop(); cancelAnimationFrame(this.frame); this.frame = 0; this.resetBars();
    }
  };
  private resetBars() {
    this.element.dataset.reactive = 'false';
    for (const bar of this.bars) { bar.style.removeProperty('transform'); bar.style.removeProperty('opacity'); }
  }
  private draw = (now: number) => {
    this.frame = requestAnimationFrame(this.draw);
    // Interpolate the 60 Hz analysis on each display refresh instead of limiting motion to 30 fps.
    const bins = this.feed.clock.sample(now, this.roomId, this.participantId);
    if (!bins) { if (this.element.dataset.reactive === 'true') this.resetBars(); return; }
    this.element.dataset.reactive = 'true';
    for (let i = 0; i < this.bars.length; i++) {
      const position = this.positions[i]! * (bins.length - 1);
      const lo = Math.floor(position); const mix = position - lo;
      const level = bins[lo]! * (1 - mix) + (bins[Math.min(bins.length - 1, lo + 1)] ?? 0) * mix;
      const appearance = spectrumNeedleLevel(level, this.positions[i]!);
      this.bars[i]!.style.transform = `scaleY(${Math.min(appearance.scale, this.limits[i]!)})`;
      this.bars[i]!.style.opacity = String(appearance.opacity);
    }
  };
}
