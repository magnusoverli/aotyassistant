/** Least-recently-used cache bounded by entry count and a caller-defined size (e.g. bytes). */
export class BoundedCache<T> {
  private entries = new Map<string, { value: T; expires: number; size: number }>();
  private size = 0;
  constructor(private maxEntries: number, private maxSize = Infinity, private now = Date.now) {}

  /** A live entry, marked as recently used. Expired entries are dropped. */
  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    this.delete(key);
    if (entry.expires <= this.now()) return undefined;
    this.entries.set(key, entry); this.size += entry.size;
    return entry.value;
  }

  set(key: string, value: T, options: { expires?: number; size?: number } = {}) {
    this.delete(key);
    const entry = { value, expires: options.expires ?? Infinity, size: options.size ?? 0 };
    this.entries.set(key, entry); this.size += entry.size;
    while (this.entries.size > this.maxEntries || this.size > this.maxSize) this.delete(this.entries.keys().next().value!);
  }

  delete(key: string) {
    const entry = this.entries.get(key);
    if (entry) { this.size -= entry.size; this.entries.delete(key); }
  }
}
