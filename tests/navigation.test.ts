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

test('header state stays presentation-only, with literal nicknames, accurate turn badges, and explicit settings mode updates', () => {
  const participant = headerModel('participant', { view }); assert.equal(participant.subtitle, 'Literal <name>'); assert.equal(participant.turn!.text, 'UP NEXT');
  assert.equal(headerModel('participant', { view: { ...view, myTurn: true } }).turn!.text, 'YOUR TURN');
  assert.equal(headerModel('participant', { view: { ...view, position: { ...view.position!, turnsUntil: 2 } } }).turn!.text, 'LISTENING');
  assert.equal(headerModel('participant', { view: { ...view, me: undefined } }).turn, undefined);
  assert.equal(headerModel('display', { view }).turn, undefined);
  assert.equal(headerModel('settings', { view, mode: 'demo' }).modeText, 'DEMO · NO AUDIO');
  const withPrivateData = { ...view, ownPlayback: { track: { title: 'SECRET TITLE' } }, preparations: ['PRIVATE LIST'] };
  assert.ok(!JSON.stringify(headerModel('participant', { view: withPrivateData })).includes('SECRET TITLE'));
  assert.ok(!JSON.stringify(headerModel('host', { view: withPrivateData })).includes('PRIVATE LIST'));
});
