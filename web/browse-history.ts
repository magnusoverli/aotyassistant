/** Private browse snapshots live only in memory. Browser history contains a local key. */
export class BrowseHistory<T> {
  private snapshots = new Map<number, T>();
  private key = 0;
  private current = 0;
  constructor(private read: () => T, private restore: (snapshot: T | undefined) => void) {
    history.scrollRestoration = 'manual';
    window.addEventListener('popstate', this.pop);
  }
  remember() { if (this.current) this.snapshots.set(this.current, this.read()); }
  reset() {
    this.snapshots.clear(); this.current = ++this.key;
    this.snapshots.set(this.current, this.read());
    history.replaceState({ aotyBrowse: this.current }, '');
  }
  push() {
    this.current = ++this.key; this.snapshots.set(this.current, this.read());
    if (this.snapshots.size > 40) this.snapshots.delete(this.snapshots.keys().next().value!);
    history.pushState({ aotyBrowse: this.current }, '');
  }
  back() { this.remember(); history.back(); }
  destroy() { window.removeEventListener('popstate', this.pop); }
  private pop = (event: PopStateEvent) => {
    const key = event.state?.aotyBrowse;
    if (key === this.current) return;
    this.remember(); this.current = typeof key === 'number' ? key : 0;
    this.restore(this.snapshots.get(this.current));
  };
}
