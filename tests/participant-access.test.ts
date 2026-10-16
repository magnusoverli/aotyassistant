import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { View } from '../src/model.js';
import { ParticipantAccess } from '../web/participant-access.js';
import { RequestError } from '../web/request.js';

const member: View = { mode: 'demo', connected: true, roomId: 'room', revision: 1, turnId: 'turn', current: null, next: null, me: { id: 'me', nickname: 'Listener' } };
const setup = (request: () => Promise<View>, online = () => true) => {
  const accepted: View[] = []; let denied = 0;
  const access = new ParticipantAccess(request, online, view => { accepted.push(view); }, () => { denied++; }, () => {});
  return { access, accepted, get denied() { return denied; } };
};

test('membership checks coalesce and enter the workspace only after a valid member response', async () => {
  let resolve!: (view: View) => void;
  const pending = new Promise<View>(done => { resolve = done; });
  const r = setup(() => pending); const first = r.access.check();
  assert.equal(r.access.state, 'checking'); assert.equal(r.access.check(), first);
  resolve(member); await first;
  assert.equal(r.access.state, 'member'); assert.deepEqual(r.accepted, [member]); assert.equal(r.denied, 0);
});

test('only a membership 401 shows the join form; network, forbidden and malformed responses remain errors', async () => {
  const r = setup(async () => { throw new RequestError('Join the room.', 401); }); await r.access.check();
  assert.equal(r.access.state, 'unjoined'); assert.equal(r.denied, 1); assert.equal(r.access.message, '');
  for (const error of [new Error('Network failed'), new RequestError('Unavailable', 503), new RequestError('Forbidden', 403)]) {
    const failed = setup(async () => { throw error; }); await failed.access.check();
    assert.equal(failed.access.state, 'error'); assert.equal(failed.access.message, error.message); assert.equal(failed.denied, 0);
  }
  const malformed = setup(async () => ({ ...member, me: undefined })); await malformed.access.check(); assert.equal(malformed.access.state, 'error');
});

test('offline checks issue no requests and a late response cannot override revocation or a confirmed join', async () => {
  let calls = 0; const offline = setup(async () => { calls++; return member; }, () => false);
  await offline.access.check(); assert.equal(calls, 0); assert.equal(offline.access.state, 'offline');
  let resolve!: (view: View) => void;
  const r = setup(() => new Promise<View>(done => { resolve = done; }));
  const request = r.access.check(); await Promise.resolve(); r.access.revoke(); resolve(member); await request;
  assert.equal(r.access.state, 'unjoined'); assert.equal(r.access.removed, true); assert.equal(r.accepted.length, 0);
  let reject!: (error: Error) => void;
  const joined = setup(() => new Promise<View>((_done, fail) => { reject = fail; }));
  const check = joined.access.check(); await Promise.resolve(); joined.access.enter(member);
  reject(new RequestError('Old response', 401)); await check;
  assert.equal(joined.access.state, 'member'); assert.deepEqual(joined.accepted, [member]); assert.equal(joined.denied, 0);
});

test('retry and reconnect use fresh checks without discarding removal context or accepting old replies', async () => {
  let online = true; const requests: ((view: View) => void)[] = [];
  const r = setup(() => new Promise<View>(resolve => { requests.push(resolve); }), () => online);
  const first = r.access.check(); await Promise.resolve(); online = false; r.access.offline();
  online = true; const second = r.access.check(); await Promise.resolve();
  requests[0]!(member); await first; assert.equal(r.access.state, 'checking'); assert.equal(r.accepted.length, 0);
  requests[1]!(member); await second; assert.equal(r.access.state, 'member'); assert.equal(r.accepted.length, 1);
  r.access.revoke(); assert.equal(r.access.removed, true);
  r.access.enter(member); assert.equal(r.access.removed, false);
});
