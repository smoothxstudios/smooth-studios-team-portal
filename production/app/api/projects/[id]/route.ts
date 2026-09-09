import {api,db,identity,admin,json,projectBody,checkImages,readProject,requireProject,RequestError} from "@/lib/server";
type Context={params:Promise<{id:string}>};
export async function GET(request:Request,context:Context){return api(async()=>{const u=await identity(request),{id}=await context.params;return json({project:readProject(await requireProject(id,u))});});}
export async function PUT(request:Request,context:Context){return api(async()=>{
 const u=await identity(request),{id}=await context.params,old=await requireProject(id,u),p=await projectBody(request);
 if(p.id!==id)throw new RequestError("Project mismatch.");await checkImages(p,u,readProject(old));
 const now=Date.now();const r=await db().prepare("UPDATE projects SET title=?,data=?,revision=revision+1,updated_at=? WHERE id=? AND revision=? AND (owner=? OR ?=1 OR EXISTS (SELECT 1 FROM project_members m WHERE m.project_id=projects.id AND m.email=?))").bind(p.title,JSON.stringify(p),now,id,p.revision,u.id,u.admin?1:0,u.email).run();
 if(!r.meta.changes)throw new RequestError("Someone updated this project while you were editing. Your draft is still open. Copy any unsaved notes, then reopen the project to load the latest version.",409);
 return json({project:{...p,revision:p.revision+1,updatedAt:now}});
});}
export async function DELETE(request:Request,context:Context){return api(async()=>{
 const u=await admin(request),{id}=await context.params;await requireProject(id,u);
 await db().batch([db().prepare("DELETE FROM project_members WHERE project_id=?").bind(id),db().prepare("DELETE FROM production_files WHERE project_id=?").bind(id),db().prepare("DELETE FROM projects WHERE id=?").bind(id)]);
 return json({ok:true});
});}
