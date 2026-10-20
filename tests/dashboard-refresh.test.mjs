import test from 'node:test';
import assert from 'node:assert/strict';
import { attachQuietSnapshotRefresh, createDashboardSnapshotReader, createDashboardRefresh, refreshDashboardSnapshot } from '../lib/dashboard-refresh.mjs';

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

test('refresh reads every mounted source once, coalesces concurrent pulls, and unregisters pages', async () => {
  const coordinator = createDashboardRefresh();
  const wait = deferred(); let reads = 0, pageReads = 0;
  coordinator.register(async () => { reads++; await wait.promise; return true; });
  const remove = coordinator.register(async () => { pageReads++; return true; });
  const first = coordinator.run();
  assert.equal(coordinator.run(), first);
  await Promise.resolve(); assert.equal(reads, 1); assert.equal(pageReads, 1);
  wait.resolve(); await first; remove(); await coordinator.run();
  assert.equal(reads, 2); assert.equal(pageReads, 1);
});

test('partial errors are reported without stopping successful reads and can be retried', async () => {
  const coordinator = createDashboardRefresh(); let good = 0, fail = true;
  coordinator.register(async () => { good++; return true; });
  coordinator.register(async () => !fail);
  const remove = coordinator.register(async () => { throw new Error('Offline'); });
  await assert.rejects(coordinator.run(), /Some updates couldn’t load/);
  assert.equal(good, 1); remove(); fail = false;
  await coordinator.run(); assert.equal(good, 2);
});

test('toolbar navigation during refresh waits for a fresh pass of the destination page', async () => {
  const coordinator = createDashboardRefresh(); const wait = deferred();
  let previousReads = 0, nextReads = 0;
  const remove = coordinator.register(async () => { previousReads++; await wait.promise; throw new Error('Old page offline'); });
  const previous = coordinator.run();
  await Promise.resolve(); remove();
  coordinator.register(async () => { nextReads++; return true; });
  const next = coordinator.run(), repeatedTap = coordinator.run();
  assert.equal(nextReads, 0);
  wait.resolve(); await assert.rejects(previous); await Promise.all([next, repeatedTap]);
  assert.equal(previousReads, 1); assert.equal(nextReads, 1);
  await coordinator.run(); assert.equal(nextReads, 2, 'a later active-tab tap refreshes again');
});

test('a stalled read times out without leaving refresh locked', async () => {
  const coordinator = createDashboardRefresh(5);
  const remove = coordinator.register(() => new Promise(() => {}));
  await assert.rejects(coordinator.run(), /took too long/);
  remove(); await coordinator.run();
});

const snapshot = { role: 'employee', user: { id: 'example' }, generatedAt: 'new' };
const request = overrides => ({
  profile: { id: 'example', role: 'employee' }, password: 'test-only',
  fetcher: async () => new Response(JSON.stringify({ encrypted: true })),
  decrypt: async () => snapshot, isCurrent: () => true, onSnapshot: () => {}, ...overrides,
});

test('refresh cache-busts the encrypted snapshot, validates the account, and updates in place', async () => {
  let applied, url, options;
  await refreshDashboardSnapshot(request({
    fetcher: async (nextUrl, nextOptions) => { url = nextUrl; options = nextOptions; return new Response('{}'); },
    onSnapshot: next => { applied = next; },
  }));
  assert.equal(url, 'https://smooth-studios-team-api.smoothxstudios.workers.dev/dashboard');
  assert.equal(options.cache, 'no-store'); assert.ok(options.signal);
  assert.equal(applied, snapshot);
});

test('logout or account switch during decryption cannot restore the old account', async () => {
  const wait = deferred(), started = deferred(); let current = true, applied = false;
  const pending = refreshDashboardSnapshot(request({ decrypt: async () => { started.resolve(); await wait.promise; return snapshot; },
    isCurrent: () => current, onSnapshot: () => { applied = true; } }));
  await started.promise; current = false; wait.resolve();
  assert.equal(await pending, false); assert.equal(applied, false);
});

test('network, decryption, mismatched identity or role errors preserve the existing snapshot', async () => {
  for (const overrides of [
    { fetcher: async () => new Response('', { status: 503 }) },
    { decrypt: async () => { throw new Error('Cannot decrypt'); } },
    { decrypt: async () => ({ ...snapshot, user: { id: 'other' } }) },
    { decrypt: async () => ({ ...snapshot, role: 'owner' }) },
  ]) {
    let applied = false;
    await assert.rejects(refreshDashboardSnapshot(request({ ...overrides, onSnapshot: () => { applied = true; } })));
    assert.equal(applied, false);
  }
});

test('automatic and manual snapshot reads coalesce, skip unchanged decryption, and reject older publications', async () => {
  const initial = { ...snapshot, generatedAt: '2026-10-17T23:00:00Z' };
  let envelope = { version: 1 }, fetches = 0, decrypts = 0, applied = [];
  const reader = createDashboardSnapshotReader(request({
    fetcher: async () => { fetches++; return new Response(JSON.stringify(envelope)); },
    decrypt: async () => { decrypts++; return { ...initial, generatedAt: envelope.time }; },
    onSnapshot: next => applied.push(next),
  }), initial, envelope);
  const first = reader(); assert.equal(reader(), first); await first;
  assert.equal(fetches, 1); assert.equal(decrypts, 0); assert.equal(applied.length, 0);
  envelope = { version: 2, time: '2026-10-17T23:05:00Z' };
  await reader(); await reader();
  assert.equal(decrypts, 1); assert.equal(applied.length, 1);
  envelope = { version: 3, time: '2026-10-17T22:55:00Z' };
  await reader(); assert.equal(applied.length, 1, 'a stale server response cannot roll data backward');
});

test('a failed automatic read can retry, and a signed-out session cannot publish or start a read', async () => {
  const initial = { ...snapshot, generatedAt: '2026-10-17T23:00:00Z' };
  const waiting = deferred(), started = deferred(); let current = true, fail = true, fetches = 0, applied = 0;
  const reader = createDashboardSnapshotReader(request({
    isCurrent: () => current,
    fetcher: async () => { fetches++; if (fail) throw new Error('Offline'); return new Response('{"version":2}'); },
    decrypt: async () => { started.resolve(); await waiting.promise; return { ...initial, generatedAt: '2026-10-17T23:05:00Z' }; },
    onSnapshot: () => applied++,
  }), initial, { version: 1 });
  await assert.rejects(reader(), /Offline/); fail = false;
  const pending = reader(); await started.promise;
  current = false; waiting.resolve();
  assert.equal(await pending, false); assert.equal(applied, 0);
  assert.equal(await reader(), false); assert.equal(fetches, 2);
});

test('opening an editor during a fetch defers the update without losing it or resetting form data', async () => {
  const initial = { ...snapshot, generatedAt: '2026-10-17T23:00:00Z' };
  const waiting = deferred(), started = deferred(); let editing = false, fetches = 0, applied = 0;
  const reader = createDashboardSnapshotReader(request({
    canApply: () => !editing,
    fetcher: async () => { fetches++; started.resolve(); await waiting.promise; return new Response('{"version":2}'); },
    decrypt: async () => ({ ...initial, generatedAt: '2026-10-17T23:05:00Z' }),
    onSnapshot: () => applied++,
  }), initial, { version: 1 });
  const pending = reader(); await started.promise; editing = true; waiting.resolve();
  await pending; assert.equal(applied, 0);
  await reader(); assert.equal(fetches, 1, 'no repeated read while editing');
  editing = false; await reader(); assert.equal(applied, 1, 'the deferred publication is still applied afterward');
});

test('quiet checks run every thirty seconds, pause hidden/offline, resume once, and clean up on logout', async () => {
  const win = new EventTarget(), doc = new EventTarget();
  let clock = 0, timer, reads = 0, cleared = false, fail = false;
  win.navigator = { onLine: true }; doc.visibilityState = 'visible';
  win.setInterval = (callback, delay) => { assert.equal(delay, 30_000); timer = callback; return 1; };
  win.clearInterval = id => { assert.equal(id, 1); cleared = true; };
  const flush = () => new Promise(resolve => setImmediate(resolve));
  const stop = attachQuietSnapshotRefresh(async () => { reads++; if (fail) throw new Error('Offline'); }, { win, doc, now: () => clock });
  assert.equal(reads, 0, 'sign-in just loaded a snapshot');
  clock = 60_000; timer(); await flush(); assert.equal(reads, 1);
  doc.visibilityState = 'hidden'; clock += 60_000; timer(); await flush(); assert.equal(reads, 1);
  doc.visibilityState = 'visible';
  doc.dispatchEvent(new Event('visibilitychange')); win.dispatchEvent(new Event('focus')); win.dispatchEvent(new Event('pageshow'));
  await flush(); assert.equal(reads, 2, 'one read for overlapping foreground events');
  win.dispatchEvent(new Event('focus')); await flush(); assert.equal(reads, 2, 'brief duplicate events are throttled');
  win.navigator.onLine = false; clock += 60_000; timer(); await flush(); assert.equal(reads, 2);
  win.navigator.onLine = true; win.dispatchEvent(new Event('online')); await flush(); assert.equal(reads, 3);
  fail = true; clock += 60_000; timer(); await flush(); assert.equal(reads, 4);
  fail = false; clock += 60_000; timer(); await flush(); assert.equal(reads, 5, 'quiet failures do not lock out retries');
  stop(); assert.equal(cleared, true); clock += 60_000;
  timer(); win.dispatchEvent(new Event('focus')); win.dispatchEvent(new Event('online')); doc.dispatchEvent(new Event('visibilitychange'));
  await flush(); assert.equal(reads, 5);
});
