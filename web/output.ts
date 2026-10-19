import type { OutputState } from '../src/model';
import { el } from './dom';

export function outputLabel(output?: OutputState, online = true) {
  const label = el('p', !online ? 'Output: Connection lost' : !output ? 'Output: Demo' : output.state === 'ready' ? `Output: ${output.name}`
    : output.state === 'checking' ? `Output: ${output.name} · Checking…`
    : output.state === 'recovery' ? `Output: ${output.name} · Recovery needed`
    : output.state === 'unconfirmed' ? 'Output: Connection unconfirmed' : 'Output: No active speaker', 'output-label');
  label.title = label.textContent!;
  return label;
}
