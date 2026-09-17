import assert from 'node:assert/strict';

export async function testCollaboration({owner,crew,sound,stranger,camera,soundAccount,expect,blankProject,blankShot}){
 const draft=blankProject('Concurrent editing checks');
 draft.shots=Array.from({length:6},(_,i)=>({...blankShot(),number:String(i+1),order:i+1,description:'Action '+(i+1)}));
 let p=(await expect(await owner('/api/projects','POST',{...draft,teamAccountIds:[camera.id,soundAccount.id]}),201)).project;
 const url='/api/projects/'+p.id,ids=p.shots.map(s=>s.id);
 const read=async(who=crew)=>(await expect(await who(url),200)).project;
 const edit=(base,index,values)=>({...structuredClone(base),shots:base.shots.map((s,i)=>i===index?{...s,...values}:s)});
 const patch=(who,base,project,extra={})=>who(url,'PATCH',{base,project,...extra});
 const verify=p=>{assert.equal(new Set(p.shots.map(s=>s.id)).size,p.shots.length);assert.deepEqual(p.shots.map(s=>s.order).sort((a,b)=>a-b),p.shots.map((_,i)=>i+1));assert.deepEqual(p.shots.map(s=>Number(s.number)).sort((a,b)=>a-b),p.shots.map((_,i)=>i+1));};
 const initial=p;
 const responses=await Promise.all([
  patch(crew,p,edit(p,0,{description:'Camera saved action'}),{shotId:ids[0]}),
  patch(sound,p,edit(p,1,{description:'Sound saved action'}),{shotId:ids[1]})
 ]);
 for(const response of responses)await expect(response,200);
 p=await read();assert.equal(p.revision,initial.revision+2);assert.equal(p.shots[0].description,'Camera saved action');assert.equal(p.shots[1].description,'Sound saved action');assert.equal(p.canManage,false);
 // The same shot can be edited independently by field from the same starting revision.
 for(const response of await Promise.all([
  patch(crew,p,edit(p,0,{description:'Updated action'}),{shotId:ids[0]}),
  patch(sound,p,edit(p,0,{values:{...p.shots[0].values,takes:'Sound take note'}}),{shotId:ids[0]})
 ]))await expect(response,200);
 p=await read();assert.equal(p.shots[0].description,'Updated action');assert.equal(p.shots[0].values.takes,'Sound take note');
 const base=p,mine=edit(base,0,{description:'My overlap',duration:7});
 await expect(await patch(sound,base,edit(base,0,{description:'Team overlap'}),{shotId:ids[0]}),200);
 let conflict=await expect(await patch(crew,base,mine,{shotId:ids[0]}),409);
 assert.equal(conflict.conflicts.length,1);assert.equal(conflict.conflicts[0].mine,'My overlap');assert.equal(conflict.conflicts[0].current,'Team overlap');assert.match(conflict.conflicts[0].label,/Description/);
 assert.equal((await read()).shots[0].duration,base.shots[0].duration,'An unresolved review does not partially save.');
 const oldReview=conflict.project.revision,key=conflict.conflicts[0].key;
 p=await read(sound);await expect(await patch(sound,p,edit(p,0,{description:'Newest team overlap'}),{shotId:ids[0]}),200);
 conflict=await expect(await patch(crew,base,mine,{shotId:ids[0],reviewRevision:oldReview,choices:{[key]:'mine'}}),409);
 assert.equal(conflict.conflicts[0].current,'Newest team overlap');
 p=(await expect(await patch(crew,base,mine,{shotId:ids[0],reviewRevision:conflict.project.revision,choices:{[key]:'current'}}),200)).project;
 assert.equal(p.shots[0].description,'Newest team overlap');assert.equal(p.shots[0].duration,7);assert.equal(p.shots[0].values.takes,'Sound take note');
 const unchanged=await crew(url+'?since='+p.revision);assert.equal(unchanged.headers.get('cache-control'),'private, no-store');assert.deepEqual(await expect(unchanged,200),{unchanged:true,revision:p.revision});
 assert.equal((await expect(await patch(crew,p,p),200)).project.revision,p.revision,'No-op saves do not create revision churn.');
 // Reordering uses the latest sequence even when another editor saves an older draft.
 let start=p;
 for(const response of await Promise.all([
  patch(crew,start,edit(start,0,{order:4}),{shotId:ids[0]}),
  patch(sound,start,edit(start,0,{description:'Kept while moving'}),{shotId:ids[0]})
 ]))await expect(response,200);
 p=await read();verify(p);assert.equal(p.shots.find(s=>s.id===ids[0]).order,4);assert.equal(p.shots.find(s=>s.id===ids[0]).description,'Kept while moving');assert.equal(p.shots.find(s=>s.id===ids[0]).number,'1');
 start=p;const newShots=['Camera insert','Sound insert'].map(description=>({...blankShot(start.shots),number:'2',description}));
 for(const response of await Promise.all(newShots.map((shot,i)=>patch(i?sound:crew,start,{...start,shots:[...start.shots,shot]},{shotId:shot.id}))))await expect(response,200);
 p=await read();verify(p);assert.equal(p.shots.length,8);for(const s of newShots)assert.equal(p.shots.find(x=>x.id===s.id).description,s.description);
 start=p;const first=p.shots.findIndex(s=>s.id===ids[0]);
 p=(await expect(await patch(crew,start,edit(start,first,{number:'6',order:2}),{shotId:ids[0]}),200)).project;
 verify(p);assert.equal(p.shots.find(s=>s.id===ids[0]).number,'6');assert.equal(p.shots.find(s=>s.id===ids[0]).order,2);
 for(const order of [0,1.5,100001])await expect(await patch(crew,p,edit(p,0,{order}),{shotId:p.shots[0].id}),400);
 await expect(await patch(crew,{...p,revision:p.revision+10},{...p,revision:p.revision+10}),400);
 await expect(await patch(crew,p,{...p,teamAccountIds:['owner']}),403);
 await expect(await patch(crew,p,{...p,id:crypto.randomUUID()}),400);
 await expect(await patch(crew,p,edit(p,0,{references:[{id:crypto.randomUUID(),name:'Foreign image',caption:''}]}),{shotId:p.shots[0].id}),400);
 await expect(await patch(stranger,p,p),401);
 const member=(await expect(await owner(url+'/crew'),200)).crew.find(m=>m.email===soundAccount.email);
 assert.ok(member);await expect(await owner(url+'/crew','DELETE',{memberId:member.id}),200);
 await expect(await sound(url+'?since='+p.revision),404);
 await expect(await patch(sound,p,edit(p,0,{description:'Revoked draft'})),404);
 await expect(await owner(url,'DELETE'),200);
 console.log('Concurrent Worker API checks passed: two account saves, same-shot field merging, version review without partial writes, stale review protection, lightweight private updates, concurrent reorders and insertions, unique sequences, and revoked access.');
}
