import assert from 'node:assert/strict';
import { test } from 'node:test';
import QRCode from 'qrcode';
import sharp from 'sharp';
import { joinQrImage } from '../web/join-qr';

test('join invitations produce a scalable self-contained image with a quiet zone', async () => {
  const image = await joinQrImage('https://room.example/join?invitation=abc&room=123');
  assert.ok(image.startsWith('data:image/svg+xml;charset=utf-8,'));
  const svg = decodeURIComponent(image.slice(image.indexOf(',') + 1));
  assert.match(svg, /<svg[^>]+viewBox="0 0 \d+ \d+"/);
  assert.match(svg, /fill="#cddbb5"/);
  assert.match(svg, /fill="#18241b"/);
  assert.doesNotMatch(svg, /<(?:script|image)|href=/);
  assert.notEqual(await joinQrImage('https://room.example/join?invitation=other'), image);
});

test('styled QR preserves every encoded module and four clear modules around short and long invitations', async () => {
  for (const url of ['http://192.168.1.20:3000/join', `https://doom-room.example.ts.net/join#invitation=${'aB3_-9'.repeat(35)}`]) {
    const { modules } = QRCode.create(url, { errorCorrectionLevel: 'M' });
    const image = await joinQrImage(url); const svg = decodeURIComponent(image.slice(image.indexOf(',') + 1));
    const scale = 8; const side = modules.size + 10;
    const { data, info } = await sharp(Buffer.from(svg)).resize(side * scale, side * scale).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const pixel = (x: number, y: number) => [...data.subarray((y * info.width + x) * info.channels, (y * info.width + x) * info.channels + 3)];
    for (let row = 0; row < modules.size; row++) for (let col = 0; col < modules.size; col++) {
      const actual = pixel((col + 5) * scale + scale / 2, (row + 5) * scale + scale / 2);
      assert.deepEqual(actual, modules.get(row, col) ? [205, 219, 181] : [24, 36, 27], `Module ${row},${col}`);
    }
    // Inspect every pixel of the quiet zone, excluding only the outer decorative module.
    for (let y = scale; y < (side - 1) * scale; y++) for (let x = scale; x < (side - 1) * scale; x++) {
      if (x >= 5 * scale && x < (side - 5) * scale && y >= 5 * scale && y < (side - 5) * scale) continue;
      assert.deepEqual(pixel(x, y), [24, 36, 27], `Quiet zone pixel ${x},${y}`);
    }
  }
});
