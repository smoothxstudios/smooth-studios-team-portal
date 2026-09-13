import {z} from 'zod';
import {api,db,identity,json,readJSON,requireProject,RequestError} from './server';
import {IMAGE_CHUNK_SIZE,MAX_IMAGE_SIZE,IMAGE_TYPES,imageMime} from './image-format';
type Upload={id:string;owner:string;project_id:string|null;name:string;mime:string;size:number;parts:number;completed:number};
type Context={params:Promise<{id:string}>};
const input=z.object({name:z.string().trim().min(1).max(180),mime:z.enum(IMAGE_TYPES),size:z.number().int().min(1).max(MAX_IMAGE_SIZE),projectId:z.string().uuid().optional()});
async function owned(request:Request,c:Context,editing=true){
 const user=await identity(request),{id}=await c.params;
 const row=await db().prepare('SELECT * FROM image_uploads WHERE id=? AND owner=?').bind(id,user.id).first<Upload>();
 if(!row)throw new RequestError('This upload expired. Select the picture again.',404);
 if(editing){if(row.project_id)await requireProject(row.project_id,user,'edit');else if(!user.admin)throw new RequestError('Choose an assigned project before uploading.',403);}
 return row;
}
export async function start(request:Request){return api(async()=>{
 const user=await identity(request),p=input.parse(await readJSON(request,4000));
 if(p.projectId)await requireProject(p.projectId,user,'edit');else if(!user.admin)throw new RequestError('Choose an assigned project before uploading.',403);
 const cutoff=Date.now()-24*60*60*1000;
 // Expire unfinished uploads without removing any published picture bytes.
 await db().batch([
  db().prepare("DELETE FROM file_chunks WHERE object_key IN (SELECT 'references/'||u.id FROM image_uploads u WHERE u.created_at<? AND u.completed=0 AND NOT EXISTS (SELECT 1 FROM images i WHERE i.id=u.id))").bind(cutoff),
  db().prepare('DELETE FROM image_uploads WHERE created_at<?').bind(cutoff)
 ]);
 const id=crypto.randomUUID(),parts=Math.ceil(p.size/IMAGE_CHUNK_SIZE);
 await db().prepare('INSERT INTO image_uploads(id,owner,project_id,name,mime,size,parts,created_at) VALUES(?,?,?,?,?,?,?,?)').bind(id,user.id,p.projectId||null,p.name,p.mime,p.size,parts,Date.now()).run();
 return json({uploadId:id,chunkSize:IMAGE_CHUNK_SIZE},201);
});}
export async function part(request:Request,c:Context){return api(async()=>{
 const row=await owned(request,c),value=new URL(request.url).searchParams.get('part');
 if(!value||!/^\d+$/.test(value))throw new RequestError('Invalid upload part.');
 const index=Number(value);if(index>=row.parts)throw new RequestError('Invalid upload part.');
 if(row.completed)throw new RequestError('This picture is already uploaded.',409);
 const expected=Math.min(IMAGE_CHUNK_SIZE,row.size-index*IMAGE_CHUNK_SIZE);
 if(Number(request.headers.get('content-length'))>IMAGE_CHUNK_SIZE)throw new RequestError('Upload part is too large.',413);
 const reader=request.body?.getReader();if(!reader)throw new RequestError('Upload part is empty.');
 const bytes=new Uint8Array(expected);let offset=0;
 try{while(true){const result=await reader.read();if(result.done)break;if(offset+result.value.length>expected){await reader.cancel();throw new RequestError('Upload part is too large.',413);}bytes.set(result.value,offset);offset+=result.value.length;}}finally{reader.releaseLock();}
 if(offset!==expected)throw new RequestError('The upload was interrupted. Retry this picture.');
 if(index===0&&imageMime(bytes)!==row.mime)throw new RequestError('This is not a supported JPG, PNG, WebP, or GIF picture.');
 const result=await db().prepare("INSERT INTO file_chunks(object_key,part,bytes) SELECT ?,?,? WHERE EXISTS (SELECT 1 FROM image_uploads WHERE id=? AND completed=0) ON CONFLICT(object_key,part) DO UPDATE SET bytes=excluded.bytes").bind('references/'+row.id,index,bytes,row.id).run();
 if(!result.meta.changes)throw new RequestError('This picture is already uploaded.',409);
 return json({ok:true});
});}
export async function finish(request:Request,c:Context){return api(async()=>{
 const row=await owned(request,c);
 if(!row.completed){
  const count=await db().prepare('SELECT COUNT(*) AS parts,SUM(length(bytes)) AS size FROM file_chunks WHERE object_key=?').bind('references/'+row.id).first<{parts:number;size:number}>();
  if(count?.parts!==row.parts||count.size!==row.size)throw new RequestError('Some picture data is missing. Please retry the upload.',409);
  await db().batch([
   db().prepare('INSERT INTO images(id,owner,name,mime,size,created_at,project_id) SELECT id,owner,name,mime,size,?,project_id FROM image_uploads WHERE id=? ON CONFLICT(id) DO NOTHING').bind(Date.now(),row.id),
   db().prepare('UPDATE image_uploads SET completed=1 WHERE id=?').bind(row.id)
  ]);
  if(!await db().prepare('SELECT id FROM images WHERE id=? AND owner=?').bind(row.id,row.owner).first())throw new RequestError('This upload was cancelled. Select the picture again.',409);
 }
 return json({image:{id:row.id,name:row.name,caption:''}},201);
});}
export async function cancel(request:Request,c:Context){return api(async()=>{
 const row=await owned(request,c,false);
 if(!row.completed)await db().batch([
  db().prepare("DELETE FROM file_chunks WHERE object_key=? AND NOT EXISTS (SELECT 1 FROM images WHERE id=?)").bind('references/'+row.id,row.id),
  db().prepare('DELETE FROM image_uploads WHERE id=? AND completed=0').bind(row.id)
 ]);
 return json({ok:true});
});}
