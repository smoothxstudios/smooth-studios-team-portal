// Synthetic mobile browser test; no production account requests or messages.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import worker from '../../team-api/worker.mjs';
import { fixture } from '../helpers/notification-fixture.mjs';
import { encryptPayload } from '../../scripts/lib/dashboard-data.mjs';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES+'/playwright');
const root=fileURLToPath(new URL('../..',import.meta.url)),profiles=[{id:'owner',label:'Smooth',role:'owner'},{id:'jordyn',label:'Jordyn',role:'employee'}];
const password=id=>'synthetic-notification-tests-'+id, f=await fixture();delete f.env.VAPID_JWK;
for(const {id,role,label} of profiles) {
  const payload={version:1,source:'sample',generatedAt:new Date().toISOString(),calendarName:'Synthetic studio',role,user:{id,name:label,accent:'#be123c'},employees:[{id:'jordyn',name:'Jordyn',accent:'#2563eb'}],rentals:[],rulebook:{version:1,updatedAt:null,entries:[]},integrations:{calendar:true,stripe:false}};
  f.DB.sqlite.prepare('INSERT INTO dashboard_snapshots VALUES(?,?,?)').run(id,JSON.stringify(encryptPayload(payload,password(id))),Date.now());
}
const server=spawn('python',['-m','http.server','3098','--bind','127.0.0.1','--directory',root+'/out'],{stdio:'ignore'});let browser;
try {
  browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,headless:true,args:['--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--no-zygote']});
  const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage(),errors=[],calls=[];
  page.on('pageerror',e=>errors.push(e.message));
  await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  await context.route('**/data/*.json*',async route=>{
    const name=new URL(route.request().url()).pathname.split('/').pop();
    assert.ok(['access.json','team-api.json','secure-import-key.json'].includes(name),'Private snapshot URL must never be fetched');
    await route.fulfill({json:name==='access.json'?{profiles}:name==='team-api.json'?{version:1,enabled:true}:{}});
  });
  await context.route('https://smooth-studios-team-api.smoothxstudios.workers.dev/**',async route=>{
    const req=route.request(),path=new URL(req.url()).pathname;calls.push({path,method:req.method()});
    const response=await worker.fetch(new Request(req.url(),{method:req.method(),headers:{authorization:req.headers().authorization||'','content-type':'application/json'},...(req.postData()?{body:req.postData()}: {})}),f.env,{waitUntil:p=>f.pending.push(p)});
    await route.fulfill({status:response.status,body:await response.text(),contentType:'application/json'});
  });
  const login=async id=>{
    await page.getByLabel('Account',{exact:true}).selectOption(id);await page.getByLabel('Password',{exact:true}).fill(password(id));await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.locator('.topbar-alerts').waitFor({state:'attached'});
  };
  await page.goto('http://127.0.0.1:3098');await login('owner');
  assert.equal(calls.filter(c=>c.path==='/auth/session'&&c.method==='POST').length,1);
  f.DB.sqlite.prepare('UPDATE dashboard_sessions SET expires_at=?').run(Date.now()-1);
  // Returning to the app triggers its quiet snapshot read and the server 401.
  await page.waitForTimeout(3100);await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await page.getByText('Your session ended. Sign in again to continue.',{exact:true}).waitFor();
  assert.equal(await page.locator('.topbar-alerts').count(),0);
  await login('jordyn');
  assert.equal(calls.filter(c=>c.path==='/auth/session'&&c.method==='POST').length,2);
  await page.getByRole('button',{name:'Dismiss Temp Check',exact:true}).click();
  await page.getByRole('button',{name:'Dismiss Daily Quiz',exact:true}).click();
  await page.getByRole('button',{name:/menu/i}).first().click();
  await page.getByRole('button',{name:/log out/i}).click();
  await page.getByRole('button',{name:'Sign in',exact:true}).waitFor();
  await page.waitForTimeout(300);
  assert.equal(f.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM dashboard_sessions WHERE expires_at>?').get(Date.now()).n,0);
  assert.deepEqual(errors,[]);
  console.log('PASS mobile authenticated data, expiry lock, account switch, explicit sign-out, no public snapshots or browser errors');
} finally {await browser?.close();server.kill();await Promise.allSettled(f.pending);f.close();}
