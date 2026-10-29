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
const rental={id:'setup-test',title:'Studio A Rental',customer:'Synthetic Client',start:new Date(Date.now()-600000).toISOString(),end:new Date(Date.now()+3000000).toISOString(),priceCents:5000,acceptedEmployeeIds:['jordyn'],rentalDetails:'What color backdrop do you need set up?:\nBlue\n\nEquipment needed:\nTwo strobes'};
const generation=crypto.randomUUID();
assert.equal((await f.call('sync','/sync/import',{generation,appointments:[rental]})).status,200);
assert.equal((await f.call('sync','/sync/commit',{generation,count:1})).status,200);
const tokens=Object.fromEntries(await Promise.all(profiles.map(async p=>[await teamToken(password(p.id),p.id),p.id]))),envelopes=Object.fromEntries(profiles.map(p=>[p.id,envelope(p.id)]));
const server=spawn('python',['-m','http.server','3098','--bind','127.0.0.1','--directory',root+'/out'],{stdio:'ignore'});let browser;
try{
 browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
 const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true}),page=await context.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
 await context.route('**/data/*.json*',route=>{const name=new URL(route.request().url()).pathname.split('/').pop();return route.fulfill({json:name==='access.json'?{profiles}:name==='team-api.json'?{enabled:true}:envelopes[name.slice(0,-5)]||{}});});
 await context.route('https://smooth-studios-team-api.smoothxstudios.workers.dev/**',async route=>{
 const req=route.request(),url=new URL(req.url()),user=tokens[req.headers().authorization?.slice(7)];
 if(url.pathname==='/engagement')return route.fulfill({json:{available:false,moodDue:false,moodPromptDue:false,quiz:[],history:[],rewards:[],summary:{points:0,stars:0,progress:0,remaining:500,goal:500}}});
 const result=await f.call(user,url.pathname+url.search,req.postData()?req.postDataJSON():undefined,req.method());return route.fulfill({status:result.status,json:result.data});
 });
 await page.goto('http://127.0.0.1:3098');
 await page.getByLabel('Account',{exact:true}).selectOption('jordyn');
 await page.getByLabel('Password',{exact:true}).fill(password('jordyn'));
 await page.getByRole('button',{name:'Sign in',exact:true}).click();
 await page.getByRole('heading',{name:'Happening now',exact:true}).waitFor();
 await page.locator('.employee-next-action .rental-description').waitFor();
 assert.match(await page.locator('.employee-next-action').innerText(),/Blue/);
 assert.match(await page.locator('.employee-next-action').innerText(),/Two strobes/);
 const earningsCard=page.locator('.employee-earnings-card');
 await earningsCard.waitFor();
 assert.match(await earningsCard.innerText(),/Earnings[\s\S]*View earnings[\s\S]*Pay owed/);
 assert.ok((await earningsCard.boundingBox()).height < 180,'Earnings card should remain compact on mobile');
 for(const width of [320,390,768]){
 await page.setViewportSize({width,height:844});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 const padding=await page.locator('.employee-next-action').evaluate(el=>parseFloat(getComputedStyle(el).paddingLeft));
 assert.ok(padding>=16);
 }
 await page.setViewportSize({width:390,height:844});
 await page.screenshot({path:'/tmp/employee-rental-setup-mobile.png'});
 await page.getByRole('button',{name:'View rental details',exact:true}).click();
 const dialog=page.getByRole('dialog');await dialog.getByRole('heading',{name:'Rental details',exact:true}).waitFor();
 assert.match(await dialog.innerText(),/Blue/);assert.match(await dialog.innerText(),/Two strobes/);
 assert.equal(await dialog.getByRole('heading',{name:'Rental checklist',exact:true}).count(),0);
 assert.deepEqual(errors,[]);
 console.log('PASS employee Home setup, full appointment details, mobile padding at 320/390/768px, no overflow or page errors');
}finally{await browser?.close();server.kill();await Promise.allSettled(f.pending);f.close();}

