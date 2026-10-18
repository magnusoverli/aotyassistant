export const escapeHtml = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);

export function errorPage(title: string, content: string, base = '') {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="theme-color" content="#101713"><title>${escapeHtml(title)} · Albums of the Year</title><link rel="stylesheet" href="${escapeHtml(base)}/assets/ui-foundation.css"><link rel="icon" href="${escapeHtml(base)}/assets/record.svg"></head><body><main class="page" data-layout="compact"><section class="panel fallback-content"><h1>${escapeHtml(title)}</h1>${content}</section></main></body></html>`;
}
