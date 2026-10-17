import test from 'node:test';
import assert from 'node:assert/strict';
import { createProductionRefresh } from '../lib/production-refresh.mjs';

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

test('refresh reads every mounted source once, coalesces concurrent pulls, and unregisters pages', async () => {
  const coordinator = createProductionRefresh();
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
  const coordinator = createProductionRefresh(); let good = 0, fail = true;
  coordinator.register(async () => { good++; return true; });
  coordinator.register(async () => !fail);
  const remove = coordinator.register(async () => { throw new Error('Offline'); });
  await assert.rejects(coordinator.run(), /Some updates couldn’t load/);
  assert.equal(good, 1); remove(); fail = false;
  await coordinator.run(); assert.equal(good, 2);
});

test('toolbar navigation during refresh waits for a fresh pass of the destination page', async () => {
  const coordinator = createProductionRefresh(); const wait = deferred();
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
  const coordinator = createProductionRefresh(5);
  const remove = coordinator.register(() => new Promise(() => {}));
  await assert.rejects(coordinator.run(), /took too long/);
  remove(); await coordinator.run();
});

