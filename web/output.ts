import type { OutputState } from '../src/model';
import { el } from './dom';
import { text, prop } from './view-nodes';
import { demoPlaybackNotice } from '../src/product';

/** Short speaker-status wording shared by the player caption and the Settings badge. */
export const outputStatus = { checking: 'Checking…', recovery: 'Recovery needed', incompatible: 'Playback unsupported', none: 'No active speaker' } as const;

export function outputLabel(output?: OutputState, online = true) {
  const label = el('p', undefined, 'output-label'); updateOutputLabel(label, output, online); return label;
}
export function updateOutputLabel(label: HTMLElement, output?: OutputState, online = true) {
  const caption = !online ? 'Output: Connection lost' : !output ? demoPlaybackNotice : output.state === 'ready' ? `Output: ${output.name}`
    : output.state === 'checking' || output.state === 'recovery' || output.state === 'incompatible' ? `Output: ${output.name} · ${outputStatus[output.state]}`
    : output.state === 'unconfirmed' ? 'Output: Connection unconfirmed' : `Output: ${outputStatus.none}`;
  text(label, caption); prop(label, 'title', caption);
}
