export async function loadPdfFonts(){
 return Promise.all(['/fonts/ProductionSans.ttf','/fonts/ProductionSans-Bold.ttf'].map(async url=>{
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),30000);
  try{
   const response=await fetch(url,{cache:'no-cache',credentials:'same-origin',signal:controller.signal});
   if(!response.ok)throw new Error('The PDF fonts could not be loaded. Refresh the dashboard and try again.');
   const bytes=new Uint8Array(await response.arrayBuffer());
   const signature=bytes.slice(0,4).join(',');
   if(signature!=='0,1,0,0'&&signature!=='79,84,84,79')throw new Error('The PDF fonts could not be loaded. Refresh the dashboard and try again.');
   return bytes;
  }catch(e){
   if(e instanceof Error&&e.message.startsWith('The PDF fonts'))throw e;
   throw new Error('The PDF fonts could not be downloaded. Check your connection and try again.');
  }finally{clearTimeout(timer);}
 }));
}
