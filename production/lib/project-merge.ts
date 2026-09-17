import type {Project,Shot} from './shot-list';
import {placeShotAtNumber,placeShotAtOrder} from './shot-order';

export type MergeConflict={key:string;path:string[];label:string;mine?:unknown;current?:unknown};
export type MergeChoices=Record<string,'mine'|'current'>;
export type ProjectChange={base:Project;project:Project;shotId?:string;reviewRevision?:number;choices?:MergeChoices};
const properties=['id','title','client','date','brief','shots','fields','columns','production'] as const;
const record=(v:any):v is Record<string,any>=>v!==null&&typeof v==='object'&&!Array.isArray(v);
export function equalValue(a:any,b:any):boolean{
 if(a===b)return true;
 if(Array.isArray(a)&&Array.isArray(b))return a.length===b.length&&a.every((v,i)=>equalValue(v,b[i]));
 if(record(a)&&record(b)){const keys=Object.keys(a);return keys.length===Object.keys(b).length&&keys.every(k=>Object.hasOwn(b,k)&&equalValue(a[k],b[k]));}
 return false;
}
export function projectContent(p:Project){return Object.fromEntries(properties.filter(k=>p[k]!==undefined).map(k=>[k,p[k]]));}
function conflictLabel(path:string[],projects:Project[]){
 const names:Record<string,string>={title:'Title',client:'Client',date:'Shoot Date',brief:'Project Notes',description:'Description / Action',scene:'Scene #',number:'Shot #',order:'Shooting Order',status:'Status',priority:'Priority',setup:'Setup',duration:'Duration',references:'Images',fields:'Categories',columns:'Visible Columns',callSheet:'Call Sheet',budgetCents:'Budget',production:'Production',tasks:'Tasks',documents:'Documents',schedule:'Schedule',expenses:'Expenses',content:'Text',notes:'Notes',modules:'Project Sections',updatedAt:'Document Update',values:'Details','$order':'Order'};
 const parts:string[]=[];
 for(let i=0;i<path.length;i++){
  if(path[i]==='shots'&&path[i+1]&&path[i+1]!=='$order'){
   const shot=projects.flatMap(p=>p.shots).find(s=>s.id===path[i+1]);parts.push(shot?'Scene '+shot.scene+' / Shot '+shot.number:'Shot');i++;continue;
  }
  if(path[i]==='values'&&path[i+1]){const field=projects.flatMap(p=>p.fields).find(f=>f.key===path[i+1]);parts.push(field?.label||path[i+1]);i++;continue;}
  if(['tasks','documents','schedule','expenses'].includes(path[i])&&path[i+1]&&path[i+1]!=='$order'){
   const item=projects.flatMap(p=>(p.production as any)?.[path[i]]||[]).find((x:any)=>x.id===path[i+1]);parts.push(item?.title||names[path[i]]);i++;continue;
  }
  if(path[i]==='fields'&&path[i+1]&&path[i+1]!=='$order'){parts.push(projects.flatMap(p=>p.fields).find(f=>f.key===path[i+1])?.label||'Category');i++;continue;}
  if(path[i]==='references'&&path[i+1]&&path[i+1]!=='$order'){parts.push(projects.flatMap(p=>p.shots.flatMap(s=>s.references)).find(r=>r.id===path[i+1])?.name||'Image');i++;continue;}
  parts.push(names[path[i]]||path[i].replace(/([A-Z])/g,' $1'));
 }
 return parts.join(' · ');
}

/** Three-way merge by field and stable item ID. Overlapping edits require a reviewed choice. */
export function mergeProject(change:ProjectChange,current:Project){
 const {base,project:draft,shotId}=change,conflicts:MergeConflict[]=[];
 const choices=current.revision===change.reviewRevision?change.choices||{}:{};
 const conflict=(path:string[],mine:any,theirs:any)=>{
  const key=JSON.stringify(path),choice=choices[key];
  if(choice)return choice==='mine'?mine:theirs;
  conflicts.push({key,path,label:conflictLabel(path,[draft,current,base]),mine,current:theirs});return theirs;
 };
 const merge=(before:any,mine:any,theirs:any,path:string[]):any=>{
  if(equalValue(before,mine))return theirs;
  if(equalValue(before,theirs)||equalValue(mine,theirs))return mine;
  if(path[0]==='production'&&path[1]==='documents'&&path[3]==='updatedAt')return Math.max(mine,theirs);
  if(record(before)&&record(mine)&&record(theirs))return Object.fromEntries([...new Set([...Object.keys(before),...Object.keys(mine),...Object.keys(theirs)])].map(k=>[k,merge(before[k],mine[k],theirs[k],[...path,k])]).filter(([,v])=>v!==undefined));
  if(Array.isArray(before)&&Array.isArray(mine)&&Array.isArray(theirs)){
   const key=path.length===1&&path[0]==='fields'?'key':'id';
   if([before,mine,theirs].every(list=>list.every(v=>record(v)&&typeof v[key]==='string')&&new Set(list.map(v=>v[key])).size===list.length)){
    const b=new Map(before.map(v=>[v[key],v])),m=new Map(mine.map(v=>[v[key],v])),t=new Map(theirs.map(v=>[v[key],v]));
    const items=new Map([...new Set([...b.keys(),...m.keys(),...t.keys()])].map(id=>[id,merge(b.get(id),m.get(id),t.get(id),[...path,id])]));
    const common=before.map(v=>v[key]).filter(id=>m.has(id)&&t.has(id)),set=new Set(common);
    const mineOrder=mine.map(v=>v[key]).filter(id=>set.has(id)),theirOrder=theirs.map(v=>v[key]).filter(id=>set.has(id));
    const mineMoved=!equalValue(common,mineOrder),theirMoved=!equalValue(common,theirOrder);
    let preferred=mineMoved?mine:theirs;
    if(mineMoved&&theirMoved&&!equalValue(mineOrder,theirOrder))preferred=conflict([...path,'$order'],mine,theirs);
    const order=preferred.map((v:any)=>v[key]);
    // Keep independent additions, including a newly selected cover image.
    for(const list of [theirs,mine])for(let i=0;i<list.length;i++){
     const id=list[i][key];if(order.includes(id))continue;
     const next=list.slice(i+1).map(v=>v[key]).find(id=>order.includes(id));
     const prior=list.slice(0,i).reverse().map(v=>v[key]).find(id=>order.includes(id));
     order.splice(next!==undefined?order.indexOf(next):prior!==undefined?order.indexOf(prior)+1:order.length,0,id);
    }
    return order.map((id:string)=>items.get(id)).filter(v=>v!==undefined);
   }
  }
  return conflict(path,mine,theirs);
 };
 let mergeDraft=draft;
 const incoming=shotId?draft.shots.find(s=>s.id===shotId):undefined,oldShot=shotId?base.shots.find(s=>s.id===shotId):undefined,currentShot=shotId?current.shots.find(s=>s.id===shotId):undefined;
 if(incoming&&oldShot){
  // Number/order shifts are operations on the latest sequence, not stale edits to every shifted row.
  mergeDraft={...draft,shots:draft.shots.map(s=>s.id===shotId?{...s,scene:oldShot.scene,number:oldShot.number,order:oldShot.order}:s)};
 }
 let merged={...current,...merge(projectContent(base),projectContent(mergeDraft),projectContent(current),[])} as Project;
 if(incoming){
  let shot=merged.shots.find(s=>s.id===shotId);
  if(oldShot&&!currentShot&&!equalValue(oldShot,incoming)&&!conflicts.some(c=>c.path[0]==='shots'&&c.path[1]===shotId)){
   shot=conflict(['shots',shotId!],incoming,undefined);if(shot)merged.shots=[...merged.shots,shot];
  }
  if(shot){
   const numbered=!oldShot||!currentShot||incoming.scene.trim()!==oldShot.scene.trim()||incoming.number.trim()!==oldShot.number.trim();
   const ordered=incoming.order!==(oldShot?.order??Math.max(0,...base.shots.map(s=>s.order))+1);
   const shots=currentShot?merged.shots.map(s=>s.id===shotId?{...shot!,scene:currentShot.scene,number:currentShot.number,order:currentShot.order}:s):merged.shots.filter(s=>s.id!==shotId);
   // The latest position stays put unless this editor explicitly changed it.
   if(numbered){merged.shots=placeShotAtNumber(shots,{...shot,scene:incoming.scene.trim(),number:incoming.number.trim(),order:currentShot?.order??Math.max(0,...shots.map(s=>s.order))+1});}
   else merged.shots=shots;
   if(ordered)merged.shots=placeShotAtOrder(merged.shots,{...merged.shots.find(s=>s.id===shotId)!,order:incoming.order});
  }
 }
 return {project:merged,conflicts};
}
