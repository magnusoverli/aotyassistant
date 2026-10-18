import { el } from './dom';

/** Clipboard API needs HTTPS; LAN users can always select and copy the existing field. */
export function copyButton(text: string, field: HTMLInputElement | HTMLTextAreaElement) {
  const button = el('button', text, 'secondary'); button.type = 'button';
  button.onclick = async () => {
    try { await navigator.clipboard.writeText(field.value); button.textContent = 'Copied'; }
    catch { field.focus(); field.select(); button.textContent = 'Select and copy'; }
  };
  return button;
}
