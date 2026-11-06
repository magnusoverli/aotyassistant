import type { BrowserSpeakerView } from '../src/browser-speakers';
import { el } from './dom';
import { showBrowserSpeaker } from './browser-speaker';
import { requestJson } from './request';

export class BrowserSpeakerPanel {
  readonly element = el('section', undefined, 'settings-card');
  private list = el('div');
  private error = el('p', undefined, 'error');
  private timer?: ReturnType<typeof setTimeout>;
  private busy = false;
  constructor(private signal: AbortSignal) {
    const enable = el('button', 'Use this device as a speaker', 'secondary'); enable.onclick = showBrowserSpeaker;
    this.error.setAttribute('role', 'alert');
    this.element.append(el('h3', 'Browser speakers'), enable,
      el('p', 'Match the code shown on your output device before approving it. Approval grants trusted-speaker access to track details and playback capabilities for eight hours. Then refresh speakers above and choose it as the destination.', 'muted small'), this.list, this.error);
    signal.addEventListener('abort', () => clearTimeout(this.timer), { once: true }); void this.load();
  }
  private async load() {
    if (this.signal.aborted) return;
    try { this.render(await requestJson<BrowserSpeakerView[]>('/api/host/browser-speakers', undefined, 15_000, this.signal)); this.error.textContent = ''; }
    catch (error) { if (!this.signal.aborted) this.error.textContent = error instanceof Error ? error.message : 'Browser speakers could not be loaded.'; }
    if (!this.signal.aborted) this.timer = setTimeout(() => { if (!this.busy) void this.load(); }, 5000);
  }
  private render(sessions: BrowserSpeakerView[]) {
    if (this.signal.aborted) return;
    const rows = sessions.map(session => {
      const row = el('div', undefined, 'settings-card');
      row.append(el('strong', session.name), el('p', session.approved ? session.connected ? 'Connected' : 'Approved · waiting for browser' : `Approval code: ${session.code}`));
      if (!session.approved) { const approve = el('button', 'Approve trusted speaker'); approve.onclick = () => { void this.change(session.id, 'approve'); }; row.append(approve); }
      const remove = el('button', 'Remove', 'secondary'); remove.onclick = () => { void this.change(session.id, 'remove'); }; row.append(remove); return row;
    });
    this.list.replaceChildren(...rows);
  }
  private async change(id: string, action: 'approve' | 'remove') {
    if (this.busy) return; this.busy = true; clearTimeout(this.timer);
    this.list.querySelectorAll('button').forEach(button => { button.disabled = true; });
    try { this.render(await requestJson<BrowserSpeakerView[]>('/api/host/browser-speakers', { id, action }, 15_000, this.signal)); this.error.textContent = ''; }
    catch (error) { if (!this.signal.aborted) this.error.textContent = error instanceof Error ? error.message : 'Speaker approval could not be changed.'; }
    finally { this.busy = false; if (!this.signal.aborted) this.timer = setTimeout(() => { void this.load(); }, 1000); }
  }
}
