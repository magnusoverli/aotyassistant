import { test } from 'node:test';
import assert from 'node:assert/strict';
import { browserDevice } from '../web/browser-device.js';
import { browserSpeakerName, browserDevices } from '../src/browser-speaker-name.js';

test('device labels distinguish mobile, desktop-mode iPad and desktop operating systems', () => {
  for (const [browser, expected] of [
    [{ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit Safari', platform: 'iPhone' }, 'iPhone'],
    [{ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) Version/18 Safari', platform: 'MacIntel', maxTouchPoints: 5 }, 'iPad'],
    [{ userAgent: 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)', platform: 'iPad' }, 'iPad'],
    [{ userAgent: 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit Chrome Mobile Safari' }, 'Android phone'],
    [{ userAgent: 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit Chrome Safari' }, 'Android tablet'],
    [{ userAgent: 'Mozilla/5.0 (X11; CrOS x86_64) AppleWebKit Chrome Safari' }, 'Chromebook'],
    [{ userAgent: 'Chrome', userAgentData: { platform: 'Windows', mobile: false } }, 'Windows PC'],
    [{ userAgent: 'Firefox', platform: 'MacIntel', maxTouchPoints: 0 }, 'Mac'],
    [{ userAgent: 'Firefox', platform: 'Linux x86_64' }, 'Linux PC'],
    [{ userAgent: 'Unknown', userAgentData: { mobile: true } }, 'Mobile'],
    [{ userAgent: 'Unknown' }, 'Browser'],
  ] as const) assert.equal(browserDevice(browser), expected);
});

test('friendly names use only username and device type and keep long Unicode names bounded', () => {
  assert.equal(browserSpeakerName('iPhone', 'Magnus'), 'Listening Room (Magnus · iPhone)');
  assert.equal(browserSpeakerName('iPhone'), 'Listening Room (iPhone)');
  assert.equal(browserSpeakerName('iPhone', '  Ma\u0000gnus\n Smith\u202e  '), 'Listening Room (Magnus Smith · iPhone)');
  for (const device of browserDevices) {
    const long = browserSpeakerName(device, '😀'.repeat(80));
    assert.ok(long.length <= 60); assert.ok(long.endsWith(` · ${device})`));
    assert.doesNotThrow(() => encodeURIComponent(long));
  }
});
