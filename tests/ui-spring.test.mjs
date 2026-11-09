import test from 'node:test';
import assert from 'node:assert/strict';
import { stepSpring, shouldDismissSheet } from '../lib/ui-spring.mjs';
test('sheet returns without overshoot and preserves direction when retargeted', () => {
  let p=150,v=0;
  for(let i=0;i<120;i++){const n=stepSpring(p,v,0,1/60);assert.ok(n.position>=0&&n.position<=p);p=n.position;v=n.velocity;}
  assert.ok(p<.01);
  const n=stepSpring(100,300,0,1/240);
  assert.ok(n.position>100,'reversal starts with existing velocity, without a position jump');
});
test('a fast upward release cancels a far drag while a downward flick can dismiss', () => {
  assert.equal(shouldDismissSheet(220,-300,700),false);
  assert.equal(shouldDismissSheet(50,1100,700),true);
  assert.equal(shouldDismissSheet(10,1100,700),false);
  assert.equal(shouldDismissSheet(60,0,700),false);
});
