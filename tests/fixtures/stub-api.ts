import type { MusicAssistantApi } from '../../src/music-assistant.js';

/** A Music Assistant client with only the methods a test cares about; any other API call fails loudly.
 * Optional hooks stay absent: `close` is skipped when missing, and `then` would make the stub look like a promise. */
export function stubApi(methods: Partial<Record<keyof MusicAssistantApi, unknown>>): MusicAssistantApi {
  return new Proxy(methods, {
    get: (target, key) => key in target ? Reflect.get(target, key)
      : key === 'close' || key === 'then' || typeof key === 'symbol' ? undefined
      : async () => { throw new Error(`Not used: ${String(key)}`); },
  }) as unknown as MusicAssistantApi;
}
