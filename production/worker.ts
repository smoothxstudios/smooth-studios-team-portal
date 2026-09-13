import {env} from 'cloudflare:workers';
import {auth} from './lib/auth';
import {api,identity,db,json} from './lib/server';
import * as session from './app/api/session/route';
import * as projects from './app/api/projects/route';
import * as project from './app/api/projects/[id]/route';
import * as crew from './app/api/projects/[id]/crew/route';
import * as files from './app/api/projects/[id]/files/route';
import * as file from './app/api/files/[id]/route';
import * as images from './app/api/images/route';
import * as image from './app/api/images/[id]/route';
import * as team from './app/api/team/route';
import * as imageUploads from './lib/image-uploads';
type Route=Record<string,(r:Request,c:any)=>Promise<Response>>;
const routes:[RegExp,Route][]=[[/^\/api\/image-uploads$/,{POST:imageUploads.start}],[/^\/api\/image-uploads\/([^/]+)$/,{PUT:imageUploads.part,POST:imageUploads.finish,DELETE:imageUploads.cancel}],[/^\/api\/session$/,session],[/^\/api\/team$/,team],[/^\/api\/projects$/,projects],[/^\/api\/projects\/([^/]+)\/crew$/,crew],[/^\/api\/projects\/([^/]+)\/files$/,files],[/^\/api\/projects\/([^/]+)$/,project],[/^\/api\/files\/([^/]+)$/,file],[/^\/api\/images$/,images],[/^\/api\/images\/([^/]+)$/,image]];
export default {async fetch(request:Request){
 const url=new URL(request.url);
 const response=await api(async()=>{
  if(url.pathname==='/api/health')return json({ok:true,service:'smooth-studios-productions',version:1,accountsReady:!!await db().prepare('SELECT id FROM user WHERE id=\'owner\'').first()});
  if(url.pathname.startsWith('/api/')){
   if(url.origin!==env.APP_ORIGIN)return json({error:'Use the production dashboard address to sign in.'},403);
   if(!['GET','HEAD'].includes(request.method)&&request.headers.get('origin')!==url.origin)return json({error:'Please reload the page before saving.'},403);
   if(Number(request.headers.get('content-length'))>22*1024*1024)return json({error:'This upload is too large.'},413);
   if(url.pathname.startsWith('/api/auth/')){
    const allowed:Record<string,string>={'/api/auth/sign-in/username':'POST','/api/auth/sign-out':'POST','/api/auth/get-session':'GET','/api/auth/change-password':'POST'};
    if(allowed[url.pathname]!==request.method)return json({error:'Not found.'},404);
    if(url.pathname==='/api/auth/change-password'){
     const me=await identity(request,true);const body=await request.json() as Record<string,unknown>;
     const result=await auth().handler(new Request(request,{body:JSON.stringify({...body,revokeOtherSessions:true})}));
     if(result.ok)await db().prepare('UPDATE user SET mustChangePassword=0 WHERE id=?').bind(me.id).run();return result;
    }
    return auth().handler(request);
   }
   for(const [pattern,module] of routes){const match=url.pathname.match(pattern);if(match){const handler=module[request.method];return handler?handler(request,{params:Promise.resolve({id:match[1]})}):json({error:'Method not allowed.'},405);}}
   return json({error:'Not found.'},404);
  }
  const asset=await env.ASSETS.fetch(request);
  // Missing scripts and fonts must never be replaced by the SPA's HTML.
  if((url.pathname.startsWith('/assets/')||url.pathname.startsWith('/fonts/'))&&asset.headers.get('Content-Type')?.includes('text/html'))return new Response('Asset unavailable. Refresh the production dashboard.',{status:404,headers:{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'}});
  return asset;
 });
 const headers=new Headers(response.headers);headers.set('X-Content-Type-Options','nosniff');headers.set('Referrer-Policy','same-origin');headers.set('X-Frame-Options','DENY');headers.set('Permissions-Policy','camera=(), microphone=(), geolocation=()');
 if(url.pathname.startsWith('/api/'))headers.set('Cache-Control','private, no-store');
 if(headers.get('Content-Type')?.includes('text/html'))headers.set('Cache-Control','no-cache');
 headers.set('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'");
 return new Response(response.body,{status:response.status,headers});
}};
