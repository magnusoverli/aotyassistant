import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { enterOnline } from '../web/online-entry.js';

type Sent = { url: string; method?: string; body?: string };
/** The few page features the entry step uses: the server's markers, the address bar and requests. */
function page(t: TestContext, options: { public: boolean; session: boolean; hash: string }, answer: () => Promise<Response>) {
  const sent: Sent[] = []; const element = () => ({ append() {}, setAttribute() {}, replaceChildren() {} });
  const marks: Record<string, string> = { 'doom-room-public': options.public ? '1' : '0', 'doom-room-online-session': options.session ? '1' : '' };
  const location = { hash: options.hash, pathname: '/join', search: '' };
  const globals = { document: { querySelector: (selector: string) => ({ content: marks[/name="([^"]+)"/.exec(selector)![1]!] ?? '' }), createElement: element },
    location, history: { replaceState: (_state: unknown, _title: string, url: string) => { location.hash = url.includes('#') ? url.slice(url.indexOf('#')) : ''; } },
    fetch: (url: string, init?: RequestInit) => { sent.push({ url, method: init?.method, body: init?.body as string | undefined }); return answer(); } };
  for (const [name, value] of Object.entries(globals)) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
    t.after(() => { if (previous) Object.defineProperty(globalThis, name, previous); else delete (globalThis as Record<string, unknown>)[name]; });
  }
  return { sent, location, root: element() as unknown as HTMLElement };
}

test('a guest with a valid session who scans the room code again enters without waiting for the server', { timeout: 5000 }, async t => {
  let answer!: (response: Response) => void;
  const f = page(t, { public: true, session: true, hash: '#online=' + 'k'.repeat(43) }, () => new Promise<Response>(resolve => { answer = resolve; }));
  assert.equal(await enterOnline(f.root), true, 'Entry does not wait for the renewal to be answered.');
  assert.equal(f.location.hash, '', 'The invitation leaves the address bar.');
  // The scan still renews the guest's seven days, in the background.
  assert.deepEqual(f.sent, [{ url: '/api/online/redeem', method: 'POST', body: JSON.stringify({ invitation: 'k'.repeat(43) }) }]);
  answer(new Response(null, { status: 403 })); // A refused renewal changes nothing for a session that is still valid.
});

test('a returning guest with a valid session and no invitation sends nothing', async t => {
  const f = page(t, { public: true, session: true, hash: '' }, async () => new Response());
  assert.equal(await enterOnline(f.root), true); assert.deepEqual(f.sent, []);
});

test('a guest without a session is admitted only once the invitation is accepted', { timeout: 5000 }, async t => {
  let answer!: (response: Response) => void;
  const f = page(t, { public: true, session: false, hash: '#online=' + 'k'.repeat(43) }, () => new Promise<Response>(resolve => { answer = resolve; }));
  let entered = false; const entering = enterOnline(f.root).then(result => { entered = result; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(entered, false); assert.equal(f.sent[0]?.url, '/api/online/redeem');
  answer(new Response('{}', { status: 200 })); await entering; assert.equal(entered, true);
});

test('pages opened on the local network or in Home Assistant skip the invitation step', async t => {
  const f = page(t, { public: false, session: false, hash: '#online=' + 'k'.repeat(43) }, async () => new Response());
  assert.equal(await enterOnline(f.root), true); assert.deepEqual(f.sent, []);
});
