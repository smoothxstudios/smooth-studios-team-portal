// These are the same password-encrypted files already stored in the public
// repository. Read committed data independently of GitHub Pages publication.
export const DASHBOARD_DATA_SOURCE = 'https://raw.githubusercontent.com/smoothxstudios/smooth-studios-team-portal/main/public/data/';

/**
 * @param {string} fileName
 * @param {{fetcher?: typeof fetch, signal?: AbortSignal}} [options]
 */
export async function readDashboardData(fileName, { fetcher = fetch, signal } = {}) {
  if (!/^[a-z0-9][a-z0-9-]*\.json$/.test(fileName)) throw new Error('Invalid dashboard data file.');
  const query = `?v=${Date.now()}`;
  let lastError;
  for (const base of [DASHBOARD_DATA_SOURCE, './data/']) {
    signal?.throwIfAborted();
    try {
      const timeout = AbortSignal.timeout(10_000);
      const response = await fetcher(`${base}${fileName}${query}`, {
        cache: 'no-store', credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer',
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
      if (!response.ok) throw new Error('Dashboard data is unavailable.');
      const value = await response.json();
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid dashboard data.');
      return value;
    } catch (error) {
      if (signal?.aborted) throw error;
      lastError = error;
    }
  }
  // The published copy remains a read-only fallback during a data-host outage.
  // Callers still decrypt, verify the account/role, and reject older snapshots.
  throw lastError;
}
