import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { MessageChannel } from 'node:worker_threads';
import { attachNotificationMessages, isNotificationHash } from '../lib/notification-navigation.mjs';

test('a warm notification tap routes even when the hash is unchanged; a locked page retains it', () => {
  const messages = new EventTarget(), win = new EventTarget();
  win.Event = Event;
  win.navigator = { serviceWorker: messages };
  win.location = { pathname: '/', search: '', hash: '#availability' };
  win.history = { replaceState(_state, _title, url) { win.location.hash = new URL(url, 'https://dashboard.smoothstudios.co').hash; } };
  const detach = attachNotificationMessages(win);
  let routed = 0, ack = 0;
  win.addEventListener('hashchange', () => routed++);
  const send = target => {
    const e = new Event('message'); e.data = { type: 'smooth-notification', target };
    e.ports = [{ postMessage(value) { if (value.handled) ack++; } }]; messages.dispatchEvent(e);
  };
  send('availability'); send('availability');
  assert.equal(routed, 2); assert.equal(ack, 2);
  for (const target of ['creative', 'payouts', 'scheduling', 'quiz', 'settings', 'alerts']) {
    send(target); assert.ok(isNotificationHash(win.location.hash));
  }
  const before = win.location.hash;
  send('https://untrusted.invalid'); assert.equal(win.location.hash, before); assert.equal(ack, 8);
  assert.equal(isNotificationHash('#unknown'), false);
  detach(); send('availability'); assert.equal(ack, 8);
});

test('service worker focuses and explicitly routes a warm app, with URL fallback for older pages', async () => {
  const source = await readFile(new URL('../public/team-sw.js', import.meta.url), 'utf8');
  const handlers = {}, actions = [], scope = 'https://dashboard.smoothstudios.co/';
  let accepts = true;
  const client = {
    url: scope + '#availability',
    postMessage(data, [port]) { actions.push(['route', data.target]); if (accepts) port.postMessage({ handled: true }); port.close(); },
    async focus() { actions.push(['focus']); },
    async navigate(url) { actions.push(['navigate', url]); },
  };
  vm.runInNewContext(source, { URL, MessageChannel, setTimeout, clearTimeout, self: {
    addEventListener: (kind, fn) => handlers[kind] = fn, registration: { scope },
    clients: { matchAll: async () => [client] },
  } });
  const tap = async target => {
    let done; handlers.notificationclick({ notification: { data: { type: 'schedule', target }, close() {} }, waitUntil: p => done = p }); await done;
  };
  await tap('availability'); await tap('availability'); await tap('creative');
  assert.deepEqual(actions.filter(([kind]) => kind === 'route'), [['route', 'availability'], ['route', 'availability'], ['route', 'creative']]);
  assert.equal(actions.filter(([kind]) => kind === 'navigate').length, 0);
  accepts = false; await tap('settings');
  assert.deepEqual(actions.at(-1), ['navigate', scope + '#settings']);
});
