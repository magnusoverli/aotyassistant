import { isViewingDistance, viewingDistances, type ViewingDistance } from '../src/viewing-distance';

export const displaySizeKey = 'doom-room.display-size';
type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** Sizes chosen in 2.0.12 were saved as numbers. 100% was that release's default, so it
 * follows the room's setting like a screen that never chose. */
function saved(value: string | null): ViewingDistance | undefined {
  if (isViewingDistance(value)) return value;
  const scale = value === null || value.trim() === '' ? NaN : Number(value);
  return viewingDistances.find(distance => distance.scale === scale && distance.scale !== 1)?.id;
}

/** One screen can sit closer or further than the rest of the room. Its own choice belongs
 * to this browser; without one, the screen follows the room's setting. */
export class DisplaySize {
  private value: ViewingDistance | undefined;
  constructor(private storage: () => Storage = () => localStorage) {
    try { this.value = saved(storage().getItem(displaySizeKey)); }
    catch { /* Storage may be blocked; the room's setting still applies. */ }
  }
  get current() { return this.value; }
  /** `undefined` goes back to following the room. */
  set(value: ViewingDistance | undefined) {
    if (value !== undefined && !isViewingDistance(value)) return;
    this.value = value;
    try { if (value) this.storage().setItem(displaySizeKey, value); else this.storage().removeItem(displaySizeKey); }
    catch { /* Keep the choice for this document even if it cannot be saved. */ }
  }
}
