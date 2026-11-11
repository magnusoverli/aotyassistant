import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { displayStage, fittingSeats } from '../web/display-stage';
import { viewingDistances } from '../src/viewing-distance';

const close = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < .01, `${actual} ≈ ${expected}`);

test('every 16:9 screen shows the same 1920×1080 design, whatever its pixel size', () => {
  for (const [width, height, unit] of [[1920, 1080, 1], [3840, 2160, 2], [960, 540, .5], [2560, 1440, 1.3333], [7680, 4320, 4]] as const) {
    const stage = displayStage({ width, height });
    close(stage.unit, unit); close(stage.rootPx, unit * 16);
    close(stage.canvas.width, 1920); close(stage.canvas.height, 1080);
    assert.equal(stage.tier, 'standard');
  }
  // A 1366×768 laptop is a hair wider than 16:9.
  const laptop = displayStage({ width: 1366, height: 768 });
  close(laptop.canvas.height, 1080); assert.ok(Math.abs(laptop.canvas.width - 1920) < 2); assert.equal(laptop.tier, 'standard');
});

test('the limiting side sets the size: wide and tall screens gain room, never larger text', () => {
  const ultrawide = displayStage({ width: 3440, height: 1440 });
  close(ultrawide.unit, 1.3333); close(ultrawide.canvas.width, 2580); close(ultrawide.canvas.height, 1080);
  const tall = displayStage({ width: 1024, height: 768 });
  close(tall.unit, .5333); close(tall.canvas.width, 1920); close(tall.canvas.height, 1440);
  assert.equal(ultrawide.tier, 'standard'); assert.equal(tall.tier, 'standard');
});

test('a larger viewing distance draws everything larger and leaves the layout a smaller canvas', () => {
  const canvases = { close: [2258.82, 1270.59, 'standard'], sofa: [1920, 1080, 'standard'], room: [1536, 864, 'compact'], back: [1280, 720, 'compact'] } as const;
  for (const distance of viewingDistances) {
    const stage = displayStage({ width: 1920, height: 1080 }, distance.scale);
    const [width, height, tier] = canvases[distance.id];
    close(stage.unit, distance.scale); close(stage.canvas.width, width); close(stage.canvas.height, height);
    assert.equal(stage.tier, tier);
    // The same setting gives the same picture on a 4K screen and on a TV box that reports 960×540.
    for (const [w, h] of [[3840, 2160], [960, 540]] as const) {
      const other = displayStage({ width: w, height: h }, distance.scale);
      close(other.canvas.width, width); close(other.canvas.height, height); assert.equal(other.tier, tier);
    }
  }
  // An ultrawide keeps its side column one step longer, because width is not what it lacks.
  assert.equal(displayStage({ width: 3440, height: 1440 }, 1.25).tier, 'standard');
  assert.equal(displayStage({ width: 3440, height: 1440 }, 1.5).tier, 'compact');
});

test('phones and turned screens use the portrait layout with readable text', () => {
  const phone = displayStage({ width: 390, height: 844 });
  assert.equal(phone.unit, .5); assert.equal(phone.rootPx, 8); assert.equal(phone.tier, 'portrait');
  assert.deepEqual(phone.canvas, { width: 780, height: 1688 });
  const landscape = displayStage({ width: 844, height: 390 });
  assert.equal(landscape.unit, .5); assert.equal(landscape.tier, 'compact');
  // A TV on its side keeps the text size it has the right way up.
  const turned = displayStage({ width: 1080, height: 1920 });
  assert.equal(turned.unit, 1); assert.equal(turned.tier, 'portrait');
  assert.equal(displayStage({ width: 320, height: 700 }, 1.5).unit, .75);
});

test('unusable sizes and scales fall back to the plain design', () => {
  for (const screen of [{ width: 0, height: 0 }, { width: NaN, height: NaN }, { width: -5, height: 1080 }]) {
    const stage = displayStage(screen);
    assert.ok(Number.isFinite(stage.unit) && stage.unit > 0); assert.ok(Number.isFinite(stage.canvas.width) && Number.isFinite(stage.canvas.height));
  }
  for (const scale of [0, -1, NaN]) assert.equal(displayStage({ width: 1920, height: 1080 }, scale).unit, 1);
});

test('the play order shows everyone who fits, otherwise the first listeners and a count of the rest', () => {
  const size = { seat: 256, gap: 26, more: 136 };
  assert.equal(fittingSeats(0, 1804, size), 0);
  assert.equal(fittingSeats(6, 1804, size), 6, 'Six cards and five gaps take 1666.');
  assert.equal(fittingSeats(7, 1804, size), 5, 'Seven do not fit, so five cards leave room for the count.');
  assert.equal(fittingSeats(20, 1804, size), 5);
  assert.equal(fittingSeats(20, 1688, size), 5);
  assert.equal(fittingSeats(20, 3000, size), 10);
  // Now and Next are always shown, even where they have to shrink.
  assert.equal(fittingSeats(20, 300, size), 2); assert.equal(fittingSeats(20, 0, size), 2);
  assert.equal(fittingSeats(1, 100, size), 1); assert.equal(fittingSeats(2, 100, size), 2);
  // Without measurements (before the first layout) nobody is left out.
  assert.equal(fittingSeats(20, NaN, size), 20); assert.equal(fittingSeats(20, 1804, { seat: NaN, gap: 26, more: 136 }), 20);
  assert.equal(fittingSeats(20, 1804, { seat: 0, gap: 26, more: 136 }), 20);
});

test('the display stylesheet is written in design units, so one setting scales every element', async () => {
  const css = (await readFile(new URL('../web/display.css', import.meta.url), 'utf8')).replace(/\/\*[\s\S]*?\*\//g, '');
  // Hairlines, and the smallest touch target, control text and menu width on a phone.
  const allowed = new Set(['0px', '.5px', '1px', '12px', '44px', '240px']);
  const lengths = css.match(/(?<![\w.#-])\d*\.?\d+px\b/g) ?? [];
  assert.deepEqual([...new Set(lengths.filter(length => !allowed.has(length)))], []);
  // Window-size breakpoints would bring back layouts that ignore the viewing distance.
  assert.doesNotMatch(css, /@media\s*\((?:min|max)-(?:width|height)/);
  assert.match(css, /--seat-min:\d/); assert.match(css, /--more-width:\d/);
});
