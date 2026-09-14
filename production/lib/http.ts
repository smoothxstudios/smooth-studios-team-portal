/** Bound reads, including the response body; retry safe reads once on a broken connection. */
export async function fetchJson<T=any>(url:string,init:RequestInit={},timeoutMs=12000):Promise<{response:Response;data:T}>{
 const safe=['GET','HEAD'].includes((init.method||'GET').toUpperCase());
 for(let attempt=0;attempt<(safe?2:1);attempt++){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
   const response=await fetch(url,{...init,signal:controller.signal});
   let data:T;
   try{data=await response.json() as T;}catch{throw new Error('The connection was interrupted. Please try again.');}
   if(safe&&attempt===0&&[502,503,504].includes(response.status))continue;
   return {response,data};
  }catch(e){
   if(safe&&attempt===0)continue;
   throw new Error(controller.signal.aborted?'The connection is taking too long. Please try again.':e instanceof TypeError?'Could not connect. Check your connection and try again.':e instanceof Error?e.message:'The connection was interrupted. Please try again.');
  }finally{clearTimeout(timer);}
 }
 throw new Error('Could not connect. Please try again.');
}
