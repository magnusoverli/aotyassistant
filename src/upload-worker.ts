import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseFile, selectCover } from 'music-metadata';
import sharp from 'sharp';

sharp.cache({ memory: 16, files: 0, items: 16 }); sharp.concurrency(1);

/** Runs in a disposable child process, never in the player/event loop. No client paths or URLs. */
process.once('message', async (message: { directory: string; filename: string }) => {
  try {
    const path = join(message.directory, 'audio');
    const { stdout } = await promisify(execFile)('ffprobe', ['-v', 'error', '-max_alloc', '33554432', '-protocol_whitelist', 'file',
      '-format_whitelist', 'mp3,mov,flac,wav,aiff,ogg', '-show_entries',
      'format=format_name,duration:stream=codec_type,codec_name,sample_rate,channels:stream_disposition=attached_pic', '-of', 'json', path],
    { timeout: 30_000, maxBuffer: 256 * 1024, windowsHide: true });
    const probe = JSON.parse(stdout) as { format: { format_name: string; duration: string }; streams: { codec_type: string; codec_name: string; channels?: number; sample_rate?: string; disposition?: { attached_pic?: number } }[] };
    const audio = probe.streams.filter(stream => stream.codec_type === 'audio');
    const stream = audio[0]; const duration = Number(probe.format.duration);
    if (audio.length !== 1 || !stream?.channels || !Number(stream.sample_rate) || !Number.isFinite(duration) || duration <= 0 ||
      probe.streams.some(item => item.codec_type === 'video' && item.disposition?.attached_pic !== 1)) throw new Error('unsupported');
    const format = probe.format.format_name.split(',');
    const type = format.includes('mp3') && stream.codec_name === 'mp3' ? ['mp3', 'audio/mpeg']
      : format.includes('mov') && ['aac', 'alac'].includes(stream.codec_name) ? ['m4a', 'audio/mp4']
      : format.includes('flac') && stream.codec_name === 'flac' ? ['flac', 'audio/flac']
      : format.includes('wav') && stream.codec_name.startsWith('pcm_') ? ['wav', 'audio/wav']
      : format.includes('aiff') && stream.codec_name.startsWith('pcm_') ? ['aiff', 'audio/aiff']
      : format.includes('ogg') && ['vorbis', 'opus'].includes(stream.codec_name) ? [stream.codec_name === 'opus' ? 'opus' : 'ogg', 'audio/ogg'] : undefined;
    if (!type) throw new Error('unsupported');
    let parsed;
    try { parsed = await parseFile(path, { maxMemoryAllocation: 8 * 1024 * 1024 }); }
    catch { try { parsed = await parseFile(path, { skipCovers: true, maxMemoryAllocation: 8 * 1024 * 1024 }); } catch { /* Valid audio can have unreadable optional tags. */ } }
    const clean = (value: string | undefined, max = 1000) => (value ?? '').replace(/[\x00-\x1f\x7f]/g, ' ').trim().slice(0, max);
    const common = parsed?.common;
    let artwork = false;
    const picture = selectCover(common?.picture);
    if (picture && ['image/jpeg', 'image/png', 'image/webp'].includes(picture.format)) {
      try {
        const image = await sharp(picture.data, { limitInputPixels: 16 * 1024 * 1024, animated: false }).rotate()
          .resize(512, 512, { fit: 'inside', withoutEnlargement: true }).png().toBuffer();
        if (image.length <= 2 * 1024 * 1024) { await writeFile(join(message.directory, 'cover.png'), image, { mode: 0o600 }); artwork = true; }
      } catch { /* Bad artwork must not discard valid audio. */ }
    }
    const fallback = message.filename.replace(/\.[^.]+$/, '');
    process.send?.({ ok: true, value: { extension: type[0], contentType: type[1], artwork, metadata: {
      title: clean(common?.title) || clean(fallback) || 'Untitled track', artist: clean(common?.artists?.join(', ') || common?.artist || common?.albumartist),
      album: clean(common?.album), version: '', provider: 'Uploaded file', duration,
    } } });
  } catch (error) {
    process.send?.({ ok: false, error: (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing-probe' : 'unsupported' });
  } finally { process.disconnect?.(); }
});
