import { SendspinPlayer, type SendspinStorage } from '@sendspin/sendspin-js';
import { appPath } from './paths';
import { requestJson } from './request';
import { operationId } from './preparation-controller';
import { BrowserSpeakerRuntime } from './browser-speaker-runtime';

let speaker: BrowserSpeakerRuntime | undefined;
export function initializeBrowserSpeaker() {
  if (speaker) return speaker;
  const browser = /Firefox\//.test(navigator.userAgent) ? 'Firefox' : /Edg\//.test(navigator.userAgent) ? 'Edge'
    : /Chrome\//.test(navigator.userAgent) ? 'Chrome' : /Safari\//.test(navigator.userAgent) ? 'Safari' : 'browser';
  const name = `Listening Room (${browser})`;
  speaker = new BrowserSpeakerRuntime({
    request: (path, data) => requestJson(path, data, 30_000), id: operationId, name,
    schedule: (work, delay) => { const timer = setTimeout(work, delay); return () => clearTimeout(timer); },
    create: (id, scope, reconnected, exhausted) => {
      const prefix = `aoty.sendspin:${scope}:`;
      const storage: SendspinStorage = { getItem: key => localStorage.getItem(prefix + key), setItem: (key, value) => localStorage.setItem(prefix + key, value) };
      const url = new URL(appPath(`/api/browser-speaker/socket?id=${id}`), location.origin); url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
      return new SendspinPlayer({ url: url.href, clientName: name, productName: 'Web Player', manufacturer: 'Listening Room', storage,
        codecs: ['pcm'], unpairedAccess: false, reconnect: { maxAttempts: 6, onReconnected: reconnected, onExhausted: exhausted } });
    },
  });
  const runtime = speaker;
  // Normal interaction supplies the browser gesture; no extra audio controls.
  document.addEventListener('click', () => runtime.unlock(), { capture: true });
  document.addEventListener('keydown', () => runtime.unlock(), { capture: true });
  window.addEventListener('online', () => runtime.wake());
  window.addEventListener('pagehide', () => runtime.stop());
  window.addEventListener('pageshow', event => { if (event.persisted) runtime.start(); });
  runtime.start(); return runtime;
}
