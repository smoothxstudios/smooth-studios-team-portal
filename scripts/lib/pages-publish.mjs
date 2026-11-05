// Pages uses pages_build_version as a deployment identity. Reusing the cancelled
// commit identity can leave a retry polling the old deployment's blank status.
export function pagesBuildVersion({ sha, runId, runAttempt = 1 }, attempt) {
  if (!/^[a-f0-9]{40}$/.test(sha) || !/^\d+$/.test(String(runId)) || !/^\d+$/.test(String(runAttempt)) || ![1, 2].includes(attempt)) {
    throw new Error('A Pages deployment needs a valid workflow identity.');
  }
  return `${sha}-${runId}-${runAttempt}-${attempt}`;
}

const terminal = new Set(['succeed', 'deployment_failed', 'deployment_perms_error', 'deployment_content_failed', 'deployment_cancelled', 'deployment_lost']);
const permanent = new Set(['deployment_perms_error', 'deployment_content_failed']);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const request = { timeout: 15000 };

// Cancellation is asynchronous. Unknown/blank status is not proof of completion.
export async function releasePagesDeployment({ github, repo, deploymentId, wait = sleep }) {
  const params = { ...repo, pages_deployment_id: deploymentId, request };
  for (let poll = 0; poll < 12; poll++) {
    try {
      if (poll % 4 === 0) await github.request('POST /repos/{owner}/{repo}/pages/deployments/{pages_deployment_id}/cancel', params);
      await wait(5000);
      const { data } = await github.request('GET /repos/{owner}/{repo}/pages/deployments/{pages_deployment_id}', params);
      if (terminal.has(data.status) || data.status === 'not_found') return;
    } catch (error) {
      if (error.status === 404) return;
      throw error;
    }
  }
  throw new Error(`Pages deployment ${deploymentId} has not confirmed cancellation; publication stopped to avoid overlapping deployments.`);
}

export async function publishPages({ github, context, core, runAttempt = process.env.GITHUB_RUN_ATTEMPT || 1, wait = sleep, now = Date.now, timeout = 180000 }) {
  const identity = { sha: context.sha, runId: context.runId, runAttempt };
  // Validate before requesting a token or creating a deployment.
  pagesBuildVersion(identity, 1);
  const artifacts = await github.paginate(github.rest.actions.listWorkflowRunArtifacts, { ...context.repo, run_id: context.runId, per_page: 100, request });
  const matches = artifacts.filter(artifact => artifact.name === 'github-pages' && !artifact.expired);
  if (matches.length !== 1) throw new Error(`Expected one unexpired github-pages artifact for this run; found ${matches.length}.`);

  for (let attempt = 1; attempt <= 2; attempt++) {
    const buildVersion = pagesBuildVersion(identity, attempt);
    let deploymentId = buildVersion;
    let created = false;
    let finished = false;
    try {
      // Tokens stay in memory and are never written to logs or outputs.
      const idToken = await core.getIDToken();
      core.info(`Publishing dashboard with a fresh deployment (attempt ${attempt}/2).`);
      const { data } = await github.request('POST /repos/{owner}/{repo}/pages/deployments', {
        ...context.repo, artifact_id: matches[0].id, pages_build_version: buildVersion, oidc_token: idToken, request,
      });
      created = true;
      deploymentId = data.id || data.status_url?.split('/').pop() || buildVersion;
      const pageUrl = data.page_url || data.html_url;
      if (!pageUrl || !pageUrl.startsWith('https://')) throw new Error('GitHub did not return an HTTPS Pages URL.');
      const deadline = now() + timeout;
      let lastStatus = '';
      let lastReported;
      while (now() < deadline) {
        await wait(5000);
        let status;
        try {
          const response = await github.request('GET /repos/{owner}/{repo}/pages/deployments/{pages_deployment_id}', {
            ...context.repo, pages_deployment_id: deploymentId, request,
          });
          status = response.data.status || '';
        } catch (error) {
          if (error.status === 401 || error.status === 403) throw error;
          lastStatus = `status request failed (${error.status || 'network'})`;
          continue; // A transient status-read failure is not a failed publication.
        }
        lastStatus = status;
        if (status !== lastReported) core.info(`Pages status: ${status || 'not reported yet'}.`);
        lastReported = status;
        if (status === 'succeed') {
          finished = true;
          core.setOutput('page_url', pageUrl);
          core.setOutput('deployment_id', deploymentId);
          core.info('GitHub confirmed dashboard publication.');
          return { pageUrl, deploymentId, attempt };
        }
        if (terminal.has(status)) {
          finished = true;
          throw Object.assign(new Error(`Pages publication ended with ${status}.`), { permanent: permanent.has(status) });
        }
      }
      throw new Error(`Pages publication timed out after ${timeout / 1000} seconds (${lastStatus || 'blank status'}).`);
    } catch (error) {
      // A creation request can time out after GitHub accepts it. Its deterministic
      // identity still lets us release it before making another attempt.
      if (!finished && (created || ![400, 401, 403, 404, 422].includes(error.status))) {
        await releasePagesDeployment({ github, repo: context.repo, deploymentId, wait });
      }
      if (attempt === 2 || error.permanent || [400, 401, 403, 404].includes(error.status)) throw error;
      core.warning(`${error.message} Retrying with a new deployment identity.`);
      await wait(15000);
    }
  }
}
