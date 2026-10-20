import { base64url, tokenHash } from '../lib/team-auth.mjs';
import { TEAM } from '../lib/team-schedule.mjs';

export const SESSION_IDLE_MS = 30 * 60_000;
export const SESSION_MAX_MS = 12 * 60 * 60_000;
const users = TEAM.map(person => person.id);
const expired = fail => fail(401, 'Your session ended. Sign in again to continue.');
function equal(a, b) {
  let difference = a.length ^ b.length;
  for (let i = 0; i < b.length; i++) difference |= (a.charCodeAt(i) || 0) ^ b.charCodeAt(i);
  return difference === 0;
}

export async function authenticate(request, env, fail) {
  if (!env.TEAM_TOKEN_HASHES) fail(503, 'Sign-in is temporarily unavailable.');
  const token = request.headers.get('authorization')?.match(/^Bearer ((?:ss1\.)?[A-Za-z0-9_-]{43})$/)?.[1];
  if (!token) return expired(fail);
  const digest = await tokenHash(token), hashes = JSON.parse(env.TEAM_TOKEN_HASHES);
  if (token.startsWith('ss1.')) {
    const session = await env.DB.prepare('SELECT * FROM dashboard_sessions WHERE token_hash = ?').bind(digest).first();
    if (!session || !users.includes(session.user_id) || session.expires_at <= Date.now() || session.absolute_expires_at <= Date.now() ||
        !equal(hashes[session.user_id] || '', session.credential_hash)) return expired(fail);
    return { user: session.user_id, session, digest };
  }
  let user;
  for (const id of [...users, 'sync']) if (equal(hashes[id] || '', digest)) user = id;
  if (!user) return expired(fail);
  // Credential proofs bootstrap sessions and retain the separate Content Vault
  // identity contract. Machine synchronization is restricted by the route guard.
  const path = new URL(request.url).pathname;
  if (user !== 'sync' && path !== '/auth/session' && !['/identity', '/identity/team'].includes(path)) return expired(fail);
  return { user, digest, credential: true };
}

export async function sessionRoute({request, env, auth, fail}) {
  const path = new URL(request.url).pathname, now = Date.now(), db = env.DB;
  if (path !== '/auth/session') return undefined;
  if (request.method === 'POST') {
    if (!auth.credential || auth.user === 'sync') fail(403, 'Sign in with your dashboard account.');
    const token = `ss1.${base64url(crypto.getRandomValues(new Uint8Array(32)))}`;
    const digest = await tokenHash(token), expiresAt = now + SESSION_IDLE_MS, absoluteExpiresAt = now + SESSION_MAX_MS;
    await db.batch([
      db.prepare('DELETE FROM dashboard_sessions WHERE expires_at <= ? OR absolute_expires_at <= ?').bind(now, now),
      db.prepare('INSERT INTO dashboard_sessions (token_hash, user_id, credential_hash, created_at, expires_at, absolute_expires_at) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(digest, auth.user, auth.digest, now, expiresAt, absoluteExpiresAt),
      db.prepare('DELETE FROM dashboard_sessions WHERE user_id = ? AND token_hash NOT IN (SELECT token_hash FROM dashboard_sessions WHERE user_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 10)').bind(auth.user, auth.user),
    ]);
    return { token, expiresAt, absoluteExpiresAt, userId: auth.user };
  }
  if (!auth.session) fail(403, 'A signed-in session is required.');
  if (request.method === 'DELETE') {
    await db.prepare('DELETE FROM dashboard_sessions WHERE token_hash = ?').bind(auth.digest).run();
    return { signedOut: true };
  }
  if (request.method === 'PATCH') {
    const expiresAt = Math.min(now + SESSION_IDLE_MS, auth.session.absolute_expires_at);
    const result = await db.prepare('UPDATE dashboard_sessions SET expires_at = MAX(expires_at, ?) WHERE token_hash = ? AND expires_at > ? AND absolute_expires_at > ?')
      .bind(expiresAt, auth.digest, now, now).run();
    if (!result.meta.changes) return expired(fail);
    return { expiresAt, absoluteExpiresAt: auth.session.absolute_expires_at };
  }
  fail(405, 'Method not allowed.');
}

export async function dashboardSnapshotRoute({request, db, user, body, fail}) {
  const url = new URL(request.url), machine = url.pathname === '/sync/dashboard';
  if (!machine && url.pathname !== '/dashboard') return undefined;
  const id = machine ? url.searchParams.get('id') : user;
  if (![...users, 'team-settings'].includes(id) || (!machine && id === 'team-settings')) fail(400, 'Choose a dashboard account.');
  if (request.method === 'GET') {
    const row = await db.prepare('SELECT envelope FROM dashboard_snapshots WHERE user_id = ?').bind(id).first();
    if (!row) fail(404, 'Dashboard data is not available yet. Please try again shortly.');
    return JSON.parse(row.envelope);
  }
  if (machine && request.method === 'PUT') {
    const input = await body(request, 1_900_000), e = input.envelope;
    if (e?.version !== 1 || e?.algorithm !== 'AES-GCM' || e?.kdf !== 'PBKDF2-SHA256' ||
        e.iterations !== 310000 || !/^[A-Za-z0-9+/]{22}==$/.test(e.salt || '') || !/^[A-Za-z0-9+/]{16}$/.test(e.iv || '') || typeof e.ciphertext !== 'string' ||
        !/^[A-Za-z0-9+/]+={0,2}$/.test(e.ciphertext) || e.ciphertext.length < 24 || !Number.isSafeInteger(input.publishedAt) || input.publishedAt > Date.now() + 60_000 || input.publishedAt < 1) {
      fail(400, 'Invalid encrypted dashboard.');
    }
    const envelope = JSON.stringify({ version: e.version, algorithm: e.algorithm, kdf: e.kdf, iterations: e.iterations, salt: e.salt, iv: e.iv, ciphertext: e.ciphertext });
    const result = await db.prepare(`INSERT INTO dashboard_snapshots (user_id, envelope, published_at) VALUES (?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET envelope = excluded.envelope, published_at = excluded.published_at
      WHERE excluded.published_at > dashboard_snapshots.published_at`).bind(id, envelope, input.publishedAt).run();
    return { saved: Boolean(result.meta.changes) };
  }
  fail(405, 'Method not allowed.');
}
