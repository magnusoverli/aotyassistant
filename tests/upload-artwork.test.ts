import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Readable } from 'node:stream';
import sharp from 'sharp';
import { UploadAssets } from '../src/uploads.js';
import { fixtureUploadAnalysis, uploadBytes } from './fixtures/uploads.js';

test('uploaded covers have shared bounded JPEG thumbnails and a separate display variant, with authorization before cache reuse', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'doom-room-upload-art-'));
  const assets = new UploadAssets(directory, async (path, filename) => {
    const analysis = await fixtureUploadAnalysis(path, filename);
    const cover = await sharp({ create: { width: 1024, height: 768, channels: 3, background: '#657a48' } }).png().toBuffer();
    await writeFile(join(path, 'cover.png'), cover); return analysis;
  }); t.after(() => assets.close());
  const owner = randomUUID(); const id = randomUUID();
  await assets.receive(owner, id, 'test.mp3', Readable.from(uploadBytes));
  const [first, second] = await Promise.all([assets.artwork(id, owner, 160), assets.artwork(id, owner, 160)]);
  assert.equal(first.contentType, 'image/jpeg'); assert.equal(first.body, second.body);
  assert.equal((await assets.artwork(id, owner, 160)).body, first.body);
  const small = await sharp(first.body).metadata(); assert.equal(small.width, 160); assert.equal(small.height, 120);
  const large = await assets.artwork(id, owner, 1024); const dimensions = await sharp(large.body).metadata();
  assert.equal(dimensions.width, 1024); assert.equal(dimensions.height, 768); assert.notEqual(large.body, first.body);
  await assert.rejects(assets.artwork(id, randomUUID(), 160), /not found/);
  assets.setOwnerPolicy(() => false); await assert.rejects(assets.artwork(id, owner, 160), /no longer available/);
  assets.setOwnerPolicy(() => true); await assets.remove(owner, id);
  await assert.rejects(assets.artwork(id, owner, 160), /not found/);
});
