import {api,db,bucket,identity,requireProject,json,RequestError} from "@/lib/server";
import {FILE_CATEGORIES} from "@/lib/production";
type Context={params:Promise<{id:string}>};
export async function GET(request:Request,c:Context){return api(async()=>{
 const u=await identity(request),{id}=await c.params;await requireProject(id,u);
 const r=await db().prepare("SELECT id,project_id AS projectId,name,category,mime,size,created_at AS createdAt FROM production_files WHERE project_id=? ORDER BY created_at DESC").bind(id).all();
 return json({files:r.results});
});}
export async function POST(request:Request,c:Context){return api(async()=>{
 const u=await identity(request),{id}=await c.params;await requireProject(id,u,"edit");
 if(Number(request.headers.get("content-length"))>21*1024*1024)throw new RequestError("Files must be 20 MB or smaller.",413);
 const form=await request.formData(),file=form.get("file"),category=String(form.get("category")||"Reference");
 if(!(file instanceof File)||!file.size)throw new RequestError("Choose a file to upload.");
 if(file.size>20*1024*1024)throw new RequestError("Files must be 20 MB or smaller.",413);
 if(!FILE_CATEGORIES.includes(category))throw new RequestError("Choose a file category.");
 const types:Record<string,string>={pdf:"application/pdf",txt:"text/plain",docx:"application/vnd.openxmlformats-officedocument.wordprocessingml.document",pptx:"application/vnd.openxmlformats-officedocument.presentationml.presentation",xlsx:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",csv:"text/csv",jpg:"image/jpeg",jpeg:"image/jpeg",png:"image/png",webp:"image/webp",gif:"image/gif"};
 const mime=types[file.name.split(".").pop()?.toLowerCase()||""];
 if(!mime)throw new RequestError("Upload a PDF, Word, PowerPoint, Excel, CSV, text, or image file. For video, add a link in a reference document.");
 const fileId=crypto.randomUUID(),now=Date.now(),name=file.name.slice(0,180);
 await bucket().put("files/"+fileId,await file.arrayBuffer(),{httpMetadata:{contentType:mime}});
 try{await db().prepare("INSERT INTO production_files (id,project_id,owner,name,category,mime,size,created_at) VALUES (?,?,?,?,?,?,?,?)").bind(fileId,id,u.id,name,category,mime,file.size,now).run();}catch(e){await bucket().delete("files/"+fileId);throw e;}
 return json({file:{id:fileId,projectId:id,name,category,mime,size:file.size,createdAt:now}},201);
});}
