import type { OutputState } from '../src/model';
import { el } from './dom';
import { text, prop } from './view-nodes';

export function outputLabel(output?: OutputState, online = true) {
  const label = el('p', undefined, 'output-label'); updateOutputLabel(label, output, online); return label;
}
export function updateOutputLabel(label: HTMLElement, output?: OutputState, online = true) {
  const caption = !online ? 'Output: Connection lost' : !output ? 'Output: Demo' : output.state === 'ready' ? `Output: ${output.name}`
    : output.state === 'checking' ? `Output: ${output.name} · Checking…`
    : output.state === 'recovery' ? `Output: ${output.name} · Recovery needed`
    : output.state === 'unconfirmed' ? 'Output: Connection unconfirmed' : 'Output: No active speaker';
  text(label, caption); prop(label, 'title', caption);
}
