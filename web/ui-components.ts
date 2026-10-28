import { el } from './dom';

export function panel(className = '', options: { tone?: 'highlight'; density?: 'compact' } = {}) {
  const section = el('section', undefined, `panel ${className}`.trim());
  if (options.tone) section.dataset.tone = options.tone;
  if (options.density) section.dataset.density = options.density;
  return section;
}

export function pageHeading(text: string, action?: HTMLElement) {
  const heading = el('div', undefined, 'workspace-heading');
  heading.append(el('h1', text));
  if (action) heading.append(action);
  return heading;
}

export function sectionHeading(text: string, id: string, level: 'h2' | 'h3' = 'h2') {
  const heading = el('div', undefined, 'section-heading');
  const title = el(level, text); title.id = id; heading.append(title);
  return heading;
}

export function fieldControl(text: string, id: string, type = 'text') {
  const group = el('div', undefined, 'field');
  const label = el('label', text); label.htmlFor = id;
  const input = el('input'); input.id = id; input.type = type;
  group.append(label, input);
  return { group, input };
}

export function actionGroup(layout: 'inline' | 'form' = 'inline') {
  const actions = el('div', undefined, 'actions'); actions.dataset.layout = layout;
  return actions;
}

export function notice(text: string, kind: 'error' | 'warning' | 'connection' | 'success') {
  const message = el('div', text, `notice ${kind}`);
  message.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  return message;
}
