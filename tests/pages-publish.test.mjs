import test from 'node:test';
import assert from 'node:assert/strict';
import { pagesBuildVersion, publishPages, releasePagesDeployment } from '../scripts/lib/pages-publish.mjs';

const context = { repo: { owner: 'fixture', repo: 'dashboard' }, runId: 42, sha: 'a'.repeat(40) };
function fixture({ states = [['succeed']], artifacts = [{ id: 7, name: 'github-pages', expired: false }], createError, cancelStates = ['deployment_cancelled'] } = {}) {
  let clock = 0;
  let attempt = 0;
  let cancelling = false;
  const calls = [];
  const outputs = {};
  const github = {
    rest: { actions: { listWorkflowRunArtifacts() {} } },
    paginate: async () => artifacts,
    request: async (route, args) => {
      calls.push({ route, ...args });
      if (route.endsWith('/cancel')) { cancelling = true; return { status: 204 }; }
      if (route.startsWith('POST')) {
        attempt++;
        cancelling = false;
        if (createError) throw createError;
        return { data: { id: args.pages_build_version, page_url: 'https://dashboard.example.test/' } };
      }
      const responses = cancelling ? cancelStates : states[attempt - 1];
      const state = responses.length > 1 ? responses.shift() : responses[0];
      if (state instanceof Error) throw state;
      return { data: { status: state } };
    },
  };
  const wait = async ms => { clock += ms; };
  return {
    calls, outputs, github, wait,
    run: options => publishPages({ github, context, core: { getIDToken: async () => 'fixture-oidc', info() {}, warning() {}, setOutput: (key, value) => { outputs[key] = value; } }, runAttempt: 1, wait, now: () => clock, timeout: 10000, ...options }),
  };
}

test('a stalled deployment is cancelled and retried with the same artifact but a fresh identity', async () => {
  const f = fixture({ states: [['updating_pages'], ['succeed']] });
  const result = await f.run();
  assert.equal(result.attempt, 2);
  const creates = f.calls.filter(call => call.route.endsWith('/deployments'));
  assert.equal(creates.length, 2);
  assert.equal(creates[0].artifact_id, creates[1].artifact_id);
  assert.notEqual(creates[0].pages_build_version, creates[1].pages_build_version);
  assert.notEqual(creates[0].pages_build_version, context.sha);
  const cancelIndex = f.calls.findIndex(call => call.route.endsWith('/cancel'));
  const secondCreateIndex = f.calls.findIndex(call => call.pages_build_version === creates[1].pages_build_version);
  assert.ok(cancelIndex < secondCreateIndex);
  assert.equal(f.calls[cancelIndex].pages_deployment_id, creates[0].pages_build_version);
  assert.equal(f.outputs.page_url, 'https://dashboard.example.test/');
});

test('blank statuses never produce a successful result and both attempts are bounded', async () => {
  const f = fixture({ states: [[''], ['']] });
  await assert.rejects(f.run(), /timed out.*blank status/);
  assert.equal(f.calls.filter(call => call.route.endsWith('/deployments')).length, 2);
  assert.equal(f.calls.filter(call => call.route.endsWith('/cancel')).length, 2);
  assert.equal(f.outputs.page_url, undefined);
});

test('cancellation must be confirmed before creating the replacement deployment', async () => {
  const f = fixture({ states: [['']], cancelStates: [''] });
  await assert.rejects(f.run(), /has not confirmed cancellation/);
  assert.equal(f.calls.filter(call => call.route.endsWith('/deployments')).length, 1);
  assert.equal(f.calls.filter(call => call.route.endsWith('/cancel')).length, 3);
});

test('a transient status request error can recover without republishing', async () => {
  const f = fixture({ states: [[Object.assign(new Error('temporary'), { status: 502 }), 'succeed']] });
  assert.equal((await f.run()).attempt, 1);
  assert.equal(f.calls.filter(call => call.route.endsWith('/deployments')).length, 1);
});

test('permissions and invalid content fail visibly without repeated publication', async () => {
  for (const status of ['deployment_perms_error', 'deployment_content_failed']) {
    const f = fixture({ states: [[status]] });
    await assert.rejects(f.run(), new RegExp(status));
    assert.equal(f.calls.filter(call => call.route.endsWith('/deployments')).length, 1);
    assert.equal(f.outputs.page_url, undefined);
  }
  const denied = fixture({ createError: Object.assign(new Error('Denied'), { status: 403 }) });
  await assert.rejects(denied.run(), /Denied/);
  assert.equal(denied.calls.length, 1);
});

test('missing, expired, and ambiguous artifacts fail before creating a deployment', async () => {
  for (const artifacts of [[], [{ id: 1, name: 'github-pages', expired: true }], [{ id: 1, name: 'github-pages' }, { id: 2, name: 'github-pages' }]]) {
    const f = fixture({ artifacts });
    await assert.rejects(f.run(), /Expected one unexpired/);
    assert.equal(f.calls.length, 0);
  }
});

test('workflow reruns and other workflows at the same commit use distinct deployment identities', () => {
  const original = pagesBuildVersion(context, 1);
  assert.notEqual(original, pagesBuildVersion({ ...context, runAttempt: 2 }, 1));
  assert.notEqual(original, pagesBuildVersion({ ...context, runId: 43 }, 1));
  assert.throws(() => pagesBuildVersion({ ...context, sha: '../invalid' }, 1), /valid workflow identity/);
});

test('a missing deployment is already released but authorization errors remain visible', async () => {
  for (const status of [404, 403]) {
    const operation = releasePagesDeployment({ github: { request: async () => { throw Object.assign(new Error('Denied or missing'), { status }); } }, repo: context.repo, deploymentId: 'fixture', wait: async () => {} });
    if (status === 404) await operation;
    else await assert.rejects(operation, /Denied or missing/);
  }
});
