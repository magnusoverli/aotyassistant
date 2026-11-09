import { type SendspinStorage } from '@sendspin/sendspin-js';
import { AutomaticAudioPlayer } from './sendspin-extension';
import { appPath, inIngress, isPublic } from './paths';
import { lanAudio, onlineAudio } from './audio-policy';
import { requestJson } from './request';
import { operationId } from './preparation-controller';
import { BrowserSpeakerRuntime } from './browser-speaker-runtime';
import { browserDevice } from './browser-device';
import { browserSpeakerName } from '../src/browser-speaker-name';

let speaker: BrowserSpeakerRuntime | undefined;
export function initializeBrowserSpeaker() {
  if (inIngress()) return;
  if (speaker) return speaker;
  const device = browserDevice(navigator);
  speaker = new BrowserSpeakerRuntime({
    request: (path, data) => requestJson(path, data, 30_000), id: operationId, device,
    schedule: (work, delay) => { const timer = setTimeout(work, delay); return () => clearTimeout(timer); },
    create: (id, scope, reconnected, exhausted) => {
      const prefix = `aoty.sendspin:${scope}:`;
      const storage: SendspinStorage = { getItem: key => localStorage.getItem(prefix + key), setItem: (key, value) => localStorage.setItem(prefix + key, value) };
      const name = browserSpeakerName(device);
      const url = new URL(appPath(`/api/browser-speaker/socket?id=${id}`), location.origin); url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
      return new AutomaticAudioPlayer({ url: url.href, clientName: name, productName: 'Web Player', manufacturer: 'Listening Room', storage,
        unpairedAccess: false, reconnect: { maxAttempts: 6, onReconnected: reconnected, onExhausted: exhausted } }, exhausted,
        undefined, isPublic() ? onlineAudio : lanAudio);
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
