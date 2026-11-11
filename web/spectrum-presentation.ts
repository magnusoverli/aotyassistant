/** Two mirrored frequency sweeps meet at treble in the upper-right and bass in the lower-left.
 * Positions are arc lengths, so the orientation survives changes in card aspect ratio. */
export function spectrumBandPosition(distance: number, perimeter: number, trebleAt: number): number {
  const offset = ((distance - trebleAt) % perimeter + perimeter) % perimeter;
  return 1 - Math.min(offset, perimeter - offset) / (perimeter / 2);
}

/** Quiet bands recede in both length and brightness instead of forming a bright baseline. */
export function spectrumNeedleLevel(level: number) {
  const strength = Math.max(0, Math.min(1, level)) ** 1.5;
  return { scale: .04 + .96 * strength, opacity: .08 + .72 * strength };
}
