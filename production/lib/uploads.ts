import {IMAGE_TYPES,MAX_IMAGE_SIZE,imageMime} from './image-format';
import type {Reference} from './shot-list';
export class UploadError extends Error{constructor(message:string,public status=0){super(message);}}
export async function uploadRequest<T>(url:string,init:RequestInit):Promise<T>{
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),30000);
 try{
  const response=await fetch(url,{...init,signal:controller.signal,credentials:'same-origin'});
  if(response.status===401){window.dispatchEvent(new Event('account-expired'));throw new UploadError('Your session expired. Sign in again before uploading.',401);}
  let data:any;try{data=JSON.parse(await response.text());}catch{}
  if(!response.ok||!data||typeof data!=='object'||Array.isArray(data)){
   const fallback=response.status===413?'This upload is too large. Choose a smaller file.':response.status===403?'You do not have permission to upload here. Reopen the project and try again.':'The upload connection was interrupted. Your draft is still open. Please try again.';
   throw new UploadError(typeof data?.error==='string'?data.error:fallback,response.status>=400?response.status:0);
  }
  return data as T;
 }catch(e){if(e instanceof UploadError)throw e;throw new UploadError('The upload connection was interrupted. Your draft is still open. Please try again.');}finally{clearTimeout(timer);}
}
async function retry<T>(fn:()=>Promise<T>){for(let attempt=0;;attempt++){try{return await fn();}catch(e){if(!(e instanceof UploadError)||attempt===2||!(e.status===0||e.status===408||e.status===429||e.status>=500))throw e;await new Promise(resolve=>setTimeout(resolve,300*(attempt+1)));}}}
export async function uploadReference(file:File,projectId?:string,progress:(percent:number)=>void=()=>{}):Promise<Reference>{
 if(!file.size)throw new Error('This picture is empty. Choose another file.');
 if(file.size>MAX_IMAGE_SIZE)throw new Error('Use a picture smaller than 12 MB.');
 // Inspect bytes because some browsers leave File.type empty or inconsistent.
 const mime=imageMime(new Uint8Array(await file.slice(0,12).arrayBuffer()));
 if(!IMAGE_TYPES.includes(mime as typeof IMAGE_TYPES[number]))throw new Error('Use a JPG, PNG, WebP, or GIF picture. Export HEIC photos as JPG or PNG first.');
 progress(0);
 const start=await uploadRequest<{uploadId:string;chunkSize:number}>('/api/image-uploads',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:file.name.slice(0,180)||'Reference image',mime,size:file.size,...(projectId?{projectId}:{})})});
 if(!/^[a-f0-9-]{36}$/i.test(start.uploadId)||!Number.isInteger(start.chunkSize)||start.chunkSize<1||start.chunkSize>512*1024)throw new UploadError('The upload could not start. Please try again.');
 const url='/api/image-uploads/'+start.uploadId;
 try{
  for(let offset=0,index=0;offset<file.size;offset+=start.chunkSize,index++){
   const body=file.slice(offset,Math.min(file.size,offset+start.chunkSize));
   await retry(()=>uploadRequest(url+'?part='+index,{method:'PUT',headers:{'Content-Type':'application/octet-stream'},body}));
   progress(Math.min(99,Math.round((offset+body.size)/file.size*100)));
  }
  const result=await retry(()=>uploadRequest<{image:Reference}>(url,{method:'POST'}));
  if(!result.image?.id||typeof result.image.name!=='string')throw new UploadError('The picture upload could not be confirmed. Please try again.');
  progress(100);return result.image;
 }catch(e){await uploadRequest(url,{method:'DELETE'}).catch(()=>{});throw e;}
}
