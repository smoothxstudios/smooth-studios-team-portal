// GitHub documents pages_build_version as a string, but the live endpoint
// requires a real commit SHA. A dedicated recovery ref gives each attempt a
// unique, reachable commit with the exact build tree, without changing main.
export const pagesRecoveryRef = 'heads/codex-pages-publishing';
export const pagesCommitPattern = /^chore: Pages publication for workflow (\d+) attempt (\d+)\.(\d+) \[skip ci\]$/;
const validSha = value => /^[a-f0-9]{40}$/.test(value);

export async function createPagesBuildCommit({ github, context, buildSha, runAttempt, attempt }) {
  if (!validSha(buildSha) || !/^\d+$/.test(String(context.runId)) || !/^\d+$/.test(String(runAttempt)) || ![1, 2].includes(attempt)) {
    throw new Error('A Pages deployment needs a valid workflow identity and build commit.');
  }
  let existing;
  try {
    existing = (await github.rest.git.getRef({ ...context.repo, ref: pagesRecoveryRef, request })).data;
  } catch (error) {
    if (error.status !== 404) throw error;
  }
  if (existing) {
    const previous = (await github.rest.git.getCommit({ ...context.repo, commit_sha: existing.object.sha, request })).data;
    const owner = pagesCommitPattern.exec(previous.message);
    if (!owner) throw new Error('The Pages recovery branch has unrelated changes; leaving it untouched.');
    if (Number(owner[1]) !== context.runId) {
      const { data } = await github.rest.actions.getWorkflowRun({ ...context.repo, run_id: Number(owner[1]), request });
      if (data.status !== 'completed') throw new Error('Another workflow still owns the Pages recovery branch.');
    }
  }
  const { data: source } = await github.rest.git.getCommit({ ...context.repo, commit_sha: buildSha, request });
  const { data: commit } = await github.rest.git.createCommit({
    ...context.repo, tree: source.tree.sha, parents: [buildSha],
    message: `chore: Pages publication for workflow ${context.runId} attempt ${runAttempt}.${attempt} [skip ci]`, request,
  });
  if (!validSha(commit.sha)) throw new Error('GitHub did not return a valid publication commit.');
  if (existing) await github.rest.git.updateRef({ ...context.repo, ref: pagesRecoveryRef, sha: commit.sha, force: true, request });
  else await github.rest.git.createRef({ ...context.repo, ref: `refs/${pagesRecoveryRef}`, sha: commit.sha, request });
  return commit.sha;
}

const terminal = new Set(['succeed', 'deployment_failed', 'deployment_perms_error', 'deployment_content_failed', 'deployment_cancelled', 'deployment_lost']);
const permanent = new Set(['deployment_perms_error', 'deployment_content_failed']);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const request = { timeout: 15000 };

// Cancellation is asynchronous. Unknown/blank status is not proof of completion.
export async function releasePagesDeployment({ github, repo, deploymentId, wait = sleep }) {
  const params = { ...repo, pages_deployment_id: deploymentId, request };
  try {
    const { data } = await github.request('GET /repos/{owner}/{repo}/pages/deployments/{pages_deployment_id}', params);
    if (terminal.has(data.status) || data.status === 'not_found') return data.status;
  } catch (error) {
    if (error.status === 404) return 'not_found';
    throw error;
  }
  for (let poll = 0; poll < 12; poll++) {
    try {
      if (poll % 4 === 0) await github.request('POST /repos/{owner}/{repo}/pages/deployments/{pages_deployment_id}/cancel', params);
      await wait(5000);
      const { data } = await github.request('GET /repos/{owner}/{repo}/pages/deployments/{pages_deployment_id}', params);
      if (terminal.has(data.status) || data.status === 'not_found') return data.status;
    } catch (error) {
      if (error.status === 404) return 'not_found';
      throw error;
    }
  }
  throw new Error(`Pages deployment ${deploymentId} has not confirmed cancellation; publication stopped to avoid overlapping deployments.`);
}

export async function publishPages({ github, context, core, buildSha = context.sha, runAttempt = process.env.GITHUB_RUN_ATTEMPT || 1, wait = sleep, now = Date.now, timeout = 180000 }) {
  if (!validSha(buildSha)) throw new Error('A Pages deployment needs the actual build commit.');
  const artifacts = await github.paginate(github.rest.actions.listWorkflowRunArtifacts, { ...context.repo, run_id: context.runId, per_page: 100, request });
  const matches = artifacts.filter(artifact => artifact.name === 'github-pages' && !artifact.expired);
  if (matches.length !== 1) throw new Error(`Expected one unexpired github-pages artifact for this run; found ${matches.length}.`);

  for (let attempt = 1; attempt <= 2; attempt++) {
    const buildVersion = await createPagesBuildCommit({ github, context, buildSha, runAttempt, attempt });
    let deploymentId = buildVersion;
    let created = false;
    let finished = false;
    let pageUrl;
    try {
      // Tokens stay in memory and are never written to logs or outputs.
      const idToken = await core.getIDToken();
      core.info(`Publishing dashboard with a fresh deployment (attempt ${attempt}/2).`);
      const { data } = await github.request('POST /repos/{owner}/{repo}/pages/deployments', {
        ...context.repo, artifact_id: matches[0].id, pages_build_version: buildVersion, oidc_token: idToken, request,
      });
      created = true;
      deploymentId = data.id || data.status_url?.split('/').pop() || buildVersion;
      pageUrl = data.page_url || data.html_url;
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
        const finalStatus = await releasePagesDeployment({ github, repo: context.repo, deploymentId, wait });
        if (finalStatus === 'succeed' && pageUrl?.startsWith('https://')) {
          core.setOutput('page_url', pageUrl);
          core.setOutput('deployment_id', deploymentId);
          core.info('GitHub confirmed dashboard publication during the final status check.');
          return { pageUrl, deploymentId, attempt };
        }
      }
      if (attempt === 2 || error.permanent || [400, 401, 403, 404].includes(error.status)) throw error;
      core.warning(`${error.message} Retrying with a new deployment identity.`);
      await wait(15000);
    }
  }
}
