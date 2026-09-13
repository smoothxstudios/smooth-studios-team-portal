import assert from 'node:assert/strict';
import {build} from 'esbuild';
await build({entryPoints:['lib/uploads.ts'],bundle:true,platform:'node',format:'esm',outfile:'.work/upload-client.mjs'});
const {uploadReference,uploadRequest}=await import('../.work/upload-client.mjs');
const originalFetch=globalThis.fetch,originalWindow=globalThis.window;
globalThis.window=new EventTarget();
const bytes=new Uint8Array(1024*1024+9);bytes.fill(52);bytes.set([137,80,78,71,13,10,26,10]);
const file=new File([bytes],'Reference photo.png',{type:''});
const id='20e67b45-07ac-4513-8656-16af7242c9ee';
const chunks=new Map();let attempts=0,expired=false;
window.addEventListener('account-expired',()=>{expired=true;});
try{
 globalThis.fetch=async(url,init)=>{
  assert.ok(String(url).startsWith('/api/'));
  if(url==='/api/image-uploads'){
   const input=JSON.parse(init.body);assert.equal(input.mime,'image/png');assert.equal(input.size,bytes.length);
   return Response.json({uploadId:id,chunkSize:128*1024},{status:201});
  }
  if(init.method==='PUT'){
   const part=Number(new URL(url,'https://test.invalid').searchParams.get('part'));
   if(part===0&&attempts++===0)return new Response('<html>Temporary server failure</html>',{status:503});
   chunks.set(part,new Uint8Array(await init.body.arrayBuffer()));return Response.json({ok:true});
  }
  const combined=Buffer.concat([...chunks].sort((a,b)=>a[0]-b[0]).map(([,b])=>b));assert.deepEqual(combined,Buffer.from(bytes));
  return Response.json({image:{id,name:file.name,caption:''}},{status:201});
 };
 const progress=[];const image=await uploadReference(file,undefined,p=>progress.push(p));
 assert.equal(image.id,id);assert.equal(attempts,2);assert.equal(progress.at(-1),100);
 await assert.rejects(uploadReference(new File(['not a picture'],'bad.heic')),/JPG, PNG/);
 globalThis.fetch=async()=>new Response('<html>Request too large</html>',{status:413});
 await assert.rejects(uploadRequest('/api/images',{method:'POST'}),/too large/);
 globalThis.fetch=async()=>new Response('<html>Unexpected page</html>',{status:200});
 await assert.rejects(uploadRequest('/api/images',{method:'POST'}),/connection was interrupted/);
 globalThis.fetch=async()=>new Response('',{status:401});
 await assert.rejects(uploadRequest('/api/images',{method:'POST'}),/session expired/);assert.equal(expired,true);
 console.log('Upload client checks passed: empty MIME, original bytes, retry after HTML error, progress, clear non-JSON errors, and expired sessions.');
}finally{globalThis.fetch=originalFetch;globalThis.window=originalWindow;}
