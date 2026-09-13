import {env} from 'cloudflare:workers';
// Keep database serialization bounded for full-size uploads and downloads.
export function storage(){return {
 async put(key:string,data:ArrayBuffer|Uint8Array<ArrayBuffer>,_options?:unknown){
  if(env.BUCKET)return env.BUCKET.put(key,data);
  const bytes=new Uint8Array(data);
  await env.DB.prepare('DELETE FROM file_chunks WHERE object_key=?').bind(key).run();
  try{for(let offset=0;offset<bytes.length;){
   const batch=[];
   for(let i=0;i<2&&offset<bytes.length;i++,offset+=512*1024)batch.push(env.DB.prepare('INSERT INTO file_chunks(object_key,part,bytes) VALUES(?,?,?)').bind(key,offset/(512*1024),bytes.slice(offset,offset+512*1024)));
   await env.DB.batch(batch);
  }}catch(e){await env.DB.prepare('DELETE FROM file_chunks WHERE object_key=?').bind(key).run();throw e;}
 },
 async get(key:string){
  if(env.BUCKET){const found=await env.BUCKET.get(key);if(found)return found;}
  const count=await env.DB.prepare('SELECT COUNT(*) AS parts FROM file_chunks WHERE object_key=?').bind(key).first<{parts:number}>();
  if(!count?.parts)return null;
  let offset=0;
  const body=new ReadableStream<Uint8Array>({async pull(controller){
   try{
    const {results}=await env.DB.prepare('SELECT part,bytes FROM file_chunks WHERE object_key=? AND part>=? ORDER BY part LIMIT 4').bind(key,offset).all<{part:number;bytes:number[]}>();
    if(!results.length)throw new Error('File data is incomplete.');
    for(const part of results){if(part.part!==offset)throw new Error('File data is incomplete.');controller.enqueue(new Uint8Array(part.bytes));offset++;}
    if(offset===count.parts)controller.close();
   }catch(e){controller.error(e);}
  }});
  return {body};
 },
 async delete(key:string){if(env.BUCKET)await env.BUCKET.delete(key);await env.DB.prepare('DELETE FROM file_chunks WHERE object_key=?').bind(key).run();}
};}
