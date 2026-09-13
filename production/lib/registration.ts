import {z} from 'zod';
import {db,readJSON,RequestError} from './server';

const signupSchema=z.object({
 name:z.string().trim().min(1,'Enter your name.').max(120,'Use a name with 120 characters or fewer.'),
 username:z.string().trim().toLowerCase().regex(/^[a-z0-9_.]{3,30}$/,'Choose a username with 3–30 letters, numbers, underscores, or periods.'),
 password:z.string().min(12,'Choose a password with at least 12 characters.').max(128,'Use a password with 128 characters or fewer.'),
});

/** Public registration accepts profile fields only; identity and access stay server-owned. */
export async function registrationRequest(request:Request):Promise<Request>{
 if(!request.headers.get('content-type')?.toLowerCase().startsWith('application/json'))throw new RequestError('Send account details as JSON.',415);
 const result=signupSchema.safeParse(await readJSON(request,4000));
 if(!result.success)throw new RequestError(result.error.issues[0].message);
 const {name,username,password}=result.data;
 const email=username+'@production.invalid';
 // Never let a new account claim a reserved identity or inherit an old email-based tag.
 if(['owner','smooth'].includes(username)||await db().prepare('SELECT id FROM project_members WHERE email=? LIMIT 1').bind(email).first())throw new RequestError('That username is unavailable. Sign in if you already have an account, or choose another username.',409);
 const headers=new Headers(request.headers);headers.delete('content-length');headers.set('Content-Type','application/json');
 // The internal alias matches existing username accounts. Submitted emails, IDs, roles,
 // verification flags, account status, and project tags never reach the auth provider.
 return new Request(request,{headers,body:JSON.stringify({name,username,password,email})});
}
