import sharp from 'sharp';

export async function makePreview(bytes){
 for(const [edge,quality] of [[960,78],[640,65]]){
  // Recover a display copy from decodable legacy image data; never alter the source.
  const preview=await sharp(bytes,{limitInputPixels:80_000_000,failOn:'none'}).rotate().resize({width:edge,height:edge,fit:'inside',withoutEnlargement:true}).webp({quality}).toBuffer();
  if(preview.length<=256*1024)return preview;
 }
 throw new Error('Preview exceeds the display size limit.');
}

/** Derive display copies through the same authenticated APIs used by the app. */
export async function backfillImagePreviews({origin,cookie,images}){
 const stats={created:0,failed:0,failedInProjects:0,originalBytes:0,previewBytes:0};
 const headers={Cookie:cookie,Origin:origin,'X-Production-Account':'owner'};
 for(const image of images){
  let originalBytes=0;
  try{
   const original=await fetch(origin+'/api/images/'+encodeURIComponent(image.id),{headers,signal:AbortSignal.timeout(30000)});
   if(!original.ok)throw new Error('Original request failed ('+original.status+').');
   const bytes=Buffer.from(await original.arrayBuffer());originalBytes=bytes.length;const preview=await makePreview(bytes);
   const upload=await fetch(origin+'/api/images/'+encodeURIComponent(image.id)+'?preview=1',{method:'PUT',headers:{...headers,'Content-Type':'image/webp'},body:preview,signal:AbortSignal.timeout(15000)});
   if(!upload.ok)throw new Error('Preview request failed ('+upload.status+').');
   stats.created++;stats.originalBytes+=bytes.length;stats.previewBytes+=preview.length;
  }catch(error){stats.failed++;if(image.referenced)stats.failedInProjects++;console.log('Image preview skipped ('+originalBytes+' source bytes; '+(image.referenced?'referenced in a project':'not referenced in a project')+'): '+error.message);}
 }
 return stats;
}
