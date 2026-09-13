import {api,db,identity,admin,json,projectBody,checkImages,readProject,RequestError} from "@/lib/server";
import {ALL_MODULES} from '@/lib/production';
export async function GET(request:Request){return api(async()=>{
 const u=await identity(request);const rows=await db().prepare("SELECT p.id, p.title, p.updated_at, json_array_length(p.data,'$.shots') AS shots, json_extract(p.data,'$.client') AS client, json_extract(p.data,'$.date') AS date, json_extract(p.data,'$.production.stage') AS stage, json_extract(p.data,'$.production.due') AS due, json_extract(p.data,'$.production.modules') AS modules, json_array_length(p.data,'$.production.tasks') AS task_count, (SELECT COUNT(*) FROM json_each(p.data,'$.production.tasks') t WHERE json_extract(t.value,'$.status')='Done') AS tasks_done, (p.owner = ? OR ? = 1 OR EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = p.id AND m.email = ?)) AS can_edit FROM projects p ORDER BY p.updated_at DESC").bind(u.id,u.admin?1:0,u.email).all<any>();
 return json({projects:rows.results.map(x=>({id:x.id,title:x.title,canEdit:!!x.can_edit,updatedAt:x.updated_at,shots:x.shots,client:x.client,date:x.date,stage:x.stage||"Pre-production",due:x.due||"",modules:x.modules?JSON.parse(x.modules):ALL_MODULES,taskCount:x.task_count||0,tasksDone:x.tasks_done||0}))});
});}
export async function POST(request:Request){return api(async()=>{
 const u=await admin(request),{teamAccountIds,...p}=await projectBody(request);await checkImages(p,u);
 const old=await db().prepare("SELECT owner,data,revision,updated_at FROM projects WHERE id=?").bind(p.id).first<any>();
 if(old){if(old.owner!==u.id||old.data!==JSON.stringify(p))throw new RequestError("This project already exists. Reopen it from Projects.",409);return json({project:readProject({...old,can_edit:1})});}
 const ids=[...new Set(teamAccountIds||[])];
 if(ids.length>50)throw new RequestError('Choose up to 50 team members.');
 const members=ids.length?(await db().prepare('SELECT id,name,email FROM user WHERE enabled=1 AND id IN ('+ids.map(()=>'?').join(',')+')').bind(...ids).all<{id:string;name:string;email:string}>()).results:[];
 if(members.length!==ids.length)throw new RequestError('A selected team account is unavailable. Update your selection.');
 const now=Date.now();await db().batch([db().prepare("INSERT INTO projects (id,owner,title,data,revision,updated_at) VALUES (?,?,?,?,1,?)").bind(p.id,u.id,p.title,JSON.stringify(p),now),...members.map(m=>db().prepare("INSERT INTO project_members(id,project_id,name,email,role,phone,call_time) VALUES (?,?,?,?,'Team member','','')").bind(crypto.randomUUID(),p.id,m.name,m.email))]);
 return json({project:{...p,revision:1,updatedAt:now,canEdit:true}},201);
});}
