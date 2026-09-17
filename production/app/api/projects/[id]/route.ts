import {api,db,identity,json,projectBody,checkImages,readProject,requireProject,RequestError,readJSON,validateProject,PROJECT_ACCESS_SQL} from "@/lib/server";
import {mergeProject,equalValue,projectContent,type ProjectChange} from '@/lib/project-merge';
import {z} from 'zod';
type Context={params:Promise<{id:string}>};
export async function GET(request:Request,context:Context){return api(async()=>{
 const u=await identity(request),{id}=await context.params,since=new URL(request.url).searchParams.get('since');
 if(since!==null){
  const row=await db().prepare('SELECT p.revision FROM projects p WHERE p.id=? AND '+PROJECT_ACCESS_SQL).bind(id,u.id,u.admin?1:0,u.email).first<{revision:number}>();
  if(!row)throw new RequestError('Project not found.',404);
  if(String(row.revision)===since)return json({unchanged:true,revision:row.revision});
 }
 return json({project:readProject(await requireProject(id,u))});
});}
const changeSchema=z.object({base:z.unknown(),project:z.unknown(),shotId:z.string().uuid().optional(),reviewRevision:z.number().int().positive().optional(),choices:z.record(z.enum(['mine','current'])).optional()}).strict();
export async function PATCH(request:Request,context:Context){return api(async()=>{
 const u=await identity(request),{id}=await context.params;
 await requireProject(id,u,'edit');
 const raw=changeSchema.parse(await readJSON(request,2200000)),base=validateProject(raw.base),draft=validateProject(raw.project);
 if(base.id!==id||draft.id!==id||base.revision!==draft.revision||base.revision<1)throw new RequestError('Project update does not match the open draft.');
 if(base.teamAccountIds!==undefined||draft.teamAccountIds!==undefined)throw new RequestError('Use project team tagging to change assignments.',403);
 if(raw.shotId&&!draft.shots.some(s=>s.id===raw.shotId))throw new RequestError('The edited shot is missing.');
 const change:ProjectChange={...raw,base,project:draft};
 for(let attempt=0;attempt<4;attempt++){
  const old=await requireProject(id,u,'edit'),current=readProject(old);
  if(base.revision>current.revision)throw new RequestError('The draft version is invalid.');
  let result;try{result=mergeProject(change,current);}catch(e){throw new RequestError(e instanceof Error?e.message:'Check the shot number and shooting order.');}
  if(result.conflicts.length)return json({error:'A teammate changed the same details. Review both versions to finish saving. Your draft is preserved.',project:current,conflicts:result.conflicts},409);
  const p=validateProject(result.project);await checkImages(p,u,current);
  if(JSON.stringify(p).length>1000000)throw new RequestError('This project is too large. Split it into separate shoot days.',413);
  if(equalValue(projectContent(p),projectContent(current)))return json({project:current});
  const now=Date.now(),saved=await db().prepare('UPDATE projects SET title=?,data=?,revision=revision+1,updated_at=? WHERE id=? AND revision=? AND (owner=? OR ?=1 OR EXISTS (SELECT 1 FROM project_members m WHERE m.project_id=projects.id AND m.email=?))').bind(p.title,JSON.stringify(p),now,id,current.revision,u.id,u.admin?1:0,u.email).run();
  if(saved.meta.changes)return json({project:{...p,revision:current.revision+1,updatedAt:now,canEdit:true,canManage:!!old.can_manage,isOwner:!!old.is_owner}});
 }
 await requireProject(id,u,'edit');
 throw new RequestError('The team is saving several updates right now. Your draft is preserved; try Save again.',409);
});}
export async function PUT(request:Request,context:Context){return api(async()=>{
 const u=await identity(request),{id}=await context.params,old=await requireProject(id,u,"edit"),{teamAccountIds,...p}=await projectBody(request);
 if(teamAccountIds!==undefined)throw new RequestError('Use project team tagging to change assignments.',403);
 if(p.id!==id)throw new RequestError("Project mismatch.");await checkImages(p,u,readProject(old));
 const now=Date.now();const r=await db().prepare("UPDATE projects SET title=?,data=?,revision=revision+1,updated_at=? WHERE id=? AND revision=? AND (owner=? OR ?=1 OR EXISTS (SELECT 1 FROM project_members m WHERE m.project_id=projects.id AND m.email=?))").bind(p.title,JSON.stringify(p),now,id,p.revision,u.id,u.admin?1:0,u.email).run();
 if(!r.meta.changes)throw new RequestError("Someone updated this project while you were editing. Your draft is still open. Copy any unsaved notes, then reopen the project to load the latest version.",409);
 return json({project:{...p,revision:p.revision+1,updatedAt:now,canEdit:true,canManage:!!old.can_manage,isOwner:!!old.is_owner}});
});}
export async function DELETE(request:Request,context:Context){return api(async()=>{
 const u=await identity(request),{id}=await context.params;await requireProject(id,u,'manage');
 await db().batch([db().prepare("DELETE FROM project_members WHERE project_id=?").bind(id),db().prepare("DELETE FROM production_files WHERE project_id=?").bind(id),db().prepare("DELETE FROM projects WHERE id=?").bind(id)]);
 return json({ok:true});
});}
