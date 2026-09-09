import {api,db,bucket,identity,RequestError} from "@/lib/server";
export async function GET(request:Request,context:{params:Promise<{id:string}>}){return api(async()=>{
 const u=await identity(request),{id}=await context.params;
 const row=await db().prepare("SELECT i.mime FROM images i WHERE i.id=? AND (?=1 OR (i.project_id IS NULL AND i.owner=?) OR EXISTS (SELECT 1 FROM projects p WHERE (p.owner=? OR EXISTS (SELECT 1 FROM project_members m WHERE m.project_id=p.id AND m.email=?)) AND (p.id=i.project_id OR EXISTS (SELECT 1 FROM json_each(p.data,'$.shots') s, json_each(s.value,'$.references') r WHERE json_extract(r.value,'$.id')=i.id))))").bind(id,u.admin?1:0,u.id,u.id,u.email).first<{mime:string}>();
 if(!row)throw new RequestError("Image not found.",404);const file=await bucket().get("references/"+id);if(!file)throw new RequestError("Image not found.",404);
 return new Response(file.body,{headers:{"Content-Type":row.mime,"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff","Content-Disposition":"inline"}});
});}
