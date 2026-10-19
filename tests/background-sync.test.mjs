import test from 'node:test';
import assert from 'node:assert/strict';
import { D1 } from './helpers/notification-fixture.mjs';
import { requestBackgroundSync } from '../team-api/background-sync.mjs';

const now = Date.parse('2026-10-19T02:00:00Z');
function setup(t) {
  const DB = new D1(); t.after(() => DB.sqlite.close());
  return { DB, DASHBOARD_SYNC_TOKEN: 'synthetic-token' };
}
const state = env => env.DB.sqlite.prepare('SELECT * FROM dashboard_sync_requests').get();
const stamp = (env, at) => env.DB.sqlite.prepare('UPDATE team_state SET synced_at = ? WHERE id = 1').run(new Date(at).toISOString());
function api(runs = []) {
  const calls = [];
  return { calls, send: async (url, options) => {
    calls.push({url, options});
    return options.method === 'POST' ? new Response(null, { status: 204 }) : Response.json({workflow_runs: runs});
  } };
}
test('disabled and fresh syncs do not request work or write a lease', async t => {
  const env = setup(t), mock = api();
  assert.equal((await requestBackgroundSync({DB: env.DB}, mock.send, now)).status, 'disabled');
  stamp(env, now - 60_000);
  assert.equal((await requestBackgroundSync(env, mock.send, now)).status, 'fresh');
  assert.equal(mock.calls.length, 0); assert.equal(state(env).requested_at, 0);
});
test('stale data dispatches only the fixed main workflow, and simultaneous checks share the lease', async t => {
  const env = setup(t), mock = api(); stamp(env, now - 2 * 3600_000);
  const results = await Promise.all([requestBackgroundSync(env, mock.send, now), requestBackgroundSync(env, mock.send, now)]);
  assert.deepEqual(results.map(r => r.status).sort(), ['pending', 'requested']);
  assert.equal(mock.calls.length, 2);
  const dispatch = mock.calls[1];
  assert.equal(dispatch.url, 'https://api.github.com/repos/smoothxstudios/smooth-studios-team-portal/actions/workflows/calendar-sync.yml/dispatches');
  assert.deepEqual(JSON.parse(dispatch.options.body), {ref: 'main'});
  assert.equal(dispatch.options.headers.authorization, 'Bearer synthetic-token');
  assert.equal(dispatch.options.redirect, 'manual');
  assert.equal(state(env).result, 'requested');
  assert.equal((await requestBackgroundSync(env, mock.send, now + 5 * 60_000)).status, 'pending');
  assert.equal(mock.calls.length, 2);
  assert.equal(env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM team_creative_assignments').get().n, 0);
});
test('active imports and backend deployments prevent duplicate work and allow a later retry', async t => {
  for (const path of ['.github/workflows/calendar-sync.yml', '.github/workflows/deploy-team-api.yml']) {
    const env = setup(t), mock = api([{path, status: 'in_progress'}]);
    assert.equal((await requestBackgroundSync(env, mock.send, now)).status, 'running');
    assert.equal(mock.calls.length, 1);
    const next = api([{path, status: 'completed'}]);
    assert.equal((await requestBackgroundSync(env, next.send, now + 5 * 60_000)).status, 'requested');
    assert.equal(next.calls.length, 2);
  }
});
test('a completed import ends the old lease while fresh data waits until the next due check', async t => {
  const env = setup(t), mock = api();
  await requestBackgroundSync(env, mock.send, now);
  stamp(env, now + 60_000);
  assert.equal((await requestBackgroundSync(env, mock.send, now + 2 * 60_000)).status, 'fresh');
  assert.equal((await requestBackgroundSync(env, mock.send, now + 5 * 60_000)).status, 'requested');
  assert.equal(mock.calls.length, 4);
});
test('API rejection retries later, while an ambiguous dispatch response retains its longer lease', async t => {
  for (const phase of ['check', 'dispatch', 'lost']) {
    const env = setup(t); let calls = 0;
    const send = async (_url, options) => {
      calls++;
      if (phase === 'check') return new Response('rejected', {status: 403});
      if (options.method !== 'POST') return Response.json({workflow_runs: []});
      if (phase === 'lost') throw Error('synthetic lost response');
      return new Response('rejected', {status: 503});
    };
    const result = await requestBackgroundSync(env, send, now);
    assert.equal(result.status, phase === 'lost' ? 'unknown' : `${phase}_failed`);
    const before = calls;
    assert.equal((await requestBackgroundSync(env, send, now + 60_000)).status, 'pending');
    assert.equal(calls, before);
    assert.equal(state(env).lease_until, now + (phase === 'lost' ? 10 : 5) * 60_000);
    assert.ok(!JSON.stringify(state(env)).includes('synthetic-token'));
  }
});
