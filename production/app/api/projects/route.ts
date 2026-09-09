import {api,db,identity,admin,json,projectBody,checkImages,readProject,RequestError} from "@/lib/server";
export async function GET(request:Request){return api(async()=>{
 const u=await identity(request);const rows=await db().prepare("SELECT p.id, p.title, p.updated_at, json_array_length(p.data,'$.shots') AS shots, json_extract(p.data,'$.client') AS client, json_extract(p.data,'$.date') AS date, json_extract(p.data,'$.production.stage') AS stage, json_extract(p.data,'$.production.due') AS due, json_array_length(p.data,'$.production.tasks') AS task_count, (SELECT COUNT(*) FROM json_each(p.data,'$.production.tasks') t WHERE json_extract(t.value,'$.status')='Done') AS tasks_done FROM projects p WHERE p.owner = ? OR ? = 1 OR EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = p.id AND m.email = ?) ORDER BY p.updated_at DESC").bind(u.id,u.admin?1:0,u.email).all<any>();
 return json({projects:rows.results.map(x=>({id:x.id,title:x.title,updatedAt:x.updated_at,shots:x.shots,client:x.client,date:x.date,stage:x.stage||"Pre-production",due:x.due||"",taskCount:x.task_count||0,tasksDone:x.tasks_done||0}))});
});}
export async function POST(request:Request){return api(async()=>{
 const u=await admin(request),p=await projectBody(request);await checkImages(p,u);
 const old=await db().prepare("SELECT owner,data,revision,updated_at FROM projects WHERE id=?").bind(p.id).first<any>();
 if(old){if(old.owner!==u.id||old.data!==JSON.stringify(p))throw new RequestError("This project already exists. Reopen it from Projects.",409);return json({project:readProject(old)});}
 const now=Date.now();await db().prepare("INSERT INTO projects (id,owner,title,data,revision,updated_at) VALUES (?,?,?,?,1,?)").bind(p.id,u.id,p.title,JSON.stringify(p),now).run();
 return json({project:{...p,revision:1,updatedAt:now}},201);
});}
