import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initializeBrowserSpeaker } from '../web/browser-speaker.js';
import { inIngress, isPublic } from '../web/paths.js';

test('Ingress never initializes browser audio, including repeated initialization from an older entry point', t => {
  let base = '/api/hassio_ingress/fixture'; let publicPage = '';
  const original = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: {
    querySelector: (selector: string) => ({ content: selector === 'meta[name="doom-room-base"]' ? base : publicPage }),
    addEventListener: () => assert.fail('Ingress must not install audio unlock handlers.'),
  } });
  t.after(() => { if (original) Object.defineProperty(globalThis, 'document', original); else Reflect.deleteProperty(globalThis, 'document'); });
  assert.equal(inIngress(), true);
  assert.equal(initializeBrowserSpeaker(), undefined);
  assert.equal(initializeBrowserSpeaker(), undefined);
  base = ''; assert.equal(inIngress(), false); assert.equal(isPublic(), false, 'Direct LAN remains outside Ingress.');
  publicPage = '1'; assert.equal(inIngress(), false); assert.equal(isPublic(), true, 'Funnel remains outside Ingress.');
});
