import { test } from 'node:test';
import assert from 'node:assert/strict';
import { headerModel, routes, pageForPath, type HeaderView, type Page } from '../web/navigation.js';

const view: HeaderView = { me: { id: 'me', nickname: 'Literal <name>' } };

test('all pages use the same central route/navigation definitions with one current page', () => {
  for (const page of Object.keys(routes) as Page[]) {
    assert.equal(pageForPath(routes[page]), page);
    const model = headerModel(page, {});
    assert.deepEqual(model.primary.map(item => item.id), ['host', 'settings', 'participant', 'display']);
    assert.equal(model.primary.filter(item => item.current).length, ['home', 'join'].includes(page) ? 0 : 1);
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

test('header state stays presentation-only with literal nicknames', () => {
  assert.equal(headerModel('participant', {}).subtitle, 'Music');
  const participant = headerModel('participant', { view }); assert.equal(participant.subtitle, 'Literal <name>');
  assert.ok(!('turn' in participant), 'Turn status belongs in the workspace, not repeated in the header.');
  const withPrivateData = { ...view, ownPlayback: { track: { title: 'SECRET TITLE' } }, preparations: ['PRIVATE LIST'] };
  assert.ok(!JSON.stringify(headerModel('participant', { view: withPrivateData })).includes('SECRET TITLE'));
  assert.ok(!JSON.stringify(headerModel('host', { view: withPrivateData })).includes('PRIVATE LIST'));
});
