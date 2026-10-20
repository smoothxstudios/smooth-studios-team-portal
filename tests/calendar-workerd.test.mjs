import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

const API = 'https://smooth-studios-team-api.smoothxstudios.workers.dev';
const CALLBACK = `${API}/calendar/oauth/callback`;
const config = { calendarId: 'studio@example.invalid', employees: [
  { id: 'jordyn', email: 'jordyn@example.invalid', invitationEmails: ['jordyn@example.invalid'] },
] };
const assignment = { id: 'synthetic-offer', appointmentId: 'synthetic-event', employeeId: 'jordyn', status: 'pending',
  start: '2030-10-20T15:00:00Z', end: '2030-10-20T16:00:00Z', createdAt: '2030-10-17T10:00:00Z' };

test('native Worker fetch completes OAuth and invitation delivery with network access disabled', async t => {
  // Exercise actual Workerd Request construction: Node fetch mocks alone miss
  // runtime differences such as Workerd rejecting redirect: "error".
  const bundle = await build({ bundle: true, write: false, format: 'esm', platform: 'browser',
    stdin: { resolveDir: new URL('..', import.meta.url).pathname, contents: `
      import { calendarAuthRoute, calendarAccessToken } from './team-api/calendar-auth.mjs';
      import { deliverCalendarAssignment } from './team-api/calendar-delivery.mjs';
      export default { async fetch(request, env) {
        if (new URL(request.url).pathname === '/synthetic-deliver') {
          return Response.json(await deliverCalendarAssignment({
            assignment: ${JSON.stringify(assignment)}, config: ${JSON.stringify(config)},
            ownerToken: await calendarAccessToken(env, 'owner'), now: Date.parse('2030-10-17T12:00:00Z')
          }));
        }
        const result = await calendarAuthRoute({ request, env, user: 'owner',
          body: req => req.json(), fail: (status, message) => { throw new Error(message); } });
        return result instanceof Response ? result : Response.json(result);
      }};
    ` } });
  const interceptors = [];
  const fetchMock = {
    get(origin) { return { intercept({path,method='GET'}) { return { reply(status,data) {
      interceptors.push({url:origin+path,method,status,data});
    } }; } }; },
    async fetch(request) {
      const index=interceptors.findIndex(item=>item.url===request.url && item.method===request.method);
      assert.notEqual(index,-1,'Unexpected outbound request: '+request.method+' '+request.url);
      const [item]=interceptors.splice(index,1);
      return Response.json(item.data,{status:item.status});
    },
    assertNoPendingInterceptors() { assert.equal(interceptors.length,0); }
  };
  const mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: bundle.outputFiles[0].text,
    // Pinned to the bundled local runtime's supported date; production keeps its own date.
    compatibilityDate: '2026-05-22', d1Databases: ['DB'], outboundService: request => fetchMock.fetch(request),
    bindings: { CALENDAR_CONNECTION_KEY: Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url') } }));
  t.after(() => mf.dispose());
  const db = await mf.getD1Database('DB');
  const schema = await readFile(new URL('../team-api/migrations/0021_google_calendar_connections.sql', import.meta.url), 'utf8');
  for (const sql of schema.split(';').map(part => part.trim()).filter(Boolean)) await db.prepare(sql).run();
  await db.prepare('INSERT INTO calendar_sync_config(id,data) VALUES(1,?)').bind(JSON.stringify(config)).run();

  fetchMock.get('https://oauth2.googleapis.com').intercept({ path: '/token', method: 'POST' }).reply(200, {
    access_token: 'synthetic-access', refresh_token: 'synthetic-refresh', expires_in: 3600,
    scope: 'openid email https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.calendarlist.readonly',
  });
  fetchMock.get('https://openidconnect.googleapis.com').intercept({ path: '/v1/userinfo' }).reply(200, {
    sub: 'synthetic-owner', email: config.calendarId, email_verified: true,
  });
  fetchMock.get('https://www.googleapis.com').intercept({
    path: `/calendar/v3/users/me/calendarList/${encodeURIComponent(config.calendarId)}`,
  }).reply(200, { id: config.calendarId, accessRole: 'owner' });

  const call = (path, body) => mf.dispatchFetch(`${API}${path}`, body === undefined ? {} : {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  const setup = await call('/calendar/setup', { web: { client_id: 'synthetic.apps.googleusercontent.com',
    client_secret: 'synthetic-client-secret', redirect_uris: [CALLBACK] } });
  assert.equal((await setup.json()).configured, true);
  const begin = await (await call('/calendar/connect', {})).json();
  const start = await mf.dispatchFetch(begin.authorizationUrl, { redirect: 'manual' });
  assert.equal(start.status, 302);
  const state = new URL(start.headers.get('location')).searchParams.get('state');
  const cookie = start.headers.get('set-cookie').split(';')[0];
  const completed = await mf.dispatchFetch(`${CALLBACK}?state=${state}&code=synthetic-code`, {
    redirect: 'manual', headers: { cookie },
  });
  assert.equal(completed.headers.get('location'), 'https://dashboard.smoothstudios.co/?calendar=connected');
  const connection = await (await call('/calendar/connection')).json();
  assert.equal(connection.connected, true); assert.equal(connection.ownerConnected, true);
  const saved = await db.prepare('SELECT data FROM calendar_connections WHERE user_id = ?').bind('owner').first();
  assert.doesNotMatch(saved.data, /synthetic-access|synthetic-refresh|example\.invalid/);

  const event = { id: assignment.appointmentId, etag: '"synthetic-v1"', status: 'confirmed',
    organizer: { self: true, email: config.calendarId }, start: { dateTime: assignment.start }, end: { dateTime: assignment.end }, attendees: [] };
  const eventPath = `/calendar/v3/calendars/${encodeURIComponent(config.calendarId)}/events/${assignment.appointmentId}`;
  fetchMock.get('https://www.googleapis.com').intercept({ path: eventPath }).reply(200, event);
  fetchMock.get('https://www.googleapis.com').intercept({ path: `${eventPath}?sendUpdates=all`, method: 'PATCH' }).reply(200, {
    ...event, etag: '"synthetic-v2"', attendees: [{ email: 'jordyn@example.invalid', responseStatus: 'needsAction' }],
  });
  assert.deepEqual(await (await call('/synthetic-deliver')).json(), {
    status: 'synced', code: 'invitation_synced', googleStatus: 'needsAction',
  });
  fetchMock.assertNoPendingInterceptors();
});
