import { defaultBackgroundSettings, maxBackgroundGrowSeconds, type BackgroundSettings, type BackgroundSnapshot } from '../src/background-settings';
import { el, link } from './dom';
import { actionGroup, panel, sectionHeading } from './ui-components';
import { AnimatedBackground } from './display-background';
import { requestJson } from './request';

const endpoint = '/api/host/background-settings';
const ranges = [
  ['coverage', 'Visible outline (%)', 5, 95, 1],
  ['cycleDuration', 'Continuous cycle time (s)', 2, 120, .5],
  ['jitter', 'Randomness', 0, 1, .05],
  ['sprouts', 'Sprouts per letter', 1, 4, 1],
  ['duration', 'Letter grow time (s)', .2, maxBackgroundGrowSeconds, .1],
  ['spread', 'Spread of start times (s)', 0, 5, .1],
  ['bloomDuration', 'Arrowhead pop time (s)', .1, 2, .05],
  ['hold', 'Loop hold (s)', 0, 30, .1],
  ['fade', 'Loop fade-out (s)', .05, 5, .05],
  ['opacity', 'Background opacity', .01, 1, .01],
  ['width', 'Background width (%)', 20, 100, 1],
] as const;

export class BackgroundSettingsPanel {
  readonly element = panel('settings-card settings-background');
  private preview = new AnimatedBackground();
  private fields = el('fieldset', undefined, 'background-controls');
  private status = el('p', 'Loading background settings…', 'muted small');
  private saveButton = el('button', 'Save and replay on display');
  private reloadButton = el('button', 'Reload saved settings', 'secondary');
  private controls = new Map<keyof BackgroundSettings, HTMLInputElement | HTMLSelectElement>();
  private outputs = new Map<keyof BackgroundSettings, HTMLOutputElement>();
  private draft: BackgroundSettings = { ...defaultBackgroundSettings };
  private revision = 0;
  private busy = false;
  private loaded = false;

  constructor(private signal: AbortSignal) {
    this.element.setAttribute('aria-labelledby', 'settings-background-title');
    this.status.setAttribute('role', 'status');
    this.preview.element.classList.add('bmf-preview');
    const form = el('form', undefined, 'form-stack');
    this.fields.append(el('legend', 'Display appearance controls', 'sr-only'));
    const placement = el('select');
    for (const [value, label] of [['bottom-right', 'Bottom-right'], ['play-order', 'Right of play order']] as const) {
      const option = el('option', label); option.value = value; placement.append(option);
    }
    this.field('qrPlacement', 'Room display QR placement', placement);
    placement.onchange = () => {
      this.draft.qrPlacement = placement.value as BackgroundSettings['qrPlacement'];
      this.report('QR placement updated. Save to apply it to the room display.');
    };
    this.toggle('enabled', 'Enable BMF display background');
    this.toggle('continuous', 'Continuous reveal');
    this.select('order', 'Order', ['random', 'center', 'edges', 'left', 'right']);
    this.select('origin', 'Growth starts at', ['random', 'base', 'top']);
    for (const [key, label, min, max, step] of ranges) {
      const input = el('input'); input.type = 'range'; input.min = String(min); input.max = String(max); input.step = String(step);
      const output = el('output'); output.htmlFor = `background-${key}`; this.outputs.set(key, output);
      const group = this.field(key, label, input); group.append(output);
      input.oninput = () => { this.draft[key] = Number(input.value); output.value = input.value; this.changed(); };
    }
    this.toggle('loop', 'Loop intro animation');
    const seed = el('input'); seed.type = 'number'; seed.min = '0'; seed.max = '2147483647'; seed.step = '1'; seed.placeholder = 'Random each time';
    this.field('seed', 'Pattern seed (optional)', seed);
    seed.oninput = () => {
      if (!seed.validity.valid) return;
      this.draft.seed = seed.value === '' ? null : Number(seed.value); this.changed();
    };
    const hint = el('p', 'Continuous reveal keeps rounded reveal strokes travelling around the letters. Visible outline sets how much of each outline is drawn; cycle time sets the time for a full trip (higher is slower). Sprouts controls the number of moving sections, and Order sets their initial phases. Arrowheads stay visible. Intro timing, hold and fade apply when Continuous reveal is off. A fixed seed repeats the pattern; reduced-motion preferences show the finished logo.', 'muted field-hint');
    const replay = el('button', 'Replay preview', 'secondary'); replay.type = 'button'; replay.onclick = () => this.preview.replay();
    const reset = el('button', 'Reset to defaults', 'secondary'); reset.type = 'button';
    reset.onclick = () => { this.draft = { ...defaultBackgroundSettings }; this.syncControls(); this.changed(); };
    const previewActions = actionGroup(); previewActions.append(replay, reset); this.fields.append(previewActions);
    this.saveButton.type = 'submit';
    this.reloadButton.type = 'button'; this.reloadButton.onclick = () => { void this.load(); };
    const actions = actionGroup('form'); actions.append(this.saveButton, this.reloadButton);
    form.append(this.fields, hint, actions);
    form.onsubmit = event => { event.preventDefault(); void this.save(); };
    this.element.append(sectionHeading('Animated BMF background', 'settings-background-title', 'h3'),
      el('p', 'Test changes in the preview, then save to update every open room display. Saving also restarts the animation.'),
      this.preview.element, form, this.status, link('Open room display', '/display', 'inline-link'));
    signal.addEventListener('abort', () => this.preview.destroy(), { once: true });
    void this.load();
  }

  private field(key: keyof BackgroundSettings, label: string, input: HTMLInputElement | HTMLSelectElement) {
    const group = el('div', undefined, 'field background-field');
    const caption = el('label', label); caption.htmlFor = input.id = `background-${key}`;
    group.append(caption, input); this.fields.append(group); this.controls.set(key, input); return group;
  }
  private toggle(key: 'enabled' | 'loop' | 'continuous', label: string) {
    const input = el('input'); input.type = 'checkbox';
    const group = this.field(key, label, input); group.classList.add('background-toggle');
    input.onchange = () => { this.draft[key] = input.checked; this.changed(); };
  }
  private select(key: 'order' | 'origin', label: string, values: string[]) {
    const select = el('select');
    for (const value of values) { const option = el('option', value); option.value = value; select.append(option); }
    this.field(key, label, select);
    select.onchange = () => {
      if (key === 'order') this.draft.order = select.value as BackgroundSettings['order'];
      else this.draft.origin = select.value as BackgroundSettings['origin'];
      this.changed();
    };
  }
  private syncControls() {
    for (const [key, input] of this.controls) {
      const value = this.draft[key];
      if (input instanceof HTMLInputElement && input.type === 'checkbox') input.checked = Boolean(value);
      else input.value = value === null ? '' : String(value);
      const output = this.outputs.get(key); if (output) output.value = input.value;
    }
    this.preview.update({ revision: this.revision, settings: this.draft });
    this.syncModeControls();
  }
  private changed() {
    this.syncModeControls();
    this.preview.update({ revision: this.revision, settings: this.draft });
    this.report('Preview updated. Save to apply these settings to the room display.');
  }
  private syncModeControls() {
    for (const key of ['duration', 'spread', 'bloomDuration', 'loop', 'hold', 'fade'] as const) {
      this.controls.get(key)!.disabled = this.draft.continuous;
    }
    for (const key of ['coverage', 'cycleDuration'] as const) this.controls.get(key)!.disabled = !this.draft.continuous;
  }
  private report(message: string, failed = false) {
    this.status.textContent = message; this.status.className = failed ? 'field-error' : 'muted small';
    this.status.setAttribute('role', failed ? 'alert' : 'status');
  }
  private lock() {
    this.fields.disabled = this.busy || !this.loaded;
    this.saveButton.disabled = this.busy || !this.loaded; this.reloadButton.disabled = this.busy;
    this.saveButton.textContent = this.busy ? 'Working…' : 'Save and replay on display';
  }
  private async load() {
    if (this.busy || this.signal.aborted) return;
    this.busy = true; this.lock();
    try {
      const result = await requestJson<BackgroundSnapshot>(endpoint, undefined, 15_000, this.signal);
      if (this.signal.aborted) return;
      this.revision = result.revision; this.draft = { ...result.settings }; this.loaded = true; this.syncControls();
      this.report('Saved settings loaded. Changes below preview locally until you save.');
    } catch (error) {
      this.loaded = false;
      if (!this.signal.aborted) this.report(error instanceof Error ? error.message : 'Background settings could not be loaded.', true);
    } finally { this.busy = false; this.lock(); }
  }
  private async save() {
    if (this.busy || !this.loaded || this.signal.aborted) return;
    this.busy = true; this.lock();
    try {
      const result = await requestJson<BackgroundSnapshot>(endpoint, { revision: this.revision, settings: this.draft }, 15_000, this.signal);
      if (this.signal.aborted) return;
      this.revision = result.revision; this.draft = { ...result.settings }; this.syncControls();
      this.report('Saved. Connected room displays now use these appearance settings.');
    } catch (error) {
      this.loaded = false;
      if (!this.signal.aborted) this.report(`${error instanceof Error ? error.message : 'The save could not be confirmed.'} Use Reload saved settings before saving again.`, true);
    } finally { this.busy = false; this.lock(); }
  }
}
