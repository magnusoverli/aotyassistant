import { test } from 'node:test';
import assert from 'node:assert/strict';
import { headerModel, routes, pageForPath, spaDestination, type HeaderView, type Page } from '../web/navigation.js';

const view: HeaderView = { me: { id: 'me', nickname: 'Literal <name>' } };

test('SPA navigation retains cross-page fragments, queries and Ingress without intercepting native anchors or external pages', () => {
  const current = new URL('https://ha.example/api/hassio_ingress/room/display');
  const base = '/api/hassio_ingress/room';
  const target = new URL(base + '/host/settings?section=audio#access', current);
  assert.equal(spaDestination(target, current, base), base + '/host/settings?section=audio#access');
  assert.equal(spaDestination(new URL('#main-content', current), current, base), undefined);
  assert.equal(spaDestination(new URL('/host', current), current, base), undefined);
  assert.equal(spaDestination(new URL('https://elsewhere.test/display'), current, base), undefined);
  assert.equal(spaDestination(new URL('/api/hassio_ingress/another/host', current), current, base), undefined);
  assert.equal(spaDestination(new URL('/api/host/state', current), current), undefined);
  assert.equal(spaDestination(new URL('http://room.local/host/settings#access'), new URL('http://room.local/display')), '/host/settings#access');
  assert.equal(spaDestination(new URL(base + '/user/settings', current), current, base), base + '/user/settings');
  assert.equal(spaDestination(new URL('https://room.ts.net/user/settings'), new URL('https://room.ts.net/participant')), '/user/settings');
});

test('all pages use the same central route/navigation definitions with one current page', () => {
  for (const page of Object.keys(routes) as Page[]) {
    assert.equal(pageForPath(routes[page]), page);
    const model = headerModel(page, {});
    assert.deepEqual(model.primary.map(item => item.id), ['participant', 'user-settings', 'display', 'host', 'settings']);
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
  assert.equal(headerModel('participant', {}).subtitle, 'Your music');
  const participant = headerModel('participant', { view }); assert.equal(participant.subtitle, 'Literal <name>');
  assert.ok(!('turn' in participant), 'Turn status belongs in the workspace, not repeated in the header.');
  const withPrivateData = { ...view, ownPlayback: { track: { title: 'SECRET TITLE' } }, preparations: ['PRIVATE LIST'] };
  assert.ok(!JSON.stringify(headerModel('participant', { view: withPrivateData })).includes('SECRET TITLE'));
  assert.ok(!JSON.stringify(headerModel('host', { view: withPrivateData })).includes('PRIVATE LIST'));
});
