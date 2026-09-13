import type {Shot} from './shot-list';

const storyOrder=(a:Shot,b:Shot)=>a.number.localeCompare(b.number,undefined,{numeric:true})||a.order-b.order;

/** Insert a saved shot at its numbered position without changing shot IDs or their linked data. */
export function placeShotAtNumber(shots:Shot[],incoming:Shot):Shot[]{
 const shot={...incoming,scene:incoming.scene.trim(),number:incoming.number.trim()};
 const previous=shots.find(s=>s.id===shot.id);
 if(previous&&previous.scene.trim()===shot.scene&&previous.number.trim()===shot.number){
  return shots.map(s=>s.id===shot.id?shot:s);
 }
 const position=Number(shot.number);
 if(!/^\d+$/.test(shot.number)||!Number.isSafeInteger(position)||position<1){
  throw new Error('Use a whole shot number of 1 or higher.');
 }
 const remaining=shots.filter(s=>s.id!==shot.id);
 const sceneShots=remaining.filter(s=>s.scene.trim()===shot.scene).sort(storyOrder);
 const index=Math.min(position-1,sceneShots.length);
 sceneShots.splice(index,0,shot);
 const updates=new Map<string,Shot>();
 const renumber=(items:Shot[])=>items.forEach((s,i)=>updates.set(s.id,{...s,number:String(i+1)}));
 renumber(sceneShots);
 if(previous&&previous.scene.trim()!==shot.scene){
  renumber(remaining.filter(s=>s.scene.trim()===previous.scene.trim()).sort(storyOrder));
 }
 // Keep an explicitly edited filming order. Otherwise place the moved shot next to
 // its new scene neighbor, so default table/storyboard/PDF ordering follows the move.
 const orderEdited=shot.order!==(previous?.order??Math.max(0,...shots.map(s=>s.order))+1);
 if(orderEdited)return [...remaining,shot].map(s=>updates.get(s.id)||s);
 const filming=remaining.slice().sort((a,b)=>a.order-b.order);
 const next=sceneShots[index+1],prior=sceneShots[index-1];
 let insert=next?filming.findIndex(s=>s.id===next.id):prior?filming.findIndex(s=>s.id===prior.id)+1:filming.findIndex(s=>s.scene.localeCompare(shot.scene,undefined,{numeric:true})>0);
 if(insert<0)insert=filming.length;
 filming.splice(insert,0,shot);
 return filming.map((s,i)=>({...(updates.get(s.id)||s),order:i+1}));
}
