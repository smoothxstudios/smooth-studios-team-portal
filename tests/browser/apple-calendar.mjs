// Synthetic browser + real in-memory Worker tests. No production data or recipients.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {fixture} from '../helpers/notification-fixture.mjs';
import {fileURLToPath} from 'node:url';
import {teamToken} from '../../lib/team-auth.mjs';

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
let applePosts=0, loseFirstAppleReply=true;
const server=spawn('python',['-m','http.server','3100','--bind','127.0.0.1','--directory',root+'/out'],{stdio:'ignore'});let browser;
try{
 browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,headless:true,args:['--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--no-zygote']});
 const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await context.addInitScript(()=>Object.defineProperty(navigator,'clipboard',{value:{writeText:async value=>{if(window.blockCopy)throw new Error('Clipboard blocked');window.copiedCalendarLink=value;}}}));
 await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
 await context.route('**/data/*.json*',route=>{const name=new URL(route.request().url()).pathname.split('/').pop();return route.fulfill({json:name==='access.json'?{profiles}:name==='team-api.json'?{enabled:true}:envelopes[name.slice(0,-5)]||{}});});
 await context.route('https://smooth-studios-team-api.smoothxstudios.workers.dev/**',async route=>{
   const req=route.request(),url=new URL(req.url()),path=url.pathname,user=tokens[req.headers().authorization?.slice(7)];
   if(path==='/engagement')return route.fulfill({json:{available:false,moodDue:false,moodPromptDue:false,quiz:[],history:[],rewards:[],summary:{points:0,stars:0,progress:0,remaining:500,goal:500}}});
   if(path==='/calendar/apple'&&req.method()==='POST'){applePosts++;await new Promise(resolve=>setTimeout(resolve,500));}
   const result=await f.call(user,path+url.search,req.postData()?req.postDataJSON():undefined,req.method());
   if(path==='/calendar/apple'&&req.method()==='POST'&&loseFirstAppleReply){loseFirstAppleReply=false;return route.fulfill({status:503,json:{error:'Could not confirm setup. Try again.'}});}
   return route.fulfill({status:result.status,json:result.data});
 });
 const login=async id=>{await page.getByLabel('Account',{exact:true}).selectOption(id);await page.getByLabel('Password',{exact:true}).fill(password(id));await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.locator('.topbar-alerts').waitFor({state:'attached'});};
 await page.goto('http://127.0.0.1:3100');await login('jordyn');
 await page.getByRole('button',{name:'View rental details',exact:true}).first().click();const dialog=page.getByRole('dialog');
 assert.equal(applePosts,0,'Opening appointment does not enable a subscription');
 await dialog.getByRole('button',{name:'Apple Calendar',exact:true}).click();await dialog.getByRole('button',{name:'Preparing…',exact:true}).waitFor();
 await dialog.getByRole('button',{name:'Try again',exact:true}).waitFor();await dialog.getByRole('button',{name:'Try again',exact:true}).click();
 const open=dialog.getByRole('link',{name:'Open Apple Calendar',exact:true});await open.waitFor();assert.equal(applePosts,1,'Lost setup reply recovers the same link');
 const link=await open.getAttribute('href');assert.match(link,/^webcal:\/\/smooth-studios-team-api\.smoothxstudios\.workers\.dev\/calendar\/apple\/feed\/[A-Za-z0-9_-]{43}\.ics$/);
 assert.equal((await f.call('jordyn','/schedule')).data.assignments[0].status,'pending','Calendar setup does not accept work');
 await dialog.getByRole('button',{name:'Copy link',exact:true}).click();assert.equal(await page.evaluate(()=>window.copiedCalendarLink),link.replace('webcal:','https:'));
 await page.evaluate(()=>{window.blockCopy=true;});await dialog.getByRole('button',{name:'Copy link',exact:true}).click();await dialog.getByLabel('Private Apple Calendar subscription link',{exact:true}).waitFor();assert.equal(await dialog.locator('.apple-calendar-help').getAttribute('open'),'');
 await dialog.getByText('Setup help & options',{exact:true}).click();await dialog.evaluate(node=>{node.scrollTop=0;});await page.screenshot({path:'/tmp/apple-calendar-mobile.png'});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 const bounds=await open.boundingBox();assert.ok(bounds.height>=44);
 await dialog.getByRole('button',{name:'Close',exact:true}).click();await page.evaluate(()=>location.hash='#settings');const settings=page.getByRole('region',{name:'Apple Calendar settings',exact:true});await settings.getByRole('link',{name:'Open Apple Calendar',exact:true}).waitFor();
 assert.equal(await settings.getByRole('link',{name:'Open Apple Calendar',exact:true}).getAttribute('href'),link);
 await settings.getByText('Setup help & options',{exact:true}).click();await settings.getByRole('button',{name:'Turn off Apple Calendar sync',exact:true}).click();await settings.getByRole('button',{name:'Keep sync',exact:true}).click();assert.equal((await f.call('jordyn','/calendar/apple')).data.enabled,true);
 await settings.getByRole('button',{name:'Turn off Apple Calendar sync',exact:true}).click();await settings.getByRole('button',{name:'Turn off sync',exact:true}).click();await settings.getByRole('button',{name:'Set up Apple Calendar',exact:true}).waitFor();assert.equal((await f.call('jordyn','/calendar/apple')).data.enabled,false);
 await settings.getByRole('button',{name:'Set up Apple Calendar',exact:true}).click();await settings.getByRole('link',{name:'Open Apple Calendar',exact:true}).waitFor();assert.notEqual(await settings.getByRole('link',{name:'Open Apple Calendar',exact:true}).getAttribute('href'),link);
 await page.reload();await login('owner');await page.evaluate(()=>location.hash='#settings');const ownerSettings=page.getByRole('region',{name:'Apple Calendar settings',exact:true});await ownerSettings.getByRole('button',{name:'Set up Apple Calendar',exact:true}).waitFor();assert.equal((await f.call('owner','/calendar/apple')).data.enabled,false);assert.equal(await ownerSettings.getByRole('link',{name:'Open Apple Calendar',exact:true}).count(),0,'Employee link is not retained across accounts');
 assert.deepEqual(errors,[]);
 console.log('PASS mobile Apple subscription setup, lost-reply recovery, stable private link, clipboard fallback, no automatic acceptance, disable confirmation, link rotation, account isolation, no overflow or page errors. Native Apple subscription confirmation requires a real Apple device.');
}finally{await browser?.close();server.kill();await Promise.allSettled(f.pending);f.close();}
