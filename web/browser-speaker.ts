import { SendspinPlayer, type SendspinStorage } from '@sendspin/sendspin-js';
import type { BrowserSpeakerView } from '../src/browser-speakers';
import { appPath } from './paths';
import { requestJson, RequestError } from './request';
import { el } from './dom';
import { operationId } from './preparation-controller';

/** Owned by the application shell, never by a mounted route. No queue/control commands. */
export class BrowserSpeaker {
  private player?: SendspinPlayer;
  private session?: BrowserSpeakerView;
  private scope = '';
  private generation = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private loading = false;
  private failures = 0;
  private status = 'Enable this browser, then choose it as the room speaker in Playback settings.';
  private dialog = el('dialog', undefined, 'browser-speaker-dialog');
  private message = el('p');
  private name = el('input');
  private enable = el('button', 'Use this device as a speaker');
  private resume = el('button', 'Enable audio', 'secondary');
  private stop = el('button', 'Disable browser speaker', 'secondary');
  constructor() {
    this.dialog.setAttribute('aria-labelledby', 'browser-speaker-title');
    const title = el('h2', 'Browser speaker'); title.id = 'browser-speaker-title';
    const label = el('label', 'Speaker name'); this.name.id = 'browser-speaker-name'; label.htmlFor = this.name.id;
    this.name.value = 'Listening Room browser'; this.name.maxLength = 60;
    const close = el('button', 'Close', 'secondary'); close.onclick = () => this.dialog.close();
    this.message.setAttribute('role', 'status');
    this.enable.onclick = () => this.start();
    this.resume.onclick = () => { void this.player?.unlock().then(() => this.update('Audio enabled. Keep this tab open.')).catch(() => this.update('Audio is blocked. Allow sound for this site and try again.')); };
    this.stop.onclick = () => this.disable();
    const actions = el('div', undefined, 'actions'); actions.append(this.enable, this.resume, this.stop, close);
    this.dialog.append(title, label, this.name, this.message,
      el('p', 'Approve only a trusted output device: Sendspin gives it access to track details and playback capabilities. Music continues while navigating within Listening Room. Reloading or closing this tab stops its audio.', 'muted small'), actions);
    document.body.append(this.dialog);
    window.addEventListener('pagehide', () => this.disable());
    this.render();
  }
  show() {
    if (!this.dialog.open) this.dialog.showModal();
    if (!this.player && !this.loading) {
      this.loading = true; this.scope = ''; this.render();
      void requestJson<{ scope: string }>('/api/browser-speaker/info').then(info => { this.scope = info.scope; })
        .catch(error => this.update(error instanceof Error ? error.message : 'Browser audio is unavailable.'))
        .finally(() => { this.loading = false; this.render(); });
    }
  }
  private update(message: string) { this.status = message; this.render(); }
  private render() {
    this.message.textContent = this.status;
    this.enable.disabled = this.loading || !this.scope || Boolean(this.player);
    this.name.disabled = Boolean(this.player);
    this.resume.hidden = this.stop.hidden = !this.player;
  }
  private start() {
    if (this.player || !this.scope) return;
    const name = this.name.value.trim(); if (!name) { this.name.focus(); return; }
    const generation = ++this.generation;
    this.failures = 0;
    try {
      const id = operationId();
      const prefix = `aoty.sendspin:${this.scope}:`;
      const storage: SendspinStorage = { getItem: key => localStorage.getItem(prefix + key), setItem: (key, value) => localStorage.setItem(prefix + key, value) };
      const url = new URL(appPath(`/api/browser-speaker/socket?id=${id}`), location.origin); url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const player = new SendspinPlayer({ url: url.href, clientName: name, productName: 'Web Player', manufacturer: 'Listening Room', storage,
        codecs: ['pcm'], unpairedAccess: false,
        reconnect: { maxAttempts: 6,
          onReconnecting: () => { if (generation === this.generation) this.update('Reconnecting browser audio…'); },
          onReconnected: () => { if (generation === this.generation) this.update('Browser audio reconnected.'); },
          onExhausted: () => this.fail(generation, 'Audio connection lost. Enable this browser speaker again to retry.') } });
      this.player = player;
      // Must be called synchronously from this click, before registration or pairing awaits.
      const unlocked = player.unlock();
      this.update('Enabling browser audio…');
      void (async () => {
        await unlocked;
        if (generation !== this.generation) return;
        const session = await requestJson<BrowserSpeakerView>('/api/browser-speaker/register', { id, clientId: player.clientId, name });
        if (generation !== this.generation) { void requestJson('/api/browser-speaker/stop', { id }).catch(() => {}); return; }
        this.session = session;
        if (!session.approved) this.update(`Ask the host to approve ${name} with code ${session.code} in Settings → Playback → Browser speakers.`);
        await this.check(generation, true);
      })().catch(error => this.fail(generation, error instanceof Error ? error.message : 'Browser audio could not start.'));
    } catch { this.fail(generation, 'This browser cannot enable audio or save its speaker identity. Allow site storage and use a current browser over HTTPS.'); }
  }
  private async check(generation: number, first = false): Promise<void> {
    if (generation !== this.generation || !this.player || !this.session) return;
    const player = this.player;
    let pairing = false;
    try {
      const next = first ? this.session : await requestJson<BrowserSpeakerView>(`/api/browser-speaker/session/${this.session.id}`);
      if (generation !== this.generation) return;
      this.failures = 0;
      const newlyApproved = next.approved && (first || !this.session.approved);
      this.session = next;
      if (newlyApproved) { this.update('Connecting to Music Assistant…'); await player.connect(); }
      if (generation !== this.generation) return;
      if (next.approved && player.isConnected && !next.paired) {
        pairing = true;
        await requestJson('/api/browser-speaker/pair', { id: next.id, token: player.pairingToken }, 30_000);
        if (generation !== this.generation) return;
        this.update(`Browser speaker enabled as “${this.name.value.trim()}”. In Playback settings, refresh speakers and select it. Music starts only on Play.`);
      }
      this.timer = setTimeout(() => { void this.check(generation); }, 3000);
    } catch (error) {
      if (generation !== this.generation) return;
      if (!pairing && !(error instanceof RequestError) && ++this.failures <= 6) {
        this.update('Connection interrupted. Reconnecting browser audio…');
        this.timer = setTimeout(() => { void this.check(generation); }, 5000);
      } else this.fail(generation, error instanceof Error ? error.message : 'Browser speaker access could not be confirmed. Enable it again.');
    }
  }
  private fail(generation: number, message: string) { if (generation === this.generation) { this.disable(); this.update(message); } }
  disable() {
    ++this.generation; clearTimeout(this.timer);
    this.player?.destroy(); this.player = undefined;
    const session = this.session; this.session = undefined;
    if (session) void requestJson('/api/browser-speaker/stop', { id: session.id }).catch(() => {});
    this.update('Browser speaker disabled.');
  }
}

let speaker: BrowserSpeaker | undefined;
export function initializeBrowserSpeaker() { return speaker ??= new BrowserSpeaker(); }
export function showBrowserSpeaker() { speaker?.show(); }
