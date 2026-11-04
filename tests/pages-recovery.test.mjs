import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import yaml from 'js-yaml';
import { recoverPages } from '../scripts/lib/pages-recovery.mjs';

const sha = 'a'.repeat(40);
const context = { repo: { owner: 'fixture', repo: 'dashboard' }, runId: 2, sha: 'b'.repeat(40) };
const failedRun = { id: 1, head_sha: sha, status: 'completed', conclusion: 'failure', path: '.github/workflows/calendar-sync.yml' };
function fixture({ runs = [failedRun], states = ['updating_pages', 'updating_pages', 'deployment_cancelled'], ownerRuns = runs, error } = {}) {
  const calls = [];
  const github = {
    rest: { actions: { listWorkflowRunsForRepo: async args => ({ data: { workflow_runs: args.head_sha ? ownerRuns : runs } }) } },
    request: async (route, args) => {
      calls.push({ route, sha: args.pages_deployment_id });
      if (error) throw error;
      if (args.pages_deployment_id !== sha) throw Object.assign(new Error('No deployment'), { status: 404 });
      if (route.startsWith('POST')) return { status: 204 };
      return { data: { status: states.length > 1 ? states.shift() : states[0] } };
    },
  };
  const waits = [];
  return { calls, waits, run: options => recoverPages({ github, context, core: { info() {} }, wait: async ms => waits.push(ms), ...options }) };
}

test('an acknowledged cancellation must finish before publishing can resume', async () => {
  const f = fixture();
  assert.deepEqual(await f.run(), [sha]);
  assert.equal(f.waits.length, 2);
  assert.equal(f.calls.filter(c => c.route.startsWith('POST')).length, 1);
});
test('blank GitHub statuses still request orphan cancellation before the publish step verifies readiness', async () => {
  const f = fixture({ states: ['', ''] });
  assert.deepEqual(await f.run(), [sha]);
  assert.equal(f.calls.filter(c => c.route.startsWith('POST')).length, 1);
});
test('first publication does not attempt to cancel its own not-yet-created deployment', async () => {
  const f = fixture({ runs: [] });
  await f.run();
  assert.equal(f.calls.length, 0);
});
test('a cancellation that remains active is retried and fails visibly', async () => {
  const f = fixture({ states: ['updating_pages'] });
  await assert.rejects(f.run(), /cancellation has not finished/);
  assert.equal(f.calls.filter(c => c.route.startsWith('POST')).length, 3);
  assert.equal(f.waits.length, 12);
});
test('successful or already cancelled deployments remain untouched', async () => {
  for (const status of ['succeed', 'deployment_cancelled']) {
    const f = fixture({ states: [status] });
    assert.deepEqual(await f.run(), []);
    assert.equal(f.calls.filter(c => c.route.startsWith('POST')).length, 0);
  }
});
test('another running workflow with the same commit protects its deployment', async () => {
  const activeRun = { ...failedRun, id: 3, status: 'in_progress', conclusion: null };
  for (const options of [{ runs: [failedRun, activeRun] }, { ownerRuns: [activeRun] }]) {
    const f = fixture(options);
    assert.deepEqual(await f.run(), []);
    assert.equal(f.calls.filter(c => c.route.startsWith('POST')).length, 0);
  }
});
test('unrelated workflows and successful runs are not cancellation candidates', async () => {
  const f = fixture({ runs: [{ ...failedRun, path: '.github/workflows/deploy-production.yml' }, { ...failedRun, conclusion: 'success' }] });
  await f.run();
  assert.equal(f.calls.some(c => c.sha === sha), false);
});
test('same-run retry cleanup can recover its own timed-out Pages deployment', async () => {
  const f = fixture({ runs: [], states: ['updating_pages', 'deployment_cancelled'] });
  assert.deepEqual(await f.run({ context: { ...context, sha }, currentOnly: true }), [sha]);
});
test('missing deployments are ignored; authorization failures are not hidden', async () => {
  assert.deepEqual(await fixture({ error: Object.assign(new Error('Missing'), { status: 404 }) }).run(), []);
  await assert.rejects(fixture({ error: Object.assign(new Error('Denied'), { status: 403 }) }).run(), /Denied/);
});
test('calendar and code publishing share recovery, data lock, and the configured domain base path', () => {
  for (const name of ['calendar-sync', 'deploy-pages']) {
    const workflow = yaml.load(readFileSync(new URL(`../.github/workflows/${name}.yml`, import.meta.url), 'utf8'));
    assert.equal(workflow.permissions.actions, 'read');
    assert.equal(workflow.concurrency.group, 'smooth-studios-data-writes');
    assert.equal(workflow.concurrency['cancel-in-progress'], false);
    const steps = workflow.jobs.deploy.steps;
    assert.equal(steps[0].uses, 'actions/checkout@v4');
    assert.equal(steps[1].uses, './.github/actions/deploy-dashboard');
    const build = Object.values(workflow.jobs)[0].steps.find(step => step.run === 'npm run build:github-pages');
    assert.equal(build.env.GITHUB_PAGES_BASE_PATH, '${{ steps.pages.outputs.base_path }}');
  }
  const action = yaml.load(readFileSync(new URL('../.github/actions/deploy-dashboard/action.yml', import.meta.url), 'utf8'));
  const retry = action.runs.steps.find(step => step.id === 'retry');
  assert.equal(retry['continue-on-error'], undefined, 'second failure must fail the workflow');
  assert.match(retry.if, /first.outcome == 'failure'/);
});
