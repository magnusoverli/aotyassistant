import type { OutputState } from '../src/model';
import { el } from './dom';
import { text, prop } from './view-nodes';

/** Short speaker-status wording shared by the player caption and the Settings badge. */
export const outputStatus = { checking: 'Checking…', recovery: 'Recovery needed', incompatible: 'Playback unsupported', none: 'No active speaker' } as const;

export function outputLabel(output?: OutputState, online = true) {
  const label = el('p', undefined, 'output-label'); updateOutputLabel(label, output, online); return label;
}
/** Which speaker plays the room's music, or that Music Assistant is not connected yet. */
export function outputCaption(output?: OutputState, online = true) {
  return !online ? 'Output: Connection lost' : !output ? 'Output: Music Assistant not connected' : output.state === 'ready' ? `Output: ${output.name}`
    : output.state === 'checking' || output.state === 'recovery' || output.state === 'incompatible' ? `Output: ${output.name} · ${outputStatus[output.state]}`
    : output.state === 'unconfirmed' ? 'Output: Connection unconfirmed' : `Output: ${outputStatus.none}`;
}
export function updateOutputLabel(label: HTMLElement, output?: OutputState, online = true) {
  const caption = outputCaption(output, online);
  text(label, caption); prop(label, 'title', caption);
}
