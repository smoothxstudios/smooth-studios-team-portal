import {api,db,bucket,identity,json,requireProject,RequestError,PROJECT_ACCESS_SQL} from '@/lib/server';
import {imageMime} from '@/lib/image-format';
import type {SessionUser} from '@/lib/production';
type Context={params:Promise<{id:string}>};
type ImageRow={mime:string;size:number;owner:string;project_id:string|null;preview_mime:string|null;preview_size:number|null};

async function authorized(request:Request,id:string,u:SessionUser){
 const account=new URL(request.url).searchParams.get('account');
 if(account&&account!==u.id)throw new RequestError('Your production account changed. Sign in again.',401);
 // Indexed image/project relationships avoid scanning every shot's JSON on each image request.
 const row=await db().prepare("SELECT i.mime,i.size,i.owner,i.project_id,v.mime AS preview_mime,v.size AS preview_size FROM images i LEFT JOIN image_previews v ON v.image_id=i.id WHERE i.id=? AND (?=1 OR (i.project_id IS NULL AND i.owner=?) OR EXISTS (SELECT 1 FROM projects p WHERE p.id=i.project_id AND "+PROJECT_ACCESS_SQL+") OR EXISTS (SELECT 1 FROM project_image_refs r JOIN projects p ON p.id=r.project_id WHERE r.image_id=i.id AND "+PROJECT_ACCESS_SQL+"))").bind(id,u.admin?1:0,u.id,u.id,u.admin?1:0,u.email,u.id,u.admin?1:0,u.email).first<ImageRow>();
 if(!row)throw new RequestError('Image not found.',404);
 return row;
}
export async function GET(request:Request,context:Context){return api(async()=>{
 const u=await identity(request),{id}=await context.params,row=await authorized(request,id,u);
 const preview=new URL(request.url).searchParams.get('preview')==='1'&&!!row.preview_mime;
 const size=preview?row.preview_size!:row.size,mime=preview?row.preview_mime!:row.mime;
 const etag='"'+encodeURIComponent(u.id)+'-'+id+'-'+(preview?'preview':'original')+'-'+size+'"';
 const headers={'Content-Type':mime,'Cache-Control':'private, no-cache, must-revalidate','Vary':'Cookie, X-Production-Account','ETag':etag,'X-Content-Type-Options':'nosniff','Content-Disposition':'inline','X-Image-Variant':preview?'preview':'original'};
 // Permissions and the active account are checked before honoring a browser's cached copy.
 if(request.headers.get('if-none-match')?.split(',').some(tag=>tag.trim().replace(/^W\//,'')===etag))return new Response(null,{status:304,headers});
 if(preview){const file=await db().prepare('SELECT bytes FROM image_previews WHERE image_id=?').bind(id).first<{bytes:number[]}>();if(!file)throw new RequestError('Image not found.',404);return new Response(new Uint8Array(file.bytes),{headers:{...headers,'Content-Length':String(size)}});}
 const file=await bucket().get('references/'+id);if(!file)throw new RequestError('Image not found.',404);
 return new Response(file.body,{headers:{...headers,'Content-Length':String(size)}});
});}
export async function PUT(request:Request,context:Context){return api(async()=>{
 if(new URL(request.url).searchParams.get('preview')!=='1')throw new RequestError('Not found.',404);
 const u=await identity(request),{id}=await context.params,row=await authorized(request,id,u);
 // A copied reference grants read access only; its original project's editors create the preview.
 if(row.project_id)await requireProject(row.project_id,u,'edit');else if(!u.admin&&row.owner!==u.id)throw new RequestError('Image not found.',404);
 if(row.preview_mime)return json({ok:true});
 const max=256*1024,reader=request.body?.getReader();if(!reader)throw new RequestError('Preview is empty.');
 const bytes=new Uint8Array(max);let size=0;
 try{while(true){const r=await reader.read();if(r.done)break;if(size+r.value.length>max){await reader.cancel();throw new RequestError('Preview is too large.',413);}bytes.set(r.value,size);size+=r.value.length;}}finally{reader.releaseLock();}
 const content=bytes.slice(0,size),mime=imageMime(content);
 if(!['image/jpeg','image/png','image/webp'].includes(mime))throw new RequestError('Use a JPG, PNG, or WebP preview.');
 await db().prepare('INSERT INTO image_previews(image_id,mime,size,bytes,created_at) VALUES(?,?,?,?,?) ON CONFLICT(image_id) DO NOTHING').bind(id,mime,size,content,Date.now()).run();
 return json({ok:true},201);
});}
