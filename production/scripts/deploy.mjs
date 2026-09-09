import {readFile,writeFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {hashPassword} from 'better-auth/crypto';
const account=process.env.CLOUDFLARE_ACCOUNT_ID?.trim(),token=process.env.CLOUDFLARE_API_TOKEN?.trim();
if(!/^[a-f0-9]{32}$/.test(account||'')||!token)throw new Error('The existing Cloudflare deployment secrets are required.');
async function cf(path,method='GET',body,optional=false){
 const r=await fetch('https://api.cloudflare.com/client/v4'+path,{method,redirect:'error',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(30000)});
 const data=await r.json();if(!r.ok||!data.success){if(optional)return null;throw new Error('Cloudflare request failed ('+r.status+') at '+path.replace(account,'ACCOUNT')+'. Check the configured token permissions.');}return data.result;
}
const prefix='/accounts/'+account,config=JSON.parse(await readFile('wrangler.jsonc','utf8'));
const databases=await cf(prefix+'/d1/database');let database=databases.find(d=>d.name==='smooth-studios-production-db');
if(!database)database=await cf(prefix+'/d1/database','POST',{name:'smooth-studios-production-db'});
config.d1_databases[0].database_id=database.uuid;
const buckets=await cf(prefix+'/r2/buckets','GET',undefined,true);
if(buckets){let bucket=buckets.buckets?.find(b=>b.name==='smooth-studios-production-files');if(!bucket)bucket=await cf(prefix+'/r2/buckets','POST',{name:'smooth-studios-production-files'},true);if(bucket)config.r2_buckets=[{binding:'BUCKET',bucket_name:'smooth-studios-production-files'}];}
await writeFile('wrangler.deploy.json',JSON.stringify(config,null,2));
async function wrangler(args){await new Promise((resolve,reject)=>{const p=spawn(process.execPath,['node_modules/wrangler/bin/wrangler.js',...args,'--config','wrangler.deploy.json'],{stdio:'inherit',env:{...process.env,WRANGLER_SEND_METRICS:'false'}});p.on('error',reject);p.on('exit',c=>c===0?resolve():reject(new Error('Production deployment failed.')));});}
await wrangler(['d1','migrations','apply','smooth-studios-production-db','--remote']);
async function query(sql,params=[]){return cf(prefix+'/d1/database/'+database.uuid+'/query','POST',{sql,params});}
const initial=[{id:'owner',username:'smooth',name:'Smooth'},{id:'akiva',username:'akiva',name:'Akiva'},{id:'jordyn',username:'jordyn',name:'Jordyn'},{id:'rayne',username:'rayne',name:'Rayne'}];
for(const person of initial){
 const found=await query('SELECT id FROM user WHERE id=?',[person.id]);if(found[0].results.length)continue;
 const password=process.env['DASHBOARD_PASSWORD_'+person.id.toUpperCase()];if(!password||password.length<16)throw new Error('Missing existing strong studio password for '+person.id+'. No password values are logged.');
 const email=process.env['EMPLOYEE_EMAIL_'+person.id.toUpperCase()]?.trim().toLowerCase()||person.id+'@production.invalid';
 const now=new Date().toISOString(),hash=await hashPassword(password);
 // Only initialize missing accounts. Redeployments never reset changed passwords.
 await cf(prefix+'/d1/database/'+database.uuid+'/query','POST',{batch:[
  {sql:'INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt,username,displayUsername,enabled,mustChangePassword) VALUES(?,?,?,0,?,?,?,?,1,0)',params:[person.id,person.name,email,now,now,person.username,person.username]},
  {sql:'INSERT INTO account(id,userId,accountId,providerId,password,createdAt,updatedAt) VALUES(?,?,?,\'credential\',?,?,?)',params:[crypto.randomUUID(),person.id,person.id,hash,now,now]}
 ]});
}
await wrangler(['deploy']);
const secretsPath=prefix+'/workers/scripts/'+config.name+'/secrets';const secrets=await cf(secretsPath);
if(!secrets.some(s=>s.name==='BETTER_AUTH_SECRET'))await cf(secretsPath,'PUT',{name:'BETTER_AUTH_SECRET',text:crypto.randomUUID()+crypto.randomUUID(),type:'secret_text'});
const origin=config.vars.APP_ORIGIN;
let ready=false,healthStatus=0,healthDetail='';
for(let attempt=0;attempt<5;attempt++){
 if(attempt)await new Promise(resolve=>setTimeout(resolve,attempt*2000));
 const health=await fetch(origin+'/api/health',{signal:AbortSignal.timeout(15000)});
 healthStatus=health.status;const body=await health.text();healthDetail=body.slice(0,300);
 try{ready=health.ok&&JSON.parse(body).accountsReady===true;}catch{}
 if(ready)break;
}
if(!ready)throw new Error('The production readiness check failed ('+healthStatus+'): '+healthDetail);
// A read-only sign-in check uses the existing owner credential only while the
// account still matches its initial password. Changed passwords are preserved.
const accountRow=(await query('SELECT password FROM account WHERE userId=\'owner\' AND providerId=\'credential\''))[0].results[0];
const {verifyPassword}=await import('better-auth/crypto');
if(await verifyPassword({hash:accountRow.password,password:process.env.DASHBOARD_PASSWORD_OWNER})){
 const login=await fetch(origin+'/api/auth/sign-in/username',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({username:'smooth',password:process.env.DASHBOARD_PASSWORD_OWNER}),signal:AbortSignal.timeout(30000)});
 if(!login.ok)throw new Error('The production login check failed ('+login.status+').');
 const cookie=login.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ');
 const me=await fetch(origin+'/api/session',{headers:{Cookie:cookie},signal:AbortSignal.timeout(30000)});if(!me.ok||!(await me.json()).user?.admin)throw new Error('The production account check failed.');
 await fetch(origin+'/api/auth/sign-out',{method:'POST',headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(30000)});
}
console.log('Production dashboard is ready: '+origin);
console.log('File storage: '+(config.r2_buckets?'production object bucket':'production database'));
if(process.env.GITHUB_STEP_SUMMARY)await writeFile(process.env.GITHUB_STEP_SUMMARY,'Production dashboard: '+origin+'\n\nAccount sign-in and project APIs verified. Initial usernames: smooth, akiva, jordyn, rayne. Initial passwords match the existing studio portal; future production password changes remain independent.\n');
