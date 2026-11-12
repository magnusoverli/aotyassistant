import type { CatalogueBrowse } from '../../src/model.js';
import type { Engine } from '../../src/engine.js';

/** Finds a track the only way the app offers: an artist search, one of their albums, then a song. */
export async function findTrack(engine: Pick<Engine, 'browse'>, credential: string, artist = 'fixture') {
  const [found] = (await engine.browse(credential, 'artists', artist)).artists ?? [];
  if (!found) throw new Error(`No artist found for "${artist}".`);
  const [album] = (await engine.browse(credential, 'albums', found.id)).albums ?? [];
  if (!album) throw new Error(`No album found for "${found.name}".`);
  const [track] = (await engine.browse(credential, 'tracks', album.id)).tracks ?? [];
  if (!track) throw new Error(`No track found on "${album.name}".`);
  return track;
}

type Browser = { browse(kind: 'artists' | 'albums' | 'tracks', value: string, context: string): Promise<CatalogueBrowse> };
/** The same path through the integration manager, for tests below the engine. */
export async function findCatalogueTrack(manager: Browser, context: string, artist = 'fixture') {
  const [found] = (await manager.browse('artists', artist, context)).artists ?? [];
  if (!found) throw new Error(`No artist found for "${artist}".`);
  const [album] = (await manager.browse('albums', found.id, context)).albums ?? [];
  if (!album) throw new Error(`No album found for "${found.name}".`);
  return (await manager.browse('tracks', album.id, context)).tracks ?? [];
}
