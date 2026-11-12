import { createServer } from 'node:http';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import sharp from 'sharp';

/** Actual deployed search shape: no cross-provider identity, only each result's own mapping. */
export function metadataOnly<T extends { item_id: string; provider: string; provider_mappings?: { available: boolean }[] }>(item: T) {
  return { ...item, external_ids: [], provider_mappings: [{ item_id: item.item_id, provider_domain: item.provider,
    provider_instance: `${item.provider}--private-instance`, available: item.provider_mappings?.[0]?.available ?? true }] };
}

/** Synthetic Music Assistant only; it never reaches a real speaker or upstream service. */
export async function startMusicAssistantFixture(port = 0) {
  const jpeg = await sharp({ create: { width: 1, height: 1, channels: 3, background: '#608040' } }).jpeg({ quality: 95 }).toBuffer();
  const track = { item_id: 'catalogue-result', provider: 'spotify', name: 'Real catalogue fixture', version: 'Original recording', media_type: 'track',
    uri: 'spotify://track/private-fixture-uri', duration: 180, artists: [{ name: 'Fixture artist', image: { type: 'thumb', proxy_id: 'b'.repeat(64) } }], album: { name: 'Fixture album', item_id: 'fixture-album-full', provider: 'spotify', uri: 'spotify://album/fixture-album-full' },
    provider_mappings: [{ item_id: 'catalogue-result', provider_domain: 'spotify', available: true }], metadata: { images: [{ type: 'thumb', proxy_id: 'a'.repeat(64), path: 'http://private.example/secret-search-art' }] } };
  // A second song on the fixture track's album, for replacing.
  const albummate = { ...track, item_id: 'catalogue-result-2', name: 'Second fixture song', uri: 'spotify://track/private-fixture-2', duration: 200,
    provider_mappings: [{ item_id: 'catalogue-result-2', provider_domain: 'spotify', available: true }] };
  const artist = { item_id: 'artist-1', provider: 'spotify', name: 'Fixture artist', uri: 'spotify://artist/private-fixture-artist', metadata: { images: [{ type: 'thumb', proxy_id: 'b'.repeat(64) }] } };
  const album = { item_id: 'album-1', provider: 'spotify', name: 'Fixture album', uri: 'spotify://album/private-fixture-album', year: 2025, version: 'Original album', artists: [{ name: artist.name }], metadata: { images: [{ type: 'thumb', proxy_id: 'a'.repeat(64) }] } };
  const artistIdentity = [['musicbrainz_artistid', '11111111-1111-4111-8111-111111111111']];
  const multiArtists = ['spotify', 'tidal'].map(provider => ({ ...artist, provider, item_id: `${provider}-private-artist`, uri: `${provider}://artist/private-multi-artist`,
    name: 'Metallica', external_ids: artistIdentity }));
  const multiAlbums = ['spotify', 'tidal'].map(provider => ({ ...album, provider, item_id: `${provider}-private-album`, uri: `${provider}://album/private-multi-album`,
    name: 'The same release', artists: [{ name: 'Metallica' }], external_ids: [['musicbrainz_albumid', '22222222-2222-4222-8222-222222222222']] }));
  const multiTracks = ['spotify', 'tidal'].map(provider => ({ ...track, provider, item_id: `${provider}-private-track`, uri: `${provider}://track/private-multi-track`,
    name: 'The same recording', artists: [{ ...track.artists[0]!, name: 'Metallica' }], album: { name: 'The same release' }, version: '',
    external_ids: [['musicbrainz_recordingid', '33333333-3333-4333-8333-333333333333']],
    provider_mappings: [{ item_id: `${provider}-private-track`, provider_domain: provider, available: provider === 'tidal' }] }));
  let catalogueMode = '';
  let metadataArtistName = 'Metallica';
  let itemNumber = 0;
  const primaryQueue = { queue_id: 'fixture-queue', available: true, active: true, items: 0, state: 'idle', ended: false,
    repeat_mode: 'all', autoplay_enabled: true, shuffle_enabled: true, is_dynamic: false, elapsed_time: 0, elapsed_time_last_updated: Date.now() / 1000, resume_pos: 0, current_item: null as null | { queue_item_id: string; media_item: Omit<typeof track, 'album'> & { album: { name: string } }; streamdetails?: { provider: string; item_id: string; audio_format?: Record<string, unknown> | null } }, next_item: null as unknown };
  const primaryPlayer = { player_id: 'sonos:room', available: true, type: 'player', supported_features: ['volume_set'], volume_control: 'native', volume_level: 30, group_volume: 40, group_members: [] as string[],
    playback_state: 'idle', active_source: null as string | null, active_group: null as string | null, synced_to: null as string | null };
  let speakers = [{ player_id: 'sonos:room', name: 'Living room', available: true }, { player_id: 'sonos:bedroom', name: 'Bedroom', available: true }, { player_id: 'sonos:offline', name: 'Offline room', available: false }];
  // Opt-in multi-queue model for handoff tests; legacy fixtures retain their single queue.
  let transfers = false;
  const queues = new Map<string, typeof primaryQueue>([[primaryQueue.queue_id, primaryQueue]]);
  const players = new Map<string, typeof primaryPlayer>([[primaryPlayer.player_id, primaryPlayer]]);
  let transferOutcome: 'normal' | 'source-cleared' | 'wrong-position' | 'wrong-source' | 'wrong-policy' = 'normal';
  let transferGate: { entered(): void; released: Promise<void> } | undefined;
  const addTransferSpeaker = (id: string, name: string, type = 'player') => {
    const queue: typeof primaryQueue = { ...structuredClone(primaryQueue), queue_id: id, current_item: null, items: 0, active: false, state: 'idle', elapsed_time: 0, resume_pos: 0, next_item: null, ended: false };
    const player: typeof primaryPlayer = { ...structuredClone(primaryPlayer), player_id: id, type, playback_state: 'idle', active_source: null, active_group: null, synced_to: null, volume_level: 55 };
    queues.set(id, queue); players.set(id, player);
    if (!speakers.some(p => p.player_id === id)) speakers.push({ player_id: id, name, available: true });
    return { queue, player };
  };
  function activeQueue(id: string, visited = new Set<string>()): typeof primaryQueue | undefined {
    if (visited.has(id)) return undefined;
    visited.add(id); const player = players.get(id);
    if (!player) return queues.get(id);
    const leader = player.synced_to || player.active_group;
    if (leader && leader !== id) return activeQueue(leader, visited);
    return queues.get(player.active_source || id) ?? (id === primaryPlayer.player_id ? primaryQueue : undefined);
  }
  let imageMode: 'png' | 'svg' | 'redirect' | 'oversized' = 'png';
  const imageCalls: string[] = [];
  let imageDelay = 0;
  let imageGate: { entered(): void; released: Promise<void> } | undefined;
  let nextVolumeDelay = 0;
  let volumeReadPending = false;
  let volumeClamp: number | undefined;
  const calls: { command: string; args: Record<string, unknown> }[] = [];
  const info = { server_id: randomUUID(), onboard_done: true, server_version: '2.fixture', schema_version: 65, min_supported_schema_version: 28 };
  const appToken = `fixture.${Buffer.from(JSON.stringify({ jti: 'fixture-app-token', exp: Math.floor(Date.now() / 1000) + 86400 * 365 })).toString('base64url')}.signature`;
  const authorizations = ['Bearer browser-test-token', 'Bearer fixture-token', 'Bearer browser-login-session', `Bearer ${appToken}`];
  let failed = false;
  const uploads = new Map<string, typeof track>();
  // Songs a test adds to the fixture album, after the fixture song: found by artist, album, then song, like any other.
  const extraTracks: (typeof track)[] = [];
  let uploadDuration = 180;
  let uploadMode: 'normal' | 'unreachable' | 'wrong-identity' | 'no-callback' = 'normal';
  let uploadDelay = 0;
  let failAfterPlay = false;
  let ignoredControl: 'pause' | 'resume' | 'stop' | undefined;
  let ignoredPolicy: 'autoplay' | 'repeat' | 'shuffle' | undefined;
  let queueGate: { entered(): void; result: Promise<boolean> } | undefined;
  let inventoryGate: { entered(): void; result: Promise<boolean> } | undefined;
  const readFailures = new Map<string, { remaining: number; status: number }>();
  let lostAcknowledgement: string | undefined;
  let applyLostCommand = true;
  let connections = 0;
  const requests: { path: string; port: number | undefined }[] = [];
  const events = new WebSocketServer({ noServer: true });
  const authenticated = new Set<WebSocket>();
  const websocketCommands: string[] = [];
  const notify = (event = 'queue_updated', object_id = primaryQueue.queue_id, data: unknown = primaryQueue) => {
    for (const socket of authenticated) if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ event, object_id, data }));
  };
  const server = createServer(async (req, res) => {
    requests.push({ path: req.url ?? '', port: req.socket.remotePort });
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/info') { res.end(JSON.stringify(info)); return; }
    if (req.url?.startsWith('/login?')) {
      const login = new URL(req.url, 'http://fixture'); const callback = new URL(login.searchParams.get('return_url')!); callback.searchParams.set('code', 'browser-login-session');
      res.setHeader('Content-Type', 'text/html'); res.setHeader('Referrer-Policy', 'no-referrer');
      res.end(`<h1>Music Assistant sign-in</h1><a href="${callback.href.replaceAll('&', '&amp;').replaceAll('"', '&quot;')}">Authorize Doom Room</a>`); return;
    }
    if (req.url === '/api-docs') { res.setHeader('Content-Type', 'text/html'); res.end('<h1>Fixture docs</h1>'); return; }
    if (req.url?.startsWith('/imageproxy/')) {
      imageCalls.push(req.url);
      const params = new URL(req.url, 'http://fixture').searchParams;
      // Match MA's actual imageproxy size allowlist, including rejection of the former 128px request.
      if (!['0', '80', '160', '256', '512', '1024'].includes(params.get('size') ?? '0')) { res.writeHead(400); res.end('Unsupported image size'); return; }
      if (imageGate) { const gate = imageGate; imageGate = undefined; gate.entered(); await gate.released; }
      if (imageDelay) await new Promise(resolve => setTimeout(resolve, imageDelay));
      if (!authorizations.includes(req.headers.authorization ?? '')) { res.writeHead(401); res.end(); return; }
      if (imageMode === 'redirect') { res.writeHead(302, { Location: 'http://169.254.169.254/private' }); res.end(); return; }
      if (imageMode === 'svg') { res.setHeader('Content-Type', 'image/svg+xml'); res.end('<svg><script>PRIVATE</script></svg>'); return; }
      if (imageMode === 'oversized') { res.end(Buffer.alloc(3 * 1024 * 1024)); return; }
      if (params.get('fmt') === 'jpeg') { res.setHeader('Content-Type', 'image/jpeg'); res.end(jpeg); return; }
      res.setHeader('Content-Type', 'image/png'); res.end(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZXkAAAAASUVORK5CYII=', 'base64')); return;
    }
    let raw = ''; for await (const chunk of req) raw += chunk;
    if (!authorizations.includes(req.headers.authorization ?? '')) { res.statusCode = 401; res.end('PRIVATE unauthorized details'); return; }
    const { command, args } = JSON.parse(raw); calls.push({ command, args });
    const queue = transfers ? args.queue_id ? queues.get(args.queue_id) ?? primaryQueue : activeQueue(args.player_id) ?? primaryQueue : primaryQueue;
    const player = transfers ? players.get(args.player_id ?? args.queue_id) ?? primaryPlayer : primaryPlayer;
    if (command === 'players/all' && inventoryGate) {
      const gate = inventoryGate; inventoryGate = undefined; gate.entered();
      const failed = await gate.result; res.statusCode = failed ? 503 : 200;
      res.end(failed ? 'PRIVATE synthetic inventory failure' : JSON.stringify(speakers)); return;
    }
    if (lostAcknowledgement === command && !applyLostCommand) { lostAcknowledgement = undefined; res.destroy(); return; }
    const readFailure = readFailures.get(command);
    if (readFailure && readFailure.remaining-- > 0) { res.statusCode = readFailure.status; res.end('PRIVATE synthetic read failure'); return; }
    if (command === 'player_queues/get_active_queue' && queueGate) {
      const gate = queueGate; queueGate = undefined;
      const snapshot = JSON.stringify(queue); gate.entered();
      res.statusCode = await gate.result ? 503 : 200; res.end(snapshot); return;
    }
    const volumeDelay = command === 'players/get' ? nextVolumeDelay : 0;
    if (volumeDelay) { nextVolumeDelay = 0; volumeReadPending = true; }
    if (queue.state === 'playing') queue.elapsed_time += Math.max(0, Date.now() / 1000 - queue.elapsed_time_last_updated);
    queue.elapsed_time_last_updated = Date.now() / 1000;
    if (failed) { res.statusCode = 503; res.end('PRIVATE connection details'); return; }
    if (ignoredControl && command === `player_queues/${ignoredControl}`) { res.end('null'); return; }
    if (ignoredPolicy && command === `player_queues/${ignoredPolicy}`) { res.end('null'); return; }
    let result: unknown = null;
    if (command === 'auth/token/create') result = appToken;
    else if (command === 'auth/token/revoke') result = null;
    else if (command === 'players/all') result = speakers;
    else if (command === 'providers') result = [{ domain: 'spotify', instance_id: 'spotify--private-instance', type: 'music', available: true }, { domain: 'builtin', type: 'music', available: true }, { domain: 'sonos', type: 'player', available: true }];
    else if (command === 'players/get') result = { ...player, player_id: args.player_id };
    else if (command === 'players/cmd/volume_set') player.volume_level = volumeClamp ?? args.volume_level;
    else if (command === 'players/cmd/group_volume') player.group_volume = volumeClamp ?? args.volume_level;
    else if (command === 'music/search') {
      if (args.search_query === 'failure') { res.statusCode = 503; res.end('PRIVATE FIXTURE ERROR'); return; }
      const actualNames = ['Metallica', 'Iron Maiden', 'Megadeth', 'Slayer'];
      catalogueMode = actualNames.includes(args.search_query) ? 'multi-provider-metadata' : args.search_query.startsWith('multi-provider') ? args.search_query : '';
      metadataArtistName = actualNames.includes(args.search_query) ? args.search_query : 'Metallica';
      if (catalogueMode) {
        const artists = catalogueMode === 'multi-provider-metadata' ? multiArtists.map(a => metadataOnly({ ...a, name: metadataArtistName }))
          : [...multiArtists, { ...multiArtists[1], item_id: 'private-other-artist', uri: 'tidal://artist/private-other-artist', external_ids: [['musicbrainz_artistid', '44444444-4444-4444-8444-444444444444']] }];
        const tracks = [...multiTracks, { ...multiTracks[0]!, item_id: 'private-live-track', uri: 'spotify://track/private-live-track', version: 'Live' }];
        result = args.media_types[0] === 'artist' ? { artists } : { tracks: catalogueMode === 'multi-provider-metadata' ? tracks.map(metadataOnly) : tracks };
      }
      else result = args.media_types[0] === 'artist' ? { artists: args.search_query === 'empty' ? [] : [artist] } : { tracks: args.search_query === 'empty' ? [] : [track] };
    } else if (command === 'music/artists/artist_albums') {
      if (catalogueMode === 'multi-provider-failure' || (catalogueMode === 'multi-provider-partial' && args.provider_instance_id_or_domain === 'tidal')) {
        res.statusCode = 503; res.end('PRIVATE SOURCE FAILURE'); return;
      }
      const provider = args.provider_instance_id_or_domain;
      const selected = multiAlbums.find(a => a.provider === provider)!;
      const albums = [selected, { ...selected, item_id: `${provider}-private-exclusive`, uri: `${provider}://album/private-exclusive`, name: `${provider} exclusive`, external_ids: [] }];
      result = catalogueMode ? catalogueMode.startsWith('multi-provider-metadata') ? albums.map(metadataOnly) : albums : [album];
    }
    else if (command === 'music/albums/album_tracks' && args.item_id === 'fixture-album-full') result = [track, albummate];
    else if (command === 'music/albums/album_tracks') {
      const tracks = multiTracks.filter(t => t.provider === args.provider_instance_id_or_domain);
      result = catalogueMode ? catalogueMode.startsWith('multi-provider-metadata') ? tracks.map(metadataOnly) : tracks : [track, ...extraTracks];
    }
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
    else if (command === 'music/item_by_uri') result = [...multiTracks, albummate, ...extraTracks].find(t => t.uri === args.uri) ?? track;
    else if (command === 'player_queues/get_active_queue') result = transfers ? activeQueue(args.player_id) ?? null : queue;
    else if (command === 'player_queues/get') result = queues.get(args.queue_id) ?? null;
    else if (command === 'player_queues/transfer' && transfers) {
      const source = queues.get(args.source_queue_id); const target = queues.get(args.target_queue_id); const targetPlayer = players.get(args.target_queue_id);
      if (!source || !target || !targetPlayer || source === target) { res.statusCode = 400; res.end('Invalid transfer'); return; }
      const position = Math.floor(source.state === 'playing' ? source.elapsed_time : source.resume_pos);
      const copy = structuredClone(source);
      Object.assign(source, { state: 'idle', active: false, items: 0, current_item: null, next_item: null, elapsed_time: 0, ended: false });
      const sourcePlayer = [...players.values()].find(p => p.player_id === source.queue_id || p.active_source === source.queue_id) ?? primaryPlayer;
      sourcePlayer.playback_state = 'idle'; sourcePlayer.active_source = null;
      notify('queue_updated', source.queue_id, source);
      if (transferGate) { const gate = transferGate; transferGate = undefined; gate.entered(); await gate.released; }
      if (transferOutcome === 'source-cleared') { res.statusCode = 503; res.end('Synthetic partial transfer'); return; }
      Object.assign(target, copy, { queue_id: target.queue_id, state: args.auto_play ? 'playing' : 'idle', active: Boolean(args.auto_play),
        elapsed_time: transferOutcome === 'wrong-position' ? 0 : position, elapsed_time_last_updated: Date.now() / 1000, resume_pos: position });
      if (transferOutcome === 'wrong-source' && target.current_item?.streamdetails) target.current_item.streamdetails.item_id = 'unverified-transfer-source';
      if (transferOutcome === 'wrong-policy') target.autoplay_enabled = true;
      targetPlayer.synced_to = null; targetPlayer.active_group = null;
      targetPlayer.playback_state = target.state; targetPlayer.active_source = args.auto_play ? target.queue_id : null;
      notify('queue_updated', target.queue_id, target);
    }
    else if (command === 'player_queues/items') result = queue.current_item ? [queue.current_item] : [];
    else if (command === 'player_queues/autoplay') queue.autoplay_enabled = args.autoplay_enabled;
    else if (command === 'player_queues/clear') {
      if (queue.state !== 'idle' || args.skip_stop !== true) { res.statusCode = 400; res.end('Stop before clearing'); return; }
      queue.items = 0; queue.current_item = null; queue.next_item = null; queue.is_dynamic = false; queue.shuffle_enabled = false;
    }
    else if (command === 'player_queues/repeat') {
      if (queue.is_dynamic) { res.statusCode = 500; res.end('Dynamic repeat locked'); return; }
      queue.repeat_mode = args.repeat_mode;
    }
    else if (command === 'player_queues/shuffle') {
      if (queue.is_dynamic) { res.statusCode = 500; res.end('Dynamic shuffle locked'); return; }
      queue.shuffle_enabled = args.shuffle_enabled;
    }
    else if (command === 'player_queues/play_media') {
      const selected = args.media?.[0] === track.uri ? track : [...multiTracks, ...extraTracks].find(t => t.uri === args.media?.[0]) ?? uploads.get(args.media?.[0]);
      if (!selected || args.option !== 'replace' || args.media.length !== 1) { res.statusCode = 400; res.end('Wrong recording or queue option'); return; }
      queue.items = 1; queue.current_item = { queue_item_id: `fixture-item-${++itemNumber}`, media_item: { ...selected },
        streamdetails: { provider: selected.provider, item_id: selected.item_id } };
      queue.state = 'playing'; queue.active = true; queue.ended = false; queue.next_item = null;
      player.playback_state = 'playing'; player.active_source = queue.queue_id;
      queue.elapsed_time = 0;
      if (failAfterPlay) { failed = true; failAfterPlay = false; }
    } else if (command === 'player_queues/stop') { queue.state = 'idle'; queue.ended = false; player.playback_state = 'idle'; player.active_source = null; }
    else if (command === 'player_queues/pause') { queue.resume_pos = queue.elapsed_time; queue.state = 'paused'; player.playback_state = 'paused'; }
    else if (command === 'player_queues/resume') { queue.state = 'playing'; queue.active = true; queue.elapsed_time = queue.resume_pos; player.playback_state = 'playing'; player.active_source = queue.queue_id; }
    else if (command === 'player_queues/seek') {
      // As in MA: only an active queue with a known-length item; the seek restarts it playing.
      const duration = queue.current_item?.media_item?.duration;
      if (!queue.active || !queue.current_item || !duration || !Number.isInteger(args.position) || args.position < 0 || args.position > duration) { res.statusCode = 500; res.end('Can not seek'); return; }
      queue.elapsed_time = args.position; queue.elapsed_time_last_updated = Date.now() / 1000; queue.state = 'playing'; player.playback_state = 'playing';
    }
    else { res.statusCode = 400; res.end('Unexpected command'); return; }
    if (volumeDelay) { await new Promise(resolve => setTimeout(resolve, volumeDelay)); volumeReadPending = false; }
    if (lostAcknowledgement === command) { lostAcknowledgement = undefined; res.destroy(); }
    else res.end(JSON.stringify(result));
    if (/^player_queues\/(play_media|pause|resume|stop|seek|autoplay|repeat|shuffle)$/.test(command)) notify('queue_updated', queue.queue_id, queue);
    if (command.startsWith('players/cmd/')) notify('player_updated', player.player_id);
  });
  server.on('upgrade', (request, socket, head) => {
    if (request.url !== '/ws') { socket.destroy(); return; }
    events.handleUpgrade(request, socket, head, client => {
      client.send(JSON.stringify(info));
      client.on('message', raw => {
        const message = JSON.parse(raw.toString()); websocketCommands.push(message.command);
        if (message.command !== 'auth' || !authorizations.includes(`Bearer ${message.args?.token}`)) { client.close(); return; }
        authenticated.add(client); client.send(JSON.stringify({ message_id: message.message_id, result: { authenticated: true } }));
      });
      client.on('close', () => authenticated.delete(client));
    });
  });
  server.on('connection', () => { connections++; });
  server.listen(port, '127.0.0.1'); await once(server, 'listening');
  return { origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, calls, info, queue: primaryQueue, track, player: primaryPlayer, imageCalls,
    enableTransfers() { transfers = true; info.server_version = '2.10.9'; return addTransferSpeaker('sonos:bedroom', 'Bedroom'); },
    addTransferSpeaker, transferOutcome(value: typeof transferOutcome) { transferOutcome = value; },
    holdNextTransfer() {
      let enter!: () => void; let release!: () => void;
      const entered = new Promise<void>(resolve => { enter = resolve; });
      const released = new Promise<void>(resolve => { release = resolve; });
      transferGate = { entered: enter, released }; return { entered, release };
    },
    requests, get connections() { return connections; },
    websocketCommands, get eventClients() { return authenticated.size; },
    notify, disconnectEvents() { for (const client of events.clients) client.terminate(); },
    failReads(command: 'player_queues/get_active_queue' | 'player_queues/items' | 'players/get' | 'player_queues/clear' | 'player_queues/get' | 'player_queues/transfer', count = 1, status = 503) {
      readFailures.set(command, { remaining: count, status });
    },
    loseAcknowledgement(command: 'player_queues/play_media' | 'player_queues/pause' | 'player_queues/resume' | 'player_queues/stop' | 'player_queues/transfer', apply = true) {
      lostAcknowledgement = command; applyLostCommand = apply;
    },
    holdNextQueueRead() {
      let enter!: () => void; let release!: (failed?: boolean) => void;
      const entered = new Promise<void>(resolve => { enter = resolve; });
      const result = new Promise<boolean>(resolve => { release = (failed = false) => resolve(failed); });
      queueGate = { entered: enter, result }; return { entered, release };
    },
    holdNextInventoryRead() {
      let enter!: () => void; let release!: (failed?: boolean) => void;
      const entered = new Promise<void>(resolve => { enter = resolve; });
      const result = new Promise<boolean>(resolve => { release = (failed = false) => resolve(failed); });
      inventoryGate = { entered: enter, result }; return { entered, release };
    },
    imageMode(mode: typeof imageMode) { imageMode = mode; },
    holdNextImageRead() {
      let enter!: () => void; let release!: () => void;
      const entered = new Promise<void>(resolve => { enter = resolve; });
      const released = new Promise<void>(resolve => { release = resolve; });
      imageGate = { entered: enter, released }; return { entered, release };
    },
    /** Adds songs to the fixture album ("Fixture artist" → "Fixture album"); each one plays like the fixture song. */
    addTracks(songs: { title: string; artist?: string; album?: string; duration?: number }[]) {
      return songs.map(song => {
        const id = `extra-track-${extraTracks.length + 1}`;
        const added: typeof track = { ...structuredClone(track), item_id: id, uri: `spotify://track/${id}`, name: song.title, version: '', duration: song.duration ?? track.duration,
          artists: [{ ...track.artists[0]!, name: song.artist ?? track.artists[0]!.name }], album: { ...track.album, name: song.album ?? track.album.name },
          provider_mappings: [{ item_id: id, provider_domain: 'spotify', available: true }] };
        extraTracks.push(added); return added;
      });
    },
    delayImages(ms: number) { imageDelay = ms; },
    delayNextVolumeRead(ms: number) { nextVolumeDelay = ms; },
    get volumeReadPending() { return volumeReadPending; },
    clampVolume(level: number) { volumeClamp = level; },
    parkPaused() { primaryQueue.state = 'idle'; primaryQueue.active = false; primaryQueue.ended = false; primaryQueue.elapsed_time = 0; primaryPlayer.playback_state = 'idle'; primaryPlayer.active_source = null; },
    finish() { primaryQueue.state = 'idle'; primaryQueue.ended = true; notify(); }, fail(value: boolean) { failed = value; },
    setSpeakers(next: typeof speakers, emit = true) {
      const previous = speakers; speakers = structuredClone(next);
      if (emit) {
        for (const speaker of previous) if (!speakers.some(p => p.player_id === speaker.player_id)) notify('player_removed', speaker.player_id, null);
        for (const speaker of speakers) notify(previous.some(p => p.player_id === speaker.player_id) ? 'player_updated' : 'player_added', speaker.player_id, speaker);
      }
    },
    failNextPlaybackVerification() { failAfterPlay = true; },
    ignoreControl(action: typeof ignoredControl) { ignoredControl = action; },
    ignorePolicy(action: typeof ignoredPolicy) { ignoredPolicy = action; },
    uploadedDuration(duration: number) { uploadDuration = duration; },
    uploadedMode(mode: typeof uploadMode) { uploadMode = mode; },
    delayUploads(ms: number) { uploadDelay = ms; },
    close() { for (const client of events.clients) client.terminate(); events.close(); server.closeAllConnections(); server.close(); } };
}
