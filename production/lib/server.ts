import { env } from "cloudflare:workers";
import {auth} from "./auth";
import {storage} from "./storage";
import { z } from "zod";
import type { Project } from "./shot-list";
import type {SessionUser} from "./production";
import {productionSchema} from "./production-schema";

export class RequestError extends Error { constructor(message:string,public status=400){super(message);} }
export function db(){if(!env.DB)throw new Error("Missing database binding");return env.DB;}
export function bucket(){return storage();}
export async function identity(request:Request,allowPasswordChange=false):Promise<SessionUser>{
 const session=await auth().api.getSession({headers:request.headers});
 if(!session)throw new RequestError("Sign in to open your productions.",401);
 const expected=request.headers.get('X-Production-Account');
 if(expected&&expected!==session.user.id)throw new RequestError("Your production account changed. Sign in again.",401);
 const row=await db().prepare('SELECT enabled,mustChangePassword,username FROM user WHERE id=?').bind(session.user.id).first<{enabled:number;mustChangePassword:number;username:string}>();
 if(!row?.enabled)throw new RequestError("This account is disabled. Contact Smooth.",403);
 if(row.mustChangePassword&&!allowPasswordChange&&new URL(request.url).pathname!=="/api/session")throw new RequestError("Set your own password before opening productions.",403);
 return {id:session.user.id,email:session.user.email,name:session.user.name,username:row.username,admin:session.user.id==="owner",mustChangePassword:!!row.mustChangePassword};
}
export async function admin(request:Request){const u=await identity(request);if(!u.admin)throw new RequestError("Only Smooth can manage team accounts.",403);return u;}
export type ProjectRow={id:string;owner:string;data:string;revision:number;updated_at:number;can_edit:number;can_manage?:number;is_owner?:number};
// Bind the signed-in user's id, owner flag, and email. The project alias is always p.
export const PROJECT_ACCESS_SQL="(p.owner = ? OR ? = 1 OR EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = p.id AND m.email = ?))";
export async function requireProject(id:string,u:SessionUser,access:"read"|"edit"|"manage"="read"):Promise<ProjectRow>{
  const row=await db().prepare("SELECT p.*, 1 AS can_edit FROM projects p WHERE p.id = ? AND "+PROJECT_ACCESS_SQL).bind(id,u.id,u.admin?1:0,u.email).first<ProjectRow>();
  if(!row)throw new RequestError("Project not found.",404);
  const isOwner=row.owner===u.id,canManage=u.admin||isOwner;
  if(access==='manage'&&!canManage)throw new RequestError('Only the project creator or Smooth can manage its team or delete this production.',403);
  return {...row,can_manage:canManage?1:0,is_owner:isOwner?1:0};
}
export async function readJSON(request:Request,limit=1000000){const raw=await request.text();if(raw.length>limit)throw new RequestError("This update is too large.",413);try{return JSON.parse(raw);}catch{throw new RequestError("Invalid request data.");}}
export async function api(fn:()=>Promise<Response>){try{return await fn();}catch(e){
  if(e instanceof RequestError)return Response.json({error:e.message},{status:e.status});
  if(e instanceof z.ZodError)return Response.json({error:"Some project details are invalid. Check the fields and try again."},{status:400});
  console.error("Production request failed",e);
  return Response.json({error:"We couldn’t save or load that right now. Your open draft is still here. Please try again."},{status:503});
}}
export function json(value:unknown,status=200){return Response.json(value,{status,headers:{"Cache-Control":"private, no-store"}});}
const short=z.string().max(500);
const fieldSchema=z.object({key:z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),label:z.string().trim().min(1).max(80),group:z.string().min(1).max(60),type:z.enum(["text","textarea","select","number"]),options:z.array(z.string().trim().min(1).max(160)).max(100).optional(),visible:z.boolean(),custom:z.boolean().optional()});
const shotSchema=z.object({id:z.string().uuid(),scene:short.min(1),number:short.min(1),description:z.string().max(12000),order:z.number().int().min(1).max(100000),status:z.enum(["Planned","Ready","In progress","Complete","Skipped"]),priority:z.enum(["Must have","Standard","If time"]),setup:z.number().min(0).max(10000),duration:z.number().min(0).max(100000),references:z.array(z.object({id:z.string().uuid(),name:short,caption:z.string().max(2000)})).max(8),values:z.record(z.string().max(12000))});
const projectSchema=z.object({id:z.string().uuid(),title:z.string().trim().min(1).max(160),client:short,date:z.string().max(10),brief:z.string().max(12000),shots:z.array(shotSchema).max(1500),fields:z.array(fieldSchema).max(60),revision:z.number().int().min(0),columns:z.array(z.string().max(80)).max(60).optional(),updatedAt:z.number().optional(),production:productionSchema});
export async function projectBody(request:Request):Promise<Project & {teamAccountIds?:string[]}>{
  const raw=await request.text();if(raw.length>1000000)throw new RequestError("This project is too large. Split it into separate shoot days.",413);
  let data;try{data=JSON.parse(raw);}catch{throw new RequestError("Invalid project data.");}
  const p=projectSchema.extend({teamAccountIds:z.array(z.string().min(1).max(80)).max(100).optional()}).parse(data);
  if(new Set(p.shots.map(s=>s.id)).size!==p.shots.length||new Set(p.fields.map(f=>f.key)).size!==p.fields.length)throw new RequestError("Duplicate shot or category IDs.");
  if(p.fields.some(f=>f.type==="select"&&(!f.options?.length||new Set(f.options).size!==f.options.length)))throw new RequestError("Dropdowns need unique options.");
  return p;
}
export async function checkImages(p:Project,user:SessionUser,previous?:Project){
  const ids=[...new Set(p.shots.flatMap(s=>s.references.map(r=>r.id)))];
  if(!ids.length)return;
  const prior=new Set(previous?.shots.flatMap(s=>s.references.map(r=>r.id))||[]);
  const accessible=await db().prepare("SELECT p.id FROM projects p WHERE "+PROJECT_ACCESS_SQL).bind(user.id,user.admin?1:0,user.email).all<{id:string}>();
  const allowed=new Set(accessible.results.map(p=>p.id));
  for(let i=0;i<ids.length;i+=50){const chunk=ids.slice(i,i+50);const rows=await db().prepare("SELECT id, owner, project_id FROM images WHERE id IN ("+chunk.map(()=>"?").join(",")+")").bind(...chunk).all<{id:string;owner:string;project_id:string|null}>();
    if(rows.results.length!==chunk.length||rows.results.some(r=>!user.admin&&!prior.has(r.id)&&!(r.project_id?allowed.has(r.project_id):r.owner===user.id)))throw new RequestError("A reference image is unavailable to this project. Remove it or upload a new copy.");
  }
}
export function readProject(row:{data:string;revision:number;updated_at:number;can_edit?:number;can_manage?:number;is_owner?:number}):Project{return {...JSON.parse(row.data),revision:row.revision,updatedAt:row.updated_at,canEdit:!!row.can_edit,canManage:!!row.can_manage,isOwner:!!row.is_owner};}
