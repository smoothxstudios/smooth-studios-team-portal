import test from 'node:test';
import assert from 'node:assert/strict';
import { createSidebarMotion } from '../lib/sidebar-motion.mjs';
function setup(reduced=false){
 const properties=new Map(),attrs=new Map(),frames=new Map();let id=0,now=0,opened=false,focused=0;
 const panel={isConnected:true,dataset:{state:'open'},setAttribute:(k,v)=>attrs.set(k,v),contains:()=>false,querySelector:()=>({focus:()=>focused++})};
 const root={style:{setProperty:(k,v)=>properties.set(k,v),removeProperty:k=>properties.delete(k)},setAttribute:(k,v)=>attrs.set(k,v),removeAttribute:k=>attrs.delete(k)};
 const win={innerWidth:390,performance:{now:()=>now},requestAnimationFrame:fn=>{frames.set(++id,fn);return id;},cancelAnimationFrame:id=>frames.delete(id),matchMedia:()=>({matches:reduced})};
 const doc={defaultView:win,documentElement:root,querySelector:()=>panel};
 const motion=createSidebarMotion(doc,value=>{opened=value;panel.isConnected=value;panel.dataset.state=value?'open':'closed';});
 const tick=()=>{now+=16;for(const [id,fn] of [...frames]){frames.delete(id);fn(now);}};
 const finish=()=>{for(let i=0;frames.size&&i<150;i++)tick();assert.equal(frames.size,0);};
 return {motion,properties,attrs,tick,finish,get opened(){return opened;},get focused(){return focused;}};
}
test('the real drawer mounts offscreen and follows exact drag distance without scheduling a tween',()=>{
 const f=setup();f.motion.begin(false,0);
 assert.equal(f.opened,true);assert.equal(f.properties.get('--sidebar-drag-x'),'-340px');
 f.motion.move(100,100);assert.equal(f.properties.get('--sidebar-drag-x'),'-240px');
 f.tick();assert.equal(f.properties.get('--sidebar-drag-x'),'-240px','holding still does not animate');
 f.motion.move(160,160);f.motion.end(true,170);f.finish();
 assert.equal(f.opened,true);assert.equal(f.focused,1);assert.equal(f.attrs.get('data-sidebar-settled'),'true');assert.equal(f.attrs.has('data-sidebar-motion'),false);
});
test('cancel and reverse return an opening drawer to closed without leaving an overlay',()=>{
 for(const cancelled of [true,false]){
 const f=setup();f.motion.begin(false,0);f.motion.move(250,100);
 if(cancelled)f.motion.cancel();else{f.motion.move(150,150);f.motion.end(true,160);}
 f.finish();assert.equal(f.opened,false);assert.equal(f.attrs.has('data-sidebar-motion'),false);assert.equal(f.properties.size,0);
 }
});
test('reduced motion preserves direct tracking and commits without a spring',()=>{
 const f=setup(true);f.motion.begin(false,0);f.motion.move(100,100);assert.equal(f.properties.get('--sidebar-drag-x'),'-240px');
 f.motion.end(true,150);assert.equal(f.opened,true);assert.equal(f.attrs.has('data-sidebar-motion'),false);f.finish();
});
test('a new drag interrupts settlement at its current position',()=>{
 const f=setup();f.motion.begin(false,0);f.motion.move(170,100);f.motion.end(true,150);f.tick();
 const previous=parseFloat(f.properties.get('--sidebar-drag-x'));
 f.motion.begin(true,200);f.motion.move(-20,220);
 assert.equal(parseFloat(f.properties.get('--sidebar-drag-x')),Math.max(-340,previous-20));f.motion.cancel();f.finish();assert.equal(f.opened,true);
});
