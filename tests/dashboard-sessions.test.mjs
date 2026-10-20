import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../team-api/worker.mjs';
import { fixture } from './helpers/notification-fixture.mjs';
import { teamToken, tokenHash } from '../lib/team-auth.mjs';
import { encryptPayload } from '../scripts/lib/dashboard-data.mjs';
import { SESSION_IDLE_MS, SESSION_MAX_MS } from '../team-api/sessions.mjs';

async function setup(t) {
  const f = await fixture(); t.after(()=>f.close()); delete f.env.VAPID_JWK;
  f.request = async(token,path,method='GET',data)=>{
    const response=await worker.fetch(new Request('https://api.example.invalid'+path,{method,headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},...(data===undefined?{}:{body:JSON.stringify(data)})}),f.env,{waitUntil(){}});
    return {status:response.status,data:await response.json()};
  };
  f.signIn=async(user='jordyn')=>{
    const result=await f.request(await teamToken('synthetic-notification-tests-'+user,user),'/auth/session','POST');
    assert.equal(result.status,200);return result.data;
  };
  return f;
}

test('sessions are random, hashed at rest, account-bound and immediately revoked on sign-out',async t=>{
  const f=await setup(t), a=await f.signIn(), b=await f.signIn();
  assert.match(a.token,/^ss1\.[A-Za-z0-9_-]{43}$/);assert.notEqual(a.token,b.token);
  const row=f.DB.sqlite.prepare('SELECT * FROM dashboard_sessions WHERE token_hash=?').get(await tokenHash(a.token));
  assert.equal(row.user_id,'jordyn'); assert.ok(!JSON.stringify(row).includes(a.token));
  assert.equal(row.expires_at-row.created_at,SESSION_IDLE_MS);assert.equal(row.absolute_expires_at-row.created_at,SESSION_MAX_MS);
  assert.equal((await f.request(a.token,'/identity')).data.user.id,'jordyn');
  assert.equal((await f.request(a.token,'/event-planner')).status,403);
  assert.equal((await f.request(a.token,'/auth/session','DELETE')).status,200);
  assert.equal((await f.request(a.token,'/identity')).status,401);
  assert.equal((await f.request(b.token,'/identity')).status,200);
  assert.equal((await f.request(a.token,'/auth/session','PATCH')).status,401);
});
test('sessions renew within an absolute lifetime and reject expiry or password rotation',async t=>{
  const f=await setup(t), a=await f.signIn(), digest=await tokenHash(a.token), now=Date.now();
  f.DB.sqlite.prepare('UPDATE dashboard_sessions SET expires_at=?, absolute_expires_at=? WHERE token_hash=?').run(now+1000,now+5000,digest);
  const renewed=await f.request(a.token,'/auth/session','PATCH');assert.equal(renewed.status,200);assert.equal(renewed.data.expiresAt,now+5000);
  f.DB.sqlite.prepare('UPDATE dashboard_sessions SET expires_at=? WHERE token_hash=?').run(now-1,digest);
  assert.equal((await f.request(a.token,'/identity')).status,401);assert.equal((await f.request(a.token,'/auth/session','PATCH')).status,401);
  const b=await f.signIn();const hashes=JSON.parse(f.env.TEAM_TOKEN_HASHES);hashes.jordyn='changed-password-digest';f.env.TEAM_TOKEN_HASHES=JSON.stringify(hashes);
  assert.equal((await f.request(b.token,'/identity')).status,401);
});
test('machine credentials cannot create sessions and sessions cannot synchronize',async t=>{
  const f=await setup(t), a=await f.signIn('owner');
  assert.equal((await f.request(await teamToken('synthetic-notification-tests-sync','sync'),'/auth/session','POST')).status,403);
  assert.equal((await f.request(a.token,'/sync/dashboard?id=owner')).status,403);
  assert.equal((await f.request(a.token,'/auth/session','POST')).status,403);
  for(let i=0;i<12;i++)await f.signIn();
  assert.equal(f.DB.sqlite.prepare("SELECT COUNT(*) AS n FROM dashboard_sessions WHERE user_id='jordyn'").get().n,10);
});
test('encrypted dashboard storage isolates accounts, rejects rollback and preserves existing data on invalid writes',async t=>{
  const f=await setup(t), a=await f.signIn(), sync=await teamToken('synthetic-notification-tests-sync','sync');
  const own=encryptPayload({user:{id:'jordyn'},secret:'synthetic'},'synthetic-private-password'), other=encryptPayload({user:{id:'owner'}},'synthetic-owner-password');
  const now=Date.now();
  for(const [id,envelope] of [['jordyn',own],['owner',other]])assert.equal((await f.request(sync,'/sync/dashboard?id='+id,'PUT',{envelope,publishedAt:now})).status,200);
  const read=await f.request(a.token,'/dashboard?id=owner');assert.equal(read.status,200);assert.deepEqual(read.data,own);
  assert.equal((await f.request('', '/dashboard')).status,401);
  assert.equal((await f.request(a.token,'/dashboard','PUT',{envelope:other,publishedAt:now})).status,405);
  assert.equal((await f.request(a.token,'/sync/dashboard?id=owner')).status,403);
  assert.equal((await f.request(sync,'/sync/dashboard?id=jordyn','PUT',{envelope:other,publishedAt:now-1})).data.saved,false);
  assert.equal((await f.request(sync,'/sync/dashboard?id=jordyn','PUT',{envelope:{secret:'plaintext'},publishedAt:now+1})).status,400);
  assert.deepEqual((await f.request(a.token,'/dashboard')).data,own);
  const large={...own,ciphertext:'A'.repeat(1_200_000)};
  assert.equal((await f.request(sync,'/sync/dashboard?id=owner','PUT',{envelope:large,publishedAt:now+1})).status,200);
});
