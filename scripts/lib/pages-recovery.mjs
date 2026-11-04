// GitHub Pages cancellation is asynchronous. A completed Actions run can leave
// its Pages deployment active, blocking every later five-minute refresh.
const terminal = new Set(['succeed', 'deployment_failed', 'deployment_perms_error', 'deployment_content_failed', 'deployment_cancelled', 'deployment_lost']);
const publishingWorkflows = new Set(['calendar-sync', 'deploy-pages', 'deploy-team-api', 'mark-paid', 'override-payment', 'match-stripe-payment', 'update-guidelines', 'update-team'].map(name => `.github/workflows/${name}.yml`));
const failed = new Set(['failure', 'cancelled', 'timed_out']);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export async function recoverPages({ github, context, core, currentOnly = false, includeCurrent = false, wait = sleep }) {
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
