import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import worker from '../team-api/worker.mjs';
import { fixture, device } from './helpers/notification-fixture.mjs';
import { flushAlerts } from '../team-api/push.mjs';
import { deliveryLabel } from '../lib/notification-delivery.mjs';

const now = Date.parse('2026-10-19T02:00:00Z');
mock.timers.enable({apis:['Date'],now});test.beforeEach(()=>mock.timers.setTime(now));test.after(()=>mock.timers.reset());
async function setup(t) {const f=await fixture();t.after(()=>f.close());return f;}
function event(f,id='synthetic-receipt',user='jordyn') {
  f.DB.sqlite.prepare('INSERT INTO team_notification_events (id,user_id,kind,payload,due_at) VALUES (?,?,?,?,?)')
    .run(id,user,'notice',JSON.stringify({title:'Synthetic reminder',body:'Review the synthetic task.',target:'alerts'}),Date.now());
}
async function receipt(f, token, stage='received') {
  const response=await worker.fetch(new Request('https://api.example.invalid/push/receipt',{method:'POST',headers:{'content-type':'application/json',origin:'https://dashboard.smoothstudios.co'},body:JSON.stringify({receipt:token,stage})}),f.env,{waitUntil(){}});
  return response.status;
}
test('provider acceptance is not a device receipt; tokens prove only the matching alert and expire',async t=>{
  const f=await setup(t), d=device('receipt');await f.call('jordyn','/push/device',d);event(f);
  let payload;
  await flushAlerts(f.env,async(_url,options)=>{payload=d.decrypt(options.body);return new Response(null,{status:201});});
  let report=(await f.call('owner','/notifications/delivery')).data;
  assert.equal(report.alerts[0].receivedAt,null);assert.equal(report.alerts[0].acceptedAt,now);
  assert.equal(deliveryLabel(report.alerts[0],1),'Sent · receipt unconfirmed');
  assert.ok(!JSON.stringify(report).includes(payload.receipt));
  assert.equal((await f.call('jordyn','/notifications/delivery')).status,403);
  assert.equal((await f.call('sync','/notifications/delivery')).status,403);
  assert.equal(await receipt(f,'x'.repeat(43)),404);
  assert.equal(await receipt(f,payload.receipt,'invalid'),400);
  assert.equal(await receipt(f,payload.receipt),200);
  mock.timers.setTime(now+1000);assert.equal(await receipt(f,payload.receipt),200);
  report=(await f.call('owner','/notifications/delivery?person=jordyn')).data;
  assert.equal(report.alerts[0].receivedAt,now);assert.equal(report.alerts[0].openedAt,null);
  assert.equal(deliveryLabel(report.alerts[0],1),'Received on device');
  assert.equal(await receipt(f,payload.receipt,'opened'),200);
  report=(await f.call('owner','/notifications/delivery')).data;
  assert.equal(report.alerts[0].openedAt,now+1000);assert.equal(deliveryLabel(report.alerts[0],1),'Opened');
  assert.equal((await f.call('owner','/notifications/delivery?person=rayne')).data.alerts.length,0);
  mock.timers.setTime(now+8*86400_000);assert.equal(await receipt(f,payload.receipt),404);
});
test('bulk read cannot masquerade as opened, and in-app opens belong only to their recipient',async t=>{
  const f=await setup(t);event(f);event(f,'other-person','rayne');
  const page=(await f.call('jordyn','/alerts')).data;
  await f.call('jordyn','/alerts/read-all',{throughSequence:page.throughSequence},'PATCH');
  let rows=(await f.call('owner','/notifications/delivery')).data.alerts;
  assert.ok(rows.every(r=>r.openedAt===null));
  await f.call('rayne','/alerts/open',{ids:['synthetic-receipt']},'PATCH');
  assert.equal((await f.call('owner','/notifications/delivery?person=jordyn')).data.alerts[0].openedAt,null);
  await f.call('jordyn','/alerts/open',{ids:['synthetic-receipt']},'PATCH');
  assert.equal((await f.call('owner','/notifications/delivery?person=jordyn')).data.alerts[0].openedAt,now);
});
test('opening a phone alert stays read on later account requests; delivery alone and receipt retries do not change deliberate unread status',async t=>{
  const f=await setup(t), d=device('persistent-read');await f.call('jordyn','/push/device',d);
  event(f);event(f,'other-inbox','rayne');
  let payload;
  await flushAlerts(f.env,async(_url,options)=>{payload=d.decrypt(options.body);return new Response(null,{status:201});});
  assert.equal(await receipt(f,payload.receipt,'received'),200);
  assert.equal((await f.call('jordyn','/alerts?summary=1')).data.unreadCount,1);
  mock.timers.setTime(now+1000);
  assert.equal(await receipt(f,payload.receipt,'opened'),200);
  const reopened=(await f.call('jordyn','/alerts')).data;
  assert.equal(reopened.unreadCount,0);assert.equal(reopened.alerts[0].readAt,now+1000);
  assert.equal((await f.call('rayne','/alerts')).data.unreadCount,1);
  assert.equal((await f.call('owner','/alerts')).data.unreadCount,0);
  // A repeated receipt is a network retry, not a new tap after Mark all → Unread.
  await f.call('jordyn','/alerts/unread-all',{throughSequence:reopened.throughSequence},'PATCH');
  mock.timers.setTime(now+2000);await receipt(f,payload.receipt,'opened');
  assert.equal((await f.call('jordyn','/alerts')).data.unreadCount,1);
  await f.call('jordyn','/alerts/open',{ids:[payload.id]},'PATCH');
  assert.equal((await f.call('jordyn','/alerts')).data.unreadCount,0);
  await f.call('jordyn','/alerts',{ids:[payload.id]},'DELETE');
  await receipt(f,payload.receipt,'opened');
  assert.equal((await f.call('jordyn','/alerts')).data.alerts.length,0);
});
test('transient failures back off, successful devices stay deduplicated, and permanent failures are visible',async t=>{
  const f=await setup(t), good=device('good'), flaky=device('flaky');await f.call('jordyn','/push/device',good);await f.call('jordyn','/push/device',flaky);event(f);
  const calls=[];let recover=false;
  const send=async(url)=>{calls.push(url);return new Response(null,{status:url===good.endpoint||recover?201:503});};
  await Promise.all([flushAlerts(f.env,send),flushAlerts(f.env,send)]);
  assert.equal(calls.length,2);
  await flushAlerts(f.env,send);assert.equal(calls.length,2);
  mock.timers.setTime(now+60_000);recover=true;await flushAlerts(f.env,send);
  assert.equal(calls.filter(url=>url===good.endpoint).length,1);assert.equal(calls.filter(url=>url===flaky.endpoint).length,2);
  assert.equal(f.DB.sqlite.prepare('SELECT COUNT(*) n FROM team_notification_events').get().n,0);
  event(f,'failed');await flushAlerts(f.env,async()=>new Response(null,{status:410}));
  const report=(await f.call('owner','/notifications/delivery')).data;
  assert.equal(report.people.find(p=>p.userId==='jordyn').devices,0);
  assert.equal(deliveryLabel(report.alerts.find(a=>a.id==='failed'),0),'Needs attention');
});
test('expired alerts are not pushed late and legacy history never claims delivery without evidence',async t=>{
  const f=await setup(t),d=device('expired');await f.call('jordyn','/push/device',d);event(f);
  mock.timers.setTime(now+25*3600_000);let sent=0;
  await flushAlerts(f.env,async()=>{sent++;return new Response(null,{status:201});});assert.equal(sent,0);
  assert.equal(deliveryLabel({readAt:now,acceptedAt:null,receivedAt:null,openedAt:null,failed:0,retrying:0,queued:0},1),'Delivery unconfirmed');
});
test('a device receipt stops retries even if the provider response is lost at the same time',async t=>{
  const f=await setup(t),d=device('lost-response');await f.call('jordyn','/push/device',d);event(f);let sent=0;
  const provider=async(_url,options)=>{sent++;const payload=d.decrypt(options.body);await receipt(f,payload.receipt);throw Error('response lost after delivery');};
  await flushAlerts(f.env,provider);mock.timers.setTime(now+3600_000);await flushAlerts(f.env,provider);
  assert.equal(sent,1);assert.equal(f.DB.sqlite.prepare('SELECT completed_at FROM team_push_deliveries').get().completed_at,now);
  assert.equal((await f.call('owner','/notifications/delivery')).data.alerts[0].receivedAt,now);
});
test('service worker reports only after display succeeds, retries a lost receipt, and routes despite receipt failure',async()=>{
  const source=await readFile(new URL('../public/team-sw.js',import.meta.url),'utf8'),handlers={},actions=[];
  let shown,failDisplay=false,failReceipt=false;
  vm.runInNewContext(source,{URL,AbortSignal,fetch:async(url,options)=>{actions.push(['receipt',JSON.parse(options.body).stage,url]);if(failReceipt)throw Error('offline');return new Response(null,{status:200});},self:{
    addEventListener:(type,fn)=>handlers[type]=fn,
    registration:{scope:'https://dashboard.smoothstudios.co/',showNotification:async(_title,options)=>{if(failDisplay)throw Error('denied');shown=options;actions.push(['shown']);}},
    clients:{matchAll:async()=>[],openWindow:async url=>actions.push(['open',url])},
  }});
  const push=async()=>{let done;handlers.push({data:{json:()=>({type:'schedule',receipt:'x'.repeat(43),target:'availability'})},waitUntil:p=>done=p});return done;};
  await push();assert.equal(actions[0][0],'shown');assert.equal(actions[1][1],'received');
  failReceipt=true;let done;handlers.notificationclick({notification:{...shown,close(){}},waitUntil:p=>done=p});await done;
  assert.equal(actions.filter(a=>a[0]==='receipt'&&a[1]==='opened').length,2);
  assert.ok(actions.some(a=>a[0]==='open'&&a[1]==='https://dashboard.smoothstudios.co/#availability'));
  failDisplay=true;const before=actions.length;await assert.rejects(push());assert.equal(actions.length,before);
});

test('a successful phone open tells the dashboard to refresh only after its read receipt is saved',async()=>{
  const source=await readFile(new URL('../public/team-sw.js',import.meta.url),'utf8'),handlers={},actions=[];
  const scope='https://dashboard.smoothstudios.co/';let saved=false;
  const opened={url:scope,postMessage(message){assert.equal(saved,true);actions.push(message.type);}};
  let scans=0;
  vm.runInNewContext(source,{URL,AbortSignal,fetch:async()=>{await Promise.resolve();saved=true;return new Response(null,{status:200});},self:{
    addEventListener:(type,fn)=>handlers[type]=fn,registration:{scope},
    clients:{matchAll:async()=>++scans===1?[]:[opened,{url:'https://other.example.invalid/',postMessage(){throw Error('Wrong scope');}}],openWindow:async()=>actions.push('navigation')},
  }});
  let done;handlers.notificationclick({notification:{data:{type:'schedule',target:'availability',receipt:'x'.repeat(43)},close(){}},waitUntil:p=>done=p});await done;
  assert.deepEqual(actions,['navigation','smooth-alerts-read']);
});
