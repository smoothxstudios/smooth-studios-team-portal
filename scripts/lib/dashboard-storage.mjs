import { TEAM_API_URL } from '../../lib/team-schedule.mjs';
import { teamToken } from '../../lib/team-auth.mjs';

export async function dashboardStorage(ownerPassword, id, { envelope, homeEnvelope, publishedAt = Date.now(), fetcher = fetch } = {}) {
  const response = await fetcher(`${TEAM_API_URL}/sync/dashboard?id=${encodeURIComponent(id)}`, {
    method: envelope === undefined ? 'GET' : 'PUT', cache: 'no-store', redirect: 'error',
    headers: { authorization: `Bearer ${await teamToken(ownerPassword, 'sync')}`, 'content-type': 'application/json' },
    ...(envelope === undefined ? {} : { body: JSON.stringify({ envelope, homeEnvelope, publishedAt }) }), signal: AbortSignal.timeout(30_000),
  });
  if (envelope === undefined && response.status === 404) return null;
  if (!response.ok) throw new Error(`Encrypted dashboard storage failed (${response.status}); existing data was preserved.`);
  return response.json();
}
