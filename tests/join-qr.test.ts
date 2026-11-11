import assert from 'node:assert/strict';
import { test } from 'node:test';
import { joinQrImage } from '../web/join-qr';

test('join invitations produce a scalable self-contained image with a quiet zone', async () => {
  const image = await joinQrImage('https://room.example/join?invitation=abc&room=123');
  assert.ok(image.startsWith('data:image/svg+xml;charset=utf-8,'));
  const svg = decodeURIComponent(image.slice(image.indexOf(',') + 1));
  assert.match(svg, /<svg[^>]+viewBox="0 0 \d+ \d+"/);
  assert.match(svg, /fill="#ffffff"/);
  assert.doesNotMatch(svg, /<(?:script|image)|href=/);
  assert.notEqual(await joinQrImage('https://room.example/join?invitation=other'), image);
});
