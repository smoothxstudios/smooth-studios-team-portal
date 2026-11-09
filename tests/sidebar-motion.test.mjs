import test from 'node:test';
import assert from 'node:assert/strict';
import { createSidebarMotion } from '../lib/sidebar-motion.mjs';
function setup(reduced=false){
 const properties=new Map(),attrs=new Map(),overlayAttrs=new Map(),frames=new Map();let id=0,now=0,opened=false,focused=0,shadeSettledBeforeClear=false;
 const panel={isConnected:false,dataset:{state:'closed'},hasAttribute:()=>false,setAttribute:(k,v)=>attrs.set(k,v),contains:()=>false,querySelector:()=>({focus:()=>focused++})};
 const preview={isConnected:true,dataset:{},hasAttribute:key=>key==='data-sidebar-preview'};
 const overlay={setAttribute:(k,v)=>overlayAttrs.set(k,v)};
 const root={style:{setProperty:(k,v)=>properties.set(k,v),removeProperty:k=>properties.delete(k)},setAttribute:(k,v)=>attrs.set(k,v),removeAttribute:k=>{if(k==='data-sidebar-motion'&&opened)shadeSettledBeforeClear=overlayAttrs.get('data-sidebar-settled')==='true';attrs.delete(k);}};
 const win={innerWidth:390,performance:{now:()=>now},requestAnimationFrame:fn=>{frames.set(++id,fn);return id;},cancelAnimationFrame:id=>frames.delete(id),matchMedia:()=>({matches:reduced})};
 const doc={defaultView:win,documentElement:root,querySelector:selector=>selector==='[data-sidebar-preview="true"]'?preview:opened?(selector==='.sidebar-backdrop[data-state="open"]'?overlay:panel):null};
 const motion=createSidebarMotion(doc,value=>{opened=value;panel.isConnected=value;panel.dataset.state=value?'open':'closed';});
 const tick=()=>{now+=16;for(const [id,fn] of [...frames]){frames.delete(id);fn(now);}};
 const finish=()=>{for(let i=0;frames.size&&i<150;i++)tick();assert.equal(frames.size,0);};
 return {motion,properties,attrs,tick,finish,get opened(){return opened;},get focused(){return focused;},get shadeSettledBeforeClear(){return shadeSettledBeforeClear;}};
}
test('opening tracks an inert preview and mounts the modal only after release and settlement',()=>{
 const f=setup();f.motion.begin(false,0);
 assert.equal(f.opened,false);assert.equal(f.attrs.get('data-sidebar-motion'),'preview');assert.equal(f.properties.get('--sidebar-drag-x'),'-340px');
 f.motion.move(100,100);assert.equal(f.properties.get('--sidebar-drag-x'),'-240px');
 f.tick();assert.equal(f.properties.get('--sidebar-drag-x'),'-240px','holding still does not animate');
 assert.equal(f.opened,false,'modal scroll locking cannot interrupt a held opening touch');
 f.motion.move(160,160);f.motion.end(true,170);f.finish();
 assert.equal(f.opened,true);assert.equal(f.focused,1);assert.equal(f.attrs.get('data-sidebar-settled'),'true');assert.equal(f.attrs.has('data-sidebar-motion'),false);
 assert.equal(f.shadeSettledBeforeClear,true,'the overlay cannot restart its fade when direct tracking ends');
});
test('a second drag closes the real modal without remounting it while held',()=>{
 const f=setup();f.motion.begin(false,0);f.motion.move(200,100);f.motion.end(true,150);f.finish();
 f.motion.begin(true,200);f.motion.move(-170,300);
 assert.equal(f.opened,true);assert.equal(f.attrs.get('data-sidebar-motion'),'panel');
 assert.equal(f.properties.get('--sidebar-drag-x'),'-170px');
 f.motion.end(false,350);f.finish();assert.equal(f.opened,false);assert.equal(f.properties.size,0);
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
 f.motion.end(true,150);assert.equal(f.opened,true);assert.equal(f.attrs.has('data-sidebar-motion'),false);assert.equal(f.shadeSettledBeforeClear,true);f.finish();
});
test('a new drag interrupts settlement at its current position',()=>{
 const f=setup();f.motion.begin(false,0);f.motion.move(170,100);f.motion.end(true,150);f.tick();
 const previous=parseFloat(f.properties.get('--sidebar-drag-x'));
 f.motion.begin(true,200);f.motion.move(-20,220);
 assert.equal(parseFloat(f.properties.get('--sidebar-drag-x')),Math.max(-340,previous-20));f.motion.cancel();f.finish();assert.equal(f.opened,true);
});
