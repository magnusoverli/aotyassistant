import type { BrowserDevice } from '../src/browser-speaker-name';

export function browserDevice(browser: { userAgent: string; platform?: string; maxTouchPoints?: number; userAgentData?: { platform?: string; mobile?: boolean } }): BrowserDevice {
  const ua = browser.userAgent;
  const platform = browser.userAgentData?.platform || browser.platform || '';
  if (/iPhone|iPod/i.test(ua)) return 'iPhone';
  if (/iPad/i.test(ua) || /Mac/i.test(platform) && (browser.maxTouchPoints ?? 0) > 1) return 'iPad';
  if (/Android/i.test(ua + platform)) return /Mobile/i.test(ua) || browser.userAgentData?.mobile ? 'Android phone' : 'Android tablet';
  if (/CrOS/i.test(ua + platform)) return 'Chromebook';
  if (/Win/i.test(platform) || /Windows/i.test(ua)) return 'Windows PC';
  if (/Mac/i.test(ua + platform)) return 'Mac';
  if (browser.userAgentData?.mobile || /Mobile/i.test(ua)) return 'Mobile';
  if (/Linux/i.test(ua + platform)) return 'Linux PC';
  return 'Browser';
}
