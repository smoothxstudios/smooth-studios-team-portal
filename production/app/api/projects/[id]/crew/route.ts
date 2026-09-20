import {api,db,identity,json,readJSON,requireProject,RequestError} from "@/lib/server";
import {crewSchema} from "@/lib/production-schema";
type Context={params:Promise<{id:string}>};
export async function GET(request:Request,c:Context){return api(async()=>{
 const u=await identity(request),{id}=await c.params;await requireProject(id,u);
 const rows=await db().prepare("SELECT id, project_id AS projectId, name,email,role,phone,call_time AS callTime FROM project_members WHERE project_id=? ORDER BY name COLLATE NOCASE").bind(id).all();
 return json({crew:rows.results});
});}
export async function POST(request:Request,c:Context){return api(async()=>{
 const u=await identity(request),{id}=await c.params;await requireProject(id,u,'manage');const body=await readJSON(request,10000);
 if(body&&typeof body==='object'&&'accountId' in body){
  if(typeof body.accountId!=='string'||!body.accountId.length||body.accountId.length>80)throw new RequestError('Choose an active team account.');
  // Existing accounts are authoritative identities, including legacy imported
  // email values. Do not normalize them through the manual crew-contact form.
  // Retrying a tag keeps the existing crew role, phone, and call time intact.
  await db().prepare("INSERT INTO project_members (id,project_id,name,email,role,phone,call_time) SELECT ?,?,name,email,'Team member','','' FROM user WHERE id=? AND enabled=1 ON CONFLICT(project_id,email) DO NOTHING").bind(crypto.randomUUID(),id,body.accountId).run();
  const member=await db().prepare('SELECT id,project_id AS projectId,name,email,role,phone,call_time AS callTime FROM project_members WHERE project_id=? AND email=(SELECT email FROM user WHERE id=? AND enabled=1)').bind(id,body.accountId).first();
  if(!member)throw new RequestError('Choose an active team account.');
  return json({member});
 }
 const parsed=crewSchema.safeParse(body);
 if(!parsed.success)throw new RequestError('Check the crew member’s name, email, role, and call time.');
 const member=parsed.data;
 if(!await db().prepare("SELECT id FROM user WHERE email=? AND enabled=1").bind(member.email).first())throw new RequestError("Choose an active team account. Create new logins in Team accounts first.");
 const duplicate=await db().prepare("SELECT id FROM project_members WHERE project_id=? AND email=?").bind(id,member.email).first<{id:string}>();
 if(duplicate&&duplicate.id!==member.id)throw new RequestError("That email is already assigned to this project.",409);
 const memberId=member.id||crypto.randomUUID();
 if(member.id){const r=await db().prepare("UPDATE project_members SET name=?,email=?,role=?,phone=?,call_time=? WHERE id=? AND project_id=?").bind(member.name,member.email,member.role,member.phone,member.callTime,memberId,id).run();if(!r.meta.changes)throw new RequestError("Crew member not found.",404);}
 else await db().prepare("INSERT INTO project_members (id,project_id,name,email,role,phone,call_time) VALUES (?,?,?,?,?,?,?)").bind(memberId,id,member.name,member.email,member.role,member.phone,member.callTime).run();
 return json({member:{...member,id:memberId,projectId:id}});
});}
export async function DELETE(request:Request,c:Context){return api(async()=>{
 const u=await identity(request),{id}=await c.params;await requireProject(id,u,'manage');const body=await readJSON(request,2000);if(typeof body.memberId!=="string")throw new RequestError("Select a crew member.");
 await db().prepare("DELETE FROM project_members WHERE id=? AND project_id=?").bind(body.memberId,id).run();return json({ok:true});
});}
