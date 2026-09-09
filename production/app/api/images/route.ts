import { api,db,bucket,identity,requireProject,json,RequestError } from "@/lib/server";
export async function POST(request:Request){return api(async()=>{
  const user=await identity(request);
  if(Number(request.headers.get("content-length"))>13*1024*1024)throw new RequestError("Use an image smaller than 12 MB.",413);
  const form=await request.formData();const file=form.get("file");
  const projectId=String(form.get("projectId")||"");
  if(projectId)await requireProject(projectId,user);else if(!user.admin)throw new RequestError("Choose an assigned project before uploading an image.",403);
  if(!(file instanceof File)||file.size===0)throw new RequestError("Choose an image to upload.");
  if(file.size>12*1024*1024)throw new RequestError("Use an image smaller than 12 MB.",413);
  const allowed=["image/jpeg","image/png","image/webp","image/gif"];
  if(!allowed.includes(file.type))throw new RequestError("Use a JPG, PNG, WebP, or GIF image.");
  const bytes=new Uint8Array(await file.arrayBuffer());
  const detected=bytes[0]===255&&bytes[1]===216&&bytes[2]===255?"image/jpeg":bytes[0]===137&&bytes[1]===80&&bytes[2]===78&&bytes[3]===71?"image/png":String.fromCharCode(...bytes.slice(0,3))==="GIF"?"image/gif":String.fromCharCode(...bytes.slice(0,4))==="RIFF"&&String.fromCharCode(...bytes.slice(8,12))==="WEBP"?"image/webp":"";
  if(detected!==file.type)throw new RequestError("That file does not appear to be a supported image.");
  const id=crypto.randomUUID();const name=file.name.slice(0,180);
  await bucket().put(`references/${id}`,bytes,{httpMetadata:{contentType:file.type}});
  try{await db().prepare("INSERT INTO images (id, owner, name, mime, size, created_at, project_id) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(id,user.id,name,file.type,file.size,Date.now(),projectId||null).run();}catch(e){await bucket().delete(`references/${id}`);throw e;}
  return json({image:{id,name,caption:""}},201);
});}
