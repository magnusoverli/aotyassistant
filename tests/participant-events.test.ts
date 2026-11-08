import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ParticipantEvents } from '../web/participant-events.js';

class FakeSource {
  static opened: FakeSource[] = [];
  closed = false; onerror: (() => void) | null = null;
  constructor(readonly url: string) { FakeSource.opened.push(this); }
  addEventListener() {}
  close() { this.closed = true; }
}

test('a held connection opens once, in its final form, after both feeds subscribe', t => {
  const globals = globalThis as unknown as { EventSource?: unknown; navigator?: unknown };
  const previous = { EventSource: globals.EventSource, navigator: globals.navigator };
  globals.EventSource = FakeSource; Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true });
  t.after(() => { globals.EventSource = previous.EventSource; Object.defineProperty(globalThis, 'navigator', { value: previous.navigator, configurable: true }); });
  FakeSource.opened = [];
  const events = new ParticipantEvents(); const listener = { state() {}, revoked() {} };
  const release = events.hold();
  const library = events.subscribe('library', listener); events.subscribe('room', listener);
  assert.equal(FakeSource.opened.length, 0, 'Nothing opens while membership is unknown.');
  release(); release();
  assert.deepEqual(FakeSource.opened.map(source => source.url), ['/api/participant/preparations/live']);
  library(); assert.equal(FakeSource.opened.length, 1, 'Leaving the list keeps the room connection.');
  const second = events.hold(); events.subscribe('library', listener); second();
  assert.equal(FakeSource.opened.length, 2, 'A new list subscriber reconnects for a fresh snapshot after release.');
});
