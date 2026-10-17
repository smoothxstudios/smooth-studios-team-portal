import { TEAM } from '../lib/team-schedule.mjs';
import { base64url, unbase64url, tokenHash } from '../lib/team-auth.mjs';

const API = 'https://smooth-studios-team-api.smoothxstudios.workers.dev';
const CALLBACK = `${API}/calendar/oauth/callback`;
const DASHBOARD = 'https://dashboard.smoothstudios.co/';
const COOKIE = '__Host-smooth_calendar_oauth';
const EVENTS_SCOPE = 'https://www.googleapis.com/auth/calendar.events';
const LIST_SCOPE = 'https://www.googleapis.com/auth/calendar.calendarlist.readonly';
const STATE_LIFETIME = 10 * 60_000;
const validRandom = value => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
const email = value => typeof value === 'string' && value.length <= 254 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value.trim()) ? value.trim().toLowerCase() : null;
const random = () => base64url(crypto.getRandomValues(new Uint8Array(32)));
const noCache = { 'cache-control': 'no-store', pragma: 'no-cache', 'referrer-policy': 'no-referrer' };
const scopes = user => ['openid', 'email', EVENTS_SCOPE, ...(user === 'owner' ? [LIST_SCOPE] : [])];
const cookie = (value, lifetime = 600) => `${COOKIE}=${value}; Path=/; Max-Age=${lifetime}; Secure; HttpOnly; SameSite=Lax`;

function finish(connected) {
  return new Response(null, { status: 303, headers: { ...noCache,
    location: `${DASHBOARD}?calendar=${connected ? 'connected' : 'error'}`, 'set-cookie': cookie('', 0) } });
}
async function encryptionKey(env) {
  if (!validRandom(env.CALENDAR_CONNECTION_KEY)) throw new Error('Calendar connection encryption is unavailable.');
  const raw = unbase64url(env.CALENDAR_CONNECTION_KEY);
  if (raw.length !== 32) throw new Error('Calendar connection encryption is unavailable.');
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
async function seal(env, purpose, value) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv,
    additionalData: new TextEncoder().encode(`smooth-calendar:v1:${purpose}`) }, await encryptionKey(env), new TextEncoder().encode(JSON.stringify(value)));
  return JSON.stringify({ version: 1, iv: base64url(iv), ciphertext: base64url(new Uint8Array(ciphertext)) });
}
async function open(env, purpose, data) {
  const envelope = JSON.parse(data);
  if (envelope.version !== 1 || typeof envelope.iv !== 'string' || typeof envelope.ciphertext !== 'string') throw new Error('Invalid Calendar connection.');
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unbase64url(envelope.iv),
    additionalData: new TextEncoder().encode(`smooth-calendar:v1:${purpose}`) }, await encryptionKey(env), unbase64url(envelope.ciphertext));
  return JSON.parse(new TextDecoder().decode(plain));
}
async function oauthSettings(env) {
  const row = await env.DB.prepare('SELECT * FROM calendar_settings WHERE id = 1').first();
  if (!row || !validRandom(env.CALENDAR_CONNECTION_KEY)) return null;
  try { return { ...await open(env, 'settings', row.data), version: row.version }; }
  catch { return null; }
}

/** Private calendar and roster written by the existing authenticated sync. */
export async function getCalendarConfig(env) {
  const row = await env.DB.prepare('SELECT data FROM calendar_sync_config WHERE id = 1').first();
  if (!row) return null;
  try {
    const value = JSON.parse(row.data);
    if (typeof value.calendarId !== 'string' || !value.calendarId || value.calendarId.length > 1024 || !Array.isArray(value.employees)) return null;
    const seen = new Set();
    const employees = value.employees.map(person => {
      if (!TEAM.some(member => member.id === person?.id && member.id !== 'owner') || seen.has(person.id)) throw new Error();
      seen.add(person.id);
      const primary = email(person.email);
      const aliases = [...new Set([primary, ...(Array.isArray(person.invitationEmails) ? person.invitationEmails.map(email) : [])].filter(Boolean))];
      return { id: person.id, email: primary, invitationEmails: aliases };
    });
    return { calendarId: value.calendarId, employees };
  } catch { return null; }
}
function expectedEmployeeEmail(config, user, address) {
  return user === 'owner' || Boolean(config?.employees.find(person => person.id === user)?.invitationEmails.includes(address));
}
async function connection(env, user, settings, config) {
  const row = await env.DB.prepare('SELECT * FROM calendar_connections WHERE user_id = ?').bind(user).first();
  if (!row || !settings) return null;
  try {
    const value = await open(env, `connection:${user}`, row.data);
    if (value.clientVersion !== settings.version || !email(value.email) || !expectedEmployeeEmail(config, user, value.email) ||
        (user === 'owner' && value.calendarId !== config?.calendarId) ||
        typeof value.accessToken !== 'string' || typeof value.refreshToken !== 'string' || !Number.isFinite(value.expiresAt)) return null;
    return { row, value };
  } catch { return null; }
}
async function google(url, options) {
  return fetch(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(15_000) });
}
async function revoke(token) {
  try { await google('https://oauth2.googleapis.com/revoke', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token }) }); }
  catch { /* Disconnect locally even if Google is temporarily unavailable. */ }
}
const pendingRefreshes = new WeakMap();

/** Return only to server-side delivery code. Never include tokens in JSON responses. */
export async function calendarAccessToken(env, user) {
  if (!TEAM.some(person => person.id === user)) return null;
  const settings = await oauthSettings(env), config = await getCalendarConfig(env);
  const saved = await connection(env, user, settings, config);
  if (!saved) return null;
  if (saved.value.expiresAt > Date.now() + 60_000) return { accessToken: saved.value.accessToken, email: saved.value.email };
  let pending = pendingRefreshes.get(env.DB);
  if (!pending) { pending = new Map(); pendingRefreshes.set(env.DB, pending); }
  if (pending.has(user)) return pending.get(user);
  const refresh = (async () => {
    let response;
    try { response = await google('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: settings.clientId, client_secret: settings.clientSecret, refresh_token: saved.value.refreshToken, grant_type: 'refresh_token' }) }); }
    catch { throw new Error('Google Calendar could not reconnect. Try again shortly.'); }
    const tokens = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (tokens.error === 'invalid_grant' || tokens.error === 'invalid_client') {
        await env.DB.prepare('DELETE FROM calendar_connections WHERE user_id = ? AND data = ?').bind(user, saved.row.data).run();
        return null;
      }
      throw new Error('Google Calendar could not reconnect. Try again shortly.');
    }
    if (typeof tokens.scope === 'string' && !tokens.scope.split(' ').includes(EVENTS_SCOPE)) {
      await env.DB.prepare('DELETE FROM calendar_connections WHERE user_id = ? AND data = ?').bind(user, saved.row.data).run();
      return null;
    }
    if (typeof tokens.access_token !== 'string' || !tokens.access_token || tokens.access_token.length > 16384 || !Number.isFinite(tokens.expires_in) || tokens.expires_in <= 0 ||
        (tokens.refresh_token !== undefined && (typeof tokens.refresh_token !== 'string' || tokens.refresh_token.length > 16384))) throw new Error('Google Calendar returned an incomplete connection.');
    const value = { ...saved.value, accessToken: tokens.access_token,
      refreshToken: typeof tokens.refresh_token === 'string' && tokens.refresh_token ? tokens.refresh_token : saved.value.refreshToken,
      expiresAt: Date.now() + Math.min(tokens.expires_in, 86400) * 1000 };
    const data = await seal(env, `connection:${user}`, value);
    const result = await env.DB.prepare(`UPDATE calendar_connections SET data = ?, updated_at = ? WHERE user_id = ? AND data = ?
      AND EXISTS (SELECT 1 FROM calendar_settings WHERE id = 1 AND version = ?)`)
      .bind(data, Date.now(), user, saved.row.data, settings.version).run();
    if (!result.meta.changes) return null;
    return { accessToken: value.accessToken, email: value.email };
  })();
  pending.set(user, refresh);
  try { return await refresh; } finally { if (pending.get(user) === refresh) pending.delete(user); }
}

async function status(env, user) {
  const settings = await oauthSettings(env), config = await getCalendarConfig(env);
  const [mine, owner] = await Promise.all([connection(env, user, settings, config), connection(env, 'owner', settings, config)]);
  return { configured: Boolean(settings), connected: Boolean(mine), ...(mine ? { email: mine.value.email } : {}),
    ownerConnected: Boolean(owner), redirectUri: CALLBACK, configurationReady: Boolean(config && validRandom(env.CALENDAR_CONNECTION_KEY)),
    ...(!settings ? { setupInstructions: [
      'Create a Google OAuth client with application type Web application.',
      `Add this exact authorized redirect URI: ${CALLBACK}`,
      'Download the OAuth client JSON and upload it here. Add the connecting Google accounts as test users while the consent screen is in testing.',
    ] } : {}) };
}
async function start(request, env) {
  const state = new URL(request.url).searchParams.get('state');
  if (!validRandom(state)) return finish(false);
  const stateHash = await tokenHash(state), now = Date.now();
  const row = await env.DB.prepare('SELECT * FROM calendar_oauth_states WHERE state_hash = ?').bind(stateHash).first();
  const settings = await oauthSettings(env);
  if (!row || !settings || row.config_version !== settings.version || row.expires_at <= now || row.used_at !== null || row.started_at !== null) return finish(false);
  try {
    const stored = await open(env, `state:${stateHash}`, row.data), browser = random();
    const claimed = await env.DB.prepare(`UPDATE calendar_oauth_states SET browser_hash = ?, started_at = ?
      WHERE state_hash = ? AND started_at IS NULL AND used_at IS NULL AND expires_at > ?`)
      .bind(await tokenHash(browser), now, stateHash, now).run();
    if (!claimed.meta.changes) return finish(false);
    const authorization = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    authorization.search = new URLSearchParams({ client_id: settings.clientId, redirect_uri: CALLBACK, response_type: 'code',
      scope: scopes(row.user_id).join(' '), access_type: 'offline', prompt: 'consent select_account', state,
      code_challenge: await tokenHash(stored.verifier), code_challenge_method: 'S256',
      ...(stored.loginHint ? { login_hint: stored.loginHint } : {}) }).toString();
    return new Response(null, { status: 302, headers: { ...noCache, location: authorization.toString(), 'set-cookie': cookie(browser) } });
  } catch { return finish(false); }
}
async function callback(request, env) {
  const url = new URL(request.url), state = url.searchParams.get('state');
  const browser = request.headers.get('cookie')?.split(';').map(part => part.trim()).find(part => part.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  if (!validRandom(state) || !validRandom(browser)) return finish(false);
  let receivedToken = null;
  try {
    const stateHash = await tokenHash(state), browserHash = await tokenHash(browser), now = Date.now();
    const row = await env.DB.prepare('SELECT * FROM calendar_oauth_states WHERE state_hash = ?').bind(stateHash).first();
    const settings = await oauthSettings(env), config = await getCalendarConfig(env);
    if (!row || !settings || !config || row.config_version !== settings.version || row.browser_hash !== browserHash || row.started_at === null || row.used_at !== null || row.expires_at <= now) return finish(false);
    const claimed = await env.DB.prepare(`UPDATE calendar_oauth_states SET used_at = ? WHERE state_hash = ? AND browser_hash = ?
      AND used_at IS NULL AND started_at IS NOT NULL AND expires_at > ? AND config_version = ?`)
      .bind(now, stateHash, browserHash, now, settings.version).run();
    if (!claimed.meta.changes || url.searchParams.has('error')) return finish(false);
    const code = url.searchParams.get('code');
    if (!code || code.length > 4096) return finish(false);
    const stored = await open(env, `state:${stateHash}`, row.data);
    const response = await google('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: settings.clientId, client_secret: settings.clientSecret, code, code_verifier: stored.verifier, redirect_uri: CALLBACK, grant_type: 'authorization_code' }) });
    const tokens = await response.json().catch(() => ({}));
    if (!response.ok || typeof tokens.access_token !== 'string' || !tokens.access_token || tokens.access_token.length > 16384 ||
        !Number.isFinite(tokens.expires_in) || tokens.expires_in <= 0 || typeof tokens.scope !== 'string' || !tokens.scope.split(' ').includes(EVENTS_SCOPE) ||
        (row.user_id === 'owner' && !tokens.scope.split(' ').includes(LIST_SCOPE))) return finish(false);
    receivedToken = tokens.refresh_token || tokens.access_token;
    const profileResponse = await google('https://openidconnect.googleapis.com/v1/userinfo', { headers: { authorization: `Bearer ${tokens.access_token}` } });
    const profile = profileResponse.ok ? await profileResponse.json() : null;
    const address = email(profile?.email);
    if (!address || profile.email_verified !== true || typeof profile.sub !== 'string' || !profile.sub || !expectedEmployeeEmail(config, row.user_id, address)) throw new Error('Calendar account did not match.');
    if (row.user_id === 'owner') {
      const access = await google(`https://www.googleapis.com/calendar/v3/users/me/calendarList/${encodeURIComponent(config.calendarId)}`, { headers: { authorization: `Bearer ${tokens.access_token}` } });
      const entry = access.ok ? await access.json() : null;
      if (!entry || !['writer', 'owner'].includes(entry.accessRole)) throw new Error('Studio Calendar access is missing.');
    }
    const previous = await connection(env, row.user_id, settings, config);
    const refreshToken = typeof tokens.refresh_token === 'string' && tokens.refresh_token && tokens.refresh_token.length <= 16384 ? tokens.refresh_token
      : previous?.value.email === address && previous.value.subject === profile.sub ? previous.value.refreshToken : null;
    if (!refreshToken) throw new Error('Offline Calendar access is missing.');
    const value = { accessToken: tokens.access_token, refreshToken, expiresAt: Date.now() + Math.min(tokens.expires_in, 86400) * 1000,
      email: address, subject: profile.sub, clientVersion: settings.version, ...(row.user_id === 'owner' ? { calendarId: config.calendarId } : {}) };
    const data = await seal(env, `connection:${row.user_id}`, value);
    // A concurrent disconnect or client replacement removes the state, so an
    // in-flight callback cannot silently reconnect the account afterward.
    const saved = await env.DB.prepare(`INSERT INTO calendar_connections(user_id, data, updated_at)
      SELECT ?, ?, ? WHERE EXISTS (SELECT 1 FROM calendar_oauth_states WHERE state_hash = ? AND used_at = ? AND expires_at > ?)
      AND EXISTS (SELECT 1 FROM calendar_settings WHERE id = 1 AND version = ?)
      ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`)
      .bind(row.user_id, data, Date.now(), stateHash, now, Date.now(), settings.version).run();
    if (!saved.meta.changes) throw new Error('Calendar connection changed.');
    return finish(true);
  } catch { if (receivedToken) await revoke(receivedToken); return finish(false); }
}

export async function calendarAuthRoute({ request, env, user, body, fail }) {
  const url = new URL(request.url);
  if (request.method === 'GET' && url.pathname === '/calendar/oauth/start') return start(request, env);
  if (request.method === 'GET' && url.pathname === '/calendar/oauth/callback') return callback(request, env);
  if (!TEAM.some(person => person.id === user)) fail(403, 'Unlock your dashboard to connect Google Calendar.');
  if (request.method === 'GET' && url.pathname === '/calendar/connection') return status(env, user);
  if (request.method === 'POST' && url.pathname === '/calendar/setup') {
    if (user !== 'owner') fail(403, 'Only Smooth can configure the Google Calendar connection.');
    const input = await body(request), web = input.web;
    if (!web || typeof web.client_id !== 'string' || web.client_id.length > 300 || !/^[A-Za-z0-9._-]+\.apps\.googleusercontent\.com$/.test(web.client_id) ||
        typeof web.client_secret !== 'string' || !web.client_secret.trim() || web.client_secret.length > 512 || /[\u0000-\u0020\u007f]/.test(web.client_secret) ||
        !Array.isArray(web.redirect_uris) || !web.redirect_uris.includes(CALLBACK)) fail(400, 'Upload a Web application OAuth client JSON with the dashboard callback URI.');
    try { await encryptionKey(env); } catch { fail(503, 'Secure Calendar connections are finishing setup. Try again shortly.'); }
    const existing = await oauthSettings(env);
    if (existing?.clientId === web.client_id && existing.clientSecret === web.client_secret) return { saved: true, ...await status(env, user) };
    const data = await seal(env, 'settings', { clientId: web.client_id, clientSecret: web.client_secret });
    await env.DB.batch([
      env.DB.prepare('INSERT INTO calendar_settings(id,data,version,updated_at) VALUES(1,?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,version=excluded.version,updated_at=excluded.updated_at').bind(data, crypto.randomUUID(), Date.now()),
      env.DB.prepare('DELETE FROM calendar_connections'), env.DB.prepare('DELETE FROM calendar_oauth_states'),
    ]);
    return { saved: true, ...await status(env, user) };
  }
  if (request.method === 'POST' && url.pathname === '/calendar/connect') {
    const settings = await oauthSettings(env), config = await getCalendarConfig(env);
    if (!settings) fail(409, 'Smooth needs to upload the Google OAuth client file first.');
    const employee = config?.employees.find(person => person.id === user);
    if (!config || (user !== 'owner' && !employee?.invitationEmails.length)) fail(409, 'Sync the studio Calendar and team email addresses before connecting.');
    const state = random(), verifier = random(), stateHash = await tokenHash(state), now = Date.now();
    const data = await seal(env, `state:${stateHash}`, { verifier, loginHint: employee?.email ?? null });
    await env.DB.batch([
      env.DB.prepare('DELETE FROM calendar_oauth_states WHERE expires_at <= ? OR user_id = ?').bind(now, user),
      env.DB.prepare('INSERT INTO calendar_oauth_states(state_hash,user_id,config_version,data,expires_at) VALUES(?,?,?,?,?)').bind(stateHash, user, settings.version, data, now + STATE_LIFETIME),
    ]);
    return { authorizationUrl: `${API}/calendar/oauth/start?state=${state}` };
  }
  if (request.method === 'DELETE' && url.pathname === '/calendar/connection') {
    const stored = await env.DB.prepare('SELECT data FROM calendar_connections WHERE user_id = ?').bind(user).first();
    let token = null;
    if (stored) {
      try {
        const value = await open(env, `connection:${user}`, stored.data);
        token = value.refreshToken || value.accessToken;
      } catch { /* An unreadable connection can still be removed locally. */ }
    }
    await env.DB.batch([
      env.DB.prepare('DELETE FROM calendar_connections WHERE user_id = ?').bind(user),
      env.DB.prepare('DELETE FROM calendar_oauth_states WHERE user_id = ?').bind(user),
    ]);
    if (typeof token === 'string' && token) await revoke(token);
    return { disconnected: true };
  }
  fail(404, 'Calendar connection action not found.');
}
