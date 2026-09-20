import assert from 'node:assert/strict';

export async function testTagging({db,owner,crew,sound,stranger,client,expect,blankProject,hash,password}){
 // Initial accounts were imported from Studio settings, before the crew form's
 // stricter contact-email validation existed. Their stored identity must survive.
 const id='legacy-tag-member',name='Legacy Crew',email='Legacy Crew <legacy.crew@example.invalid>',username='legacy_tag_member',now=new Date().toISOString();
 await db.prepare('INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt,username,displayUsername,enabled,mustChangePassword) VALUES(?,?,?,0,?,?,?,?,1,0)').bind(id,name,email,now,now,username,username).run();
 await db.prepare("INSERT INTO account(id,userId,accountId,providerId,password,createdAt,updatedAt) VALUES(?,?,?,'credential',?,?,?)").bind(id+'-credential',id,id,hash,now,now).run();
 const member=client('198.51.100.150');
 await expect(await member('/api/auth/sign-in/username','POST',{username,password}),200);
 assert.equal((await expect(await member('/api/session'),200)).user.email,email);
 const p=(await expect(await crew('/api/projects','POST',blankProject('Existing account tagging')),201)).project,url='/api/projects/'+p.id,team=url+'/crew';
 await expect(await member(url),404);
 await expect(await sound(team,'POST',{accountId:id}),404);
 await expect(await stranger(team,'POST',{accountId:id}),401);
 const tagged=(await expect(await owner(team,'POST',{accountId:id,name:'Spoofed name',email:'owner@production.invalid',role:'Owner'}),200)).member;
 assert.equal(tagged.name,name);assert.equal(tagged.email,email);assert.equal(tagged.role,'Team member');
 assert.equal((await expect(await member(url),200)).project.canEdit,true);
 assert.equal((await expect(await member(url),200)).project.canManage,false);
 await expect(await member(team,'POST',{accountId:'owner'}),403);
 assert.equal((await expect(await member('/api/projects'),200)).projects.some(x=>x.id===p.id),true);
 // A retry must neither add a duplicate nor reset an existing person's crew details.
 await db.prepare('UPDATE project_members SET role=?,phone=?,call_time=? WHERE id=?').bind('Camera operator','555-0100','09:00',tagged.id).run();
 for(const response of await Promise.all([owner(team,'POST',{accountId:id}),crew(team,'POST',{accountId:id})])){
  const retry=(await expect(response,200)).member;assert.equal(retry.id,tagged.id);assert.equal(retry.role,'Camera operator');assert.equal(retry.phone,'555-0100');assert.equal(retry.callTime,'09:00');
 }
 assert.equal((await expect(await crew(team),200)).crew.length,1);
 assert.deepEqual((await expect(await crew(url),200)).project,p,'Tagging does not modify the project draft or revision.');
 await expect(await crew(team,'DELETE',{memberId:tagged.id}),200);await expect(await member(url),404);
 const responses=await Promise.all([owner(team,'POST',{accountId:id}),crew(team,'POST',{accountId:id})]);
 const added=await Promise.all(responses.map(response=>expect(response,200)));
 assert.equal(added[0].member.id,added[1].member.id);assert.equal((await expect(await crew(team),200)).crew.length,1);
 await expect(await owner('/api/team','PUT',{id,enabled:false}),200);
 const inactive=await expect(await crew(team,'POST',{accountId:id}),400);assert.match(inactive.error,/active team account/);
 await expect(await member(url),401);
 for(const accountId of ['',null,123,{},'missing-account','x'.repeat(81)]){
  const rejected=await expect(await owner(team,'POST',{accountId}),400);assert.match(rejected.error,/active team account/);
 }
 await expect(await owner(team,'POST',{name:'Unregistered person',email:'not-an-email',role:'Camera'}),400);
 await expect(await owner(team,'POST',{name:'Unregistered person',email:'unregistered@example.invalid',role:'Camera'}),400);
 await expect(await crew(url,'DELETE'),200);
 await db.prepare('DELETE FROM user WHERE id=?').bind(id).run();
 console.log('Tagging checks passed: existing account identities, owner and creator tagging, exact selected account, idempotent retries, concurrent tags, preserved crew metadata, private access, removal, disabled accounts, and invalid selections.');
}
