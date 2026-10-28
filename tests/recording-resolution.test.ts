import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MusicAssistantClient } from '../src/music-assistant.js';

const mapping = (provider: string) => ({ provider_domain: provider, provider_instance: `${provider}--account`, item_id: `${provider}-track`, available: true });
const track = (provider: string) => ({ provider, item_id: `${provider}-track`, uri: `${provider}://track/${provider}-track`,
  name: 'Selected song', version: '', artists: [{ name: 'Selected artist' }], album: { name: 'Selected release' }, duration: 180,
  media_type: 'track', external_ids: [['isrc', 'USABC2612345']], provider_mappings: [mapping(provider)] });

test('canonical MA library responses save and resolve while preserving recording identity across fresh clients', async () => {
  const library = { ...track('spotify'), provider: 'library', item_id: '42', uri: 'library://track/42', provider_mappings: [mapping('spotify'), mapping('tidal')] };
  let changed = false;
  const transport = { async read(_path: unknown, command?: string) {
    return command === 'music/search' ? { tracks: [library] } : changed ? { ...library, version: 'Live' } : library;
  } };
  const client = new MusicAssistantClient('http://localhost:8095', 'SECRET', 8000, transport);
  const result = (await client.search('selected'))[0]!;
  assert.equal(result.available, true);
  const saved = await client.captureTrack(result.id); assert.equal(saved.recording.identity?.provider, 'library');
  assert.equal(saved.recording.equivalents?.length, 1); client.close();
  const restored = new MusicAssistantClient('http://localhost:8095', 'SECRET', 8000, transport);
  const resolved = await restored.resolveRecording(saved.recording);
  assert.equal(resolved.track.title, 'Selected song');
  assert.ok(resolved.allowedSources?.some(source => source.provider === 'tidal--account' && source.itemId === 'tidal-track'));
  changed = true; await assert.rejects(restored.resolveRecording(saved.recording), /No alternative recording was substituted/);
  restored.close();
});

test('automatic resolution uses a verified available equivalent and never resolves a merely same-title different edition', async () => {
  const calls: string[] = []; const spotify = track('spotify'); const tidal = { ...track('tidal'), duration: 181 };
  const client = new MusicAssistantClient('http://localhost:8095', 'SECRET', 8000, { async read(_path, command, args = {}) {
    calls.push(command!);
    if (command === 'music/search') return { tracks: [spotify, tidal, { ...tidal, version: 'Live' }] };
    return (args as { uri: string }).uri.startsWith('spotify:') ? { ...spotify, is_playable: false } : tidal;
  } });
  const results = await client.search('selected'); assert.equal(results.length, 2);
  const saved = await client.captureTrack(results[0]!.id);
  const resolved = await client.resolveRecording(saved.recording);
  assert.equal(resolved.provider, 'tidal'); assert.equal(resolved.track.title, 'Selected song');
  assert.ok(calls.every(command => command.startsWith('music/'))); client.close();
});

test('ID-less canonical mappings remain valid across save/restart and retain newly discovered equivalents', async () => {
  const source = { ...track('spotify'), external_ids: [] };
  const library = { ...source, provider: 'library', item_id: '42', uri: 'library://track/42', provider_mappings: [mapping('spotify'), mapping('tidal')] };
  let spotifyGone = false;
  const transport = { async read(_path: unknown, command?: string, args: Record<string, unknown> = {}) {
    if (command === 'music/search') return { tracks: [source] };
    if (spotifyGone && String(args.uri).startsWith('spotify:')) throw Error('Unavailable');
    return library;
  } };
  const client = new MusicAssistantClient('http://localhost:8095', 'SECRET', 8000, transport);
  const saved = await client.captureTrack((await client.search('selected'))[0]!.id); client.close();
  assert.ok(saved.recording.equivalents?.some(ref => ref.provider === 'tidal--account'));
  spotifyGone = true;
  const restored = new MusicAssistantClient('http://localhost:8095', 'SECRET', 8000, transport);
  assert.equal((await restored.resolveRecording(saved.recording)).provider, 'tidal--account');
  restored.close();
});
