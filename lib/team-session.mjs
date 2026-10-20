import { TEAM_API_URL } from './team-schedule.mjs';

const sessions = new Map(); // Memory only: neither bearer nor password is persisted.
export const SESSION_ENDED_EVENT = 'smooth-session-ended';
const endedMessage = 'Your session ended. Sign in again to continue.';
function ended(token) {
  sessions.delete(token);
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(SESSION_ENDED_EVENT, { detail: { token } }));
}
async function request(token, path, options = {}, fetcher = fetch) {
  const response = await fetcher(`${TEAM_API_URL}${path}`, { cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(20_000), ...options,
    headers: { ...options.headers, authorization: `Bearer ${token}`, 'content-type': 'application/json' } });
  if (response.status === 401) ended(token);
  return response;
}
async function createSession(proof, userId, fetcher, dashboard) {
  const response = await request(proof, dashboard ? '/auth/session?dashboard=home' : '/auth/session', { method: 'POST' }, fetcher);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Sign-in is unavailable. Please try again.');
  if (!/^ss1\.[A-Za-z0-9_-]{43}$/.test(data.token) || data.userId !== userId || !Number.isSafeInteger(data.expiresAt) ||
      !Number.isSafeInteger(data.absoluteExpiresAt) || data.expiresAt <= Date.now() || data.absoluteExpiresAt < data.expiresAt) throw new Error('Invalid sign-in response.');
  const { dashboard: initial, ...session } = data;
  sessions.set(data.token, { ...session, renewal: null, reads: new Map() });
  return { token: data.token, dashboard: initial };
}
export async function openTeamSession(proof, userId, fetcher = fetch) {
  return (await createSession(proof, userId, fetcher, false)).token;
}
export async function openDashboardSession(proof, userId, fetcher = fetch) {
  return createSession(proof, userId, fetcher, true);
}
export async function maintainTeamSession(token, fetcher = fetch) {
  const session = sessions.get(token);
  if (!session) throw new Error(endedMessage);
  if (Math.min(session.expiresAt, session.absoluteExpiresAt) <= Date.now()) { ended(token); throw new Error(endedMessage); }
  if (session.expiresAt - Date.now() > 10 * 60_000 || (typeof document !== "undefined" && document.visibilityState !== "visible")) return;
  if (!session.renewal) session.renewal = (async () => {
    const response = await request(token, '/auth/session', { method: 'PATCH' }, fetcher);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not renew your session.');
    if (!Number.isSafeInteger(data.expiresAt) || data.expiresAt <= Date.now() || data.expiresAt > session.absoluteExpiresAt || data.absoluteExpiresAt !== session.absoluteExpiresAt) throw new Error('Invalid session renewal.');
    session.expiresAt = data.expiresAt;
  })().finally(() => { session.renewal = null; });
  return session.renewal;
}
export async function sessionFetch(token, path, options = {}, fetcher = fetch) {
  await maintainTeamSession(token, fetcher);
  if (options.signal?.aborted) throw options.signal.reason;
  const session = sessions.get(token);
  if (!session) throw new Error(endedMessage);
  if ((options.method || 'GET').toUpperCase() !== 'GET') {
    // A mutation starts a fresh read generation, including reads requested
    // while the write was in flight. Never reuse a pre-write response afterward.
    session.reads.clear();
    try { return await request(token, path, options, fetcher); }
    finally { session.reads.clear(); }
  }
  const key = JSON.stringify([path, [...new Headers(options.headers).entries()]]);
  let pending = session.reads.get(key);
  if (!pending) {
    pending = (async () => {
      const response = await request(token, path, { ...options, signal: AbortSignal.timeout(20_000) }, fetcher);
      const body = [204, 304].includes(response.status) ? null : await response.arrayBuffer();
      if (!sessions.has(token) && response.status !== 401) throw new Error(endedMessage);
      return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
    })().finally(() => { if (session.reads.get(key) === pending) session.reads.delete(key); });
    session.reads.set(key, pending);
  }
  return (await waitForRead(pending, options.signal)).clone();
}
function waitForRead(pending, signal) {
  if (!signal) return pending;
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    pending.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}
export async function closeTeamSession(token, fetcher = fetch) {
  sessions.delete(token);
  if (token) await request(token, '/auth/session', { method: 'DELETE' }, fetcher);
}

export function attachTeamSession(token, { win = window, doc = document } = {}) {
  const check = () => {
    const current = sessions.get(token);
    if (!current) return;
    if (Math.min(current.expiresAt, current.absoluteExpiresAt) <= Date.now()) { ended(token); return; }
    if (doc.visibilityState === 'visible' && win.navigator.onLine !== false) void maintainTeamSession(token).catch(() => {});
  };
  const timer = win.setInterval(check, 15_000);
  win.addEventListener('focus', check); doc.addEventListener('visibilitychange', check);
  check();
  return () => { win.clearInterval(timer); win.removeEventListener('focus', check); doc.removeEventListener('visibilitychange', check); };
}
