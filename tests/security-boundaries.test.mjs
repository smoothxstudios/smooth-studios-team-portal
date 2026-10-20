import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../team-api/worker.mjs';
import {fixture} from './helpers/notification-fixture.mjs';
import {teamToken} from '../lib/team-auth.mjs';

const ownerActions=[['/identity/team','GET'],['/event-planner','GET'],['/dashboard-layout','PUT'],['/payroll/reviews','GET'],['/notifications/delivery','GET'],['/notifications','POST'],['/calendar/setup','POST'],['/studio-reference','PATCH'],['/creative-work','POST'],['/creative-work/manual-pay','POST'],['/engagement/team','GET'],['/engagement/rewards','POST'],['/rental-staff/remove','POST'],['/assignments','POST']];
test('owner APIs enforce roles independently of hidden navigation and supplied identity fields',async t=>{
 const f=await fixture();t.after(()=>f.close());delete f.env.VAPID_JWK;
 for(const [path,method] of ownerActions){
  const data=method==='GET'?undefined:{user:'owner',userId:'owner',role:'owner',employeeId:'owner'};
  assert.equal((await f.call('invalid',path,data,method)).status,401,path+' signed out');
  assert.equal((await f.call('jordyn',path,data,method)).status,403,path+' employee');
  assert.equal((await f.call('sync',path,data,method)).status,403,path+' sync token');
 }
 for(const user of ['owner','jordyn'])assert.equal((await f.call(user,'/sync/manifest')).status,403);
});
test('untrusted browser origins and malformed JSON cannot reach authenticated operations',async t=>{
 const f=await fixture();t.after(()=>f.close());
 const authorization='Bearer '+await teamToken('synthetic-notification-tests-owner','owner');
 const call=(origin,body,headers={})=>worker.fetch(new Request('https://api.example.invalid/studio-reference',{method:'PATCH',headers:{origin,authorization,'content-type':'application/json',...headers},body}),f.env,{waitUntil(){}});
 assert.equal((await call('https://attacker.invalid','{}')).status,403);
 assert.equal((await call('https://dashboard.smoothstudios.co','null')).status,400);
 assert.equal((await call('https://dashboard.smoothstudios.co','{')).status,400);
 assert.equal((await call('https://dashboard.smoothstudios.co',JSON.stringify({note:'x'.repeat(256001)}))).status,413);
 assert.equal((await call('https://dashboard.smoothstudios.co','{}',{'content-type':'text/plain'})).status,415);
});

test('API request throttle runs before database reads and uses one budget across paths',async()=>{
 const keys=[];const env={API_RATE_LIMIT:{async limit({key}){keys.push(key);return {success:false};}},DB:{prepare(){throw new Error('Database must not be reached');}}};
 for(const path of ['/health','/identity','/alerts','/push/receipt']){
  const result=await worker.fetch(new Request('https://api.example.invalid'+path,{headers:{'cf-connecting-ip':'192.0.2.1',authorization:'Bearer '+ 'a'.repeat(43)}}),env,{});
  assert.equal(result.status,429);assert.equal(result.headers.get('retry-after'),'60');assert.equal(result.headers.get('cache-control'),'no-store');
 }
 assert.equal(new Set(keys).size,1);assert.ok(!keys[0].includes('192.0.2.1'));
 await worker.fetch(new Request('https://api.example.invalid/identity',{headers:{'cf-connecting-ip':'192.0.2.2'}}),env,{});assert.notEqual(keys.at(-1),keys[0]);
});
