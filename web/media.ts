import type { PlaybackProgress, VolumeState } from '../src/model';
import { el } from './dom';
import { vinyl } from './visuals';
import { ProgressClock } from './progress-clock';
import { attr, prop } from './view-nodes';
import { appPath } from './paths';

const clock = new ProgressClock();
const animated = new Set<HTMLElement>();
let animation = 0;
let lastPaint = 0;
let connected = true;
export function progressConnected(online: boolean) { connected = online; clock.connect(online); }
export function displayedProgress(progress?: PlaybackProgress) {
  const shown = clock.position(); return shown?.id === progress?.id ? shown : progress;
}
function animate(now: number) {
  animation = 0;
  for (const frame of animated) {
    if (!frame.isConnected || !connected) { animated.delete(frame); continue; }
    if (now - lastPaint >= 80) paintProgress(frame, clock.position());
  }
  if (now - lastPaint >= 80) lastPaint = now;
  if (animated.size) animation = requestAnimationFrame(animate);
}

export function artwork(url: string | undefined, alt: string, className = '', eager = false) {
  const frame = el('div', undefined, `media-artwork ${className}`); frame.append(vinyl());
  const image = artworkImage(url, alt, className, eager);
  if (image) { image.onerror = () => image.remove(); frame.append(image); }
  return frame;
}
function artworkImage(url: string | undefined, alt: string, className: string, eager: boolean) {
  if (url && (url.startsWith('/api/participant/artwork/') || url.startsWith('/api/participant/preparations/artwork/') || /^\/api\/participant\/preparations\/uploads\/[a-f0-9-]{36}\/artwork$/.test(url) || url.startsWith('/api/display/artwork/') || url === '/demo-cover.svg')) {
    const image = el('img'); image.alt = alt; image.loading = eager ? 'eager' : 'lazy'; image.decoding = 'async';
    const size = className.includes('room-artwork') ? 1024 : className.includes('result-artwork') || className.includes('artist-portrait') ? 160 : 512;
    image.src = appPath(url.startsWith('/api/') ? `${url}?size=${size}` : url);
    return image;
  }
}
const time = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
export function updateProgress(frame: HTMLElement, progress?: PlaybackProgress) {
  const shown = clock.accept(progress);
  paintProgress(frame, shown);
  if (connected && shown?.status === 'playing' && shown.elapsed !== undefined && shown.duration && !shown.id.startsWith('pending-')) {
    animated.add(frame); if (!animation) animation = requestAnimationFrame(animate);
  } else animated.delete(frame);
}
function paintProgress(frame: HTMLElement, progress?: PlaybackProgress) {
  const status = frame.querySelector<HTMLElement>('.playback-status')!;
  const caption = progress?.status === 'playing' ? '● Playing' : progress?.status === 'paused' ? 'Ⅱ Paused' : progress?.status === 'stopped' ? '■ Stopped' : '○ Waiting for a track';
  if (status.textContent !== caption && !status.classList.contains('player-pending')) status.textContent = caption;
  attr(frame, 'data-status', progress?.status ?? 'waiting');
  const bar = frame.querySelector<HTMLProgressElement>('progress')!;
  const fallback = frame.querySelector<HTMLElement>('.progress-unavailable');
  const unavailable = Boolean(progress && progress.fraction == null);
  if (fallback) prop(fallback, 'hidden', !unavailable);
  if (progress?.fraction != null) prop(bar, 'value', progress.fraction); else attr(bar, 'value', undefined);
  prop(bar, 'hidden', !progress || Boolean(fallback && unavailable));
  const marker = frame.querySelector<HTMLElement>('.auto-reveal-marker');
  if (marker) {
    const at = progress?.autoRevealAt;
    const visible = at !== undefined && Number.isFinite(at) && at > 0 && at < 1 && !bar.hidden && !unavailable && progress?.status !== 'stopped';
    prop(marker, 'hidden', !visible);
    if (visible) {
      const label = `Automatic reveal at ${Math.round(at * 100)}%`;
      attr(marker, 'aria-label', label); prop(marker, 'title', label);
      const left = `${at * 100}%`; if (marker.style.left !== left) marker.style.left = left;
    }
  }
  const times = frame.querySelector<HTMLElement>('.track-times')!;
  prop(times, 'hidden', Boolean(fallback && unavailable));
  if (progress?.duration !== undefined) {
    if (times.children.length !== 2) times.replaceChildren(el('span'), el('span'));
    const elapsed = progress.elapsed === undefined ? '—:—' : time(progress.elapsed); const duration = progress.duration > 0 ? time(progress.duration) : '—:—';
    if (times.children[0]!.textContent !== elapsed) times.children[0]!.textContent = elapsed;
    if (times.children[1]!.textContent !== duration) times.children[1]!.textContent = duration;
    const description = progress.elapsed === undefined ? 'Position unavailable' : `${elapsed} elapsed${progress.duration > 0 ? ` of ${duration}` : ''}`;
    if (bar.getAttribute('aria-valuetext') !== description) bar.setAttribute('aria-valuetext', description);
  } else { if (times.childNodes.length) times.replaceChildren(); attr(bar, 'aria-valuetext', 'Track progress. Times hidden until reveal.'); }
}
export function progressBar(progress?: PlaybackProgress, publicDisplay = false, options: { hideStatus?: boolean; positionFallback?: boolean } = {}) {
  const frame = el('section', undefined, `playback-progress${publicDisplay ? ' public-playback' : ''}`); frame.setAttribute('aria-label', 'Playback status and progress');
  const status = el('span', undefined, 'playback-status'); status.setAttribute('role', 'status');
  status.hidden = Boolean(options.hideStatus);
  const bar = el('progress'); bar.max = 1; bar.setAttribute('aria-label', 'Track progress');
  const rail = el('div', undefined, 'progress-rail');
  const marker = el('span', undefined, 'auto-reveal-marker'); marker.hidden = true; marker.setAttribute('role', 'img');
  rail.append(bar, marker);
  frame.append(status, rail, el('div', undefined, 'track-times'));
  if (options.positionFallback) frame.append(el('p', 'Position unavailable', 'progress-unavailable muted small'));
  updateProgress(frame, progress); return frame;
}
export function volumeControl(volume: VolumeState | undefined, change: (level: number, commit: boolean) => void, disabled: boolean) {
  const frame = el('div', undefined, 'volume-control');
  const label = el('label', 'Volume'); label.htmlFor = 'volume-level';
  const output = el('output', volume?.level == null ? 'Unavailable' : `${volume.level}%`); output.htmlFor = 'volume-level';
  const slider = el('input'); slider.id = 'volume-level'; slider.type = 'range'; slider.min = '0'; slider.max = '100'; slider.step = '1'; slider.value = String(volume?.level ?? 0);
  slider.disabled = disabled || !volume?.available;
  slider.onpointerdown = () => { slider.dataset.dragging = 'true'; };
  slider.onpointerup = slider.onpointercancel = () => { delete slider.dataset.dragging; };
  slider.oninput = () => { output.value = `${slider.value}%`; change(Number(slider.value), false); };
  slider.onchange = () => { change(Number(slider.value), true); };
  frame.append(label, output, slider); updateVolume(frame, volume); return frame;
}
export function updateVolume(root: HTMLElement, volume?: VolumeState) {
  const slider = root.querySelector<HTMLInputElement>('#volume-level');
  if (!slider || slider.dataset.dragging === 'true') return;
  prop(slider, 'value', String(volume?.level ?? 0));
  const output = root.querySelector<HTMLOutputElement>('.volume-control output');
  if (output) {
    prop(output, 'value', volume?.level == null ? 'Unavailable' : `${volume.level}%`);
    prop(output, 'title', 'Volume');
  }
}

/** Keep verified identical pixels mounted. Decode replacements before swapping,
 * and fence late image events when the requested track or identity changes. */
export class ArtworkView {
  readonly element: HTMLElement;
  private requested?: { url: string; identity: string };
  private displayed?: { image: HTMLImageElement; identity: string };
  private pending?: { image: HTMLImageElement; url: string; identity: string };
  constructor(private alt: string, private className = '') { this.element = artwork(undefined, alt, className); }
  clear() {
    this.cancelPending(); this.displayed?.image.remove(); this.displayed = undefined; this.requested = undefined;
  }
  private cancelPending() {
    if (!this.pending) return;
    const { image } = this.pending; this.pending = undefined;
    image.onload = image.onerror = null; image.removeAttribute('src'); image.remove();
  }
  update(url?: string, identity = url) {
    if (!url || !identity) { this.clear(); return this.element; }
    if (url === this.requested?.url && identity === this.requested.identity) return this.element;
    this.requested = { url, identity };
    if (identity === this.displayed?.identity) { this.cancelPending(); return this.element; }
    // Confirmation can arrive before the saved image finishes loading, too.
    if (identity === this.pending?.identity) return this.element;
    this.cancelPending();
    // Keep first loads lazy in the DOM (especially long catalogue lists).
    // Only replacements load eagerly off-DOM while the previous image remains.
    const image = artworkImage(url, this.alt, this.className, Boolean(this.displayed));
    if (!image) { this.clear(); return this.element; }
    const pending = this.pending = { image, url, identity };
    const commit = () => {
      if (this.pending !== pending) return;
      image.onload = image.onerror = null; this.pending = undefined;
      if (this.displayed) this.displayed.image.replaceWith(image);
      else if (image.parentElement !== this.element) this.element.append(image);
      this.displayed = { image, identity };
    };
    const failed = () => {
      if (this.pending !== pending) return;
      const latest = this.requested!; this.cancelPending();
      // If the old saved URL failed during confirmation, try the latest
      // authorized playback URL once rather than retaining a broken image.
      if (latest.url !== url) { this.requested = undefined; this.update(latest.url, latest.identity); return; }
      this.displayed?.image.remove(); this.displayed = undefined;
    };
    image.onload = () => { if (image.decode) void image.decode().then(commit, failed); else commit(); };
    image.onerror = failed;
    if (!this.displayed) this.element.append(image);
    return this.element;
  }
}
