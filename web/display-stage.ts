import { viewingDistance, type ViewingDistance } from '../src/viewing-distance';

/** The room display is designed once, at 1920×1080 design pixels, and drawn as one picture.
 * This module decides how large a design pixel is on the current screen and which layout
 * fits; display.css sizes everything in rem, where 1rem is 16 design pixels. */
export const designWidth = 1920;
export const designHeight = 1080;
const designRem = 16;
/** Phones keep text readable: a design pixel is never smaller than half a CSS pixel. */
const smallestUnit = .5;
/** Below these design-pixel sizes the side column and stream details no longer fit. */
const standardWidth = 1600;
const standardHeight = 800;

export type DisplayTier = 'standard' | 'compact' | 'portrait';
export type DisplayStage = {
  /** CSS pixels per design pixel. */
  unit: number;
  /** The root font size: 16 design pixels. */
  rootPx: number;
  /** The screen measured in design pixels: what the layout has to fit into. */
  canvas: { width: number; height: number };
  tier: DisplayTier;
};

/** The long side is measured against 1920 and the short side against 1080, so a TV turned
 * on its side keeps its text size. A larger `scale` draws everything larger, which leaves
 * the layout a smaller canvas; the tier says which layout fits that canvas. */
export function displayStage(screen: { width: number; height: number }, scale = 1): DisplayStage {
  const width = screen.width > 0 ? screen.width : designWidth;
  const height = screen.height > 0 ? screen.height : designHeight;
  const fit = Math.min(Math.max(width, height) / designWidth, Math.min(width, height) / designHeight);
  const unit = Math.max(smallestUnit, fit) * (scale > 0 ? scale : 1);
  const canvas = { width: width / unit, height: height / unit };
  const tier: DisplayTier = canvas.width < canvas.height ? 'portrait'
    : canvas.width < standardWidth || canvas.height < standardHeight ? 'compact' : 'standard';
  return { unit, rootPx: unit * designRem, canvas, tier };
}

/** How many listener cards the play order shows. Everyone, when they fit at the smallest
 * card width; otherwise as many as fit beside a "+N more" marker, and never fewer than
 * Now and Next. */
export function fittingSeats(total: number, width: number, size: { seat: number; gap: number; more: number }) {
  if (![width, size.seat, size.gap, size.more].every(Number.isFinite) || size.seat <= 0) return total;
  if (total * size.seat + (total - 1) * size.gap <= width + .5) return total;
  return Math.min(total, Math.max(2, Math.floor((width - size.more + .5) / (size.seat + size.gap))));
}

// The page-level state below is shared by the header (this screen's choice), the page
// runtime (the room's setting) and the play order (what fits).
let active = false;
let room: ViewingDistance | undefined;
let screen: ViewingDistance | undefined;
let current: DisplayStage | undefined;
const listeners = new Set<() => void>();

/** Listeners hear about a new size or layout, and about a changed setting even when
 * this screen's own choice keeps the picture as it was. */
function apply(settingChanged = false) {
  const root = document.documentElement; const previous = current;
  if (!active) {
    current = undefined; root.style.removeProperty('font-size'); delete root.dataset.displayTier;
  } else {
    current = displayStage({ width: window.innerWidth, height: window.innerHeight }, viewingDistance(screen ?? room).scale);
    root.style.fontSize = `${current.rootPx}px`; root.dataset.displayTier = current.tier;
  }
  if (!settingChanged && previous?.rootPx === current?.rootPx && previous?.tier === current?.tier) return;
  for (const listener of listeners) listener();
}
const resized = () => apply();

/** Only the room display is drawn in design pixels; every other page keeps the browser's own sizes. */
export function showDisplayStage(shown: boolean) {
  if (shown === active) return;
  active = shown;
  if (shown) window.addEventListener('resize', resized); else window.removeEventListener('resize', resized);
  apply();
}
/** The room's saved viewing distance, sent with the display's room state. */
export function setRoomDistance(distance: ViewingDistance | undefined) {
  if (distance === room) return;
  room = distance; apply(true);
}
/** This screen's own choice, which wins over the room's. `undefined` follows the room. */
export function setScreenDistance(distance: ViewingDistance | undefined) {
  if (distance === screen) return;
  screen = distance; apply(true);
}
export const roomDistance = () => room;
/** `undefined` on every page but the room display. */
export const currentStage = () => current;
export function onDisplayStage(listener: () => void, signal: AbortSignal) {
  listeners.add(listener);
  signal.addEventListener('abort', () => listeners.delete(listener), { once: true });
}
