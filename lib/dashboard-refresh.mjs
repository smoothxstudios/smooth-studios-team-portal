/** Coordinate reads from the mounted dashboard without reloading its session. */
export function createDashboardRefresh(timeoutMs = 25_000) {
  const readers = new Set();
  let pending = null;
  let activeReaders = [];
  return {
    register(reader) { readers.add(reader); return () => { readers.delete(reader); }; },
    run() {
      if (pending) {
        if ([...readers].every(reader => activeReaders.includes(reader))) return pending;
        // Navigation can mount new sources while the previous page refreshes.
        // Queue a fresh pass so that page is never reported as already updated.
        return pending.catch(() => {}).then(() => this.run());
      }
      let timer;
      activeReaders = [...readers];
      const reads = Promise.allSettled(activeReaders.map(reader => Promise.resolve().then(reader))).then(results => {
        if (results.some(result => result.status === 'rejected' || result.value === false)) {
          throw new Error('Some updates couldn’t load. Check your connection and pull again.');
        }
      });
      pending = Promise.race([reads, new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Refresh took too long. Check your connection and pull again.')), timeoutMs);
      })]).finally(() => { clearTimeout(timer); pending = null; });
      return pending;
    },
  };
}

/**
 * Refresh only the signed-in account. A logout/account switch invalidates the
 * pending result, even if it happens while decryption is finishing.
 * @template {{user: {id: string}, role: string}} T
 * @param {{profile: {id: string, role: string}, password: string,
 * decrypt: (envelope: any, password: string) => Promise<T>,
 * isCurrent: () => boolean, onSnapshot: (payload: T) => void, fetcher?: typeof fetch}} options
 */
export async function refreshDashboardSnapshot({ profile, password, decrypt, isCurrent, onSnapshot, fetcher = fetch }) {
  const response = await fetcher(`./data/${encodeURIComponent(profile.id)}.json?v=${Date.now()}`, {
    cache: 'no-store', signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error('Dashboard data is unavailable.');
  if (!isCurrent()) return false;
  const next = await decrypt(await response.json(), password);
  if (next.user.id !== profile.id || next.role !== profile.role) throw new Error('Invalid dashboard payload.');
  if (!isCurrent()) return false;
  onSnapshot(next);
  return true;
}
