// Synthetic mobile browser test; no production account requests or messages.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import worker from '../../team-api/worker.mjs';
import { fixture } from '../helpers/notification-fixture.mjs';
import { encryptDashboard } from '../../scripts/lib/dashboard-data.mjs';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES+'/playwright');
const root=fileURLToPath(new URL('../..',import.meta.url)),profiles=[{id:'owner',label:'Smooth',role:'owner'},{id:'jordyn',label:'Jordyn',role:'employee'}];
const password=id=>'synthetic-notification-tests-'+id, f=await fixture();delete f.env.VAPID_JWK;
for(const {id,role,label} of profiles) {
  const payload={version:1,source:'sample',generatedAt:new Date().toISOString(),calendarName:'Synthetic studio',role,user:{id,name:label,accent:'#be123c'},employees:[{id:'jordyn',name:'Jordyn',accent:'#2563eb'}],rentals:[],rulebook:{version:1,updatedAt:null,entries:[]},integrations:{calendar:true,stripe:false}};
  if(id==='owner') payload.rentals.push({id:'synthetic-old-rental',title:'Studio Rental',customer:'Synthetic History Client',start:'2020-01-01T12:00:00Z',end:'2020-01-01T13:00:00Z',priceCents:5000,paidOnlineCents:5000,fullyPaid:true,assignedEmployeeIds:['jordyn'],employeePayouts:{jordyn:{amountCents:1500,paid:true}},rentalDetails:'Synthetic old details'});
  const bundle=encryptDashboard(payload,password(id));
  f.DB.sqlite.prepare('INSERT INTO dashboard_snapshots (user_id, envelope, home_envelope, published_at) VALUES(?,?,?,?)').run(id,JSON.stringify(bundle.envelope),JSON.stringify(bundle.homeEnvelope),Date.now());
}
const server=spawn('python',['-m','http.server','3098','--bind','127.0.0.1','--directory',root+'/out'],{stdio:'ignore'});let browser;
try {
  browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,headless:true,args:['--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--no-zygote']});
  let failHistory=true;
  const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage(),errors=[],calls=[];
  page.on('pageerror',e=>errors.push(e.message));
  await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  await context.route('**/data/*.json*',async route=>{
    const name=new URL(route.request().url()).pathname.split('/').pop();
    assert.ok(['access.json','team-api.json','secure-import-key.json'].includes(name),'Private snapshot URL must never be fetched');
    await route.fulfill({json:name==='access.json'?{profiles}:name==='team-api.json'?{version:1,enabled:true}:{}});
  });
  await context.route('https://smooth-studios-team-api.smoothxstudios.workers.dev/**',async route=>{
    const req=route.request(),url=new URL(req.url()),path=url.pathname;const call={path,search:url.search,method:req.method()};calls.push(call);
    if(path==='/dashboard' && !url.search && failHistory) {failHistory=false;return route.abort();}
    const response=await worker.fetch(new Request(req.url(),{method:req.method(),headers:{authorization:req.headers().authorization||'','content-type':'application/json',...(req.headers()['if-none-match']?{'if-none-match':req.headers()['if-none-match']}: {})},...(req.postData()?{body:req.postData()}: {})}),f.env,{waitUntil:p=>f.pending.push(p)});
    call.status=response.status;
    await route.fulfill({status:response.status,body:await response.text(),headers:Object.fromEntries(response.headers)});
  });
  const login=async id=>{
    await page.getByLabel('Account',{exact:true}).selectOption(id);await page.getByLabel('Password',{exact:true}).fill(password(id));await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.locator('.topbar-alerts').waitFor({state:'attached'});
  };
  await page.goto('http://127.0.0.1:3098');await login('owner');
  assert.equal(calls.filter(c=>c.path==='/auth/session'&&c.method==='POST').length,1);
  assert.equal(calls.filter(c=>c.path==='/dashboard').length,0,'sign-in includes Home without an extra snapshot read');
  assert.equal(await page.locator('.owner-reports-content').count(),0,'closed reports are not rendered');
  await page.waitForTimeout(3100);await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await page.waitForTimeout(400);assert.ok(calls.some(c=>c.path==='/dashboard'&&c.status===304),'unchanged refresh returns no payload');
  await page.locator('summary').filter({hasText:'Financial reports'}).click();
  await page.getByText('History couldn’t load.',{exact:false}).waitFor();
  await page.getByRole('button',{name:'Try again',exact:true}).click();
  await page.locator('.owner-reports-content').waitFor();
  await page.getByRole('button',{name:/menu/i}).first().click();
  await page.getByRole('button',{name:'Appointments',exact:true}).click();
  await page.getByText('Synthetic History Client',{exact:true}).first().waitFor();
  assert.equal(calls.filter(c=>c.path==='/dashboard'&&!c.search).length,2,'full history retries once, then is reused');
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
  console.log('PASS mobile combined login, conditional refresh, deferred history with failure/retry, expiry lock, account switch, sign-out, no browser errors');
} finally {await browser?.close();server.kill();await Promise.allSettled(f.pending);f.close();}
