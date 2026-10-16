import { createServer } from 'node:http';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';

/** Synthetic Music Assistant only; it never reaches a real speaker or upstream service. */
export async function startMusicAssistantFixture(port = 0) {
  const track = { item_id: 'catalogue-result', provider: 'spotify', name: 'Real catalogue fixture', version: 'Original recording', media_type: 'track',
    uri: 'spotify://track/private-fixture-uri', duration: 180, artists: [{ name: 'Fixture artist', image: { type: 'thumb', proxy_id: 'b'.repeat(64) } }], album: { name: 'Fixture album' },
    provider_mappings: [{ item_id: 'catalogue-result', provider_domain: 'spotify', available: true }], metadata: { images: [{ type: 'thumb', proxy_id: 'a'.repeat(64), path: 'http://private.example/secret-search-art' }] } };
  const artist = { item_id: 'artist-1', provider: 'spotify', name: 'Fixture artist', uri: 'spotify://artist/private-fixture-artist', metadata: { images: [{ type: 'thumb', proxy_id: 'b'.repeat(64) }] } };
  const album = { item_id: 'album-1', provider: 'spotify', name: 'Fixture album', uri: 'spotify://album/private-fixture-album', year: 2025, version: 'Original album', artists: [{ name: artist.name }], metadata: { images: [{ type: 'thumb', proxy_id: 'a'.repeat(64) }] } };
  let itemNumber = 0;
  const queue = { queue_id: 'fixture-queue', available: true, active: true, items: 0, state: 'idle', ended: false,
    repeat_mode: 'all', autoplay_enabled: true, shuffle_enabled: true, elapsed_time: 0, elapsed_time_last_updated: Date.now() / 1000, resume_pos: 0, current_item: null as null | { queue_item_id: string; media_item: typeof track }, next_item: null as unknown };
  const player = { player_id: 'sonos:room', available: true, type: 'player', supported_features: ['volume_set'], volume_control: 'native', volume_level: 30, group_volume: 40, group_members: [] as string[],
    playback_state: 'idle', active_source: null as string | null, active_group: null as string | null, synced_to: null as string | null };
  let imageMode: 'png' | 'svg' | 'redirect' | 'oversized' = 'png';
  const imageCalls: string[] = [];
  let imageDelay = 0;
  let nextVolumeDelay = 0;
  let volumeReadPending = false;
  let volumeClamp: number | undefined;
  const calls: { command: string; args: Record<string, unknown> }[] = [];
  const info = { server_id: randomUUID(), onboard_done: true, server_version: '2.fixture', schema_version: 65, min_supported_schema_version: 28 };
  const appToken = `fixture.${Buffer.from(JSON.stringify({ jti: 'fixture-app-token', exp: Math.floor(Date.now() / 1000) + 86400 * 365 })).toString('base64url')}.signature`;
  const authorizations = ['Bearer browser-test-token', 'Bearer fixture-token', 'Bearer browser-login-session', `Bearer ${appToken}`];
  let failed = false;
  const uploads = new Map<string, typeof track>();
  let uploadDuration = 180;
  let uploadMode: 'normal' | 'unreachable' | 'wrong-identity' | 'no-callback' = 'normal';
  let uploadDelay = 0;
  let failAfterPlay = false;
  let ignoredControl: 'pause' | 'resume' | 'stop' | undefined;
  const server = createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/info') { res.end(JSON.stringify(info)); return; }
    if (req.url?.startsWith('/login?')) {
      const login = new URL(req.url, 'http://fixture'); const callback = new URL(login.searchParams.get('return_url')!); callback.searchParams.set('code', 'browser-login-session');
      res.setHeader('Content-Type', 'text/html'); res.setHeader('Referrer-Policy', 'no-referrer');
      res.end(`<h1>Music Assistant sign-in</h1><a href="${callback.href.replaceAll('&', '&amp;').replaceAll('"', '&quot;')}">Authorize Albums of the Year</a>`); return;
    }
    if (req.url === '/api-docs') { res.setHeader('Content-Type', 'text/html'); res.end('<h1>Fixture docs</h1>'); return; }
    if (req.url?.startsWith('/imageproxy/')) {
      imageCalls.push(req.url);
      if (imageDelay) await new Promise(resolve => setTimeout(resolve, imageDelay));
      if (!authorizations.includes(req.headers.authorization ?? '')) { res.writeHead(401); res.end(); return; }
      if (imageMode === 'redirect') { res.writeHead(302, { Location: 'http://169.254.169.254/private' }); res.end(); return; }
      if (imageMode === 'svg') { res.setHeader('Content-Type', 'image/svg+xml'); res.end('<svg><script>PRIVATE</script></svg>'); return; }
      if (imageMode === 'oversized') { res.end(Buffer.alloc(3 * 1024 * 1024)); return; }
      res.setHeader('Content-Type', 'image/png'); res.end(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZXkAAAAASUVORK5CYII=', 'base64')); return;
    }
    let raw = ''; for await (const chunk of req) raw += chunk;
    if (!authorizations.includes(req.headers.authorization ?? '')) { res.statusCode = 401; res.end('PRIVATE unauthorized details'); return; }
    const { command, args } = JSON.parse(raw); calls.push({ command, args });
    const volumeDelay = command === 'players/get' ? nextVolumeDelay : 0;
    if (volumeDelay) { nextVolumeDelay = 0; volumeReadPending = true; }
    if (queue.state === 'playing') queue.elapsed_time += Math.max(0, Date.now() / 1000 - queue.elapsed_time_last_updated);
    queue.elapsed_time_last_updated = Date.now() / 1000;
    if (failed) { res.statusCode = 503; res.end('PRIVATE connection details'); return; }
    if (ignoredControl && command === `player_queues/${ignoredControl}`) { res.end('null'); return; }
    let result: unknown = null;
    if (command === 'auth/token/create') result = appToken;
    else if (command === 'auth/token/revoke') result = null;
    else if (command === 'players/all') result = [{ player_id: 'sonos:room', name: 'Living room', available: true }, { player_id: 'sonos:bedroom', name: 'Bedroom', available: true }, { player_id: 'sonos:offline', name: 'Offline room', available: false }];
    else if (command === 'players/get') result = { ...player, player_id: args.player_id };
    else if (command === 'players/cmd/volume_set') player.volume_level = volumeClamp ?? args.volume_level;
    else if (command === 'players/cmd/group_volume') player.group_volume = volumeClamp ?? args.volume_level;
    else if (command === 'music/search') {
      if (args.search_query === 'failure') { res.statusCode = 503; res.end('PRIVATE FIXTURE ERROR'); return; }
      result = args.media_types[0] === 'artist' ? { artists: args.search_query === 'empty' ? [] : [artist] } : { tracks: args.search_query === 'empty' ? [] : [track] };
    } else if (command === 'music/artists/artist_albums') result = [album];
    else if (command === 'music/albums/album_tracks') result = [track];
    else if (command === 'music/item_by_uri' && typeof args.uri === 'string' && args.uri.startsWith('builtin://track/')) {
      const url = args.uri.slice('builtin://track/'.length);
      try {
        if (uploadMode === 'unreachable') throw new Error();
        if (uploadDelay) await new Promise(resolve => setTimeout(resolve, uploadDelay));
        if (uploadMode !== 'no-callback') { const file = await fetch(url, { signal: AbortSignal.timeout(2000) }); if (!file.ok) throw new Error(); await file.arrayBuffer(); }
        const uploaded = { ...track, item_id: uploadMode === 'wrong-identity' ? 'different-file' : url, uri: args.uri, provider: 'builtin', version: '',
          name: `UPSTREAM SECRET ${url}`, duration: new URL(url).pathname.startsWith('/api/media/check/') ? 3 : uploadDuration, metadata: { images: [] },
          provider_mappings: [{ item_id: url, provider_domain: 'builtin', available: true }] };
        uploads.set(args.uri, uploaded); result = uploaded;
      } catch { res.statusCode = 400; res.end(`PRIVATE unreachable source ${url}`); return; }
    }
    else if (command === 'music/item_by_uri') result = track;
    else if (command === 'player_queues/get_active_queue') result = queue;
    else if (command === 'player_queues/items') result = queue.current_item ? [queue.current_item] : [];
    else if (command === 'player_queues/autoplay') queue.autoplay_enabled = args.autoplay_enabled;
    else if (command === 'player_queues/repeat') queue.repeat_mode = args.repeat_mode;
    else if (command === 'player_queues/shuffle') queue.shuffle_enabled = args.shuffle_enabled;
    else if (command === 'player_queues/play_media') {
      const selected = args.media?.[0] === track.uri ? track : uploads.get(args.media?.[0]);
      if (!selected || args.option !== 'replace' || args.media.length !== 1) { res.statusCode = 400; res.end('Wrong recording or queue option'); return; }
      queue.items = 1; queue.current_item = { queue_item_id: `fixture-item-${++itemNumber}`, media_item: { ...selected } };
      queue.state = 'playing'; queue.active = true; queue.ended = false; queue.next_item = null;
      player.playback_state = 'playing'; player.active_source = queue.queue_id;
      queue.elapsed_time = 0;
      if (failAfterPlay) { failed = true; failAfterPlay = false; }
    } else if (command === 'player_queues/stop') { queue.state = 'idle'; queue.ended = false; player.playback_state = 'idle'; player.active_source = null; }
    else if (command === 'player_queues/pause') { queue.resume_pos = queue.elapsed_time; queue.state = 'paused'; player.playback_state = 'paused'; }
    else if (command === 'player_queues/resume') { queue.state = 'playing'; queue.active = true; queue.elapsed_time = queue.resume_pos; player.playback_state = 'playing'; player.active_source = queue.queue_id; }
    else { res.statusCode = 400; res.end('Unexpected command'); return; }
    if (volumeDelay) { await new Promise(resolve => setTimeout(resolve, volumeDelay)); volumeReadPending = false; }
    res.end(JSON.stringify(result));
  });
  server.listen(port, '127.0.0.1'); await once(server, 'listening');
  return { origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, calls, info, queue, track, player, imageCalls,
    imageMode(mode: typeof imageMode) { imageMode = mode; },
    delayImages(ms: number) { imageDelay = ms; },
    delayNextVolumeRead(ms: number) { nextVolumeDelay = ms; },
    get volumeReadPending() { return volumeReadPending; },
    clampVolume(level: number) { volumeClamp = level; },
    parkPaused() { queue.state = 'idle'; queue.active = false; queue.ended = false; queue.elapsed_time = 0; player.playback_state = 'idle'; player.active_source = null; },
    finish() { queue.state = 'idle'; queue.ended = true; }, fail(value: boolean) { failed = value; },
    failNextPlaybackVerification() { failAfterPlay = true; },
    ignoreControl(action: typeof ignoredControl) { ignoredControl = action; },
    uploadedDuration(duration: number) { uploadDuration = duration; },
    uploadedMode(mode: typeof uploadMode) { uploadMode = mode; },
    delayUploads(ms: number) { uploadDelay = ms; },
    close() { server.closeAllConnections(); server.close(); } };
}
