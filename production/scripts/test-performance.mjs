import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {build} from 'esbuild';
import sharp from 'sharp';
import {makePreview,backfillImagePreviews} from './image-previews.mjs';
await build({entryPoints:['lib/http.ts'],bundle:true,platform:'node',format:'esm',outfile:'.work/http.mjs'});
const {fetchJson}=await import('../.work/http.mjs');
const realFetch=globalThis.fetch;
try{
 let calls=0;
 globalThis.fetch=async()=>{if(++calls===1)throw new TypeError('offline');return Response.json({ok:true});};
 assert.equal((await fetchJson('/read')).data.ok,true);assert.equal(calls,2);
 calls=0;globalThis.fetch=async()=>++calls===1?Response.json({error:'Unavailable'},{status:503}):Response.json({ok:true});
 assert.equal((await fetchJson('/read')).data.ok,true);assert.equal(calls,2);
 calls=0;globalThis.fetch=async()=>{calls++;return Response.json({error:'Sign in'},{status:401});};
 assert.equal((await fetchJson('/read')).response.status,401);assert.equal(calls,1);
 calls=0;globalThis.fetch=async()=>{calls++;throw new TypeError('offline');};
 await assert.rejects(fetchJson('/save',{method:'POST',body:'{}'}),/Could not connect/);assert.equal(calls,1);
 calls=0;globalThis.fetch=async(_url,init)=>{calls++;return new Promise((_,reject)=>init.signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError'))));};
 await assert.rejects(fetchJson('/read',{},5),/taking too long/);assert.equal(calls,2);
 calls=0;globalThis.fetch=async(_url,init)=>{calls++;return new Response(new ReadableStream({start(controller){init.signal.addEventListener('abort',()=>controller.error(new DOMException('Aborted','AbortError')));}}));};
 await assert.rejects(fetchJson('/read',{},5),/taking too long/);assert.equal(calls,2);
 // A detailed 2400px image represents an original uploaded reference, including alpha.
 const pixels=Buffer.alloc(2400*1600*4);let seed=1;
 for(let i=0;i<pixels.length;i+=4){seed=(seed*1664525+1013904223)>>>0;pixels[i]=seed&255;pixels[i+1]=(seed>>>8)&255;pixels[i+2]=(seed>>>16)&255;pixels[i+3]=255;}
 const original=await sharp(pixels,{raw:{width:2400,height:1600,channels:4}}).png().toBuffer();
 const preview=await makePreview(original),metadata=await sharp(preview).metadata();
 assert.equal(metadata.format,'webp');assert.ok(metadata.width<=960);assert.ok(preview.length<=256*1024);assert.ok(preview.length<original.length/4);
 const callsMade=[];
 globalThis.fetch=async(url,init)=>{
  assert.equal(init.headers.Cookie,'test-session');assert.equal(init.headers['X-Production-Account'],'owner');callsMade.push([url,init.method||'GET']);
  if(init.method==='PUT'){assert.equal(init.headers['Content-Type'],'image/webp');assert.equal((await sharp(init.body).metadata()).format,'webp');return Response.json({ok:true},{status:201});}
  return new Response(original,{headers:{'Content-Type':'image/png'}});
 };
 const stats=await backfillImagePreviews({origin:'https://test.invalid',cookie:'test-session',images:[{id:'one'}]});
 assert.equal(stats.created,1);assert.equal(stats.failed,0);assert.equal(stats.originalBytes,original.length);assert.equal(callsMade.length,2);assert.match(callsMade[1][0],/preview=1/);
 const shell=await readFile('dist/client/index.html','utf8'),mainPath=shell.match(/<script[^>]+src="([^"]+)"/)[1];
 const main=await readFile('dist/client'+mainPath,'utf8');
 assert.ok(main.length<800000,'The initial app must not include the PDF engine');
 const pdf=await readFile('dist/client/assets/pdf-export.js','utf8');assert.match(pdf,/createProjectPdf/);assert.ok(pdf.length>100000);
 console.log('Performance checks passed: bounded requests and bodies, safe read retries, no repeated writes, private preview conversion, and separate PDF module. Fixture preview: '+original.length+' → '+preview.length+' bytes.');
}finally{globalThis.fetch=realFetch;}
