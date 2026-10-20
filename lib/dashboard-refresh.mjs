import { expandHomeLedger } from './dashboard-history.mjs';
import { TEAM_API_URL } from './team-schedule.mjs';

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
 * @template {{user: {id: string}, role: string, generatedAt: string}} T
 * @param {{profile: {id: string, role: string}, password: string,
 * decrypt: (envelope: any, password: string) => Promise<T>,
 * isCurrent: () => boolean, onSnapshot: (payload: T) => void, fetcher?: typeof fetch,
 * canApply?: () => boolean, cache?: {envelope: string | null, generatedAt: string, etag?: string | null, upgrading?: boolean}, path?: string}} options
 */
export async function refreshDashboardSnapshot({ profile, password, decrypt, isCurrent, onSnapshot, fetcher = fetch, cache, canApply = () => true, path = "/dashboard" }) {
  const response = await fetcher(`${TEAM_API_URL}${path}`, {
    cache: 'no-store', signal: AbortSignal.timeout(20_000),
    ...(cache?.etag ? { headers: { 'if-none-match': cache.etag } } : {}),
  });
  if (response.status === 304 && cache?.etag) return isCurrent();
  if (!response.ok) throw new Error('Dashboard data is unavailable.');
  if (!isCurrent()) return false;
  const envelope = await response.json();
  const serialized = JSON.stringify(envelope);
  if (!isCurrent()) return false;
  if (cache?.envelope === serialized) { cache.etag = response.headers.get("etag"); return true; }
  const next = expandHomeLedger(await decrypt(envelope, password));
  if (next.user.id !== profile.id || next.role !== profile.role) throw new Error('Invalid dashboard payload.');
  if (!isCurrent()) return false;
  // A dialog may have opened while the request was in flight. Leave the cache
  // unchanged so the next check can apply this publication after editing ends.
  if (!canApply()) return true;
  if (cache) {
    // A delayed Pages/CDN response must not roll a newer snapshot backward.
    const nextTime = Date.parse(next.generatedAt), currentTime = Date.parse(cache.generatedAt);
    if (!Number.isFinite(nextTime)) throw new Error('Invalid dashboard update time.');
    if (Number.isFinite(currentTime) && nextTime < currentTime) return true;
    cache.envelope = serialized;
    cache.etag = response.headers.get("etag");
    if (nextTime === currentTime && !cache.upgrading) return true;
    cache.generatedAt = next.generatedAt;
  }
  onSnapshot(next);
  return true;
}

/** Share manual and automatic reads for one authenticated session. */
export function createDashboardSnapshotReader(options, initialSnapshot, initialEnvelope, initialTag = null) {
  let full = !initialSnapshot.history?.deferred, wantsHistory = false;
  const cache = { envelope: JSON.stringify(initialEnvelope), generatedAt: initialSnapshot.generatedAt, etag: initialTag, upgrading: false };
  let pending = null;
  const read = () => {
    if (!options.isCurrent()) return Promise.resolve(false);
    if (pending) return pending;
    const upgrading = wantsHistory && !full;
    if (options.canApply && !options.canApply()) return Promise.resolve(true);
    const attempt = upgrading ? { envelope: null, generatedAt: cache.generatedAt, etag: null, upgrading: true } : cache;
    pending = refreshDashboardSnapshot({ ...options, cache: attempt,
      path: full || upgrading ? '/dashboard' : '/dashboard?view=home',
      onSnapshot: next => {
        if (upgrading && next.history?.deferred) throw new Error('Full history is not available yet.');
        if (upgrading) { full = true; Object.assign(cache, attempt, { upgrading: false }); }
        options.onSnapshot(next);
      },
    }).finally(() => { pending = null; });
    return pending;
  };
  read.loadHistory = async () => {
    wantsHistory = true;
    // Finish a Home read first so it cannot overwrite the full history later.
    if (pending) await pending;
    if (!options.isCurrent()) return false;
    if (!full) await read();
    return full;
  };
  return read;
}

/** Published data must not replace the source of an open editor or picker. */
export function dashboardHasOpenEditor(doc = document) {
  return Boolean(doc.querySelector('[role="dialog"]:not([data-history-loading]), [role="alertdialog"], [role="listbox"], [role="menu"]') ||
    doc.activeElement?.matches('input, textarea, select, [contenteditable]:not([contenteditable="false"])'));
}

/** Quiet reads only: never navigate, scroll, reload, or invoke a sync workflow. */
export function attachQuietSnapshotRefresh(read, { win = window, doc = document, now = Date.now, intervalMs = 30_000 } = {}) {
  let disposed = false, busy = false, lastAttempt = now();
  const check = () => {
    if (disposed || busy || doc.visibilityState !== 'visible' || win.navigator.onLine === false || now() - lastAttempt < 3_000) return;
    lastAttempt = now(); busy = true;
    void Promise.resolve().then(() => disposed ? undefined : read()).catch(() => {
      // Keep the last usable data; manual refresh still reports its own errors.
    }).finally(() => { busy = false; });
  };
  const timer = win.setInterval(check, intervalMs);
  const events = ['focus', 'pageshow', 'online'];
  for (const event of events) win.addEventListener(event, check);
  doc.addEventListener('visibilitychange', check);
  return () => {
    disposed = true; win.clearInterval(timer);
    for (const event of events) win.removeEventListener(event, check);
    doc.removeEventListener('visibilitychange', check);
  };
}
