import { spectrumMaxHz, spectrumMinHz } from '../src/spectrum';

/** Two mirrored frequency sweeps meet at treble in the upper-right and bass in the lower-left.
 * Positions are arc lengths, so the orientation survives changes in card aspect ratio. */
export function spectrumBandPosition(distance: number, perimeter: number, trebleAt: number): number {
  const offset = ((distance - trebleAt) % perimeter + perimeter) % perimeter;
  return 1 - Math.min(offset, perimeter - offset) / (perimeter / 2);
}

/** Hue falls linearly from purple through blue/cyan to green with frequency on both sweeps. */
export function spectrumBandHue(position: number): number {
  return 270 - Math.max(0, Math.min(1, position)) * 150;
}

/** Linear opacity ramp: 0% at zero input, 5% at 10%, then 90% at 35% and above. */
function needleOpacity(input: number) {
  if (input <= .1) return .5 * input;
  if (input >= .35) return .9;
  return .05 + .85 * (input - .1) / .25;
}

/** Length eases above roughly 1 kHz; opacity reaches its plateau at 35% input.
 * Keep brightness independent of frequency and the needle-length response curve. */
export function spectrumNeedleLevel(level: number, position: number) {
  const trebleStart = Math.log(1000 / spectrumMinHz) / Math.log(spectrumMaxHz / spectrumMinHz);
  const treble = Math.max(0, Math.min(1, (position - trebleStart) / (1 - trebleStart)));
  const input = Math.max(0, Math.min(1, level));
  const strength = input ** (1.5 - .6 * treble);
  return { scale: .04 + .96 * strength, opacity: needleOpacity(input) };
}
