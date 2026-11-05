import test from 'node:test';
import assert from 'node:assert/strict';
import { DASHBOARD_DATA_SOURCE, readDashboardData } from '../lib/dashboard-data-source.mjs';
import { createDashboardSnapshotReader } from '../lib/dashboard-refresh.mjs';

test('committed encrypted data is available without reading the published website', async () => {
  const envelope = { version: 1, ciphertext: 'encrypted-fixture' };
  const calls = [];
  const data = await readDashboardData('owner.json', { fetcher: async (url, options) => {
    calls.push({ url, options });
    return new Response(JSON.stringify(envelope));
  } });
  assert.deepEqual(data, envelope);
  assert.equal(calls.length, 1);
  assert.ok(calls[0].url.startsWith(`${DASHBOARD_DATA_SOURCE}owner.json?v=`));
  assert.equal(calls[0].options.cache, 'no-store');
  assert.equal(calls[0].options.credentials, 'omit');
  assert.equal(calls[0].options.headers, undefined, 'passwords and account tokens never go to the file host');
  assert.equal(calls[0].options.referrerPolicy, 'no-referrer');
});

test('network, HTTP, and malformed-response failures fall back to the published encrypted copy', async () => {
  const fallback = { ciphertext: 'existing-encrypted-fixture' };
  for (const liveResponse of [() => { throw new TypeError('Offline'); }, () => new Response('', { status: 503 }), () => new Response('<html>Error</html>'), () => new Response('null')]) {
    const calls = [];
    const data = await readDashboardData('example.json', { fetcher: async url => {
      calls.push(url);
      return url.startsWith(DASHBOARD_DATA_SOURCE) ? liveResponse() : new Response(JSON.stringify(fallback));
    } });
    assert.deepEqual(data, fallback);
    assert.equal(calls.length, 2);
    assert.match(calls[1], /^\.\/data\/example\.json\?v=\d+$/);
  }
});

test('an unavailable live source cannot replace a signed-in account with an older published snapshot', async () => {
  const current = { user: { id: 'example' }, role: 'employee', generatedAt: '2026-11-05T19:00:00Z' };
  let applied = 0;
  const reader = createDashboardSnapshotReader({
    profile: { id: 'example', role: 'employee' }, password: 'fixture-only',
    fetcher: async url => url.startsWith(DASHBOARD_DATA_SOURCE) ? new Response('', { status: 503 }) : new Response('{"ciphertext":"older"}'),
    decrypt: async () => ({ ...current, generatedAt: '2026-11-05T18:00:00Z' }),
    isCurrent: () => true, onSnapshot: () => applied++,
  }, current, { ciphertext: 'current' });
  assert.equal(await reader(), true);
  assert.equal(applied, 0);
});

test('a fallback still passes through account and role validation', async () => {
  const current = { user: { id: 'example' }, role: 'employee', generatedAt: '2026-11-05T19:00:00Z' };
  for (const invalid of [{ ...current, user: { id: 'other' } }, { ...current, role: 'owner' }]) {
    let applied = false;
    const reader = createDashboardSnapshotReader({
      profile: { id: 'example', role: 'employee' }, password: 'fixture-only',
      fetcher: async url => url.startsWith(DASHBOARD_DATA_SOURCE) ? new Response('', { status: 503 }) : new Response('{"ciphertext":"fixture"}'),
      decrypt: async () => invalid, isCurrent: () => true, onSnapshot: () => { applied = true; },
    }, current, { ciphertext: 'current' });
    await assert.rejects(reader(), /Invalid dashboard payload/);
    assert.equal(applied, false);
  }
});

test('cancelled reads do not start a fallback request', async () => {
  const controller = new AbortController();
  let calls = 0;
  await assert.rejects(readDashboardData('access.json', { signal: controller.signal, fetcher: async () => {
    calls++;
    controller.abort();
    throw controller.signal.reason;
  } }), { name: 'AbortError' });
  assert.equal(calls, 1);
  await assert.rejects(readDashboardData('access.json', { signal: controller.signal, fetcher: async () => { calls++; } }), { name: 'AbortError' });
  assert.equal(calls, 1);
});

test('invalid file paths are rejected before any network request', async () => {
  let calls = 0;
  for (const file of ['../owner.json', 'https://other.example/owner.json', 'owner.json?secret=value', 'owner.js']) {
    await assert.rejects(readDashboardData(file, { fetcher: async () => { calls++; } }), /Invalid dashboard data file/);
  }
  assert.equal(calls, 0);
});
