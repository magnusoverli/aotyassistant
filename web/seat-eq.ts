import { el } from './dom';

/** One band of light rising inward from an edge of the current participant's card. */
export type EqBand = { edge: 'top' | 'bottom' | 'left' | 'right'; at: number; width: number; low: number; peak: number;
  duration: number; delay: number; shape: 'a' | 'b' | 'c' };

/** A small deterministic generator, so every page draws the same pattern and tests can rely on it. */
function generator(seed: number) {
  let state = seed >>> 0;
  return () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 2 ** 32; };
}

/** Bands spread evenly along the long edges and a few along the short ones. Their durations
 * do not divide into each other, so together they never visibly repeat: the old spectrum-meter
 * look without any audio (the music plays on the speaker, not in this page). */
export function eqBands(perLongEdge = 9, perShortEdge = 2, seed = 0x5eed): EqBand[] {
  const random = generator(seed); const bands: EqBand[] = []; const shapes = ['a', 'b', 'c'] as const;
  const band = (edge: EqBand['edge'], index: number, count: number): EqBand => {
    const slot = 100 / count;
    const duration = .55 + random() * .85;
    return { edge, at: Math.round((slot * (index + .5) + (random() - .5) * slot * .35) * 10) / 10,
      width: Math.round(slot * (1.35 + random() * .4) * 10) / 10, low: Math.round((.1 + random() * .12) * 100) / 100,
      peak: Math.round((.55 + random() * .35) * 100) / 100, duration: Math.round(duration * 100) / 100,
      delay: -Math.round(random() * duration * 100) / 100, shape: shapes[Math.floor(random() * shapes.length)]! };
  };
  for (const edge of ['top', 'bottom'] as const) for (let i = 0; i < perLongEdge; i++) bands.push(band(edge, i, perLongEdge));
  for (const edge of ['left', 'right'] as const) for (let i = 0; i < perShortEdge; i++) bands.push(band(edge, i, perShortEdge));
  return bands;
}

const pattern = eqBands();

/** The decorative layer behind the current card's avatar and name. listening-order.css decides
 * when it moves: only while the song plays, frozen while paused, gone while a song is chosen. */
export function seatEq() {
  const layer = el('span', undefined, 'seat-eq'); layer.setAttribute('aria-hidden', 'true');
  for (const band of pattern) {
    const node = el('i', undefined, 'eq-band'); node.dataset.edge = band.edge;
    // CSSOM custom properties are allowed by the page's style-src policy; style attributes are not.
    for (const [name, value] of [['--at', `${band.at}%`], ['--w', `${band.width}%`], ['--low', String(band.low)], ['--peak', String(band.peak)],
      ['--d', `${band.duration}s`], ['--delay', `${band.delay}s`], ['--eq', `seat-eq-${band.shape}${band.edge === 'left' || band.edge === 'right' ? '-x' : ''}`]] as const) {
      node.style.setProperty(name, value);
    }
    layer.append(node);
  }
  return layer;
}
