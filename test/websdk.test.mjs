import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  getConsentMode,
  installAlloyQueue,
  initWebSdk,
  ALLOY_SRC,
  LOADER_SRC,
} from '../scripts/websdk.js';

const IDS = { orgId: 'TESTORG@AdobeOrg', datastreamId: 'test-datastream' };

function fakeEnv({ search = '', fail = {} } = {}) {
  const calls = [];
  const appended = [];
  const win = {
    location: { search, href: `https://example.test/${search}` },
    alloy: (command, options) => {
      calls.push([command, options]);
      return fail[command] ? Promise.reject(new Error(`${command} failed`)) : Promise.resolve({});
    },
  };
  const doc = {
    title: 'Test page',
    createElement: () => ({ dataset: {} }),
    head: { append: (el) => appended.push({ ...el, afterCalls: calls.length }) },
  };
  return {
    win, doc, calls, appended,
  };
}

const silenceConsole = (t) => {
  t.mock.method(console, 'warn', () => {});
  t.mock.method(console, 'error', () => {});
};

test('getConsentMode maps the URL consent parameter', () => {
  ['?consent=accept', '?consent=TRUE', '?consent=1', '?consent=yes'].forEach((s) => assert.equal(getConsentMode(s), 'in', s));
  assert.equal(getConsentMode('?consent=pending'), 'pending');
  ['', '?consent=decline', '?consent=no', '?consent=', '?other=accept'].forEach((s) => assert.equal(getConsentMode(s), 'out', s));
});

test('installAlloyQueue installs the official command queue once', async () => {
  const win = {};
  installAlloyQueue(win);
  const first = win.alloy;
  installAlloyQueue(win);
  assert.equal(win.alloy, first);
  // eslint-disable-next-line no-underscore-dangle
  assert.deepEqual(win.__alloyNS, ['alloy']);
  const result = win.alloy('configure', { a: 1 });
  assert.equal(win.alloy.q.length, 1);
  const [resolve, reject, args] = win.alloy.q[0];
  assert.equal(typeof reject, 'function');
  assert.deepEqual([...args], ['configure', { a: 1 }]);
  resolve('done');
  assert.equal(await result, 'done');
});

test('placeholder IDs: no Web SDK, no loader', async (t) => {
  silenceConsole(t);
  const env = fakeEnv({ search: '?consent=accept' });
  assert.equal(await initWebSdk({ win: env.win, doc: env.doc }), false);
  assert.deepEqual(env.calls, []);
  assert.deepEqual(env.appended, []);
});

test('accepted consent: configure pending, opt in, page view, then loader', async () => {
  const env = fakeEnv({ search: '?consent=accept' });
  assert.equal(await initWebSdk({ win: env.win, doc: env.doc, ...IDS }), true);
  assert.deepEqual(env.calls.map(([c]) => c), ['configure', 'setConsent', 'sendEvent']);
  assert.deepEqual(env.calls[0][1], { ...IDS, defaultConsent: 'pending' });
  assert.equal(env.calls[1][1].consent[0].value.collect.val, 'y');
  assert.deepEqual(env.calls[2][1].xdm, {
    eventType: 'web.webpagedetails.pageViews',
    web: { webPageDetails: { name: 'Test page', pageViews: { value: 1 } } },
  });
  assert.equal(env.appended.length, 2);
  assert.equal(env.appended[0].src, ALLOY_SRC);
  assert.equal(env.appended[0].async, true);
  assert.equal(env.appended[1].src, LOADER_SRC);
  assert.equal(env.appended[1].async, true);
  assert.equal(env.appended[1].dataset.clientKey, 'astrocat');
  assert.ok(env.appended[1].afterCalls >= 2, 'loader appended only after setConsent');
});

test('declined consent: opt out, no page view, then loader', async () => {
  const env = fakeEnv({ search: '?consent=decline' });
  assert.equal(await initWebSdk({ win: env.win, doc: env.doc, ...IDS }), true);
  assert.deepEqual(env.calls.map(([c]) => c), ['configure', 'setConsent']);
  assert.equal(env.calls[1][1].consent[0].value.collect.val, 'n');
  assert.equal(env.appended[1].src, LOADER_SRC);
  assert.equal(env.appended[1].afterCalls, 2);
});

test('pending consent: no setConsent, no page view, loader after configure', async () => {
  const env = fakeEnv({ search: '?consent=pending' });
  assert.equal(await initWebSdk({ win: env.win, doc: env.doc, ...IDS }), true);
  assert.deepEqual(env.calls.map(([c]) => c), ['configure']);
  assert.equal(env.appended[1].src, LOADER_SRC);
});

test('configure or setConsent failure: no loader', async (t) => {
  silenceConsole(t);
  await Promise.all(['configure', 'setConsent'].map(async (command) => {
    const env = fakeEnv({ search: '?consent=accept', fail: { [command]: true } });
    assert.equal(await initWebSdk({ win: env.win, doc: env.doc, ...IDS }), false, command);
    assert.ok(!env.appended.some((el) => el.src === LOADER_SRC), command);
  }));
});

test('page view failure does not block the loader', async (t) => {
  silenceConsole(t);
  const env = fakeEnv({ search: '?consent=accept', fail: { sendEvent: true } });
  assert.equal(await initWebSdk({ win: env.win, doc: env.doc, ...IDS }), true);
  assert.equal(env.appended[1].src, LOADER_SRC);
});
