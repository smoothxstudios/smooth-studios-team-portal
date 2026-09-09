import assert from 'node:assert/strict';
import {Miniflare} from 'miniflare';
import {readFile,readdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {hashPassword} from 'better-auth/crypto';
import {build} from 'esbuild';
const bundle=spawnSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','deploy','--dry-run','--outdir','.work/worker'],{encoding:'utf8'});
if(bundle.status!==0)throw new Error(bundle.stdout+bundle.stderr);
await build({entryPoints:['lib/shot-list.ts'],bundle:true,platform:'node',format:'esm',outfile:'.work/shot-list.mjs'});
const {blankProject,blankShot}=await import('../.work/shot-list.mjs');
const origin='https://test.invalid';
let mf;
if(process.env.LOCAL_NODE_TEST==='1'){
 await build({stdin:{contents:"export {default} from './worker'; export {env as testEnv} from 'cloudflare:workers';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',packages:'external',outfile:'.work/test-worker.mjs',alias:{'cloudflare:workers':'./scripts/mock-cloudflare.mjs'}});
 const worker=(await import('../.work/test-worker.mjs')).default;
 // The alias's database is shared with the bundled Worker through this export.
 const exported=await import('../.work/test-worker.mjs');
 mf={getD1Database:async()=>exported.testEnv.DB,dispatchFetch:(url,init)=>worker.fetch(new Request(url,init)),dispose:async()=>{}};
}else mf=new Miniflare({modules:[{type:'ESModule',path:'.work/worker/worker.js'}],compatibilityDate:'2026-05-22',cf:false,host:'127.0.0.1',compatibilityFlags:['nodejs_compat'],d1Databases:['DB'],bindings:{APP_ORIGIN:origin,BETTER_AUTH_SECRET:'test-only-secret-with-more-than-32-characters'},serviceBindings:{ASSETS:()=>new Response('Test assets')}});
try{
 const db=await mf.getD1Database('DB');
 for(const name of (await readdir('drizzle')).filter(n=>n.endsWith('.sql')).sort()){
  const sql=(await readFile('drizzle/'+name,'utf8')).replaceAll('--> statement-breakpoint','');
  for(const statement of sql.split(';').map(s=>s.trim()).filter(Boolean))await db.prepare(statement).run();
 }
 const password='Test-password-for-owner-only',now=new Date().toISOString(),hash=await hashPassword(password);
 await db.prepare('INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt,username,displayUsername,enabled,mustChangePassword) VALUES(\'owner\',\'Smooth\',\'owner@production.invalid\',0,?,?,\'smooth\',\'smooth\',1,0)').bind(now,now).run();
 await db.prepare('INSERT INTO account(id,userId,accountId,providerId,password,createdAt,updatedAt) VALUES(\'owner-credential\',\'owner\',\'owner\',\'credential\',?,?,?)').bind(hash,now,now).run();
 function client(ip){let cookies=new Map();return async(path,method='GET',body,extra={})=>{
  const headers={Origin:origin,'cf-connecting-ip':ip,...extra};if(cookies.size)headers.Cookie=Array.from(cookies).map(([k,v])=>k+'='+v).join('; ');
  if(body&&!(body instanceof FormData))headers['Content-Type']='application/json';
  let payload=body?JSON.stringify(body):undefined;
  if(body instanceof FormData){
   // Serialize with the same Fetch implementation that created FormData;
   // Miniflare and Node use separate undici versions.
   const upload=new Request(origin+path,{method,body});
   headers['Content-Type']=upload.headers.get('Content-Type');
   payload=new Uint8Array(await upload.arrayBuffer());
  }
  const response=await mf.dispatchFetch(origin+path,{method,headers,body:payload});
  for(const value of response.headers.getSetCookie()){const part=value.split(';')[0],i=part.indexOf('=');cookies.set(part.slice(0,i),part.slice(i+1));}
  return response;
 };}
 async function expect(response,status){const text=await response.text();assert.equal(response.status,status,text);try{return JSON.parse(text);}catch{return text;}}
 const owner=client('198.51.100.1'),crew=client('198.51.100.2'),stranger=client('198.51.100.3');
 await expect(await stranger('/api/projects','GET',undefined,{'oai-authenticated-user-id':'owner','oai-authenticated-user-email':'owner@production.invalid'}),401);
 const login=await owner('/api/auth/sign-in/username','POST',{username:'smooth',password});assert.equal(login.status,200,await login.clone().text());assert.ok(login.headers.getSetCookie().some(c=>c.includes('HttpOnly')&&c.includes('Secure')));
 assert.equal((await expect(await owner('/api/session'),200)).user.admin,true);
 await expect(await owner('/api/auth/sign-up/email','POST',{name:'Intruder',email:'a@example.invalid',password}),404);
 await expect(await owner('/api/team','POST',{name:'Camera Crew',username:'camera',email:'camera@example.invalid',password:'temporary-team-password'}),201);
 const camera=(await expect(await owner('/api/team'),200)).accounts.find(a=>a.username==='camera');assert.ok(camera);
 await expect(await crew('/api/auth/sign-in/username','POST',{username:'camera',password:'temporary-team-password'}),200);
 assert.equal((await expect(await crew('/api/session'),200)).user.mustChangePassword,true);
 await expect(await crew('/api/projects'),403);
 await expect(await crew('/api/auth/change-password','POST',{currentPassword:'temporary-team-password',newPassword:'new-private-crew-password'}),200);
 assert.equal((await expect(await crew('/api/session'),200)).user.mustChangePassword,false);
 const draft=blankProject('Permission check');draft.shots=[blankShot()];let p=(await expect(await owner('/api/projects','POST',draft),201)).project;
 await expect(await crew('/api/projects/'+p.id),404);
 await expect(await owner('/api/projects/'+p.id+'/crew','POST',{name:'Camera Crew',email:'camera@example.invalid',role:'DP'}),200);
 await expect(await crew('/api/projects/'+p.id),200);
 p=(await expect(await crew('/api/projects/'+p.id,'PUT',{...p,title:'Crew edited production'}),200)).project;
 await expect(await crew('/api/projects/'+p.id,'PUT',{...p,revision:p.revision-1}),409);
 await expect(await crew('/api/team'),403);
 await expect(await crew('/api/projects','POST',blankProject('Blocked')),403);
 await expect(await crew('/api/projects/'+p.id,'DELETE'),403);
 const bytes=Uint8Array.from([137,80,78,71,13,10,26,10]);const imageForm=new FormData();imageForm.set('file',new File([bytes],'test.png',{type:'image/png'}));imageForm.set('projectId',p.id);
 const image=(await expect(await crew('/api/images','POST',imageForm),201)).image;
 const fetched=await crew('/api/images/'+image.id);assert.equal(fetched.status,200);assert.deepEqual(new Uint8Array(await fetched.arrayBuffer()),bytes);
 const fileForm=new FormData();fileForm.set('file',new File(['Production script'],'script.txt',{type:'text/plain'}));fileForm.set('category','Script');
 const file=(await expect(await crew('/api/projects/'+p.id+'/files','POST',fileForm),201)).file;
 assert.equal(await expect(await owner('/api/files/'+file.id),200),'Production script');
 await expect(await stranger('/api/files/'+file.id),401);
 const m=(await expect(await owner('/api/projects/'+p.id+'/crew'),200)).crew[0];await expect(await owner('/api/projects/'+p.id+'/crew','DELETE',{memberId:m.id}),200);
 await expect(await crew('/api/images/'+image.id),404);await expect(await crew('/api/files/'+file.id),404);
 await expect(await owner('/api/team','PUT',{id:camera.id,password:'reset-temporary-password'}),200);
 await expect(await crew('/api/session'),401);
 await expect(await crew('/api/auth/sign-in/username','POST',{username:'camera',password:'new-private-crew-password'}),401);
 await expect(await crew('/api/auth/sign-in/username','POST',{username:'camera',password:'reset-temporary-password'}),200);
 await expect(await owner('/api/team','PUT',{id:camera.id,enabled:false}),200);await expect(await crew('/api/session'),401);
 await expect(await owner('/api/team','PUT',{id:'owner',enabled:false}),400);
 await expect(await owner('/api/projects/'+p.id,'PUT',p,{Origin:'https://attacker.invalid'}),403);
 await expect(await owner('/api/auth/sign-out','POST',{}),200);await expect(await owner('/api/projects'),401);
 const probe=client('198.51.100.44');for(let i=0;i<5;i++)await probe('/api/auth/sign-in/username','POST',{username:'nobody',password:'invalid-password'});await expect(await probe('/api/auth/sign-in/username','POST',{username:'nobody',password:'invalid-password'}),429);
 console.log('Passed: standalone password sign-in, secure sessions, owner account management, forced password changes, disabled accounts, password reset revocation, sign-out, closed registration, rate limiting, CSRF protection, assigned-project access, shared file and image storage.');
}finally{await mf.dispose();}
