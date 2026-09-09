import {z} from 'zod';
import {hashPassword} from 'better-auth/crypto';
import {api,admin,db,json,readJSON,RequestError} from '@/lib/server';
const input=z.object({name:z.string().trim().min(1).max(120),username:z.string().trim().toLowerCase().regex(/^[a-z0-9_.]{3,30}$/),password:z.string().min(12).max(128),email:z.string().trim().toLowerCase().email().or(z.literal('')).default('')});
export async function GET(request:Request){return api(async()=>{await admin(request);const r=await db().prepare('SELECT id,name,username,email,enabled,mustChangePassword FROM user ORDER BY name').all();return json({accounts:r.results.map((x:any)=>({...x,enabled:!!x.enabled,mustChangePassword:!!x.mustChangePassword,email:x.email.endsWith('@production.invalid')?'':x.email}))});});}
export async function POST(request:Request){return api(async()=>{
 await admin(request);const p=input.parse(await readJSON(request,4000));const email=p.email||p.username+'@production.invalid';
 if(await db().prepare('SELECT id FROM user WHERE username=? OR email=?').bind(p.username,email).first())throw new RequestError('That username or email is already in use.',409);
 const id=crypto.randomUUID(),now=new Date().toISOString(),hash=await hashPassword(p.password);
 await db().batch([db().prepare('INSERT INTO user (id,name,username,displayUsername,email,emailVerified,createdAt,updatedAt,enabled,mustChangePassword) VALUES (?,?,?,?,?,0,?,?,1,1)').bind(id,p.name,p.username,p.username,email,now,now),db().prepare('INSERT INTO account (id,userId,accountId,providerId,password,createdAt,updatedAt) VALUES (?,?,?,\'credential\',?,?,?)').bind(crypto.randomUUID(),id,id,hash,now,now)]);
 return json({ok:true},201);
});}
export async function PUT(request:Request){return api(async()=>{
 const me=await admin(request),p=z.object({id:z.string().min(1),enabled:z.boolean().optional(),password:z.string().min(12).max(128).optional()}).parse(await readJSON(request,4000));
 if(p.id===me.id)throw new RequestError('Use Change password for your own account. The owner account cannot be disabled.');
 if(!await db().prepare('SELECT id FROM user WHERE id=?').bind(p.id).first())throw new RequestError('Account not found.',404);
 const batch:D1PreparedStatement[]=[];
 if(p.enabled!==undefined)batch.push(db().prepare('UPDATE user SET enabled=?,updatedAt=? WHERE id=?').bind(p.enabled?1:0,new Date().toISOString(),p.id));
 if(p.password){const hash=await hashPassword(p.password);batch.push(db().prepare('UPDATE account SET password=?,updatedAt=? WHERE userId=? AND providerId=\'credential\'').bind(hash,new Date().toISOString(),p.id));batch.push(db().prepare('UPDATE user SET mustChangePassword=1,updatedAt=? WHERE id=?').bind(new Date().toISOString(),p.id));}
 if(p.enabled===false||p.password)batch.push(db().prepare('DELETE FROM session WHERE userId=?').bind(p.id));
 if(!batch.length)throw new RequestError('Choose an account change.');await db().batch(batch);return json({ok:true});
});}
