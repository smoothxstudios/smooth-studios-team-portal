import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequestCoalescer } from '../lib/request-coalescer.mjs';
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r});return{promise,resolve};};
test('concurrent reads share only an account and path, then fetch fresh',async()=>{
 const requests=createRequestCoalescer(),gate=deferred();let calls=0;
 const fetch=()=>{calls++;return gate.promise};
 const first=requests.read('a','/schedule',fetch),second=requests.read('a','/schedule',fetch);
 assert.equal(first,second);
 const other=requests.read('b','/schedule',fetch),path=requests.read('a','/payroll',fetch);
 await Promise.resolve();assert.equal(calls,3);gate.resolve({ready:true});await Promise.all([first,other,path]);
 await requests.read('a','/schedule',()=>{calls++;return{fresh:true}});assert.equal(calls,4);
});
test('failed reads can retry and writes isolate older in-flight reads',async()=>{
 const requests=createRequestCoalescer();await assert.rejects(requests.read('a','/x',()=>{throw Error('offline')}));
 assert.equal(await requests.read('a','/x',()=>42),42);
 const old=deferred(),fresh=deferred();const before=requests.read('a','/x',()=>old.promise);
 requests.invalidate('a');const after=requests.read('a','/x',()=>fresh.promise);assert.notEqual(before,after);
 old.resolve('old');await before;
 assert.equal(requests.read('a','/x',()=>{throw Error('should share fresh')}),after);
 fresh.resolve('fresh');assert.equal(await after,'fresh');
});
