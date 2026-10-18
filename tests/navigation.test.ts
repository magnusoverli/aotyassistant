import { test } from 'node:test';
import assert from 'node:assert/strict';
import { headerModel, routes, pageForPath, type HeaderView, type Page } from '../web/navigation.js';

const view: HeaderView = { mode: 'music-assistant', me: { id: 'me', nickname: 'Literal <name>' }, myTurn: false,
  current: { id: 'other', nickname: 'Other' }, position: { seat: 2, total: 3, turnsUntil: 1 } };

test('all pages use the same central route/navigation definitions with one current page', () => {
  for (const page of Object.keys(routes) as Page[]) {
    assert.equal(pageForPath(routes[page]), page);
    const model = headerModel(page, {});
    assert.deepEqual(model.primary.map(item => item.id), ['host', 'settings', 'participant', 'display']);
    assert.equal(model.primary.filter(item => item.current).length, ['home', 'join'].includes(page) ? 0 : 1);
    assert.equal(model.modeText, '', 'Unknown state must not claim live or demo connectivity.');
  }
  assert.equal(pageForPath('/not-a-page'), 'home');
  assert.equal(pageForPath('/host/settings/'), 'settings');
});

test('all pages have stable navigation without display credentials or lifecycle shortcuts', () => {
  const expected = headerModel('home', {}).primary.map(({ current, ...item }) => item);
  for (const page of Object.keys(routes) as Page[]) {
    for (const me of [view.me, undefined]) {
      const privateView = { ...view, me, joinUrl: 'http://app.local/join', displayUrl: 'http://app.local/display' };
      const model = headerModel(page, { view: privateView });
      assert.deepEqual(model.primary.map(({ current, ...item }) => item), expected);
      assert.ok(!JSON.stringify(model).includes('private-'));
      assert.ok(model.primary.every(item => !item.href.includes('#')));
    }
  }
});

test('header state stays presentation-only, with literal nicknames and explicit settings mode updates', () => {
  assert.equal(headerModel('participant', {}).subtitle, 'My music');
  const participant = headerModel('participant', { view }); assert.equal(participant.subtitle, 'Literal <name>');
  assert.ok(!('turn' in participant), 'Turn status belongs in the workspace, not repeated in the header.');
  assert.equal(headerModel('settings', { view, mode: 'demo' }).modeText, 'DEMO · NO AUDIO');
  const withPrivateData = { ...view, ownPlayback: { track: { title: 'SECRET TITLE' } }, preparations: ['PRIVATE LIST'] };
  assert.ok(!JSON.stringify(headerModel('participant', { view: withPrivateData })).includes('SECRET TITLE'));
  assert.ok(!JSON.stringify(headerModel('host', { view: withPrivateData })).includes('PRIVATE LIST'));
});

test('header readiness uses server availability, never an assumed speaker or a stale connection', () => {
  assert.equal(headerModel('host', { view }).modeText, 'Music Assistant');
  assert.equal(headerModel('host', { view: { ...view, playbackAvailable: false } }).modeText, 'Playback unavailable');
  assert.equal(headerModel('host', { view: { ...view, playbackAvailable: true } }).modeText, 'Playback ready');
  assert.equal(headerModel('participant', { view: { ...view, playbackAvailable: true }, realtime: false }).modeText, 'Reconnecting…');
});
