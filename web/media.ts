import type { PlaybackProgress, VolumeState } from '../src/model';
import { el } from './dom';
import { vinyl } from './visuals';
import { ProgressClock } from './progress-clock';

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
  if (url && (url.startsWith('/api/participant/artwork/') || url.startsWith('/api/participant/preparations/artwork/') || /^\/api\/participant\/preparations\/uploads\/[a-f0-9-]{36}\/artwork$/.test(url) || url.startsWith('/api/display/artwork/') || url === '/demo-cover.svg')) {
    const image = el('img'); image.alt = alt; image.loading = eager ? 'eager' : 'lazy'; image.decoding = 'async';
    image.src = url.startsWith('/api/') ? `${url}?size=${className.includes('result-artwork') || className.includes('artist-portrait') && !eager ? 128 : 512}` : url;
    image.onerror = () => image.remove(); frame.append(image);
  }
  return frame;
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
  frame.dataset.status = progress?.status ?? 'waiting';
  const bar = frame.querySelector<HTMLProgressElement>('progress')!;
  if (progress?.fraction != null) bar.value = progress.fraction; else bar.removeAttribute('value');
  bar.hidden = !progress;
  const times = frame.querySelector<HTMLElement>('.track-times')!;
  if (progress?.duration !== undefined) {
    if (times.children.length !== 2) times.replaceChildren(el('span'), el('span'));
    const elapsed = progress.elapsed === undefined ? '—:—' : time(progress.elapsed); const duration = progress.duration > 0 ? time(progress.duration) : '—:—';
    if (times.children[0]!.textContent !== elapsed) times.children[0]!.textContent = elapsed;
    if (times.children[1]!.textContent !== duration) times.children[1]!.textContent = duration;
    const description = progress.elapsed === undefined ? 'Position unavailable' : `${elapsed} elapsed${progress.duration > 0 ? ` of ${duration}` : ''}`;
    if (bar.getAttribute('aria-valuetext') !== description) bar.setAttribute('aria-valuetext', description);
  } else { if (times.childNodes.length) times.replaceChildren(); bar.setAttribute('aria-valuetext', 'Track progress. Times hidden until reveal.'); }
}
export function progressBar(progress?: PlaybackProgress, publicDisplay = false) {
  const frame = el('section', undefined, `playback-progress${publicDisplay ? ' public-playback' : ''}`); frame.setAttribute('aria-label', 'Playback status and progress');
  const status = el('span', undefined, 'playback-status'); status.setAttribute('role', 'status');
  const bar = el('progress'); bar.max = 1; bar.setAttribute('aria-label', 'Track progress');
  frame.append(status, bar, el('div', undefined, 'track-times')); updateProgress(frame, progress); return frame;
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
  slider.value = String(volume?.level ?? 0);
  const output = root.querySelector<HTMLOutputElement>('.volume-control output');
  if (output) {
    output.value = volume?.level == null ? 'Unavailable' : `${volume.level}%`;
    output.title = 'Volume';
  }
}
