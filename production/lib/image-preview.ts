/** A small display copy; the original upload is always preserved. */
export async function createImagePreview(file:Blob):Promise<Blob|null>{
 if(typeof document==='undefined')return null;
 const url=URL.createObjectURL(file);
 try{
  const image=new Image();image.decoding='async';
  await new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Preview unavailable')),8000);image.onload=()=>{clearTimeout(timer);resolve();};image.onerror=()=>{clearTimeout(timer);reject(new Error('Preview unavailable'));};image.src=url;});
  for(const [edge,quality] of [[960,.78],[640,.65]]){
   const scale=Math.min(1,edge/Math.max(image.naturalWidth,image.naturalHeight));
   const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));
   const context=canvas.getContext('2d');if(!context)return null;context.drawImage(image,0,0,canvas.width,canvas.height);
   const preview=await new Promise<Blob|null>(resolve=>canvas.toBlob(resolve,'image/webp',quality));
   if(preview&&preview.size<=256*1024)return preview;
  }
  return null;
 }catch{return null;}finally{URL.revokeObjectURL(url);}
}
