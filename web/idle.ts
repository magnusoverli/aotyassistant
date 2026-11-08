type IdleWindow = { requestIdleCallback?: (work: () => void, options: { timeout: number }) => number };

/** Runs work once the page has loaded and the browser is idle, or after `timeout` ms at the latest. */
export function whenIdle(work: () => void, timeout = 3000) {
  const later = () => {
    const idle = (globalThis as IdleWindow).requestIdleCallback;
    if (idle) idle(work, { timeout }); else setTimeout(work, 200);
  };
  if (document.readyState === 'complete') later(); else window.addEventListener('load', later, { once: true });
}
