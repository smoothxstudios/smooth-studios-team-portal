import assert from 'node:assert/strict';
import {Miniflare} from 'miniflare';
import {readFile,readdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {hashPassword} from 'better-auth/crypto';
import {build} from 'esbuild';
import {testAssets} from './mock-assets.mjs';
const bundle=spawnSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','deploy','--dry-run','--outdir','.work/worker'],{encoding:'utf8',env:{...process.env,WRANGLER_SEND_METRICS:'false'}});
if(bundle.status!==0)throw new Error(bundle.stdout+bundle.stderr);
await build({entryPoints:['lib/shot-list.ts'],bundle:true,platform:'node',format:'esm',outfile:'.work/shot-list.mjs'});
const {blankProject,blankShot}=await import('../.work/shot-list.mjs');
await build({entryPoints:['lib/account-session.ts'],bundle:true,platform:'node',format:'esm',outfile:'.work/account-session.mjs'});
const {studioEntry,linkedAccount}=await import('../.work/account-session.mjs');
const origin='https://test.invalid';
let mf;
if(process.env.LOCAL_NODE_TEST==='1'){
 await build({stdin:{contents:"export {default} from './worker'; export {env as testEnv} from 'cloudflare:workers';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',packages:'external',outfile:'.work/test-worker.mjs',alias:{'cloudflare:workers':'./scripts/mock-cloudflare.mjs'}});
 const worker=(await import('../.work/test-worker.mjs')).default;
 // The alias's database is shared with the bundled Worker through this export.
 const exported=await import('../.work/test-worker.mjs');
 mf={getD1Database:async()=>exported.testEnv.DB,dispatchFetch:(url,init)=>worker.fetch(new Request(url,init)),dispose:async()=>{}};
}else mf=new Miniflare({modules:[{type:'ESModule',path:'.work/worker/worker.js'}],compatibilityDate:'2026-05-22',cf:false,host:'127.0.0.1',compatibilityFlags:['nodejs_compat'],d1Databases:['DB'],bindings:{APP_ORIGIN:origin,BETTER_AUTH_SECRET:'test-only-secret-with-more-than-32-characters'},serviceBindings:{ASSETS:testAssets}});
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
  let payload=body instanceof Uint8Array?body:body?JSON.stringify(body):undefined;
  if(body instanceof Uint8Array)headers['Content-Type']='application/octet-stream';
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
 const shell=await stranger('/');assert.equal(shell.status,200);assert.equal(shell.headers.get('cache-control'),'no-cache');
 for(const path of ['/assets/previous-export.js','/fonts/missing.ttf']){const missing=await stranger(path);assert.equal(missing.status,404);assert.equal(missing.headers.get('cache-control'),'no-store');assert.match(missing.headers.get('content-type'),/text\/plain/);}
 const currentAsset=await stranger('/assets/current.js');assert.equal(currentAsset.status,200);assert.match(currentAsset.headers.get('content-type'),/javascript/);assert.match(currentAsset.headers.get('cache-control'),/immutable/);
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
 assert.deepEqual((await expect(await crew('/api/projects'),200)).projects,[]);
 // A second signed-in teammate must have their own isolated project list.
 await expect(await owner('/api/team','POST',{name:'Sound Crew',username:'sound',email:'sound@example.invalid',password:'temporary-sound-password'}),201);
 const soundAccount=(await expect(await owner('/api/team'),200)).accounts.find(a=>a.username==='sound');
 const sound=client('198.51.100.4');
 await expect(await sound('/api/auth/sign-in/username','POST',{username:'sound',password:'temporary-sound-password'}),200);
 await expect(await sound('/api/auth/change-password','POST',{currentPassword:'temporary-sound-password',newPassword:'new-private-sound-password'}),200);
 const soundProject=(await expect(await owner('/api/projects','POST',{...blankProject('Private sound production'),teamAccountIds:[soundAccount.id]}),201)).project;
 assert.deepEqual((await expect(await sound('/api/projects'),200)).projects.map(p=>p.id),[soundProject.id]);
 assert.deepEqual((await expect(await crew('/api/projects'),200)).projects,[]);
 await expect(await crew('/api/projects/'+soundProject.id),404);
 // Optional modules and account tags must work independently of Crew & Tasks.
 const taggedDraft=blankProject('Tagged production');
 assert.deepEqual(taggedDraft.production.modules,[]);
 taggedDraft.production.tasks=[{id:crypto.randomUUID(),title:'Preserved task',assignee:'',department:'Pre-production',due:'',status:'To do',notes:'Keep this content'}];
 let tagged=(await expect(await owner('/api/projects','POST',{...taggedDraft,teamAccountIds:[camera.id]}),201)).project;
 assert.equal((await expect(await crew('/api/projects/'+tagged.id),200)).project.canEdit,true);
 assert.deepEqual((await expect(await owner('/api/projects'),200)).projects.find(p=>p.id===tagged.id).modules,[]);
 tagged=(await expect(await crew('/api/projects/'+tagged.id,'PUT',{...tagged,production:{...tagged.production,modules:['crew']}}),200)).project;
 tagged=(await expect(await crew('/api/projects/'+tagged.id,'PUT',{...tagged,production:{...tagged.production,modules:[]}}),200)).project;
 assert.equal(tagged.production.tasks[0].title,'Preserved task');
 await expect(await crew('/api/projects/'+tagged.id,'PUT',{...tagged,teamAccountIds:['owner']}),403);
 await expect(await crew('/api/projects/'+tagged.id+'/crew','POST',{accountId:'owner'}),403);
 const taggedMember=(await expect(await owner('/api/projects/'+tagged.id+'/crew'),200)).crew[0];
 await expect(await owner('/api/projects/'+tagged.id+'/crew','DELETE',{memberId:taggedMember.id}),200);
 await expect(await crew('/api/projects/'+tagged.id),404);
 await expect(await crew('/api/projects/'+tagged.id,'PUT',{...tagged,canEdit:true}),404);
 assert.equal((await expect(await crew('/api/projects'),200)).projects.some(p=>p.id===tagged.id),false);
 await expect(await owner('/api/projects/'+tagged.id+'/crew','POST',{accountId:camera.id}),200);
 assert.equal((await expect(await crew('/api/projects/'+tagged.id),200)).project.canEdit,true);
 const invalidTag=blankProject('Invalid tagged account');
 await expect(await owner('/api/projects','POST',{...invalidTag,teamAccountIds:['missing-account']}),400);
 await expect(await owner('/api/projects/'+invalidTag.id),404);
 await expect(await owner('/api/projects/'+tagged.id,'PUT',{...tagged,production:{...tagged.production,modules:['unknown']}}),400);
 const draft=blankProject('Permission check');draft.shots=[blankShot()];let p=(await expect(await owner('/api/projects','POST',draft),201)).project;
 // Untagged productions never appear in the list, totals, direct links, or export data.
 const deniedProject=await expect(await crew('/api/projects/'+p.id),404);
 assert.deepEqual(deniedProject,await expect(await crew('/api/projects/'+crypto.randomUUID()),404));
 const listResponse=await crew('/api/projects');assert.equal(listResponse.headers.get('cache-control'),'private, no-store');
 const visibleProjects=(await expect(listResponse,200)).projects;
 assert.deepEqual(visibleProjects.map(x=>x.id),[tagged.id]);
 assert.equal(visibleProjects[0].canEdit,true);
 assert.equal(JSON.stringify(visibleProjects).includes(p.title),false);
 assert.equal(JSON.stringify(visibleProjects).includes(soundProject.title),false);
 for(const account of [crew,sound]){
  await expect(await account('/api/projects/'+p.id+'/crew'),404);
  await expect(await account('/api/projects/'+p.id+'/files'),404);
  await expect(await account('/api/projects/'+p.id,'PUT',{...p,canEdit:true,title:'Unauthorized change'}),404);
 }
 assert.equal((await expect(await owner('/api/projects'),200)).projects.length,3);
 // A Studio account hint never grants access or reuses another person's session.
 assert.equal(studioEntry('?account=smooth'),null);
 assert.deepEqual(studioEntry('?from=studio&account=%20CAMERA%20'),{username:'camera'});
 assert.deepEqual(studioEntry('?from=studio&account=bad%2Fname'),{username:''});
 const sharedBrowser=client('198.51.100.45');
 assert.equal(await linkedAccount(null,studioEntry('?from=studio&account=smooth'),async()=>{throw new Error('No session to revoke');}),null);
 await expect(await sharedBrowser('/api/projects?from=studio&account=smooth'),401);
 await expect(await sharedBrowser('/api/auth/sign-in/username','POST',{username:'smooth',password}),200);
 const ownerSession=(await expect(await sharedBrowser('/api/session'),200)).user;
 let revoked=0;
 assert.equal(await linkedAccount(ownerSession,studioEntry('?from=studio&account=camera'),async()=>{await expect(await sharedBrowser('/api/auth/sign-out','POST',{}),200);revoked++;}),null);
 assert.equal(revoked,1);await expect(await sharedBrowser('/api/session'),401);await expect(await sharedBrowser('/api/projects/'+p.id),401);
 await expect(await sharedBrowser('/api/auth/sign-in/username','POST',{username:'camera',password:'new-private-crew-password'}),200);
 const cameraSession=(await expect(await sharedBrowser('/api/session'),200)).user;
 assert.equal((await linkedAccount(cameraSession,studioEntry('?from=studio&account=camera'),async()=>{throw new Error('A matching session should stay signed in');})).id,camera.id);
 assert.equal((await expect(await sharedBrowser('/api/session'),200)).user.admin,false);
 // A stale tab cannot fetch or save as a different account after cookies change.
 await expect(await sharedBrowser('/api/projects','GET',undefined,{'X-Production-Account':'owner'}),401);
 await expect(await owner('/api/projects','GET',undefined,{'X-Production-Account':camera.id}),401);
 await expect(await owner('/api/projects/'+p.id,'PUT',{...p,title:'Wrong account write'},{'X-Production-Account':camera.id}),401);
 assert.equal((await expect(await owner('/api/projects/'+p.id),200)).project.title,p.title);
 assert.deepEqual((await expect(await sharedBrowser('/api/projects','GET',undefined,{'X-Production-Account':camera.id}),200)).projects.map(x=>x.id),[tagged.id]);
 assert.deepEqual((await expect(await sharedBrowser('/api/projects?account=smooth'),200)).projects.map(x=>x.id),[tagged.id]);
 await expect(await sharedBrowser('/api/projects/'+p.id),404);await expect(await sharedBrowser('/api/projects/'+soundProject.id),404);
 await assert.rejects(linkedAccount(ownerSession,studioEntry('?from=studio&account=camera'),async()=>{throw new Error('Sign-out unavailable');}),/Sign-out unavailable/);
 assert.equal(await linkedAccount(cameraSession,studioEntry('?from=studio'),async()=>{await expect(await sharedBrowser('/api/auth/sign-out','POST',{}),200);}),null);
 await expect(await sharedBrowser('/api/projects'),401);
 assert.equal((await expect(await owner('/api/projects/'+p.id),200)).project.title,p.title);
 await expect(await stranger('/api/projects/'+p.id),401);
 await expect(await owner('/api/projects/'+p.id+'/crew','POST',{name:'Camera Crew',email:'camera@example.invalid',role:'DP'}),200);
 assert.equal((await expect(await crew('/api/projects/'+p.id),200)).project.canEdit,true);
 p=(await expect(await crew('/api/projects/'+p.id,'PUT',{...p,title:'Crew edited production'}),200)).project;
 await expect(await crew('/api/projects/'+p.id,'PUT',{...p,revision:p.revision-1}),409);
 await expect(await crew('/api/team'),403);
 await expect(await crew('/api/projects','POST',blankProject('Blocked')),403);
 await expect(await crew('/api/projects/'+p.id,'DELETE'),403);
 const bytes=Uint8Array.from([137,80,78,71,13,10,26,10]);const imageForm=new FormData();imageForm.set('file',new File([bytes],'test.png',{type:'image/png'}));imageForm.set('projectId',p.id);
 const image=(await expect(await crew('/api/images','POST',imageForm),201)).image;
 const fetched=await crew('/api/images/'+image.id);assert.equal(fetched.status,200);assert.equal(fetched.headers.get('cache-control'),'private, no-store');assert.deepEqual(new Uint8Array(await fetched.arrayBuffer()),bytes);
 await expect(await sound('/api/images/'+image.id),404);
 await expect(await sound('/api/projects/'+p.id),404);
 // Exercise a real multi-part picture, including retries and paged download.
 const large=new Uint8Array(2*1024*1024+23);large.fill(71);large.set(bytes);
 const uploadInput={name:'Large picture.png',mime:'image/png',size:large.length,projectId:p.id};
 await expect(await stranger('/api/image-uploads','POST',uploadInput),401);
 const upload=(await expect(await crew('/api/image-uploads','POST',uploadInput),201));
 const uploadUrl='/api/image-uploads/'+upload.uploadId;
 await expect(await owner(uploadUrl+'?part=0','PUT',large.slice(0,upload.chunkSize)),404);
 await expect(await crew(uploadUrl,'POST'),409);
 await expect(await crew(uploadUrl+'?part=999','PUT',bytes),400);
 await expect(await crew(uploadUrl+'?part=0','PUT',large.slice(0,upload.chunkSize+1)),413);
 await expect(await crew(uploadUrl+'?part=0','PUT',new Uint8Array(upload.chunkSize)),400);
 for(let offset=0,i=0;offset<large.length;offset+=upload.chunkSize,i++)await expect(await crew(uploadUrl+'?part='+i,'PUT',large.slice(offset,offset+upload.chunkSize)),200);
 await expect(await crew(uploadUrl+'?part=0','PUT',large.slice(0,upload.chunkSize)),200);
 const largeImage=(await expect(await crew(uploadUrl,'POST'),201)).image;
 assert.equal((await expect(await crew(uploadUrl,'POST'),201)).image.id,largeImage.id);
 await expect(await crew(uploadUrl+'?part=0','PUT',large.slice(0,upload.chunkSize)),409);
 await expect(await crew(uploadUrl,'DELETE'),200);
 assert.deepEqual(new Uint8Array(await (await owner('/api/images/'+largeImage.id)).arrayBuffer()),large);
 await db.prepare('UPDATE image_uploads SET created_at=0 WHERE id=?').bind(upload.uploadId).run();
 const abandoned=await expect(await crew('/api/image-uploads','POST',uploadInput),201);
 assert.deepEqual(new Uint8Array(await (await owner('/api/images/'+largeImage.id)).arrayBuffer()),large);
 await expect(await crew('/api/image-uploads/'+abandoned.uploadId+'?part=0','PUT',large.slice(0,abandoned.chunkSize)),200);
 await expect(await crew('/api/image-uploads/'+abandoned.uploadId,'DELETE'),200);
 await expect(await crew('/api/image-uploads/'+abandoned.uploadId,'POST'),404);
 assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM file_chunks WHERE object_key=?').bind('references/'+abandoned.uploadId).first()).n,0);
 const legacyForm=new FormData();legacyForm.set('file',new File([large],'large-file.png',{type:'image/png'}));legacyForm.set('category','Reference');
 const legacyFile=(await expect(await crew('/api/projects/'+p.id+'/files','POST',legacyForm),201)).file;
 assert.deepEqual(new Uint8Array(await (await crew('/api/files/'+legacyFile.id)).arrayBuffer()),large);
 await expect(await crew('/api/files/'+legacyFile.id,'DELETE'),200);
 const customDraft=blankProject('Custom category check', [{key:'custom_lens',label:'Lens choice',type:'select',group:'Framing & camera',visible:true,custom:true,options:['24mm','50mm']}]);
 const customProject=(await expect(await owner('/api/projects','POST',customDraft),201)).project;
 assert.deepEqual(customProject.fields,customDraft.fields);
 await expect(await owner('/api/projects/'+customProject.id,'DELETE'),200);
 const fileForm=new FormData();fileForm.set('file',new File(['Production script'],'script.txt',{type:'text/plain'}));fileForm.set('category','Script');
 const file=(await expect(await crew('/api/projects/'+p.id+'/files','POST',fileForm),201)).file;
 assert.equal(await expect(await owner('/api/files/'+file.id),200),'Production script');
 await expect(await sound('/api/files/'+file.id),404);
 await expect(await sound('/api/projects/'+p.id+'/files'),404);
 await expect(await sound('/api/projects/'+p.id+'/files','POST',fileForm),404);
 await expect(await sound('/api/images','POST',imageForm),404);
 await expect(await sound('/api/image-uploads','POST',uploadInput),404);
 await expect(await stranger('/api/files/'+file.id),401);
 // A reference deliberately copied into another tagged project remains available there.
 const copiedShot=blankShot();copiedShot.references=[largeImage];
 tagged=(await expect(await owner('/api/projects/'+tagged.id,'PUT',{...tagged,shots:[copiedShot]}),200)).project;
 await expect(await sound('/api/images/'+largeImage.id),404);
 const permissionUpload=await expect(await crew('/api/image-uploads','POST',{...uploadInput,size:bytes.length}),201);
 const m=(await expect(await owner('/api/projects/'+p.id+'/crew'),200)).crew[0];await expect(await owner('/api/projects/'+p.id+'/crew','DELETE',{memberId:m.id}),200);
 // Revocation applies immediately to the existing session, including the uploader's own files.
 await expect(await crew('/api/projects/'+p.id),404);
 await expect(await crew('/api/images/'+image.id),404);
 await expect(await crew('/api/files/'+file.id),404);
 await expect(await crew('/api/projects/'+p.id+'/files'),404);
 await expect(await crew('/api/projects/'+p.id+'/crew'),404);
 assert.deepEqual((await expect(await crew('/api/projects'),200)).projects.map(x=>x.id),[tagged.id]);
 assert.deepEqual(new Uint8Array(await (await crew('/api/images/'+largeImage.id)).arrayBuffer()),large);
 const copyMember=(await expect(await owner('/api/projects/'+tagged.id+'/crew'),200)).crew[0];
 await expect(await owner('/api/projects/'+tagged.id+'/crew','DELETE',{memberId:copyMember.id}),200);
 await expect(await crew('/api/images/'+largeImage.id),404);
 assert.deepEqual((await expect(await crew('/api/projects'),200)).projects,[]);
 await expect(await owner('/api/images/'+image.id),200);
 await expect(await crew('/api/projects/'+p.id,'PUT',{...p,canEdit:true}),404);
 await expect(await crew('/api/images','POST',imageForm),404);
 await expect(await crew('/api/image-uploads','POST',uploadInput),404);
 await expect(await crew('/api/image-uploads/'+permissionUpload.uploadId,'POST'),404);
 await expect(await crew('/api/image-uploads/'+permissionUpload.uploadId+'?part=0','PUT',bytes),404);
 await expect(await crew('/api/image-uploads/'+permissionUpload.uploadId,'DELETE'),200);
 await expect(await crew('/api/projects/'+p.id+'/files','POST',fileForm),404);
 await expect(await crew('/api/files/'+file.id,'DELETE'),404);
 assert.equal(await expect(await owner('/api/files/'+file.id),200),'Production script');
 await expect(await stranger('/api/images/'+image.id),401);
 const privateForm=new FormData();privateForm.set('file',new File([bytes],'private-draft.png',{type:'image/png'}));
 const privateImage=(await expect(await owner('/api/images','POST',privateForm),201)).image;
 await expect(await crew('/api/images/'+privateImage.id),404);
 await expect(await owner('/api/projects/'+p.id+'/crew','POST',{accountId:camera.id}),200);
 assert.equal((await expect(await crew('/api/projects/'+p.id),200)).project.canEdit,true);
 await expect(await crew('/api/images/'+image.id),200);
 await expect(await crew('/api/projects/'+p.id+'/crew'),200);
 assert.equal(await expect(await crew('/api/files/'+file.id),200),'Production script');
 // Knowing another image id cannot attach it to a project to gain access.
 const linkedShot={...p.shots[0],references:[privateImage]};
 await expect(await crew('/api/projects/'+p.id,'PUT',{...p,shots:[linkedShot]}),400);
 await expect(await crew('/api/images/'+privateImage.id),404);
 // An owner can deliberately share a draft reference into a tagged project.
 p=(await expect(await owner('/api/projects/'+p.id,'PUT',{...p,shots:[linkedShot]}),200)).project;
 await expect(await crew('/api/images/'+privateImage.id),200);
 await expect(await sound('/api/images/'+privateImage.id),404);
 await expect(await crew('/api/files/'+file.id,'DELETE'),200);
 await expect(await owner('/api/files/'+file.id),404);
 await expect(await owner('/api/team','PUT',{id:camera.id,password:'reset-temporary-password'}),200);
 await expect(await crew('/api/session'),401);
 await expect(await crew('/api/auth/sign-in/username','POST',{username:'camera',password:'new-private-crew-password'}),401);
 await expect(await crew('/api/auth/sign-in/username','POST',{username:'camera',password:'reset-temporary-password'}),200);
 await expect(await owner('/api/team','PUT',{id:camera.id,enabled:false}),200);await expect(await crew('/api/session'),401);
 await expect(await crew('/api/projects'),401);
 await expect(await crew('/api/projects/'+p.id),401);
 await expect(await crew('/api/images/'+image.id),401);
 await expect(await owner('/api/team','PUT',{id:'owner',enabled:false}),400);
 await expect(await owner('/api/projects/'+p.id,'PUT',p,{Origin:'https://attacker.invalid'}),403);
 await expect(await owner('/api/auth/sign-out','POST',{}),200);await expect(await owner('/api/projects'),401);
 const probe=client('198.51.100.44');for(let i=0;i<5;i++)await probe('/api/auth/sign-in/username','POST',{username:'nobody',password:'invalid-password'});await expect(await probe('/api/auth/sign-in/username','POST',{username:'nobody',password:'invalid-password'}),429);
 console.log('Passed: Studio account handoff, mismatched-session revocation, pinned account reads and writes, standalone password sign-in, secure sessions, owner account management, forced password changes, disabled accounts, password reset revocation, sign-out, closed registration, rate limiting, CSRF protection, tag-restricted project lists and direct access, isolated teammate projects, immediate revocation and re-tagging, protected files and images, copied-reference access, private drafts, multi-part picture uploads and retries, byte-exact downloads, custom project categories, shared file and image storage.');
}finally{await mf.dispose();}
