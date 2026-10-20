// Synthetic browser + real in-memory Worker tests. No production data or recipients.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {fixture} from '../helpers/notification-fixture.mjs';
import {fileURLToPath} from 'node:url';
import {teamToken} from '../../lib/team-auth.mjs';
import {rentalAlertTargetId} from '../../lib/alert-target.mjs';
const require=createRequire(import.meta.url),{chromium}=require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES+'/playwright');
const root=fileURLToPath(new URL('../..',import.meta.url)).replace(/\/$/,''),stamp=new Date().toISOString();
const profiles=[{id:'owner',label:'Smooth',role:'owner'},{id:'jordyn',label:'Jordyn',role:'employee'}],employees=[{id:'jordyn',name:'Jordyn',accent:'#2563eb'},{id:'rayne',name:'Rayne',accent:'#9333ea'}];
const password=id=>'synthetic-notification-tests-'+id;
function envelope(id){const salt=crypto.randomBytes(16),iv=crypto.randomBytes(12),key=crypto.pbkdf2Sync(password(id),salt,1000,32,'sha256'),cipher=crypto.createCipheriv('aes-256-gcm',key,iv);const payload={version:1,source:'sample',generatedAt:stamp,calendarName:'Synthetic studio',role:id==='owner'?'owner':'employee',user:{id,name:id==='owner'?'Smooth':'Jordyn',accent:'#be123c'},employees,rentals:[],rulebook:{version:1,updatedAt:null,entries:[]},integrations:{calendar:true,stripe:false}};const encrypted=Buffer.concat([cipher.update(JSON.stringify(payload)),cipher.final(),cipher.getAuthTag()]);return {version:1,algorithm:'AES-GCM',kdf:'PBKDF2-SHA256',iterations:1000,salt:salt.toString('base64'),iv:iv.toString('base64'),ciphertext:encrypted.toString('base64')};}
const f=await fixture();delete f.env.VAPID_JWK;
const rental={id:'synthetic-daily-rental',title:'Studio A Rental',customer:'Synthetic Client',start:new Date(Date.now()+7200000).toISOString(),end:new Date(Date.now()+10800000).toISOString(),priceCents:10000,paidOnlineCents:2500,fullyPaid:false,acceptedEmployeeIds:[],rentalDetails:'Backdrop: white\nSetup: Two lights'};
const generation=crypto.randomUUID();assert.equal((await f.call('sync','/sync/import',{generation,appointments:[rental]})).status,200);assert.equal((await f.call('sync','/sync/commit',{generation,count:1})).status,200);
assert.equal((await f.call('owner','/studio-reference',{revision:0,entries:[],checklist:Array.from({length:16},(_,i)=>({id:'step'+i,phase:i<8?'Before arrival':'Closing',label:i===0?'Test the lights':`Synthetic checklist step ${i+1}`}))},'PATCH')).status,200);
const offer=async()=>{const result=await f.call('owner','/assignments',{revision:(await f.call('owner','/schedule')).data.revision,employeeId:'jordyn',appointmentId:rental.id});assert.equal(result.status,200);return result;};await offer();
const tokens=Object.fromEntries(await Promise.all(profiles.map(async p=>[await teamToken(password(p.id),p.id),p.id]))),envelopes=Object.fromEntries(profiles.map(p=>[p.id,envelope(p.id)]));
let failCreative=true,loseChecklistReply=true,delaySchedule=false;
const server=spawn('python',['-m','http.server','3099','--bind','127.0.0.1','--directory',root+'/out'],{stdio:'ignore'});let browser;
try{
 browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,headless:true,args:['--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--no-zygote']});
 const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
 await context.route('**/data/*.json*',route=>{const name=new URL(route.request().url()).pathname.split('/').pop();return route.fulfill({json:name==='access.json'?{profiles}:name==='team-api.json'?{enabled:true}:envelopes[name.slice(0,-5)]||{}});});
 await context.route('https://smooth-studios-team-api.smoothxstudios.workers.dev/**',async route=>{
   const req=route.request(),url=new URL(req.url()),path=url.pathname,user=tokens[req.headers().authorization?.slice(7)];
   if(path==='/engagement')return route.fulfill({json:{available:false,moodDue:false,moodPromptDue:false,quiz:[],history:[],rewards:[],summary:{points:0,stars:0,progress:0,remaining:500,goal:500}}});
   if(path==='/creative-work'&&req.method()==='POST'&&failCreative){failCreative=false;return route.fulfill({status:503,json:{error:'Synthetic connection problem. Your entries are still here.'}});}
   if(req.method()!=='GET')await new Promise(resolve=>setTimeout(resolve,500));
   if(path==='/schedule'&&delaySchedule)await new Promise(resolve=>setTimeout(resolve,2000));
   const result=await f.call(user,path+url.search,req.postData()?req.postDataJSON():undefined,req.method());
   if(path.startsWith('/rental-checklists/')&&req.method()==='PATCH'&&loseChecklistReply){loseChecklistReply=false;return route.fulfill({status:503,json:{error:'Could not confirm the save. Try again.'}});}
   return route.fulfill({status:result.status,json:result.data});
 });
 const login=async id=>{await page.getByLabel('Account',{exact:true}).selectOption(id);await page.getByLabel('Password',{exact:true}).fill(password(id));await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.locator('.topbar-alerts').waitFor({state:'attached'});};
 await page.goto('http://127.0.0.1:3099');await login('owner');
 await page.getByRole('heading',{name:'Today’s action list',exact:true}).waitFor();await page.locator('.daily-action-row').first().waitFor();
 assert.equal(await page.locator('[data-home-section="finances"] details').getAttribute('open'),null);assert.equal(await page.locator('.owner-reports').getAttribute('open'),null);
 assert.deepEqual(await page.locator('[data-home-section]').evaluateAll(nodes=>nodes.slice(0,2).map(n=>n.dataset.homeSection)),['upcoming','attention']);
 await page.screenshot({path:'/tmp/daily-home-mobile.png'});
 await page.locator('.daily-action-row').first().click();let dialog=page.getByRole('dialog');
 await dialog.getByRole('heading',{name:'Rental checklist',exact:true}).waitFor();assert.match(await dialog.innerText(),/\$75\.00/);assert.match(await dialog.innerText(),/Jordyn/);
 await dialog.getByLabel('Test the lights',{exact:true}).click();await dialog.getByRole('button',{name:'Try again',exact:true}).click();await page.waitForTimeout(700);assert.equal(await dialog.getByRole('checkbox').first().isChecked(),true);
 const saved=(await f.call('owner','/rental-checklists')).data.rentals[0];assert.equal(saved.progress.version,1,'Lost reply retry must not write twice');
 await dialog.evaluate(node=>{node.scrollTop=node.scrollHeight;});await page.waitForTimeout(100);
 const exit=await dialog.getByRole('button',{name:'Close',exact:true}).boundingBox();assert.ok(exit.y>=0&&exit.y+exit.height<=844);assert.ok(exit.width>=44&&exit.height>=44);
 await page.screenshot({path:'/tmp/appointment-mobile.png'});
 await dialog.getByRole('button',{name:'Cancel offer',exact:true}).click();delaySchedule=true;
 await dialog.getByRole('group',{name:'Confirm change'}).getByRole('button',{name:'Cancel offer',exact:true}).click();
 await dialog.getByText('Cancelling…',{exact:true}).waitFor();await page.locator('.action-feedback').getByText('Saved',{exact:true}).waitFor();
 await dialog.getByText('Previous responses (1)',{exact:true}).click();assert.match(await dialog.innerText(),/Offer cancelled/);await page.waitForTimeout(2100);delaySchedule=false;
 await dialog.getByRole('button',{name:'Close',exact:true}).click();
 await page.evaluate(()=>location.hash='#scheduling');await page.getByRole('button',{name:'Assign work',exact:true}).click();dialog=page.getByRole('dialog');assert.equal(await dialog.getByLabel('Employee',{exact:true}).inputValue(),'');assert.equal(await dialog.locator('.form-more-options').getAttribute('open'),null);assert.equal(await dialog.getByLabel('Employee',{exact:true}).evaluate(el=>el===document.activeElement),false);await dialog.getByRole('button',{name:'Close',exact:true}).click();
 await page.evaluate(()=>location.hash='#creative-work');await page.getByRole('button',{name:'Assign work',exact:true}).click();dialog=page.getByRole('dialog');assert.equal(await dialog.getByRole('checkbox',{checked:true}).count(),0);assert.equal(await dialog.locator('.form-more-options').getAttribute('open'),null);
 await dialog.getByLabel('Jordyn',{exact:true}).check();await dialog.getByLabel('Assignment title',{exact:true}).fill('Synthetic physical work');await dialog.getByLabel('Deadline',{exact:true}).fill('2026-10-25T17:00');await dialog.getByLabel('Pay per person (USD)',{exact:true}).fill('20');await dialog.getByRole('button',{name:'Assign work',exact:true}).click();await dialog.getByRole('button',{name:'Try again',exact:true}).waitFor();assert.equal(await dialog.getByLabel('Assignment title',{exact:true}).inputValue(),'Synthetic physical work');await dialog.getByRole('button',{name:'Try again',exact:true}).click();await dialog.waitFor({state:'hidden'});assert.equal((await f.call('owner','/creative-work')).data.assignments.length,1);
 await offer();await page.reload();await login('jordyn');await page.getByRole('heading',{name:'Your next assignment',exact:true}).waitFor();await page.getByRole('button',{name:'Accept rental',exact:true}).click();await page.getByRole('button',{name:'Open rental & checklist',exact:true}).first().waitFor();
 assert.match(await page.locator('.employee-home').innerText(),/Accept assignment/);await page.getByRole('button',{name:'Open rental & checklist',exact:true}).first().click();dialog=page.getByRole('dialog');await dialog.getByRole('checkbox').first().waitFor();assert.equal(await dialog.getByRole('checkbox').first().isChecked(),true,'Crew sees the saved checklist');assert.equal(await dialog.getByRole('button',{name:'Remove',exact:true}).count(),0);assert.doesNotMatch(await dialog.innerText(),/\$75\.00/);await dialog.getByRole('button',{name:'Close',exact:true}).click();
 await page.locator('.daily-action-row').filter({hasText:'Synthetic physical work'}).click();dialog=page.getByRole('dialog');await dialog.getByRole('button',{name:'Accept assignment',exact:true}).click();await dialog.getByRole('button',{name:'Submit work',exact:true}).waitFor();await dialog.getByRole('button',{name:'Close',exact:true}).click();await page.locator('.mobile-toolbar').getByRole('button',{name:'Home',exact:true}).click();assert.match(await page.locator('.employee-home').innerText(),/Submit work/);
 f.DB.sqlite.prepare('INSERT INTO team_notification_events(id,user_id,kind,payload,due_at) VALUES(?,?,?,?,?)').run('rental-alert','jordyn','notice',JSON.stringify({title:'Synthetic rental reminder',body:'Review your rental',target:'scheduling',targetId:rentalAlertTargetId(rental.id)}),Date.now());
 await page.locator('.mobile-toolbar').getByRole('button',{name:'Alerts',exact:true}).click();await page.getByRole('button',{name:/Synthetic rental reminder.*View/}).click();await page.getByRole('dialog').getByRole('heading',{name:'Rental checklist',exact:true}).waitFor();
 assert.deepEqual(errors,[]);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 console.log('PASS mobile daily action order, collapsed reports, complete appointment, cancellation feedback, blank selectors, optional fields, failed-save retry, shared checklist lost-reply recovery, employee acceptance/work actions, alert destination, reachable close, no overflow or page errors');
}finally{await browser?.close();server.kill();await Promise.allSettled(f.pending);f.close();}
