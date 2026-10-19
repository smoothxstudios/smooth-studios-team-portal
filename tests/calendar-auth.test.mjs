import assert from 'node:assert/strict';
import test, { mock } from 'node:test';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { calendarAccessToken, calendarAuthRoute, getCalendarConfig } from '../team-api/calendar-auth.mjs';
import { calendarConnectionError } from '../lib/calendar-connection-errors.mjs';

const API = 'https://smooth-studios-team-api.smoothxstudios.workers.dev';
const CALLBACK = `${API}/calendar/oauth/callback`;
const EVENTS = 'https://www.googleapis.com/auth/calendar.events';
const errorLocation = reason => `https://dashboard.smoothstudios.co/?calendar=error&calendar_reason=${reason}`;
const LIST = 'https://www.googleapis.com/auth/calendar.calendarlist.readonly';
const now = Date.parse('2026-10-17T18:00:00Z');
mock.timers.enable({ apis: ['Date'], now });
test.beforeEach(() => mock.timers.setTime(now));
test.afterEach(() => mock.restoreAll());
test.after(() => mock.timers.reset());
const client = (suffix = 'first') => ({ web: { client_id: `123-${suffix}.apps.googleusercontent.com`, client_secret: `synthetic-secret-${suffix}`, redirect_uris: [CALLBACK] } });
const roster = { calendarId: 'studio@example.invalid', employees: [
  { id: 'jordyn', email: 'jordyn@example.invalid', invitationEmails: ['jordyn@example.invalid', 'jordyn.alias@example.invalid'] },
  { id: 'rayne', email: 'rayne@example.invalid', invitationEmails: ['rayne@example.invalid'] },
] };
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });

function fixture(t) {
  const sqlite = new DatabaseSync(':memory:'); t.after(() => sqlite.close());
  sqlite.exec(readFileSync(new URL('../team-api/migrations/0021_google_calendar_connections.sql', import.meta.url), 'utf8'));
  const DB = {
    prepare(sql) {
      let args = [];
      return { bind(...values) { args = values; return this; },
        async first() { return sqlite.prepare(sql).get(...args) ?? null; },
        async all() { return { results: sqlite.prepare(sql).all(...args) }; },
        runSync() { return { meta: { changes: Number(sqlite.prepare(sql).run(...args).changes) } }; },
        async run() { return this.runSync(); } };
    },
    async batch(statements) {
      sqlite.exec('BEGIN');
      try { const result = statements.map(statement => statement.runSync()); sqlite.exec('COMMIT'); return result; }
      catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
  };
  const env = { DB, CALENDAR_CONNECTION_KEY: Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url') };
  sqlite.prepare('INSERT INTO calendar_sync_config(id,data) VALUES(1,?)').run(JSON.stringify(roster));
  const f = { env, sqlite, address: 'jordyn@example.invalid', verified: true, accessRole: 'writer', calls: [], refreshError: null, refreshUnavailable: false, afterProfile: null };
  mock.method(globalThis, 'fetch', async (input, options = {}) => {
    const url = String(input), form = options.body instanceof URLSearchParams ? Object.fromEntries(options.body) : null;
    f.calls.push({ url, options, form });
    assert.equal(options.redirect, 'manual', 'Google credentials must never follow redirects and must use a Workerd-supported mode');
    if (f.redirectAt === url) return new Response(null, {status:302, headers:{location:'https://untrusted.example.invalid/'}});
    if (f.networkFailure) throw new Error('SYNTHETIC PRIVATE PROVIDER FAILURE');
    if (url === 'https://oauth2.googleapis.com/token') {
      if (form.grant_type === 'refresh_token') {
        if (f.refreshUnavailable) throw new Error('SYNTHETIC PRIVATE GOOGLE ERROR');
        if (f.refreshError) return json({ error: f.refreshError, error_description: 'SYNTHETIC PRIVATE GOOGLE ERROR' }, 400);
        return json({ access_token: 'refreshed-access-token', expires_in: 3600, scope: EVENTS, token_type: 'Bearer' });
      }
      if (f.tokenError) return json({error:f.tokenError, error_description:'SYNTHETIC PRIVATE TOKEN ERROR'},400);
      return json({ access_token: 'synthetic-access-token', refresh_token: 'synthetic-refresh-token', expires_in: 3600,
        scope: f.scopes ?? `openid email ${EVENTS} ${LIST}`, token_type: 'Bearer' });
    }
    if (url === 'https://openidconnect.googleapis.com/v1/userinfo') {
      await f.afterProfile?.();
      return json({ sub: `synthetic-subject-${f.address}`, email: f.address, email_verified: f.verified });
    }
    if (url.startsWith('https://www.googleapis.com/calendar/v3/users/me/calendarList/')) return json({ id: roster.calendarId, accessRole: f.accessRole });
    if (url === 'https://oauth2.googleapis.com/revoke') return json({});
    throw new Error(`Unexpected synthetic endpoint: ${url}`);
  });
  f.call = async (user, path, data, method = data === undefined ? 'GET' : 'POST', cookie) => {
    const request = new Request(path.startsWith('https://') ? path : `${API}${path}`, { method,
      headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
    try {
      const result = await calendarAuthRoute({ request, env, user, body: req => req.json(), fail: (status, message) => { throw Object.assign(new Error(message), { status }); } });
      return result instanceof Response ? { status: result.status, response: result } : { status: 200, data: result };
    } catch (error) { if (!error.status) throw error; return { status: error.status, data: { error: error.message } }; }
  };
  f.begin = async (user = 'jordyn') => {
    const connect = await f.call(user, '/calendar/connect', {}); assert.equal(connect.status, 200);
    const start = await f.call(null, connect.data.authorizationUrl); assert.equal(start.status, 302);
    const authorization = new URL(start.response.headers.get('location'));
    return { state: authorization.searchParams.get('state'), authorization, cookie: start.response.headers.get('set-cookie').split(';')[0], start, connect };
  };
  f.complete = (flow, cookie = flow.cookie) => f.call(null, `${CALLBACK}?state=${flow.state}&code=synthetic-code`, undefined, 'GET', cookie);
  f.setup = () => f.call('owner', '/calendar/setup', client());
  return f;
}

test('only the owner configures a Web OAuth client; downloaded secrets stay encrypted and callback URI is fixed', async t => {
  const f = fixture(t);
  const before = (await f.call('jordyn', '/calendar/connection')).data;
  assert.equal(before.configured, false); assert.equal(before.connected, false); assert.equal(before.redirectUri, CALLBACK);
  assert.equal(before.configurationReady, true);
  assert.ok(before.setupInstructions.every(value => !value.includes('synthetic-secret')));
  assert.equal((await f.call('jordyn', '/calendar/setup', client())).status, 403);
  assert.equal((await f.call('sync', '/calendar/connection')).status, 403);
  assert.equal((await f.call(null, '/calendar/connection')).status, 403);
  for (const input of [{ installed: client().web }, { web: { ...client().web, redirect_uris: ['https://attacker.invalid/callback'] } }, { web: { ...client().web, client_secret: 'bad\nsecret' } }]) {
    assert.equal((await f.call('owner', '/calendar/setup', input)).status, 400);
  }
  const setup = await f.setup(); assert.equal(setup.status, 200); assert.equal(setup.data.configured, true);
  const stored = f.sqlite.prepare('SELECT * FROM calendar_settings').get();
  assert.doesNotMatch(stored.data, /synthetic-secret|apps\.googleusercontent/);
  assert.doesNotMatch(JSON.stringify(setup.data), /client_secret|clientId|refreshToken|accessToken/);
  assert.deepEqual(await getCalendarConfig(f.env), roster);
  delete f.env.CALENDAR_CONNECTION_KEY;
  assert.equal((await f.call('owner', '/calendar/connection')).data.configurationReady, false);
  assert.equal((await f.setup()).status, 503);
});

test('first-party start sets a secure browser cookie and PKCE, then stores only verified matching employee tokens', async t => {
  const f = fixture(t); await f.setup(); f.address = 'JORDYN.ALIAS@example.invalid';
  const flow = await f.begin();
  assert.equal(flow.authorization.origin, 'https://accounts.google.com');
  assert.equal(flow.authorization.searchParams.get('redirect_uri'), CALLBACK);
  assert.equal(flow.authorization.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(flow.authorization.searchParams.get('access_type'), 'offline');
  assert.match(flow.authorization.searchParams.get('prompt'), /consent/);
  assert.equal(flow.authorization.searchParams.get('scope'), `openid email ${EVENTS}`);
  assert.match(flow.start.response.headers.get('set-cookie'), /Secure; HttpOnly; SameSite=Lax/);
  const state = f.sqlite.prepare('SELECT * FROM calendar_oauth_states').get();
  assert.notEqual(state.state_hash, flow.state); assert.ok(state.browser_hash); assert.doesNotMatch(state.data, /verifier|loginHint|jordyn/);
  const callback = await f.complete(flow); assert.equal(callback.status, 303);
  assert.equal(callback.response.headers.get('location'), 'https://dashboard.smoothstudios.co/?calendar=connected');
  assert.match(callback.response.headers.get('set-cookie'), /Max-Age=0/);
  const tokenRequest = f.calls.find(call => call.url.endsWith('/token')).form;
  const digest = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(tokenRequest.code_verifier))).toString('base64url');
  assert.equal(digest, flow.authorization.searchParams.get('code_challenge'));
  const saved = f.sqlite.prepare('SELECT * FROM calendar_connections').get();
  assert.doesNotMatch(saved.data, /synthetic-(?:access|refresh)-token|jordyn|example\.invalid/);
  const status = (await f.call('jordyn', '/calendar/connection')).data;
  assert.deepEqual(status, { configured: true, connected: true, email: 'jordyn.alias@example.invalid', ownerConnected: false, redirectUri: CALLBACK, configurationReady: true });
  assert.equal((await f.call('rayne', '/calendar/connection')).data.email, undefined);
  assert.deepEqual(await calendarAccessToken(f.env, 'jordyn'), { accessToken: 'synthetic-access-token', email: 'jordyn.alias@example.invalid' });
});

test('callback rejects missing or mismatched cookies, expired state, retries and denied consent without exposing Google errors', async t => {
  const f = fixture(t); await f.setup();
  const flow = await f.begin();
  for (const cookie of [null, '__Host-smooth_calendar_oauth=bad-cookie']) {
    const result = await f.complete(flow, cookie);
    assert.equal(result.response.headers.get('location'), errorLocation('session'));
  }
  assert.equal(f.calls.length, 0);
  const [first, duplicate] = await Promise.all([f.complete(flow), f.complete(flow)]);
  assert.deepEqual([first, duplicate].map(result => result.response.headers.get('location')).sort(), [
    'https://dashboard.smoothstudios.co/?calendar=connected', errorLocation('session'),
  ].sort());
  assert.equal(f.calls.filter(call => call.form?.grant_type === 'authorization_code').length, 1);
  assert.equal((await f.call(null, flow.connect.data.authorizationUrl)).response.headers.get('location'), 'https://dashboard.smoothstudios.co/?calendar=error');
  const expired = await f.begin(); mock.timers.setTime(now + 600001);
  assert.equal((await f.complete(expired)).response.headers.get('location'), errorLocation('session'));
  mock.timers.setTime(now);
  const denied = await f.begin();
  const result = await f.call(null, `${CALLBACK}?state=${denied.state}&error=PRIVATE_GOOGLE_ERROR&return=https://attacker.invalid`, undefined, 'GET', denied.cookie);
  assert.equal(result.response.headers.get('location'), errorLocation('consent'));
  assert.equal(await result.response.text(), '');
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM calendar_connections').get().n, 1);
});

test('wrong or unverified employee Google accounts cannot be attached; owner must have write access to the configured calendar', async t => {
  const f = fixture(t); await f.setup();
  for (const [address, verified] of [['rayne@example.invalid', true], ['jordyn@example.invalid', false]]) {
    f.address = address; f.verified = verified;
    const result = await f.complete(await f.begin());
    assert.equal(result.response.headers.get('location'), errorLocation('account'));
  }
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM calendar_connections').get().n, 0);
  f.address = 'owner@example.invalid'; f.verified = true; f.accessRole = 'reader';
  const denied = await f.begin('owner'); assert.ok(denied.authorization.searchParams.get('scope').includes(LIST));
  assert.equal((await f.complete(denied)).response.headers.get('location'), errorLocation('calendar_access'));
  f.accessRole = 'writer';
  assert.equal((await f.complete(await f.begin('owner'))).response.headers.get('location'), 'https://dashboard.smoothstudios.co/?calendar=connected');
  const employeeStatus = (await f.call('rayne', '/calendar/connection')).data;
  assert.equal(employeeStatus.ownerConnected, true); assert.equal(employeeStatus.email, undefined);
  assert.equal(f.calls.filter(call => call.url.includes('/calendarList/')).length, 2);
  f.sqlite.prepare('UPDATE calendar_sync_config SET data = ? WHERE id = 1').run(JSON.stringify({ ...roster, calendarId: 'changed@example.invalid' }));
  assert.equal(await calendarAccessToken(f.env, 'owner'), null);
});

test('refresh is coalesced, retains offline credentials and removes revoked connections without leaking provider errors', async t => {
  const f = fixture(t); await f.setup(); await f.complete(await f.begin());
  mock.timers.setTime(now + 3600000);
  const refreshed = await Promise.all([calendarAccessToken(f.env, 'jordyn'), calendarAccessToken(f.env, 'jordyn')]);
  assert.ok(refreshed.every(value => value.accessToken === 'refreshed-access-token'));
  assert.equal(f.calls.filter(call => call.form?.grant_type === 'refresh_token').length, 1);
  mock.timers.setTime(now + 7200000); f.refreshUnavailable = true;
  await assert.rejects(calendarAccessToken(f.env, 'jordyn'), { message: 'Google Calendar could not reconnect. Try again shortly.' });
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM calendar_connections').get().n, 1);
  f.refreshUnavailable = false; f.refreshError = 'invalid_grant';
  assert.equal(await calendarAccessToken(f.env, 'jordyn'), null);
  assert.equal((await f.call('jordyn', '/calendar/connection')).data.connected, false);
});

test('disconnect affects only the caller, revokes its token and invalidates in-flight callbacks; client replacement clears all old connections', async t => {
  const f = fixture(t); await f.setup(); await f.complete(await f.begin());
  f.address = 'rayne@example.invalid'; await f.complete(await f.begin('rayne'));
  const pending = await f.begin('rayne');
  await f.call('jordyn', '/calendar/connection', { userId: 'rayne' }, 'DELETE');
  assert.equal((await f.call('jordyn', '/calendar/connection')).data.connected, false);
  assert.equal((await f.call('rayne', '/calendar/connection')).data.connected, true);
  assert.ok(f.calls.some(call => call.url.endsWith('/revoke') && call.form.token === 'synthetic-refresh-token'));
  const same = await f.setup(); assert.equal(same.data.configured, true);
  assert.equal((await f.call('rayne', '/calendar/connection')).data.connected, true);
  f.afterProfile = async () => { f.afterProfile = null; await f.call('rayne', '/calendar/connection', {}, 'DELETE'); };
  assert.equal((await f.complete(pending)).response.headers.get('location'), errorLocation('save'));
  assert.equal((await f.call('rayne', '/calendar/connection')).data.connected, false);
  f.address = 'jordyn@example.invalid'; await f.complete(await f.begin());
  const oldState = await f.begin();
  await f.call('owner', '/calendar/setup', client('replacement'));
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM calendar_connections').get().n, 0);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM calendar_oauth_states').get().n, 0);
  assert.equal((await f.complete(oldState)).response.headers.get('location'), errorLocation('session'));
});

test('changing a private employee alias invalidates only that connection and ciphertext cannot be moved between users', async t => {
  const f = fixture(t); await f.setup(); await f.complete(await f.begin());
  const original = f.sqlite.prepare('SELECT data FROM calendar_connections WHERE user_id = ?').get('jordyn').data;
  f.sqlite.prepare('INSERT INTO calendar_connections(user_id,data,updated_at) VALUES(?,?,?)').run('rayne', original, now);
  assert.equal(await calendarAccessToken(f.env, 'rayne'), null);
  f.sqlite.prepare('UPDATE calendar_sync_config SET data = ? WHERE id = 1').run(JSON.stringify({ ...roster, employees: roster.employees.filter(person => person.id !== 'jordyn') }));
  assert.equal(await calendarAccessToken(f.env, 'jordyn'), null);
  assert.equal((await f.call('jordyn', '/calendar/connection')).data.connected, false);
  assert.equal((await f.call('jordyn', '/calendar/connect', {})).status, 409);
  await f.call('jordyn', '/calendar/connection', {}, 'DELETE');
  assert.ok(f.calls.some(call => call.url.endsWith('/revoke') && call.form.token === 'synthetic-refresh-token'));
});

test('connection failures explain the next action without returning provider errors or following redirects', async t => {
  const f = fixture(t); await f.setup();
  for (const [problem, reason] of [
    [{networkFailure:true}, 'google_unavailable'],
    [{tokenError:'invalid_client'}, 'setup'],
    [{tokenError:'invalid_grant'}, 'session'],
    [{tokenError:'PRIVATE_GOOGLE_ERROR'}, 'google_unavailable'],
    [{scopes:'openid email'}, 'permissions'],
    [{redirectAt:'https://oauth2.googleapis.com/token'}, 'google_unavailable'],
  ]) {
    Object.assign(f,{networkFailure:false,tokenError:null,scopes:null,redirectAt:null},problem);
    const result = await f.complete(await f.begin());
    assert.equal(result.response.headers.get('location'), errorLocation(reason));
    assert.doesNotMatch(result.response.headers.get('location'), /PRIVATE|secret|token|example/);
    assert.equal(await result.response.text(), '');
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM calendar_connections').get().n,0);
  }
  assert.ok(f.calls.every(call => new URL(call.url).hostname.endsWith('.googleapis.com')));
  assert.match(calendarConnectionError('calendar_access'), /can’t edit the studio rental calendar/);
  assert.doesNotMatch(calendarConnectionError('<script>PRIVATE'), /PRIVATE|script/);
  assert.doesNotMatch(calendarConnectionError('__proto__'), /Object/);
});
