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
const employees=[{id:'jordyn',name:'Jordyn',accent:'#2563eb'},{id:'rayne',name:'Rayne',accent:'#2563eb'},{id:'akiva',name:'Akiva',accent:'#2563eb'}],password=id=>'synthetic-notification-tests-'+id;
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
 if(path.startsWith('/alerts') || path.startsWith('/creative-work')){if(req.method()!=='GET')await new Promise(r=>setTimeout(r,800));const result=await f.call(user,path+url.search,req.postData()?req.postDataJSON():undefined,req.method());status=result.status;json=result.data;}
 else if(path==='/schedule')json={revision:1,syncedAt:stamp,appointments:[],blocks:[],assignments:[],workPreferences:[],devices:{},pushPublicKey:null};
 else if(path==='/event-planner')json={revision:0,events:[],guests:[],availability:[]};
 else if(path==='/creative-work')json={assignments:[]};else if(path==='/payroll')json={version:1,syncedAt:stamp,balances:[],allocations:[],reviewCount:0};
 else if(path==='/dashboard-layout')json={revision:1,order:['upcoming','attention','finances','hours','creative','reports']};
 else if(path==='/engagement')json={available:false,moodDue:false,moodPromptDue:false,quiz:[],history:[],rewards:[],summary:{points:0,stars:0,progress:0,remaining:500,goal:500}};
 else {status=503;json={error:'Synthetic unavailable service'};}
 await route.fulfill({status,json});});
 const login=async id=>{await page.getByLabel('Account',{exact:true}).selectOption(id);await page.getByLabel('Password',{exact:true}).fill(password(id));await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.locator('.topbar-alerts').waitFor({state:'attached'});};
 await page.goto('http://127.0.0.1:3098');await login('owner');await page.setViewportSize({width:390,height:844});await page.evaluate(()=>location.hash='#creative-work');
 await page.getByRole('button',{name:'Assign work',exact:true}).click();
 let dialog=page.getByRole('dialog');
 assert.equal(await dialog.getByRole('checkbox',{checked:true}).count(),0);
 await dialog.getByLabel('Jordyn',{exact:true}).check();await dialog.getByLabel('Rayne',{exact:true}).check();
 await dialog.getByLabel('Assignment title',{exact:true}).fill('Synthetic team project');
 await dialog.getByLabel('Deadline',{exact:true}).fill('2026-10-25T17:00');
 await dialog.getByLabel('Pay per person (USD)',{exact:true}).fill('50');
 await page.screenshot({path:'/tmp/creative-editor.png'});
 await dialog.getByRole('button',{name:'Assign work',exact:true}).click();await dialog.waitFor({state:'hidden'});
 assert.equal(await page.locator('.creative-card').count(),1);assert.match(await page.locator('.creative-card').innerText(),/2 people/);
 await page.locator('.creative-card').click();await page.getByRole('button',{name:'Edit work',exact:true}).click();
 dialog=page.getByRole('dialog');await dialog.getByText('More options',{exact:true}).click();await dialog.getByLabel('Brief & deliverables · optional',{exact:true}).fill('Updated work instructions');await dialog.getByRole('button',{name:'Save changes',exact:true}).click();await dialog.waitFor({state:'hidden'});
 await page.locator('.creative-card').click();await page.getByRole('button',{name:'Add people',exact:true}).click();dialog=page.getByRole('dialog');
 assert.equal(await dialog.getByRole('checkbox').count(),1);await dialog.getByLabel('Akiva',{exact:true}).check();await dialog.getByRole('button',{name:'Add people',exact:true}).click();await dialog.waitFor({state:'hidden'});
 assert.equal(await page.locator('.creative-card').count(),1);assert.match(await page.locator('.creative-card').innerText(),/3 people/);assert.match(await page.locator('.creative-card').innerText(),/150.00/);
 await page.locator('.creative-card').click();assert.equal(await page.getByRole('group',{name:'Assigned people'}).getByRole('button').count(),3);
 await page.waitForTimeout(350);await page.screenshot({path:'/tmp/creative-team.png'});
 const items=(await f.call('owner','/creative-work')).data.assignments;assert.equal(items.length,3);assert.equal(items.find(i=>i.employeeId==='rayne').instructions,'');assert.equal(items.find(i=>i.employeeId==='jordyn').instructions,'Updated work instructions');
 assert.deepEqual(errors,[]);console.log('PASS mobile multi-person assignment, grouped card, edit selected person, add another person, separate terms, no browser errors');
}finally{await browser?.close();server.kill();await Promise.all(f.pending);f.close();}
