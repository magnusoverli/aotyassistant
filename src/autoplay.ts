import type { Engine } from './engine.js';
import type { PreparationManager } from './preparations.js';
import type { UserManager } from './users.js';

/** Automatic play: when a song ends and the turn passes, start the next person's first saved song,
 * exactly as their own Play first selection would. Anything that prevents it (the setting switched
 * off, an empty list, a pending review, a disconnected source or speaker, a changed turn) leaves
 * the turn with them to choose as usual. */
export function attachAutoplay(engine: Engine, lists: PreparationManager, users: Pick<UserManager, 'listOwner' | 'ownerAvailable'>) {
  engine.attachAutoplay(async target => {
    const ownerId = users.listOwner(target.userId); if (!ownerId) return;
    await lists.playFirstFor(ownerId, { available: () => users.ownerAvailable(ownerId), ready: () => engine.autoplayReady(target) },
      (selection, entryId) => engine.autoplay(target, selection, entryId));
  });
}
