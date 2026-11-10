export const displaySizes = [
  { value: .85, label: 'Compact (85%)' },
  { value: 1, label: 'Automatic (100%)' },
  { value: 1.25, label: 'Larger (125%)' },
  { value: 1.5, label: 'Largest (150%)' },
] as const;
export const displaySizeKey = 'doom-room.display-size';
type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'>;

/** A viewing-distance preference belongs to this browser, not every room display. */
export class DisplaySize {
  private value = 1;
  constructor(private storage: () => Storage = () => localStorage) {
    try {
      const saved = Number(storage().getItem(displaySizeKey));
      if (displaySizes.some(size => size.value === saved)) this.value = saved;
    } catch { /* Storage may be blocked; automatic sizing still works. */ }
  }
  get current() { return this.value; }
  set(value: number) {
    if (!displaySizes.some(size => size.value === value)) return;
    this.value = value;
    try { this.storage().setItem(displaySizeKey, String(value)); }
    catch { /* Keep the adjustment for this document even if it cannot be saved. */ }
  }
}
