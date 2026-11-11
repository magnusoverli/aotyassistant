/** CSS owns display geometry. This bridge only coordinates the two existing QR locations;
 * it never changes fonts, computes a scale, or stores a preference. */
export function displayHasSideRail() {
  return getComputedStyle(document.body).getPropertyValue('--display-side-rail').trim() === '1';
}

export function observeDisplayLayout(changed: () => void, signal: AbortSignal) {
  if (signal.aborted) return;
  let previous = displayHasSideRail();
  const update = () => {
    if (signal.aborted) return;
    const next = displayHasSideRail();
    if (next === previous) return;
    previous = next; changed();
  };
  window.addEventListener('resize', update, { signal });
  document.addEventListener('fullscreenchange', update, { signal });
  // Includes changed browser font defaults as well as viewport resizing.
  const observer = new ResizeObserver(update);
  observer.observe(document.body);
  signal.addEventListener('abort', () => observer.disconnect(), { once: true });
}

/** Show everyone when they fit; otherwise reserve space for the summary. Current and next
 * remain visible even if their cards need to shrink below the preferred minimum. */
export function fittingSeats(total: number, width: number, size: { seat: number; gap: number; more: number }) {
  if (![width, size.seat, size.gap, size.more].every(Number.isFinite) || size.seat <= 0) return total;
  if (total * size.seat + (total - 1) * size.gap <= width + .5) return total;
  return Math.min(total, Math.max(2, Math.floor((width - size.more + .5) / (size.seat + size.gap))));
}
