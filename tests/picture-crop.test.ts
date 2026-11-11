import { test } from 'node:test';
import assert from 'node:assert/strict';
import { centredCrop, movePictureCrop, pictureCrop } from '../web/picture-crop.js';

test('camera portrait and landscape crops stay square, centred and within the oriented source', () => {
  assert.deepEqual(pictureCrop(4000, 3000, centredCrop()), { left: 500, top: 0, size: 3000 });
  assert.deepEqual(pictureCrop(3000, 4000, centredCrop()), { left: 0, top: 500, size: 3000 });
  for (const [width, height] of [[4000, 3000], [3000, 4000], [512, 512]]) {
    for (const zoom of [1, 2, 4, 100, NaN]) {
      const crop = pictureCrop(width!, height!, { x: -1, y: 2, zoom });
      assert.ok(crop.left >= 0 && crop.top >= 0);
      assert.ok(crop.left + crop.size <= width! && crop.top + crop.size <= height!);
    }
  }
});

test('dragging moves the picture with the pointer and clamps at its edges, including square photos', () => {
  const right = movePictureCrop(4000, 3000, centredCrop(), 50, 0, 250);
  assert.ok(right.x < .5); assert.equal(right.y, .5);
  const left = movePictureCrop(4000, 3000, centredCrop(), -50, 0, 250);
  assert.ok(left.x > .5);
  const edge = movePictureCrop(512, 512, { x: .5, y: .5, zoom: 2 }, 10000, -10000, 250);
  assert.deepEqual(edge, { x: 0, y: 1, zoom: 2 });
  assert.deepEqual(movePictureCrop(512, 512, centredCrop(), 20, 20, 250), centredCrop());
});
