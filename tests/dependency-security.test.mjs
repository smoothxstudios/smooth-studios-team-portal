import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url), braces = require('braces');

test('patched braces rejects adversarial nesting and caller-supplied deep ASTs', () => {
  for (const pair of [['{','}'], ['(',')']]) {
    const pattern = pair[0].repeat(4000) + 'a,b' + pair[1].repeat(4000);
    for (const method of ['parse','compile','expand','stringify']) assert.throws(() => braces[method](pattern), /nesting exceeds limit/);
  }
  const ast = { type: 'root', nodes: [] }; let node = ast;
  for (let i=0; i<10000; i++) { const child={type:'brace',nodes:[]}; node.nodes.push(child); node=child; }
  for (const method of ['compile','expand','stringify']) assert.throws(() => braces[method](ast), /nesting exceeds limit/);
  const cyclic={type:'root',nodes:[]};cyclic.nodes.push(cyclic);
  assert.throws(()=>braces.stringify(cyclic),/nesting exceeds limit/);
});
test('patched build tooling preserves ordinary patterns and TypeScript transforms', async () => {
  assert.deepEqual(braces.expand('src/{app,lib}/{a,b}.ts'), ['src/app/a.ts','src/app/b.ts','src/lib/a.ts','src/lib/b.ts']);
  assert.equal(braces.compile('v{1..3}'), 'v([1-3])');
  assert.deepEqual(require('micromatch')(['src/app/a.ts','src/lib/b.js'], 'src/{app,lib}/*.ts'), ['src/app/a.ts']);
  assert.ok((await require('fast-glob')('lib/{team-auth,team-schedule}.mjs')).length === 2);
  const nested = createRequire(require.resolve('@esbuild-kit/core-utils'));
  const esbuild = nested('esbuild');
  assert.equal(esbuild.version, '0.25.12');
  assert.match(esbuild.transformSync('const x: number = 2', { loader: 'ts' }).code, /const x = 2/);
});
