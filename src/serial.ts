/** FIFO work lanes. A rejected operation never poisons later work; nothing is retried. */
export class SerialQueue {
  private tail: Promise<unknown> = Promise.resolve();

  run<T>(work: () => Promise<T>): Promise<T> {
    const result = this.tail.then(work);
    this.tail = result.catch(() => {});
    return result;
  }
}

/** Independent lanes for owners/assets; idle keys are released rather than retained forever. */
export class KeyedSerialQueue {
  private tails = new Map<string, Promise<void>>();

  has(key: string) { return this.tails.has(key); }

  run<T>(key: string, work: () => Promise<T>): Promise<T> {
    const result = (this.tails.get(key) ?? Promise.resolve()).then(work);
    const tail = result.then(() => {}, () => {});
    this.tails.set(key, tail);
    void tail.then(() => { if (this.tails.get(key) === tail) this.tails.delete(key); });
    return result;
  }
}
