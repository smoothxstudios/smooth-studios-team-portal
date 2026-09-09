import {env} from 'cloudflare:workers';
// A separate production bucket is preferred. Chunked D1 storage supports the
// same file limits when object storage is not enabled on the hosting account.
export function storage(){return {
 async put(key:string,data:ArrayBuffer|Uint8Array<ArrayBuffer>,_options?:unknown){
  if(env.BUCKET)return env.BUCKET.put(key,data);
  const bytes=new Uint8Array(data),statements=[env.DB.prepare('DELETE FROM file_chunks WHERE object_key=?').bind(key)];
  for(let offset=0,i=0;offset<bytes.length;offset+=512*1024,i++)statements.push(env.DB.prepare('INSERT INTO file_chunks(object_key,part,bytes) VALUES(?,?,?)').bind(key,i,bytes.slice(offset,offset+512*1024)));
  await env.DB.batch(statements);
 },
 async get(key:string){
  if(env.BUCKET){const found=await env.BUCKET.get(key);if(found)return found;}
  const {results}=await env.DB.prepare('SELECT bytes FROM file_chunks WHERE object_key=? ORDER BY part').bind(key).all<{bytes:number[]}>();
  if(!results.length)return null;const bytes=new Uint8Array(results.reduce((n,r)=>n+r.bytes.length,0));let offset=0;for(const part of results){bytes.set(part.bytes,offset);offset+=part.bytes.length;}return {body:bytes};
 },
 async delete(key:string){if(env.BUCKET)await env.BUCKET.delete(key);await env.DB.prepare('DELETE FROM file_chunks WHERE object_key=?').bind(key).run();}
};}
