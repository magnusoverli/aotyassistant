/** Two mirrored frequency sweeps meet at treble in the upper-right and bass in the lower-left.
 * Positions are arc lengths, so the orientation survives changes in card aspect ratio. */
export function spectrumBandPosition(distance: number, perimeter: number, trebleAt: number): number {
  const offset = ((distance - trebleAt) % perimeter + perimeter) % perimeter;
  return 1 - Math.min(offset, perimeter - offset) / (perimeter / 2);
}

/** Colour follows frequency on both sweeps, rather than the SVG's drawing order. */
export function spectrumBandHue(position: number): number {
  return (150 + Math.max(0, Math.min(1, position)) * 300) % 360;
}

/** Radial corner needles converge. Stop before neighbouring strokes meet, leaving
 * a small gap without changing their anchors, angles, spacing or width. */
export function spectrumCornerLength(radius: number, count: number, strokeWidth = 1.6, gap = .4): number {
  const halfAngle = Math.PI / (4 * count);
  return Math.max(0, radius - (strokeWidth + gap) / (2 * Math.sin(halfAngle)));
}

/** Keep silence faint, but don't suppress weak treble twice through length and brightness.
 * Ease the response curve above roughly 1 kHz, retaining the bass response and full-scale limit. */
export function spectrumNeedleLevel(level: number, position: number) {
  const trebleStart = Math.log(1000 / 50) / Math.log(15000 / 50);
  const treble = Math.max(0, Math.min(1, (position - trebleStart) / (1 - trebleStart)));
  const strength = Math.max(0, Math.min(1, level)) ** (1.5 - .6 * treble);
  return { scale: .04 + .96 * strength, opacity: .08 + .72 * strength };
}
