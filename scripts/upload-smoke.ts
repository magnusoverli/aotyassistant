import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import assert from 'node:assert/strict';
import type { View } from '../src/model.js';
import type { PreparationView, PreparationResult } from '../src/preparations.js';
import type { UploadPreview } from '../src/uploads.js';
import { docker, image, availablePort } from './container-fixture.js';

/** Real packaged FFprobe/tag/image validation, never a real Music Assistant or speaker. Own temporary container/volume only. */
const port = await availablePort();
const origin = `http://127.0.0.1:${port}`; const volume = `aoty-upload-smoke-${randomUUID()}`;
const restoredVolume = `aoty-backup-restore-${randomUUID()}`;
let container = '';
try {
  await docker('volume', 'create', volume);
  await docker('volume', 'create', restoredVolume);
  await docker('run', '--rm', '--network', 'none', '--volume', `${volume}:/data`, '--entrypoint', 'node', image, '-e', "require('fs').writeFileSync('/data/options.json', JSON.stringify({demo_track_seconds:30}))");
  const launch = (data: string) => docker('run', '--detach', '--rm', '--publish', `127.0.0.1:${port}:3000`, '--volume', `${data}:/data`, '--env', 'HA_ADDON=1', '--env', `GUEST_URL=${origin}`, image);
  container = await launch(volume);
  const ready = async () => {
    for (let i = 0; i < 80; i++) {
      try { if ((await fetch(origin + '/api/health', { signal: AbortSignal.timeout(1000) })).ok) return; } catch { /* Test container starting. */ }
      await delay(100);
    }
    throw new Error('Upload smoke container did not start.');
  };
  await ready();
  const post = (path: string, data: unknown, cookie = '') => fetch(origin + path, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify(data) });
  const joined = await post('/api/participant/join', { nickname: 'Upload smoke listener', pin: '1234' }); assert.equal(joined.status, 200);
  const membership = joined.headers.get('set-cookie')!.split(';')[0]!;
  const initialized = await post('/api/participant/preparations/init', {}, membership); assert.equal(initialized.status, 200);
  const libraryCookie = initialized.headers.get('set-cookie')!.split(';')[0]!; const credentials = `${membership}; ${libraryCookie}`;
  let library = await initialized.json() as PreparationView;
  await docker('exec', container, 'node', '--input-type=module', '-e', "import sharp from 'sharp'; await sharp({create:{width:32,height:32,channels:3,background:'#208050'}}).png().toFile('/tmp/cover.png'); await sharp('/tmp/cover.png').jpeg().toFile('/tmp/cover.jpg');");
  const picture = Buffer.from(await docker('exec', container, 'node', '-e', "console.log(require('fs').readFileSync('/tmp/cover.png').toString('base64'))"), 'base64');
  const mime = Buffer.from('image/png'); const header = Buffer.alloc(8); header.writeUInt32BE(3, 0); header.writeUInt32BE(mime.length, 4);
  const details = Buffer.alloc(24); details.writeUInt32BE(32, 4); details.writeUInt32BE(32, 8); details.writeUInt32BE(24, 12); details.writeUInt32BE(picture.length, 20);
  const pictureTag = Buffer.concat([header, mime, details, picture]).toString('base64');
  const formats = [
    { name: 'cbr.mp3', args: ['-c:a', 'libmp3lame', '-b:a', '128k', '-id3v2_version', '3'], cover: 'jpg' },
    { name: 'vbr.mp3', args: ['-c:a', 'libmp3lame', '-q:a', '3', '-id3v2_version', '4'], cover: 'png' },
    { name: 'aac-in-m4a.m4a', args: ['-c:a', 'aac', '-b:a', '128k'], cover: 'jpg' },
    { name: 'apple-lossless.m4a', args: ['-c:a', 'alac'], cover: 'png' },
    { name: 'lossless.flac', args: ['-c:a', 'flac'], cover: 'png' },
    { name: 'pcm.wav', args: ['-c:a', 'pcm_s16le'] },
    { name: 'pcm.aiff', args: ['-c:a', 'pcm_s16be', '-write_id3v2', '1'] },
    { name: 'vorbis.ogg', args: ['-c:a', 'libvorbis', '-q:a', '4', '-metadata', `METADATA_BLOCK_PICTURE=${pictureTag}`], embedded: true },
    { name: 'opus.opus', args: ['-c:a', 'libopus', '-b:a', '96k', '-metadata', `METADATA_BLOCK_PICTURE=${pictureTag}`], embedded: true },
  ];
  const uploadIds: string[] = [];
  for (const format of formats) {
    const coverArgs = format.cover ? ['-i', `/tmp/cover.${format.cover}`, '-map', '0:a:0', '-map', '1:v:0', '-c:v', 'copy', '-disposition:v:0', 'attached_pic', '-metadata:s:v:0', 'comment=Cover (front)'] : [];
    await docker('exec', container, 'ffmpeg', '-hide_banner', '-loglevel', 'error', '-nostdin', '-threads', '1', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100:duration=2', ...coverArgs,
      ...format.args, '-metadata', `title=Container ${format.name}`, '-metadata', 'artist=Container track artist', '-metadata', 'album_artist=Container album artist', '-metadata', 'album=Container album', `/tmp/${format.name}`);
    const bytes = Buffer.from(await docker('exec', container, 'node', '-e', `console.log(require('fs').readFileSync('/tmp/${format.name}').toString('base64'))`), 'base64');
    const id = randomUUID(); uploadIds.push(id);
    const uploaded = await fetch(`${origin}/api/participant/preparations/uploads/${id}`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/octet-stream', 'X-Upload-Filename': format.name, Cookie: credentials }, body: new Uint8Array(bytes), signal: AbortSignal.timeout(20_000) });
    assert.equal(uploaded.status, 200, `${format.name}: ${await uploaded.clone().text()}`); const preview = await uploaded.json() as UploadPreview;
    assert.equal(preview.title, `Container ${format.name}`); assert.equal(preview.artist, 'Container track artist'); assert.equal(preview.album, 'Container album'); assert.ok(preview.duration > 1 && preview.duration < 3);
    if (format.cover || format.embedded) {
      assert.ok(preview.artwork, `${format.name} cover extraction`);
      const image = await fetch(origin + preview.artwork, { headers: { Cookie: libraryCookie } }); assert.equal(image.status, 200);
      assert.equal(Buffer.from(await image.arrayBuffer()).subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    }
    const added = await post('/api/participant/preparations/add-upload', { uploadId: id, text: { title: preview.title, artist: preview.artist, album: preview.album }, operation: { id: randomUUID(), revision: library.revision, issuedAt: Date.now() } }, credentials);
    assert.equal(added.status, 200, await added.clone().text()); library = (await added.json() as PreparationResult).view;
    const original = Buffer.from(await docker('exec', container, 'node', '-e', `console.log(require('fs').readFileSync('/data/uploads/${id}/audio').toString('base64'))`), 'base64');
    assert.deepEqual(original, bytes, 'Saving metadata never rewrites original audio.');
  }
  await docker('exec', container, 'ffmpeg', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-c:a', 'aac', '-f', 'adts', '/tmp/standalone.aac');
  const aac = Buffer.from(await docker('exec', container, 'node', '-e', "console.log(require('fs').readFileSync('/tmp/standalone.aac').toString('base64'))"), 'base64');
  for (const [name, bytes] of [['standalone.aac', aac], ['renamed.mp3', aac], ['text.mp3', Buffer.from('this is not music')]] as const) {
    const rejected = await fetch(`${origin}/api/participant/preparations/uploads/${randomUUID()}`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/octet-stream', 'X-Upload-Filename': name, Cookie: credentials }, body: new Uint8Array(bytes), signal: AbortSignal.timeout(20_000) });
    assert.equal(rejected.status, 422, name);
  }
  assert.equal(library.upcoming.length, formats.length);
  const saved = library;
  await docker('exec', container, 'node', '/app/dist/server/backup-hook.js', 'freeze');
  try {
    assert.equal((await (await fetch(origin + '/api/health')).json()).backupPaused, true);
    assert.equal((await post('/api/participant/join', { nickname: 'Not committed during backup' })).status, 503);
    await docker('run', '--rm', '--network', 'none', '--read-only', '--volume', `${volume}:/source:ro`, '--volume', `${restoredVolume}:/data`, '--entrypoint', 'sh', image,
      '-e', '-o', 'pipefail', '-c', 'tar -C /source -cf - . | tar -C /data -xpf -');
  } finally { await docker('exec', container, 'node', '/app/dist/server/backup-hook.js', 'thaw'); }
  assert.equal((await (await fetch(origin + '/api/health')).json()).backupPaused, false);
  await docker('stop', '--time', '5', container); container = await launch(restoredVolume); await ready();
  const restored = await fetch(origin + '/api/participant/preparations/state', { headers: { Cookie: libraryCookie } }); assert.equal(restored.status, 200);
  const restoredLibrary = await restored.json() as PreparationView; assert.equal(restoredLibrary.upcoming.length, formats.length);
  assert.deepEqual(restoredLibrary.upcoming.map(entry => entry.title), saved.upcoming.map(entry => entry.title));
  assert.equal((await fetch(origin + restoredLibrary.upcoming[0]!.artwork!, { headers: { Cookie: libraryCookie } })).status, 200);
  assert.equal((await fetch(origin + restoredLibrary.upcoming[0]!.artwork!)).status, 401);
  const initializedAgain = await post('/api/participant/preparations/init', {}, membership); assert.equal(initializedAgain.status, 200);
  assert.equal((await initializedAgain.json() as PreparationView).ownerId, library.ownerId);
  assert.equal((await (await fetch(origin + '/api/participant/state', { headers: { Cookie: membership } })).json() as View).ownPlayback, null);
  console.info('Upload container smoke passed: packaged audio formats, HA backup write coordination, the same automatic list and covers after volume restore; no audio commands.');
} finally {
  if (container) await docker('stop', '--time', '5', container).catch(() => {});
  await docker('volume', 'rm', volume).catch(() => {});
  await docker('volume', 'rm', restoredVolume).catch(() => {});
}
