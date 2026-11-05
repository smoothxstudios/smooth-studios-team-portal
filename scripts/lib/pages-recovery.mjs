// GitHub Pages cancellation is asynchronous. A completed Actions run can leave
// its Pages deployment active, blocking every later five-minute refresh.
import { pagesRecoveryRef, pagesCommitPattern, releasePagesDeployment } from './pages-publish.mjs';
const terminal = new Set(['succeed', 'deployment_failed', 'deployment_perms_error', 'deployment_content_failed', 'deployment_cancelled', 'deployment_lost']);
const publishingWorkflows = new Set(['calendar-sync', 'deploy-pages', 'deploy-team-api', 'mark-paid', 'override-payment', 'match-stripe-payment', 'update-guidelines', 'update-team'].map(name => `.github/workflows/${name}.yml`));
const failed = new Set(['failure', 'cancelled', 'timed_out']);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export async function recoverPages({ github, context, core, currentOnly = false, includeCurrent = false, runAttempt = process.env.GITHUB_RUN_ATTEMPT || 1, wait = sleep }) {
  const repo = context.repo;
  const request = { timeout: 15000 };
  const { data } = await github.rest.actions.listWorkflowRunsForRepo({ ...repo, branch: 'main', per_page: 100, request });
  // Never cancel a deployment that another running workflow may still own.
  const active = new Set(data.workflow_runs.filter(run => run.id !== context.runId && run.status === 'in_progress').map(run => run.head_sha));
  const candidates = new Set(currentOnly || includeCurrent ? [context.sha] : []);
  if (!currentOnly) for (const run of data.workflow_runs) {
    if (run.status === 'completed' && failed.has(run.conclusion) && publishingWorkflows.has(run.path)) candidates.add(run.head_sha);
  }
  const recovered = [];
  // New attempts have a reachable, dedicated commit. Its message records the
  // owning workflow so an orphan can be recovered without touching main.
  let recoveryCommit;
  try {
    const { data: ref } = await github.rest.git.getRef({ ...repo, ref: pagesRecoveryRef, request });
    recoveryCommit = (await github.rest.git.getCommit({ ...repo, commit_sha: ref.object.sha, request })).data;
  } catch (error) {
    if (error.status !== 404) throw error;
  }
  if (recoveryCommit) {
    const owner = pagesCommitPattern.exec(recoveryCommit.message);
    if (!owner) throw new Error('The Pages recovery branch has unrelated changes; leaving it untouched.');
    const ownerId = Number(owner[1]);
    const { data: ownerRun } = await github.rest.actions.getWorkflowRun({ ...repo, run_id: ownerId, request });
    const ownCleanup = ownerId === context.runId && (currentOnly || includeCurrent || Number(owner[2]) < Number(runAttempt));
    const abandoned = !currentOnly && ownerRun.status === 'completed' && failed.has(ownerRun.conclusion);
    if (ownCleanup || abandoned) {
      await releasePagesDeployment({ github, repo, deploymentId: recoveryCommit.sha, wait });
      recovered.push(recoveryCommit.sha);
      core.info(`Released Pages deployment from workflow ${ownerId}.`);
    }
  }
  for (const sha of candidates) {
    if (!/^[a-f0-9]{40}$/.test(sha) || active.has(sha)) continue;
    const params = { ...repo, pages_deployment_id: sha, request };
    const status = async () => {
      try {
        const response = await github.request('GET /repos/{owner}/{repo}/pages/deployments/{pages_deployment_id}', params);
        return response.data.status ?? '';
      } catch (error) {
        if (error.status === 404) return null; // Most failed runs never created a deployment.
        throw error;
      }
    };
    let state = await status();
    if (state === null || terminal.has(state) || state === 'not_found') continue;
    // Recheck ownership immediately before cancellation; a rerun may have started.
    const runs = await github.rest.actions.listWorkflowRunsForRepo({ ...repo, head_sha: sha, per_page: 100, request });
    if (runs.data.workflow_runs.some(run => run.id !== context.runId && run.status === 'in_progress')) continue;
    core.info(`Recovering unfinished Pages deployment ${sha.slice(0, 7)} (${state}).`);
    for (let attempt = 0; attempt < 12; attempt++) {
      if (attempt % 4 === 0) {
        try {
          await github.request('POST /repos/{owner}/{repo}/pages/deployments/{pages_deployment_id}/cancel', params);
        } catch (error) {
          if (error.status !== 404) throw error;
        }
      }
      await wait(5000);
      state = await status();
      if (!state || terminal.has(state) || state === 'not_found') break;
    }
    if (state && !terminal.has(state) && state !== 'not_found') throw new Error(`Pages deployment ${sha.slice(0, 7)} is still ${state}; cancellation has not finished.`);
    recovered.push(sha);
    core.info(state ? `Pages deployment ${sha.slice(0, 7)} released (${state}).` : `Cancellation requested for ${sha.slice(0, 7)}; Pages reports no active status. The publish step will verify that it can proceed.`);
  }
  return recovered;
}
