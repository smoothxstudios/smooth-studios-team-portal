import assert from 'node:assert/strict';
import {build} from 'esbuild';
await build({entryPoints:['lib/shot-order.ts','lib/shot-list.ts'],bundle:true,platform:'node',format:'esm',outdir:'.work/shot-order-test'});
const {placeShotAtNumber}=await import('../.work/shot-order-test/shot-order.js');
const {blankShot}=await import('../.work/shot-order-test/shot-list.js');
const shots=Array.from({length:14},(_,i)=>({...blankShot(),number:String(i+1),order:i+1,description:'Action '+(i+1),references:[{id:'reference-'+i,name:'Frame '+i,caption:'Keep this reference'}],values:{notes:'Saved notes '+i},status:i===5?'Complete':'Planned'}));
const before=structuredClone(shots);
const numbers=s=>s.slice().sort((a,b)=>Number(a.number)-Number(b.number));
function verify(result,source){
 assert.equal(new Set(result.map(s=>s.id)).size,result.length);
 for(const scene of new Set(result.map(s=>s.scene))){assert.deepEqual(numbers(result.filter(s=>s.scene===scene)).map(s=>s.number),result.filter(s=>s.scene===scene).map((_,i)=>String(i+1)));}
 for(const shot of source){const saved=result.find(s=>s.id===shot.id);assert.ok(saved);for(const field of ['description','references','values','status'])assert.deepEqual(saved[field],shot[field]);}
 assert.deepEqual(result.map(s=>s.order),result.map((_,i)=>i+1));
}
let moved=placeShotAtNumber(shots,{...shots[13],number:'10'});
verify(moved,shots);
assert.equal(moved[9].id,shots[13].id);assert.equal(moved[9].number,'10');
assert.deepEqual(moved.slice(10).map(s=>s.id),shots.slice(9,13).map(s=>s.id));
assert.deepEqual(moved.slice(10).map(s=>s.number),['11','12','13','14']);
moved=placeShotAtNumber(shots,{...shots[0],number:'14'});verify(moved,shots);assert.equal(moved[13].id,shots[0].id);
const fresh={...blankShot(shots),number:'10',description:'Inserted coverage'};
const inserted=placeShotAtNumber(shots,fresh);verify(inserted,shots);assert.equal(inserted[9].id,fresh.id);assert.equal(inserted[14].id,shots[13].id);
const appended=placeShotAtNumber(shots,{...fresh,number:'99999'});verify(appended,shots);assert.equal(appended[14].id,fresh.id);assert.equal(appended[14].number,'15');
const leading=placeShotAtNumber(shots,{...shots[13],number:' 01 '});verify(leading,shots);assert.equal(leading[0].id,shots[13].id);
const second=Array.from({length:2},(_,i)=>({...blankShot([], '2'),number:String(i+1),order:i+15}));
const across=placeShotAtNumber([...shots,...second],{...shots[13],scene:'2',number:'1'});verify(across,[...shots,...second]);assert.deepEqual(across.filter(s=>s.scene==='2').map(s=>s.id),[shots[13].id,...second.map(s=>s.id)]);
const other={...blankShot([], '3'),number:'19',order:17};
const isolated=placeShotAtNumber([...shots,...second,other],{...shots[13],number:'4'});assert.equal(isolated.find(s=>s.id===other.id).number,'19');assert.deepEqual(isolated.filter(s=>s.scene==='2').map(s=>s.number),['1','2']);
const sparse=[{...shots[0],number:'1'},{...shots[1],number:'5'},{...shots[2],number:'12'}];
const closed=placeShotAtNumber(sparse,{...shots[2],number:'2'});assert.deepEqual(closed.map(s=>s.number),['1','2','3']);
const manual=placeShotAtNumber(shots,{...shots[13],number:'10',order:2});assert.equal(manual.find(s=>s.id===shots[13].id).order,2);
const noteEdit=placeShotAtNumber(shots,{...shots[3],description:'Edited action only'});assert.deepEqual(noteEdit.map(s=>[s.id,s.number,s.order]),shots.map(s=>[s.id,s.number,s.order]));
const legacy={...shots[0],number:'1A'};assert.equal(placeShotAtNumber([legacy],{...legacy,description:'Legacy note edit'})[0].number,'1A');
for(const number of ['','0','-1','1.5','1A','9007199254740992'])assert.throws(()=>placeShotAtNumber(shots,{...fresh,number}),/whole shot number/);
assert.deepEqual(shots,before,'Reordering never mutates the open project before Save succeeds.');
console.log('Shot numbering checks passed: 14 to 10, moving later, insertion at occupied numbers, end placement, leading zeros, cross-scene moves, gap closure, preserved IDs/content, explicit filming order, and invalid positions.');
