import test from 'node:test';
import assert from 'node:assert/strict';
import { createDashboardRefresh, refreshDashboardSnapshot } from '../lib/dashboard-refresh.mjs';

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
  assert.match(url, /^\.\/data\/example\.json\?v=\d+$/);
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
