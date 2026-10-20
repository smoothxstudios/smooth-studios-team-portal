import worker from '../../team-api/worker.mjs';
// Run after build:github-pages with Playwright installed; all external requests use synthetic fixtures.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {fixture} from '../helpers/notification-fixture.mjs';
import {fileURLToPath} from 'node:url';
import {teamToken} from '../../lib/team-auth.mjs';
const require=createRequire(import.meta.url),{chromium}=require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES ? process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES+'/playwright' : 'playwright');
const root=fileURLToPath(new URL('../..',import.meta.url)).replace(/\/$/,''),profiles=[{id:'owner',label:'Smooth',role:'owner'},{id:'jordyn',label:'Jordyn',role:'employee'}],stamp=new Date().toISOString();
const employees=[{id:'jordyn',name:'Jordyn',accent:'#2563eb'}],password=id=>'synthetic-notification-tests-'+id;
function envelope(id){const salt=crypto.randomBytes(16),iv=crypto.randomBytes(12),key=crypto.pbkdf2Sync(password(id),salt,1000,32,'sha256'),cipher=crypto.createCipheriv('aes-256-gcm',key,iv);const payload={version:1,source:'sample',generatedAt:stamp,calendarName:'Synthetic studio',role:id==='owner'?'owner':'employee',user:{id,name:id==='owner'?'Smooth':'Jordyn',accent:'#be123c'},employees,rentals:[],rulebook:{version:1,updatedAt:null,entries:[]},integrations:{calendar:true,stripe:false}};const encrypted=Buffer.concat([cipher.update(JSON.stringify(payload)),cipher.final(),cipher.getAuthTag()]);return {version:1,algorithm:'AES-GCM',kdf:'PBKDF2-SHA256',iterations:1000,salt:salt.toString('base64'),iv:iv.toString('base64'),ciphertext:encrypted.toString('base64')};}
const f=await fixture();delete f.env.VAPID_JWK;
for(const id of ['owner','jordyn'])f.DB.sqlite.prepare('INSERT INTO team_notification_events(id,user_id,kind,payload,due_at) VALUES(?,?,?,?,?)').run('synthetic-'+id,id,'notice',JSON.stringify({title:'Synthetic availability reminder',body:'Review availability.',target:'availability'}),Date.now());
const tokens=Object.fromEntries(await Promise.all(profiles.map(async p=>[await teamToken(password(p.id),p.id),p.id]))),envelopes={owner:envelope('owner'),jordyn:envelope('jordyn')};
const server=spawn('python',['-m','http.server','3098','--bind','127.0.0.1','--directory',root+'/out'],{stdio:'ignore'});let browser;
try{
 browser=await chromium.launch({...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? {executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE} : {}),headless:true,args:['--no-sandbox','--disable-gpu','--disable-software-rasterizer','--disable-dev-shm-usage','--no-zygote']});
 const context=await browser.newContext({viewport:{width:1280,height:900}}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
 await context.route('**/data/*.json*',async route=>{const file=new URL(route.request().url()).pathname.split('/').pop();await route.fulfill({json:file==='access.json'?{profiles}:file==='team-api.json'?{version:1,enabled:true}:envelopes[file.slice(0,-5)]||{}});});
 await context.route('https://smooth-studios-team-api.smoothxstudios.workers.dev/**',async route=>{const req=route.request(),url=new URL(req.url()),path=url.pathname,user=tokens[req.headers().authorization?.slice(7)];let json,status=200;
 if(path==='/auth/session') {
   const result=await worker.fetch(new Request(req.url(),{method:req.method(),headers:{authorization:req.headers().authorization,'content-type':'application/json'},...(req.postData()?{body:req.postData()}: {})}),f.env,{waitUntil(){}});
   json=await result.json();status=result.status;if(json.token)tokens[json.token]=user;
 }
 else if(path==='/dashboard') {json=envelopes[user];if(!json){status=401;json={error:'Sign in again'};}}
 else if(path.startsWith('/alerts')){if(req.method()!=='GET')await new Promise(r=>setTimeout(r,800));const result=await f.call(user,path+url.search,req.postData()?req.postDataJSON():undefined,req.method());status=result.status;json=result.data;}
 else if(path==='/schedule')json={revision:1,syncedAt:stamp,appointments:[],blocks:[],assignments:[],workPreferences:[],devices:{},pushPublicKey:null};
 else if(path==='/event-planner')json={revision:0,events:[],guests:[],availability:[]};
 else if(path==='/creative-work')json={assignments:[]};else if(path==='/payroll')json={version:1,syncedAt:stamp,balances:[],allocations:[],reviewCount:0};
 else if(path==='/dashboard-layout')json={revision:1,order:['upcoming','attention','finances','hours','creative','reports']};
 else if(path==='/engagement')json={available:false,moodDue:false,moodPromptDue:false,quiz:[],history:[],rewards:[],summary:{points:0,stars:0,progress:0,remaining:500,goal:500}};
 else {status=503;json={error:'Synthetic unavailable service'};}
 await route.fulfill({status,json});});
 const login=async id=>{await page.getByLabel('Account',{exact:true}).selectOption(id);await page.getByLabel('Password',{exact:true}).fill(password(id));await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.locator('.topbar-alerts').waitFor({state:'attached'});};
 await page.goto('http://127.0.0.1:3098');await login('owner');await page.setViewportSize({width:390,height:844});await page.locator('.mobile-toolbar').getByRole('button',{name:'Alerts',exact:true}).click();
 const title='Synthetic availability reminder',badge=()=>page.locator('.topbar-alerts').getAttribute('aria-label');
 const leaveDuring=async (method,path,action)=>{
   const request=page.waitForRequest(r=>r.method()===method&&new URL(r.url()).pathname===path);
   await action();await request;await page.evaluate(()=>location.hash='#payouts');await page.waitForTimeout(1200);
 };
 await page.getByRole('button',{name:'More options: '+title,exact:true}).click();
 await leaveDuring('DELETE','/alerts',()=>page.getByRole('menuitem',{name:'Delete alert',exact:true}).click());
 assert.equal((await f.call('owner','/alerts?summary=1')).data.unreadCount,0);
 assert.equal(await badge(),'Alerts','Deletion badge must update after navigating away');
 await page.locator('.mobile-toolbar').getByRole('button',{name:'Alerts',exact:true}).click();
 await leaveDuring('PATCH','/alerts/restore',()=>page.getByRole('button',{name:'Undo deletion: '+title,exact:true}).click());
 assert.match(await badge(),/1/,'Restored unread badge must update on another tab');
 await page.locator('.mobile-toolbar').getByRole('button',{name:'Alerts',exact:true}).click();await page.getByRole('button',{name:title+'. View availability',exact:true}).click();
 await page.waitForTimeout(1200);assert.equal(await badge(),'Alerts');await page.locator('.mobile-toolbar').getByRole('button',{name:'Alerts',exact:true}).click();
 await page.getByRole('button',{name:'Mark all',exact:true}).click();
 await leaveDuring('PATCH','/alerts/unread-all',()=>page.getByRole('menuitem',{name:'Unread',exact:true}).click());
 assert.match(await badge(),/1/,'Bulk unread badge must update after navigation');
 assert.equal((await f.call('owner','/alerts?summary=1')).data.unreadCount,1);
 assert.equal((await f.call('jordyn','/alerts?summary=1')).data.unreadCount,1);
 assert.deepEqual(errors,[]);
 console.log('PASS delayed delete / Undo / mark-unread across navigation; other account isolated; no page errors');
 await page.addInitScript(()=>{Object.defineProperty(window,'localStorage',{get(){throw new DOMException('Storage disabled','SecurityError')}})});
 await page.reload();await login('owner');assert.deepEqual(errors,[]);
 console.log('PASS sign-in and dashboard with blocked browser storage');
}finally{await browser?.close();server.kill();await Promise.all(f.pending);f.close();}
