import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { eqBands } from '../web/seat-eq.js';

test('the current card’s light is one fixed pattern of bands along every edge, so every page draws the same', () => {
  const bands = eqBands();
  assert.deepEqual(eqBands(), bands, 'The pattern is deterministic.');
  assert.deepEqual(['top', 'bottom', 'left', 'right'].map(edge => bands.filter(band => band.edge === edge).length), [9, 9, 2, 2]);
  for (const band of bands) {
    assert.ok(band.at > 0 && band.at < 100, `position ${band.at}`);
    assert.ok(band.width > 0 && band.width < 100, `width ${band.width}`);
    assert.ok(band.low > 0 && band.low < band.peak && band.peak <= 1, `levels ${band.low}–${band.peak}`);
    assert.ok(band.duration >= .55 && band.duration <= 1.4, `duration ${band.duration}`);
    assert.ok(band.delay <= 0 && -band.delay <= band.duration, 'Each band starts somewhere inside its own cycle.');
  }
  // Rhythms that differ keep the bands from moving together or visibly looping.
  assert.ok(new Set(bands.map(band => band.duration)).size >= bands.length - 3);
  assert.ok(new Set(bands.map(band => band.shape)).size === 3);
  const top = bands.filter(band => band.edge === 'top').map(band => band.at);
  assert.deepEqual(top, [...top].sort((a, b) => a - b), 'Bands stay in order along an edge.');
});

test('the light only moves while a song plays, holds when paused or offline, and respects reduced motion', async () => {
  const css = await readFile(new URL('../web/listening-order.css', import.meta.url), 'utf8');
  assert.match(css, /\.listening-order:is\(\[data-playback='playing'\],\[data-playback='paused'\]\) \.eq-band \{[^}]*animation:var\(--eq\)/);
  assert.match(css, /\.listening-order:is\(\[data-playback='paused'\],\[data-online='false'\]\) \.eq-band \{ animation-play-state:paused;/);
  assert.match(css, /@media\(prefers-reduced-motion:reduce\) \{\s*\.listening-order \.eq-band \{ animation:none; opacity:0; \}/);
  for (const shape of ['a', 'b', 'c']) for (const axis of ['', '-x']) assert.match(css, new RegExp(`@keyframes seat-eq-${shape}${axis} \\{`));
  // Bands move by transform only; the single blur is on their shared layer, not on each band.
  const bandRules = [...css.matchAll(/\.eq-band[^{]*\{([^}]*)\}/g)].map(match => match[1]!);
  assert.ok(bandRules.every(rule => !/filter:/.test(rule)));
});
