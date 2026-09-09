import {DatabaseSync} from 'node:sqlite';
const sqlite=new DatabaseSync(':memory:');
export const env={APP_ORIGIN:'https://test.invalid',BETTER_AUTH_SECRET:'test-only-secret-with-more-than-32-characters',ASSETS:{fetch:async()=>new Response('Test assets')},DB:{
 prepare(sql){let args=[];return {bind(...values){args=values.map(v=>v instanceof ArrayBuffer?new Uint8Array(v):v);return this;},async first(column){const row=sqlite.prepare(sql).get(...args);return column?row?.[column]??null:row||null;},async all(){const rows=sqlite.prepare(sql).all(...args);return {results:rows,success:true,meta:{changes:Number(sqlite.prepare('SELECT changes() AS n').get().n)}};},async run(){const r=sqlite.prepare(sql).run(...args);return {success:true,results:[],meta:{changes:Number(r.changes),last_row_id:Number(r.lastInsertRowid)}};},async raw(){return sqlite.prepare(sql).all(...args).map(r=>Object.values(r));}};},
 async batch(statements){sqlite.exec('BEGIN');try{const results=[];for(const statement of statements)results.push(await statement.all());sqlite.exec('COMMIT');return results;}catch(e){sqlite.exec('ROLLBACK');throw e;}},
 async exec(sql){sqlite.exec(sql);return {count:1,duration:0};}
}};
