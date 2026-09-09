import {api,db,bucket,identity,requireProject,json,RequestError} from "@/lib/server";
type Context={params:Promise<{id:string}>};
async function allowed(request:Request,c:Context){const u=await identity(request),{id}=await c.params;const row=await db().prepare("SELECT project_id,name,mime FROM production_files WHERE id=?").bind(id).first<{project_id:string;name:string;mime:string}>();if(!row)throw new RequestError("File not found.",404);await requireProject(row.project_id,u);return {id,row};}
export async function GET(request:Request,c:Context){return api(async()=>{
 const {id,row}=await allowed(request,c),file=await bucket().get("files/"+id);if(!file)throw new RequestError("File not found.",404);
 const filename=row.name.replace(/[\r\n"\\]/g,"_");
 return new Response(file.body,{headers:{"Content-Type":row.mime,"Content-Disposition":"attachment; filename*=UTF-8''"+encodeURIComponent(filename),"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"}});
});}
export async function DELETE(request:Request,c:Context){return api(async()=>{const {id}=await allowed(request,c);await bucket().delete("files/"+id);await db().prepare("DELETE FROM production_files WHERE id=?").bind(id).run();return json({ok:true});});}
