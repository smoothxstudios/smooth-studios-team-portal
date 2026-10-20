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
export async function openTeamSession(proof, userId, fetcher = fetch) {
  const response = await request(proof, '/auth/session', { method: 'POST' }, fetcher);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Sign-in is unavailable. Please try again.');
  if (!/^ss1\.[A-Za-z0-9_-]{43}$/.test(data.token) || data.userId !== userId || !Number.isSafeInteger(data.expiresAt) ||
      !Number.isSafeInteger(data.absoluteExpiresAt) || data.expiresAt <= Date.now() || data.absoluteExpiresAt < data.expiresAt) throw new Error('Invalid sign-in response.');
  sessions.set(data.token, { ...data, renewal: null });
  return data.token;
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
  return request(token, path, options, fetcher);
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
